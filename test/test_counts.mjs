// The gate fails when a step runs no tests, or fewer than it last did.
//
//   node test/test_counts.mjs run [step ...]
//
// With no step it runs every step of the gate (`test/steps.mjs`), the way
// `.githooks/pre-push` does, and stops at the first that fails. A step's count
// is read from what its runner prints or writes, never from the source, and is
// held to `test/test_counts.json`. A run with more tests than the file says
// raises the file, which is then committed. A run with fewer fails, and the
// count can only be lowered by editing the file by hand, so that the removal
// shows in the diff.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateSteps, heldNames } from "./steps.mjs";

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

/**
 * Runs `argv` and gives back its exit code, the signal that ended it, and
 * everything it printed, which `write` also gets as it comes. With a
 * `timeoutMs` the command and what it started are killed when it runs over,
 * and the caller is told so: it is then run in a group of its own.
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
      detached: timeoutMs !== undefined,
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
 * nothing readable) and `held`, `{ name: count }`.
 */
export async function runCheck(step, { write = () => {}, timeoutMs } = {}) {
  if (step.outIn) mkdirSync(step.outIn, { recursive: true });
  const outDir = mkdtempSync(join(step.outIn ?? tmpdir(), "step-"));
  try {
    const run = await spawnCapture(step.command(outDir), { cwd: step.cwd, env: step.env, timeoutMs }, write);
    let counts = null;
    let held = {};
    let problem;
    if (step.counted) {
      try {
        counts = step.read({ output: run.output, outDir });
        held = step.held ? step.held({ output: run.output, outDir }) : {};
      } catch (error) {
        counts = null;
        problem = error.message;
      }
    }
    return { ...run, counts, held, problem };
  } finally {
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

/**
 * Runs `steps` in order and stops at the first that fails. When every step of
 * the gate ran (not `partial`), a known count with no step to run it fails
 * too, so a step cannot be dropped from the gate and leave its count behind.
 */
export async function gate({ steps, countsFile: file = countsFile, partial = false, ...io }) {
  loadCounts(file);
  const ran = [];
  const raised = {};
  const lowered = {};
  for (const step of steps) {
    const verdict = await runStep(step, { countsFile: file, ...io });
    ran.push(step.id);
    if (verdict.raised !== null) raised[step.id] = verdict.raised;
    for (const [name, count] of Object.entries(verdict.lowered ?? {})) lowered[heldKey(step.id, name)] = count;
    if (!verdict.ok) return { ok: false, ran, raised, lowered, failures: verdict.failures };
  }
  const orphans = partial ? [] : Object.entries(loadCounts(file)).filter(([key]) => !ran.includes(stepOf(key)));
  const failures = orphans.map(([key, count]) =>
    key === stepOf(key)
      ? `${key}: ${COUNTS} knows ${tests(count)} for it, and no step of the gate runs it. ` + `If the step was removed on purpose, remove its line from ${COUNTS} by hand.`
      : `${key}: ${COUNTS} allows ${count} for ${stepOf(key)}, and no step of the gate runs it. ` + `If the step was removed on purpose, remove its line from ${COUNTS} by hand.`,
  );
  return { ok: failures.length === 0, ran, raised, lowered, failures };
}

async function main(args) {
  const [command, ...selected] = args;
  if (command !== "run") {
    console.error("usage: node test/test_counts.mjs run [step ...]");
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
  const verdict = await gate({ steps, partial: selected.length > 0 });
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
