import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("..", import.meta.url));

const colours = /\u001b\[[0-9;]*m/g;
const plain = (text) => text.replace(colours, "");
const none = (runner, expected) => new Error(`no summary line in the output of ${runner} (${expected}): it crashed, or its output changed`);

export const readers = {
  gleeunit({ output }) {
    const text = plain(output);
    if (/^No tests found!$/m.test(text)) return { passed: 0, failed: 0, skipped: 0 };
    const found = [...text.matchAll(/^(\d+) passed, (?:no failures|(\d+) failures?)(?:, (\d+) skipped)?$/gm)].at(-1);
    if (!found) throw none("gleam test", "'N passed, no failures'");
    return { passed: Number(found[1]), failed: Number(found[2] ?? 0), skipped: Number(found[3] ?? 0) };
  },

  keystroke({ output }) {
    const found = output.match(/^keystroke_cost: (?<ok>\d+) ok, (?<failed>\d+) failed, (?<notBuilt>\d+) not built yet$/m);
    if (!found) throw none("test/keystroke_cost.mjs", "'keystroke_cost: N ok, N failed, N not built yet'");
    const { ok, failed } = found.groups;
    return { passed: Number(ok), failed: Number(failed), skipped: 0 };
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

export const heldNames = ["expected-fail", "todo"];

const collapse = (text) => text.replace(/[│┌┐└┘├┤┬┴┼─']/g, " ").replace(/\s+/g, " ").trim();
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

const stepRequired = ["id", "cwd", "counted", "command"];
const stepOptional = ["read", "failing", "held", "compileFailed", "build", "narrow", "env", "needs", "hint", "outIn"];

export function step(fields) {
  const unknown = Object.keys(fields).filter((name) => !stepRequired.includes(name) && !stepOptional.includes(name));
  const missing = stepRequired.filter((name) => fields[name] === undefined);
  if (fields.counted === true && fields.read === undefined) missing.push("read");
  if (unknown.length > 0 || missing.length > 0) {
    const problems = [unknown.length > 0 && `unknown ${unknown.join(", ")}`, missing.length > 0 && `missing ${missing.join(", ")}`].filter(Boolean);
    throw new Error(`step ${fields.id ?? JSON.stringify(Object.keys(fields))}: ${problems.join("; ")}`);
  }
  return fields;
}

export const gleamTest = step({
  id: "gleam-test",
  cwd: root,
  counted: true,
  command: () => ["gleam", "test"],
  read: readers.gleeunit,
  failing: failedTests.gleeunit,
  // `gleam test` compiles the tests too, and prints "Running" once they start.
  compileFailed: (output) => /^error:/m.test(plain(output)) && !/Running .*\.main/.test(plain(output)),
});

export const gleamBuild = step({ id: "build", cwd: root, counted: false, build: true, command: () => ["gleam", "build"] });

export const keystrokeCost = step({
  id: "keystroke-cost",
  cwd: root,
  counted: true,
  command: () => ["node", "test/keystroke_cost.mjs"],
  read: readers.keystroke,
  failing: failedTests.keystroke,
});

export const nodeTest = (id, file) => step({
  id,
  cwd: root,
  counted: true,
  command: () => ["node", "--test", "--test-reporter=tap", file],
  read: readers.nodeTest,
  held: heldBack.nodeTest,
  failing: failedTests.nodeTest,
});

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

export function strayNodeTests(steps, base = root) {
  const run = new Set(steps.flatMap((step) => step.command("").filter((arg) => nodeTestName.test(arg))));
  return nodeTestsNamed(base).filter((file) => !run.has(file));
}

const e2eDir = join(root, "e2e");

// The e2e runner writes only inside its own project, in a folder git ignores.
const needsE2e = { outIn: join(e2eDir, ".e2e"), needs: join(e2eDir, "node_modules"), hint: "run 'cd e2e && npm install' once, then push again." };

export const e2eTypes = step({ id: "e2e-types", cwd: e2eDir, counted: false, command: () => ["npx", "tsc"], ...needsE2e });

export const e2eDiscovery = step({ id: "e2e-discovery", cwd: root, counted: false, command: () => ["node", "test/e2e_discovery.mjs"], ...needsE2e });

export const typist = step({ id: "typist", cwd: e2eDir, counted: false, command: () => ["npm", "run", "typist"], ...needsE2e });

export function e2eConfigs(dir = e2eDir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.config\.(?:ts|mts|js|mjs)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

export const e2e = (config, args = []) => step({
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

export function gateSteps() {
  return [gleamTest, keystrokeCost, nodeTest("test-counts", "test/test_counts.test.mjs"), nodeTest("mutants-tool", "tools/mutants/mutants.test.mjs"), nodeTest("test-cleanup", "test/scratch.test.mjs"), nodeTest("e2e-server", "test/serve.test.mjs"), nodeTest("e2e-discovery-tool", "test/e2e_discovery.test.mjs"), nodeTest("judges", "test/judges.test.mjs"), nodeTest("pick", "test/pick.test.mjs"), nodeTest("typist-shifts", "test/typist_shifts.test.mjs"), e2eTypes, e2eDiscovery, ...e2eConfigs().map((config) => e2e(config)), typist];
}
