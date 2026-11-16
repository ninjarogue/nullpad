// The gate fails when a step runs no tests, or fewer than it last did.
//
//   node test/test_counts.mjs run [--no-commit-check] [step ...]
//
// With no step it runs every step of the gate (`test/steps.mjs`), the way
// `.githooks/pre-push` does, and stops at the first that fails. A step's count
// is read from what its runner prints or writes, never from the source, and is
// held to `test/test_counts.json`. A run with more tests than the file says
// raises the file, which is then committed. A run with fewer fails, and the
// count can only be lowered by editing the file by hand, so that the removal
// shows in the diff. The run also fails while the file differs from HEAD,
// because a raise or a hand edit that is not committed holds nothing for the
// next clone; `--no-commit-check` is for a run kept on one machine.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gateSteps, heldNames, root, strayNodeTests } from "./steps.mjs";

export const countsFile = fileURLToPath(new URL("./test_counts.json", import.meta.url));
const COUNTS = "test/test_counts.json";

const tests = (n) => `${n} test${n === 1 ? "" : "s"}`;

/** The known count of every step, by step id. */
export function loadCounts(file = countsFile) {
  let counts;
  try {
    counts = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${COUNTS} cannot be read (${error.code ?? error.message}): a gate with no counts holds nothing`);
  }
  if (counts === null || typeof counts !== "object" || Array.isArray(counts)) {
    throw new Error(`${COUNTS} must be an object of step ids and test counts`);
  }
  for (const [id, count] of Object.entries(counts)) {
    if (!Number.isSafeInteger(count) || count < 1) {
      throw new Error(`${COUNTS}: the count for ${id} must be a whole number of at least 1, not ${JSON.stringify(count)}`);
    }
  }
  return counts;
}

function saveCounts(file, counts) {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const next = `${file}.next`;
  writeFileSync(next, JSON.stringify(sorted, null, 2) + "\n");
  renameSync(next, file);
}

/**
 * What a run of a counted step says about the gate. `counts` is what the
 * runner reported, or null with the `problem` that kept it from being read.
 * `raise` is the new count to record, or null.
 */
export function judge({ id, known, exitCode, signal, counts, problem }) {
  const failures = [];
  if (signal) failures.push(`${id}: the command was killed by ${signal}`);
  else if (exitCode !== 0) failures.push(`${id}: the command exited ${exitCode}`);
  if (counts === null) {
    failures.push(`${id}: ${problem}`);
    return { failures, raise: null };
  }
  if (counts.failed > 0) failures.push(`${id}: ${tests(counts.failed)} failed`);
  if (counts.skipped > 0) failures.push(`${id}: ${tests(counts.skipped)} skipped, and a skipped test did not run`);
  if (counts.passed === 0) {
    failures.push(`${id}: ran 0 tests`);
  } else if (known !== undefined && counts.passed < known) {
    failures.push(
      `${id}: ran ${tests(counts.passed)}, and the last known count is ${known} (${COUNTS}). Tests are missing. ` +
        `If removing them is intended, lower the count by hand in ${COUNTS}, so the removal shows in the diff.`,
    );
  }
  const raise = failures.length === 0 && counts.passed > (known ?? 0) ? counts.passed : null;
  return { failures, raise };
}

const heldKey = (id, name) => `${id} ${name}`;

const heldReasons = {
  "expected-fail": "marked test.fail, and a test marked to fail passes by failing, so a real failure can hide behind the mark",
  todo: "marked todo, and a todo test that fails fails nothing",
};

/** The step a key of the counts file belongs to: its id, with the name of what it holds back taken off. */
export function stepOf(key) {
  const name = heldNames.find((held) => key.endsWith(` ${held}`));
  return name ? key.slice(0, -(name.length + 1)) : key;
}

/**
 * What a run says about the tests the step held back from its count. `known`
 * is `{ name: count }` as the counts file has it, and `held` what the run
 * reported. More than known fails: only a hand edit allows one more. Fewer is
 * `lower`, the new numbers to record, so that the room that is left cannot be
 * spent on a new one.
 */
export function judgeHeld({ id, known = {}, held = {} }) {
  const failures = [];
  const lower = {};
  for (const [name, count] of Object.entries(held)) {
    const allowed = known[name] ?? 0;
    if (count > allowed) {
      failures.push(
        `${id}: ${tests(count)} ${heldReasons[name] ?? `held back as ${name}`}, and ${COUNTS} allows ${allowed}. ` +
          `If that is intended, set "${heldKey(id, name)}": ${count} in ${COUNTS} by hand, so it shows in the diff.`,
      );
    } else if (count < allowed) {
      lower[name] = count;
    }
  }
  return { failures, lower };
}

const live = new Set();
const liveDirs = new Set();

/** Kills what `spawnCapture` has started that is still running, with everything it started. */
export function killAll() {
  for (const child of live) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

/** Removes the results folders of the runs that are still going, as `runCheck` would when they ended. */
export function removeLiveDirs() {
  for (const dir of liveDirs) rmSync(dir, { recursive: true, force: true });
  liveDirs.clear();
}

/**
 * Stops everything that was started when the process is told to stop (Ctrl+C,
 * `kill`, a terminal that is closed): the commands it runs and the folders
 * they write in go, `cleanup(signal)` runs, and the process ends with 128 and
 * the number of the signal. Gives a function that takes the handlers off.
 */
export function stopOnSignals(cleanup = () => {}) {
  const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => {
    const handler = () => {
      killAll();
      removeLiveDirs();
      cleanup(signal);
      process.exit(128 + constants.signals[signal]);
    };
    process.on(signal, handler);
    return [signal, handler];
  });
  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}

/**
 * Runs `argv` and gives back its exit code, the signal that ended it, and
 * everything it printed, which `write` also gets as it comes. It is run in a
 * group of its own, so that `killAll` ends what it started too. With a
 * `timeoutMs` the command is killed when it runs over, and the caller is told so.
 */
export function spawnCapture(argv, { cwd, env, timeoutMs }, write) {
  return new Promise((done) => {
    let output = "";
    let timedOut = false;
    const take = (chunk) => {
      const text = chunk.toString();
      output += text;
      write(text);
    };
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    live.add(child);
    const timer =
      timeoutMs === undefined
        ? null
        : setTimeout(() => {
            timedOut = true;
            killAll();
          }, timeoutMs);
    const finish = (exitCode, signal) => {
      clearTimeout(timer);
      live.delete(child);
      done({ exitCode, signal, output, timedOut });
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => {
      take(`${error.message}\n`);
      finish(127, null);
    });
    child.on("close", finish);
  });
}

/**
 * Runs one step in a new results directory, which is removed after, and reads
 * its count and what it held back. Gives the exit code, the signal, whether it
 * timed out, the output, `counts` (null with a `problem` when the runner said
 * nothing readable), `held`, `{ name: count }`, and `failing`, the names of
 * the tests that failed as far as the runner says.
 */
export async function runCheck(step, { write = () => {}, timeoutMs } = {}) {
  if (step.outIn) mkdirSync(step.outIn, { recursive: true });
  const outDir = mkdtempSync(join(step.outIn ?? tmpdir(), "step-"));
  liveDirs.add(outDir);
  try {
    const run = await spawnCapture(step.command(outDir), { cwd: step.cwd, env: step.env, timeoutMs }, write);
    let counts = null;
    let held = {};
    let failing = [];
    let problem;
    if (step.counted) {
      try {
        counts = step.read({ output: run.output, outDir });
        held = step.held ? step.held({ output: run.output, outDir }) : {};
      } catch (error) {
        counts = null;
        problem = error.message;
      }
      try {
        failing = step.failing ? step.failing({ output: run.output, outDir }) : [];
      } catch {}
    }
    return { ...run, counts, held, failing, problem };
  } finally {
    liveDirs.delete(outDir);
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** Runs one step and holds it to its known count, raising the count in `file` when more tests ran. */
export async function runStep(step, { countsFile: file = countsFile, log = console.log, write = (text) => process.stdout.write(text) } = {}) {
  const all = loadCounts(file);
  if (step.needs && !existsSync(step.needs)) {
    return { ok: false, id: step.id, failures: [`${step.id}: ${step.hint ?? `${step.needs} is missing`}`], raised: null };
  }
  log(`==> ${step.id}`);
  const { exitCode, signal, counts, held, problem } = await runCheck(step, { write });
  if (!step.counted) {
    const failures = exitCode === 0 && !signal ? [] : [`${step.id}: the command ${signal ? `was killed by ${signal}` : `exited ${exitCode}`}`];
    return { ok: failures.length === 0, id: step.id, failures, raised: null, lowered: {} };
  }
  const known = all[step.id];
  const verdict = judge({ id: step.id, known, exitCode, signal, counts, problem });
  const knownHeld = Object.fromEntries(Object.keys(held).map((name) => [name, all[heldKey(step.id, name)] ?? 0]));
  const heldVerdict = judgeHeld({ id: step.id, known: knownHeld, held });
  const failures = [...verdict.failures, ...heldVerdict.failures];
  const lowered = failures.length === 0 ? heldVerdict.lower : {};
  const raise = failures.length === 0 ? verdict.raise : null;
  if (raise !== null || Object.keys(lowered).length > 0) {
    const next = { ...loadCounts(file) };
    if (raise !== null) next[step.id] = raise;
    for (const [name, count] of Object.entries(lowered)) {
      if (count === 0) delete next[heldKey(step.id, name)];
      else next[heldKey(step.id, name)] = count;
    }
    saveCounts(file, next);
  }
  if (raise !== null) log(`${step.id}: ${tests(raise)}, up from ${known ?? "none"}. ${COUNTS} is raised: commit it.`);
  for (const [name, count] of Object.entries(lowered)) {
    log(`${step.id}: ${count} ${name}, down from ${knownHeld[name]}. ${COUNTS} is lowered: commit it.`);
  }
  if (failures.length === 0 && raise === null) log(`${step.id}: ${tests(counts.passed)}, as known`);
  return { ok: failures.length === 0, id: step.id, failures, raised: raise, lowered };
}

const withoutGitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"].includes(name)));

/**
 * What to say when `file` is not what HEAD of the repository at `base` has:
 * new, changed, or staged and not committed. Null when it is committed as it
 * is, and a failure of its own when git cannot say.
 */
export function uncommitted(base = root, file = countsFile) {
  const shown = relative(base, file).split("\\").join("/");
  const name = shown.startsWith("..") || isAbsolute(shown) ? file : shown;
  let status;
  try {
    status = execFileSync("git", ["status", "--porcelain", "--", file], { cwd: base, env: withoutGitEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const said = `${error.stderr ?? error.message}`.trim().split("\n")[0];
    return `${name}: cannot tell whether it is committed (${said}). Commit ${name}, or run with --no-commit-check for a deliberate local run.`;
  }
  if (status === "") return null;
  return (
    `commit ${name}: it ${status.startsWith("??") ? "is not in HEAD" : "differs from HEAD"}, and a count that only this working tree has holds nothing for the next clone. ` +
    "Commit it, or run with --no-commit-check for a deliberate local run."
  );
}

/** What to say when `git push` in `base` would run no gate: its `core.hooksPath` is not `.githooks`. Null when it is. */
export function hooksWarning(base = root) {
  let value = "";
  try {
    value = execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd: base, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {}
  if (value !== "" && resolve(base, value) === resolve(base, ".githooks")) return null;
  return (
    `core.hooksPath is ${value === "" ? "not set" : JSON.stringify(value)}, so git push in this clone runs no gate. ` +
    "Run `git config core.hooksPath .githooks` once, or run `node test/test_counts.mjs run` before every push."
  );
}

/**
 * Runs `steps` in order and stops at the first that fails. Given the `base` of
 * a repository, it also warns when a push there would run no gate, and, when
 * every step of the gate ran (not `partial`), fails on a node test file that
 * no step runs. Then too, a known count with no step to run it fails, so a
 * step cannot be dropped from the gate and leave its count behind.
 */
export async function gate({ steps, countsFile: file = countsFile, partial = false, base, commitCheck = false, ...io }) {
  loadCounts(file);
  const warnings = base === undefined ? [] : [hooksWarning(base)].filter((warning) => warning !== null);
  const ran = [];
  const raised = {};
  const lowered = {};
  for (const step of steps) {
    const verdict = await runStep(step, { countsFile: file, ...io });
    ran.push(step.id);
    if (verdict.raised !== null) raised[step.id] = verdict.raised;
    for (const [name, count] of Object.entries(verdict.lowered ?? {})) lowered[heldKey(step.id, name)] = count;
    if (!verdict.ok) return { ok: false, ran, raised, lowered, warnings, failures: verdict.failures };
  }
  const orphans = partial ? [] : Object.entries(loadCounts(file)).filter(([key]) => !ran.includes(stepOf(key)));
  const removed = " If the step was removed on purpose, remove its line from " + `${COUNTS} by hand.`;
  const unsaved = commitCheck ? uncommitted(base ?? root, file) : null;
  const failures = [
    ...(unsaved === null ? [] : [unsaved]),
    ...orphans.map(([key, count]) =>
      key === stepOf(key)
        ? `${key}: ${COUNTS} knows ${tests(count)} for it, and no step of the gate runs it.${removed}`
        : `${key}: ${COUNTS} allows ${count} for ${stepOf(key)}, and no step of the gate runs it.${removed}`,
    ),
    ...(partial || base === undefined ? [] : strayNodeTests(steps, base)).map(
      (name) => `${name}: it is named like a node test and no step of the gate runs it. Add a step for it in test/steps.mjs, or rename it if it is not a test.`,
    ),
  ];
  return { ok: failures.length === 0, ran, raised, lowered, warnings, failures };
}

const usage = "usage: node test/test_counts.mjs run [--no-commit-check] [step ...]";

/** What the command line asks for: `{ selected, commitCheck }`, or an `error` to print. */
export function parseArgs(args) {
  const [command, ...rest] = args;
  const flags = rest.filter((arg) => arg.startsWith("--"));
  const unknown = flags.filter((flag) => flag !== "--no-commit-check");
  if (command !== "run") return { error: usage };
  if (unknown.length > 0) return { error: `unknown option ${unknown.join(", ")}. ${usage}` };
  return { selected: rest.filter((arg) => !arg.startsWith("--")), commitCheck: !flags.includes("--no-commit-check") };
}

async function main(args) {
  const { selected, commitCheck, error } = parseArgs(args);
  if (error !== undefined) {
    console.error(error);
    return 2;
  }
  const every = gateSteps();
  const names = new Set(every.map((step) => step.id));
  const steps = selected.length === 0 ? every : every.filter((step) => selected.includes(step.id) || (selected.includes("e2e") && step.id.startsWith("e2e:")));
  const unknown = selected.filter((name) => name !== "e2e" && !names.has(name));
  if (unknown.length > 0) {
    console.error(`unknown step ${unknown.join(", ")}. Steps: ${[...names].join(", ")}, e2e`);
    return 2;
  }
  const stop = stopOnSignals((signal) => console.error(`\n${signal}: the steps are stopped and the folders they wrote in are removed`));
  const verdict = await gate({ steps, partial: selected.length > 0, base: root, commitCheck });
  stop();
  if (!commitCheck) console.error(`\n!!! WARNING: ${COUNTS} is not checked against HEAD (--no-commit-check). Commit it before a push.\n`);
  for (const warning of verdict.warnings) console.error(`\n!!! WARNING: ${warning}\n`);
  for (const failure of verdict.failures) console.error(`FAIL ${failure}`);
  const rose = Object.entries(verdict.raised);
  if (rose.length > 0) console.log(`${COUNTS} was raised for ${rose.map(([id, count]) => `${id} (${count})`).join(", ")}. Commit it.`);
  const fell = Object.entries(verdict.lowered);
  if (fell.length > 0) console.log(`${COUNTS} was lowered for ${fell.map(([key, count]) => `${key} (${count})`).join(", ")}. Commit it.`);
  return verdict.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
