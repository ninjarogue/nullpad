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
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gateSteps } from "./steps.mjs";

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

function spawnCapture(argv, { cwd, env }, write) {
  return new Promise((done) => {
    let output = "";
    const take = (chunk) => {
      const text = chunk.toString();
      output += text;
      write(text);
    };
    const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => {
      take(`${error.message}\n`);
      done({ exitCode: 127, signal: null, output });
    });
    child.on("close", (exitCode, signal) => done({ exitCode, signal, output }));
  });
}

/** Runs one step and holds it to its known count, raising the count in `file` when more tests ran. */
export async function runStep(step, { countsFile: file = countsFile, log = console.log, write = (text) => process.stdout.write(text) } = {}) {
  const all = loadCounts(file);
  if (step.needs && !existsSync(step.needs)) {
    return { ok: false, id: step.id, failures: [`${step.id}: ${step.hint ?? `${step.needs} is missing`}`], raised: null };
  }
  log(`==> ${step.id}`);
  if (step.outIn) mkdirSync(step.outIn, { recursive: true });
  const outDir = mkdtempSync(join(step.outIn ?? tmpdir(), "step-"));
  try {
    const { exitCode, signal, output } = await spawnCapture(step.command(outDir), { cwd: step.cwd, env: step.env }, write);
    if (!step.counted) {
      const failures = exitCode === 0 && !signal ? [] : [`${step.id}: the command ${signal ? `was killed by ${signal}` : `exited ${exitCode}`}`];
      return { ok: failures.length === 0, id: step.id, failures, raised: null };
    }
    let counts = null;
    let problem;
    try {
      counts = step.read({ output, outDir });
    } catch (error) {
      problem = error.message;
    }
    const known = all[step.id];
    const verdict = judge({ id: step.id, known, exitCode, signal, counts, problem });
    if (verdict.raise !== null) {
      saveCounts(file, { ...loadCounts(file), [step.id]: verdict.raise });
      log(`${step.id}: ${tests(verdict.raise)}, up from ${known ?? "none"}. ${COUNTS} is raised: commit it.`);
    } else if (verdict.failures.length === 0) {
      log(`${step.id}: ${tests(counts.passed)}, as known`);
    }
    return { ok: verdict.failures.length === 0, id: step.id, failures: verdict.failures, raised: verdict.raise };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
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
  for (const step of steps) {
    const verdict = await runStep(step, { countsFile: file, ...io });
    ran.push(step.id);
    if (verdict.raised !== null) raised[step.id] = verdict.raised;
    if (!verdict.ok) return { ok: false, ran, raised, failures: verdict.failures };
  }
  const orphans = partial ? [] : Object.entries(loadCounts(file)).filter(([id]) => !ran.includes(id));
  const failures = orphans.map(
    ([id, count]) =>
      `${id}: ${COUNTS} knows ${tests(count)} for it, and no step of the gate runs it. ` +
      `If the step was removed on purpose, remove its line from ${COUNTS} by hand.`,
  );
  return { ok: failures.length === 0, ran, raised, failures };
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
  return verdict.ok ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
