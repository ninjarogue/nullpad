// How each step of the gate is run, and how a runner says in its own output
// how many tests it ran. `test/test_counts.mjs` runs the gate with these, and
// `tools/mutants` runs the same checks against planted bugs, so that a change
// to how a runner is called or read is made once.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
    let report;
    try {
      report = JSON.parse(readFileSync(join(outDir, "report.json"), "utf8"));
    } catch (error) {
      throw new Error(`no readable report.json in ${outDir} (${error.code ?? error.message}): the run crashed before it wrote one`);
    }
    if (report.schemaVersion !== "report-1") {
      throw new Error(`report.json has schema ${report.schemaVersion}, and this reader knows report-1`);
    }
    const { summary, results } = report.run;
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

/**
 * A step is `{ id, cwd, command(outDir) -> argv, counted, read, env?, needs?, hint?, outIn? }`.
 * `outDir` is a new directory for the run's results, inside `outIn` when the
 * runner will not write anywhere else.
 * A counted step reports how many tests it ran, and the gate holds it to the
 * count in `test/test_counts.json`. One that is not counted must exit 0.
 */
export const gleamTest = { id: "gleam-test", cwd: root, counted: true, command: () => ["gleam", "test"], read: readers.gleeunit };

export const keystrokeCost = {
  id: "keystroke-cost",
  cwd: root,
  counted: true,
  command: () => ["node", "test/keystroke_cost.mjs"],
  read: readers.keystroke,
};

export const nodeTest = (id, file) => ({
  id,
  cwd: root,
  counted: true,
  command: () => ["node", "--test", "--test-reporter=tap", file],
  read: readers.nodeTest,
});

const e2eDir = join(root, "e2e");

// The e2e runner writes only inside its own project, in a folder git ignores.
const needsE2e = { outIn: join(e2eDir, ".e2e"), needs: join(e2eDir, "node_modules"), hint: "run 'cd e2e && npm install' once, then push again." };

export const e2eTypes = { id: "e2e-types", cwd: e2eDir, counted: false, command: () => ["npx", "tsc"], ...needsE2e };

/** The e2e configs in `dir`: `e2e.config.ts` and any `e2e.<name>.config.<ext>` beside it. */
export function e2eConfigs(dir = e2eDir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.config\.(?:ts|mts|js|mjs)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/** One e2e config, run the way `npm test` runs it, with its results written in the directory it is given. */
export const e2e = (config, args = []) => ({
  id: `e2e:${config}`,
  cwd: e2eDir,
  counted: true,
  command: (outDir) => ["npm", "test", "--", "--config", config, "--output", outDir, ...args],
  read: readers.e2e,
  env: { E2E_TELEMETRY_DISABLED: "1" },
  ...needsE2e,
});

/** Every step of the gate after the format check, in the order it runs. */
export function gateSteps() {
  return [gleamTest, keystrokeCost, nodeTest("test-counts", "test/test_counts.test.mjs"), e2eTypes, ...e2eConfigs().map((config) => e2e(config))];
}
