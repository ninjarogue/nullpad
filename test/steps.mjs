// How each step of the gate is run, and how a runner says in its own output
// how many tests it ran. `test/test_counts.mjs` runs the gate with these, and
// `tools/mutants` runs the same checks against planted bugs, so that a change
// to how a runner is called or read is made once.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("..", import.meta.url));

const colours = /\u001b\[[0-9;]*m/g;
const plain = (text) => text.replace(colours, "");
const none = (runner, expected) => new Error(`no summary line in the output of ${runner} (${expected}): it crashed, or its output changed`);

// A reader takes what a run printed (`output`) and the directory it was told
// to write its results in (`outDir`), and returns how many tests passed,
// failed and were skipped. It throws when the run said nothing readable.
export const readers = {
  gleeunit({ output }) {
    const text = plain(output);
    if (/^No tests found!$/m.test(text)) return { passed: 0, failed: 0, skipped: 0 };
    const found = [...text.matchAll(/^(\d+) passed, (?:no failures|(\d+) failures?)(?:, (\d+) skipped)?$/gm)].at(-1);
    if (!found) throw none("gleam test", "'N passed, no failures'");
    return { passed: Number(found[1]), failed: Number(found[2] ?? 0), skipped: Number(found[3] ?? 0) };
  },

  // An event whose code is still `todo` is not a test that was skipped: the
  // gate holds the count of checks that are ok, so one that goes back to
  // `todo` lowers it.
  keystroke({ output }) {
    const found = output.match(/^keystroke_cost: (\d+) ok, (\d+) failed, (\d+) not built yet$/m);
    if (!found) throw none("test/keystroke_cost.mjs", "'keystroke_cost: N ok, N failed, N not built yet'");
    return { passed: Number(found[1]), failed: Number(found[2]), skipped: 0 };
  },

  nodeTest({ output }) {
    const total = {};
    for (const [, name, count] of output.matchAll(/^# (tests|pass|fail|cancelled|skipped) (\d+)$/gm)) total[name] = Number(count);
    if (total.tests === undefined || total.pass === undefined) throw none("node --test", "'# tests N' and '# pass N'");
    return { passed: total.pass, failed: (total.fail ?? 0) + (total.cancelled ?? 0), skipped: total.skipped ?? 0 };
  },

  e2e({ outDir }) {
    const { summary, results } = readReport(outDir);
    const passed = results.filter((result) => result.status === "passed").length;
    if (passed !== summary.passed) {
      throw new Error(`report.json disagrees with itself: its summary says ${summary.passed} passed and its results show ${passed}`);
    }
    return {
      passed: summary.passed,
      failed: summary.failed + summary.interrupted + summary.flaky,
      skipped: summary.skipped,
    };
  },
};

function readReport(outDir) {
  let report;
  try {
    report = JSON.parse(readFileSync(join(outDir, "report.json"), "utf8"));
  } catch (error) {
    throw new Error(`no readable report.json in ${outDir} (${error.code ?? error.message}): the run crashed before it wrote one`);
  }
  if (report.schemaVersion !== "report-1") {
    throw new Error(`report.json has schema ${report.schemaVersion}, and this reader knows report-1`);
  }
  return report.run;
}

/**
 * What a run held back from its count without failing: tests that are not
 * checks of the code, or that do not say when it breaks. A held reader takes
 * what a reader takes and gives `{ name: count }`. The gate holds each count
 * to the one in `test/test_counts.json` under "<step id> <name>", which is 0
 * when the file has no line for it, and only a hand edit raises it.
 */
export const heldBack = {
  // A test marked `test.fail` passes by failing, so the passes do not say whether
  // the thing it marks still fails. One that passed instead is a failed test already.
  e2e({ outDir }) {
    const { results } = readReport(outDir);
    return { "expected-fail": results.filter((result) => result.status === "passed" && result.expectedFailure).length };
  },

  // Node counts a todo apart from the passes, and a todo that fails fails nothing.
  nodeTest({ output }) {
    const found = plain(output).match(/^# todo (\d+)$/m);
    if (!found) throw none("node --test", "'# todo N'");
    return { todo: Number(found[1]) };
  },
};

/** The names a step can hold something back under, as they end a key of `test/test_counts.json`. */
export const heldNames = ["expected-fail", "todo"];

const collapse = (text) => text.replace(/[│┌┐└┘├┤┬┴┼─']/g, " ").replace(/\s+/g, " ").trim();
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Which tests failed, as the runner says: names to show a person and to run
 * again. A reader takes what a reader takes and gives a list of names. It is
 * a best effort, so a run that failed in some way it does not know gives [].
 */
export const failedTests = {
  gleeunit({ output }) {
    const text = plain(output);
    return [...text.matchAll(/^ test: (.+)$|^(\S+\.\S+)\nAn unexpected error occurred:/gm)].map((found) => found[1] ?? found[2]);
  },

  keystroke({ output }) {
    return plain(output)
      .split("\n")
      .filter((line) => /OVER BUDGET|has no entry|^undo history: .*(?:could be undone|, over )/.test(line))
      .map(collapse);
  },

  nodeTest({ output }) {
    const failed = [];
    for (const [, body] of plain(output).matchAll(/^\s*not ok \d+ - (.*)$/gm)) {
      const [title, ...directive] = body.split(" # ");
      if (!/^(?:TODO|SKIP)/i.test(directive.join(" # "))) failed.push(title.trim());
    }
    return failed;
  },

  e2e({ outDir }) {
    return readReport(outDir)
      .results.filter((result) => result.status !== "passed" && result.status !== "skipped")
      .map((result) => [result.file, ...result.titlePath].join(" > "));
  },
};

/**
 * A step is `{ id, cwd, command(outDir) -> argv, counted, read, held?, env?, needs?, hint?, outIn? }`.
 * `outDir` is a new directory for the run's results, inside `outIn` when the
 * runner will not write anywhere else.
 * A counted step reports how many tests it ran, and the gate holds it to the
 * count in `test/test_counts.json`. One that is not counted must exit 0.
 */
export const gleamTest = {
  id: "gleam-test",
  cwd: root,
  counted: true,
  command: () => ["gleam", "test"],
  read: readers.gleeunit,
  failing: failedTests.gleeunit,
  // `gleam test` compiles the tests too, and prints "Running" once they start.
  compileFailed: (output) => /^error:/m.test(plain(output)) && !/Running .*\.main/.test(plain(output)),
};

/** What a planted bug has to get through before any test runs. `tools/mutants` counts a failure here as INVALID. */
export const gleamBuild = { id: "build", cwd: root, counted: false, build: true, command: () => ["gleam", "build"] };

export const keystrokeCost = {
  id: "keystroke-cost",
  cwd: root,
  counted: true,
  command: () => ["node", "test/keystroke_cost.mjs"],
  read: readers.keystroke,
  failing: failedTests.keystroke,
};

export const nodeTest = (id, file) => ({
  id,
  cwd: root,
  counted: true,
  command: () => ["node", "--test", "--test-reporter=tap", file],
  read: readers.nodeTest,
  held: heldBack.nodeTest,
  failing: failedTests.nodeTest,
});

/** Every `*.test.mjs` under `test/` and `tools/` of `base`, as paths from it, sorted. */
export function nodeTestFiles(base = root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && !entry.name.startsWith(".")) walk(path);
      } else if (entry.name.endsWith(".test.mjs")) {
        found.push(relative(base, path));
      }
    }
  };
  for (const top of ["test", "tools"]) walk(join(base, top));
  return found.sort();
}

const nodeTestName = /\.test\.(?:mjs|cjs|js|mts|cts|ts)$/;
const neverTests = new Set(["node_modules", ".git"]);
const madeAtTop = new Set(["build", "dist", ".lustre", ".mutants", ".verify"]);

/** Every file in `base` named like a node test, outside node_modules and what the build and the tools make, as paths from it, sorted. */
export function nodeTestsNamed(base = root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const from = relative(base, path);
      if (entry.isDirectory()) {
        if (!neverTests.has(entry.name) && !(madeAtTop.has(from)) && from !== join("e2e", ".e2e")) walk(path);
      } else if (nodeTestName.test(entry.name)) {
        found.push(from);
      }
    }
  };
  walk(base);
  return found.sort();
}

/** The files named like a node test, anywhere in `base`, that no command of `steps` names, so that nothing runs them. */
export function strayNodeTests(steps, base = root) {
  const run = new Set(steps.flatMap((step) => step.command("").filter((arg) => nodeTestName.test(arg))));
  return nodeTestsNamed(base).filter((file) => !run.has(file));
}

const e2eDir = join(root, "e2e");

// The e2e runner writes only inside its own project, in a folder git ignores.
const needsE2e = { outIn: join(e2eDir, ".e2e"), needs: join(e2eDir, "node_modules"), hint: "run 'cd e2e && npm install' once, then push again." };

export const e2eTypes = { id: "e2e-types", cwd: e2eDir, counted: false, command: () => ["npx", "tsc"], ...needsE2e };

/** Every file under e2e/ that looks like a test is one a config discovers, so that none sits there unrun. */
export const e2eDiscovery = { id: "e2e-discovery", cwd: root, counted: false, command: () => ["node", "test/e2e_discovery.mjs"], ...needsE2e };

/** The e2e configs in `dir`: `e2e.config.ts` and any `e2e.<name>.config.<ext>` beside it. */
export function e2eConfigs(dir = e2eDir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.config\.(?:ts|mts|js|mjs)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * One e2e config, run the way `npm test` runs it, with its results written in
 * the directory it is given. `narrow` is the same step for only the tests
 * named, as `failing` gives them, so that they can be run again alone.
 */
export const e2e = (config, args = []) => ({
  id: `e2e:${config}`,
  cwd: e2eDir,
  counted: true,
  command: (outDir) => ["npm", "test", "--", "--config", config, "--output", outDir, ...args],
  read: readers.e2e,
  held: heldBack.e2e,
  failing: failedTests.e2e,
  narrow: (names) => e2e(config, [...args, ...[...new Set(names)].map((name) => name.split(" > ").slice(1).join(" ")).filter((title) => title !== "").flatMap((title) => ["--grep", escapeRegExp(title)])]),
  env: { E2E_TELEMETRY_DISABLED: "1" },
  ...needsE2e,
});

/** Every step of the gate after the format check, in the order it runs. */
export function gateSteps() {
  return [gleamTest, keystrokeCost, nodeTest("test-counts", "test/test_counts.test.mjs"), nodeTest("mutants-tool", "tools/mutants/mutants.test.mjs"), nodeTest("test-cleanup", "test/scratch.test.mjs"), nodeTest("e2e-server", "test/serve.test.mjs"), nodeTest("e2e-discovery-tool", "test/e2e_discovery.test.mjs"), e2eTypes, e2eDiscovery, ...e2eConfigs().map((config) => e2e(config))];
}
