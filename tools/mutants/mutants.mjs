// Plants bugs in the source one at a time and runs the project's checks on
// each, to see which bug no check notices. See README.md.
//
//   node tools/mutants/mutants.mjs <mutants.json> [--only M01,M02] [--checks gleam-test,e2e] [--out DIR]
//                                  [--repo DIR] [--calibration FILE]
//   node tools/mutants/mutants.mjs --calibrate

import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as ownSteps from "../../test/steps.mjs";
import { killAll, runCheck } from "../../test/test_counts.mjs";

/** The tool cannot say what a result means, or the tree is not fit to run in. No result is trusted after one. */
export class HarnessError extends Error {
  constructor(message, records = []) {
    super(message);
    this.name = "HarnessError";
    this.records = records;
  }
}

const plain = (text) => text.replace(/\u001b\[[0-9;]*m/g, "");
const firstLine = (text) => plain(text).split("\n").find((line) => line.trim() !== "")?.trim().slice(0, 160) ?? "";

/** What a check's result means for the mutant that was planted: pass, caught, invalid, or error. */
export function classify(check, run) {
  const { exitCode, signal, timedOut, output, counts, problem } = run;
  const say = (verdict, reason) => ({ verdict, reason });
  if (timedOut) return say("error", `timed out after ${run.timeoutMs ?? "its"} ms`);
  if (signal) return say("error", `was killed by ${signal}`);
  if (exitCode === 127) return say("error", `could not be started: ${firstLine(output)}`);
  if (check.build) return exitCode === 0 ? say("pass", "") : say("invalid", firstLine(output));
  if (!check.counted) return exitCode === 0 ? say("pass", "") : say("caught", firstLine(output));
  if (/No tests found/i.test(plain(output))) return say("error", 'the output says "No tests found"');
  if (counts === null) {
    if (check.compileFailed?.(output)) return say("invalid", firstLine(output));
    return say("error", `crashed, or reported nothing readable (${problem}), exit ${exitCode}`);
  }
  if (counts.passed + counts.failed === 0) return say("error", "ran 0 tests");
  if (counts.failed > 0) {
    return exitCode === 0 ? say("error", "exited 0 but reported failures") : say("caught", `${counts.failed} failed`);
  }
  if (exitCode !== 0) return say("error", `exited ${exitCode} without a failed test`);
  return say("pass", "");
}

/** The checks a bug has to get past, in order, from the `steps` of a repository. Each e2e run stops at its first failed test. */
export function defaultChecks(steps = ownSteps) {
  return [steps.gleamBuild, steps.gleamTest, steps.keystrokeCost, ...steps.e2eConfigs().map((config) => steps.e2e(config, ["--max-failures", "1", "--reporter", "list"]))];
}

/**
 * The repository at `repo` and its `test/steps.mjs`, which says how its checks
 * are run. Throws a `HarnessError` when it is not the top of a git repository,
 * has no steps, or has steps that would run the checks in another directory.
 */
export async function stepsOf(repo) {
  let dir;
  try {
    dir = realpathSync(repo);
    if (!statSync(dir).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new HarnessError(`--repo ${repo}: no such directory`);
  }
  let top;
  try {
    top = realpathSync(execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {
    throw new HarnessError(`--repo ${repo}: not a git repository`);
  }
  if (top !== dir) throw new HarnessError(`--repo ${repo}: not the top of a git repository (that is ${top})`);
  const file = join(dir, "test/steps.mjs");
  if (!existsSync(file)) {
    throw new HarnessError(`--repo ${repo}: it has no test/steps.mjs, which says how its checks are run. Merge the branch that adds it into ${repo}, or run the tool from there`);
  }
  let steps;
  try {
    steps = await import(pathToFileURL(file).href);
  } catch (error) {
    throw new HarnessError(`--repo ${repo}: test/steps.mjs did not load: ${error.message}`);
  }
  const missing = ["root", "gleamBuild", "gleamTest", "keystrokeCost", "e2eConfigs", "e2e"].filter((name) => steps[name] === undefined);
  if (missing.length > 0) throw new HarnessError(`--repo ${repo}: test/steps.mjs does not export ${missing.join(", ")}`);
  let runsIn;
  try {
    runsIn = realpathSync(steps.root);
  } catch {
    runsIn = String(steps.root);
  }
  if (runsIn !== dir) {
    throw new HarnessError(`--repo ${repo}: its test/steps.mjs runs its checks in ${steps.root}, not in ${dir}, so a bug planted in the one would be tested in the other`);
  }
  return { dir, steps };
}

function matches(text, find) {
  let count = 0;
  for (let at = text.indexOf(find); at >= 0; at = text.indexOf(find, at + 1)) count++;
  return count;
}

/** Every mutant must be an exact string replacement that matches exactly once. Throws with every one that does not. */
export function validate(dir, mutants) {
  const problems = [];
  const seen = new Set();
  for (const mutant of mutants) {
    const { id, file } = mutant;
    if (typeof id !== "string" || typeof file !== "string" || typeof mutant.old !== "string" || typeof mutant.new !== "string" || mutant.old === "") {
      problems.push(`${id ?? JSON.stringify(mutant).slice(0, 60)}: needs an id, a file, a non-empty "old" and a "new"`);
      continue;
    }
    if (seen.has(id)) problems.push(`${id}: the id is used more than once`);
    seen.add(id);
    if (mutant.old === mutant.new) {
      problems.push(`${id}: changes nothing. The no-op belongs in the calibration, not among the mutants`);
      continue;
    }
    const path = resolve(dir, file);
    if (isAbsolute(file) || relative(dir, path).startsWith("..")) {
      problems.push(`${id}: ${file} is outside the repository`);
      continue;
    }
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      problems.push(`${id}: ${file} cannot be read`);
      continue;
    }
    const count = matches(text, mutant.old);
    if (count !== 1) {
      problems.push(`${id}: ${JSON.stringify(mutant.old.slice(0, 70))} matches ${count} times in ${file}, and a mutant must match exactly once`);
    }
  }
  if (problems.length > 0) throw new HarnessError(`bad mutants, nothing was run:\n${problems.join("\n")}`);
}

function assertClean(dir, when) {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: dir, encoding: "utf8" });
  if (status.trim() !== "") {
    throw new HarnessError(
      `the git tree is not clean ${when}:\n${status}` +
        "A run that was killed may have left a bug planted. Look at `git diff`, and put the file back with `git checkout -- <file>`.",
    );
  }
}

function assertOutputIgnored(dir, outDir) {
  const inside = relative(realpathSync(dir), realpathSync(outDir));
  if (inside.startsWith("..") || isAbsolute(inside)) return;
  try {
    execFileSync("git", ["check-ignore", "-q", "--", join(inside, "results.jsonl")], { cwd: dir, stdio: "ignore" });
  } catch {
    throw new HarnessError(`the output folder ${outDir} is inside ${dir} and git does not ignore it, so the tree would be dirty after the first mutant. Put it outside, or in a folder .gitignore lists`);
  }
}

/**
 * Plants each mutant of `mutants` in turn and runs `checks` on it, stopping at
 * the first that fails. Before any real mutant, the `calibration` has to
 * come out as it says: every mutant in `caught` CAUGHT by the check named in
 * its `by`, and the `noop` MISSED by all. Gives `{ calibration, results }`,
 * each a list of `{ id, status, check, reason, file }`, and throws a
 * `HarnessError` with the `records` made so far when it cannot trust a result.
 */
export async function runMutants({
  root: dir,
  mutants,
  calibration,
  checks,
  outDir,
  only = null,
  calibrationOnly = false,
  timeoutMs = 20 * 60_000,
  log = () => {},
}) {
  assertClean(dir, "before the run");
  const unknown = (only ?? []).filter((id) => !mutants.some((mutant) => mutant.id === id));
  if (unknown.length > 0) throw new HarnessError(`${unknown.join(", ")} is not in the mutants file`);
  const chosen = only ? mutants.filter((mutant) => only.includes(mutant.id)) : mutants;
  const known = [...calibration.caught.filter((entry) => checks.some((check) => check.id === entry.by)), calibration.noop];
  validate(dir, [...known, ...chosen]);
  for (const check of checks.filter((candidate) => candidate.counted)) {
    if (!calibration.caught.some((entry) => entry.by === check.id)) {
      throw new HarnessError(`${check.id} has no known-caught mutant in the calibration to prove it can catch one`);
    }
  }
  for (const check of checks) {
    if (check.needs && !existsSync(check.needs)) throw new HarnessError(`${check.id}: ${check.hint ?? `${check.needs} is missing`}`);
  }
  mkdirSync(outDir, { recursive: true });
  assertOutputIgnored(dir, outDir);

  const records = [];
  let planted = null;
  const putBack = () => {
    if (planted) writeFileSync(planted.path, planted.original);
    planted = null;
  };
  const interrupted = (signal) => {
    killAll();
    putBack();
    console.error(`${signal}: the planted bug is taken out`);
    process.exit(130);
  };
  process.on("SIGINT", interrupted);
  process.on("SIGTERM", interrupted);

  async function plant(mutant, kind) {
    const path = join(dir, mutant.file);
    const original = readFileSync(path);
    planted = { path, original };
    const started = Date.now();
    const finish = (status, check, reason) => {
      const record = { kind, id: mutant.id, file: mutant.file, desc: mutant.desc, status, check, reason, seconds: Math.round((Date.now() - started) / 1000) };
      records.push(record);
      appendFileSync(join(outDir, "results.jsonl"), JSON.stringify(record) + "\n");
      log(`${kind} ${mutant.id} ${status}${check ? ` by ${check}` : ""}${reason ? `: ${reason}` : ""}`);
      return record;
    };
    try {
      writeFileSync(path, original.toString("utf8").replace(mutant.old, () => mutant.new));
      for (const check of checks) {
        const saved = join(outDir, `${mutant.id}.${check.id}.txt`);
        writeFileSync(saved, "");
        const run = await runCheck(check, { write: (text) => appendFileSync(saved, text), timeoutMs });
        const { verdict, reason } = classify(check, { ...run, timeoutMs });
        if (verdict === "pass") continue;
        if (verdict === "error") {
          putBack();
          finish("ERROR", check.id, reason);
          throw new HarnessError(`${mutant.id}: ${check.id} ${reason}. Its output is in ${saved}`, records);
        }
        return finish(verdict === "caught" ? "CAUGHT" : "INVALID", check.id, reason);
      }
      return finish("MISSED", null, "");
    } finally {
      putBack();
    }
  }

  try {
    const proven = [];
    for (const entry of known) {
      const record = await plant(entry, "calibration");
      proven.push(record);
      assertClean(dir, `after ${entry.id}`);
      if (entry === calibration.noop) {
        if (record.status !== "MISSED") {
          throw new HarnessError(`${entry.id} is the calibration no-op and came out ${record.status}${record.check ? ` by ${record.check}` : ""}: a check fails on code with no bug planted. Real mutants were not run`, records);
        }
      } else if (record.status !== "CAUGHT") {
        throw new HarnessError(`${entry.id} is known to be caught by ${entry.by}, and came out ${record.status}: the checks cannot be trusted. Real mutants were not run`, records);
      } else if (record.check !== entry.by) {
        throw new HarnessError(`${entry.id} is known to be caught by ${entry.by}, and was caught by ${record.check}. Real mutants were not run`, records);
      }
    }
    const results = [];
    if (!calibrationOnly) {
      for (const mutant of chosen) {
        results.push(await plant(mutant, "mutant"));
        assertClean(dir, `after ${mutant.id}`);
      }
    }
    // The build directory holds the last bug that was planted until it is built again.
    const build = checks.find((check) => check.build);
    if (build) await runCheck(build, { write: (text) => appendFileSync(join(outDir, "final-build.txt"), text), timeoutMs });
    return { calibration: proven.map(({ id, status, check }) => ({ id, status, check })), results };
  } finally {
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
  }
}

function table(records) {
  const rows = records.map((record) => `| ${record.id} | ${record.status} | ${record.check ?? ""} | ${record.file} | ${record.desc ?? ""} | ${record.reason} |`);
  return ["| id | result | caught by | file | what was planted | first failure |", "| --- | --- | --- | --- | --- | --- |", ...rows].join("\n");
}

const toolRoot = fileURLToPath(new URL("../..", import.meta.url));

async function main(args) {
  const options = { only: null, checks: null, out: null, calibrate: false, file: null, repo: null, calibration: null };
  const value = (index, name, what) => {
    const given = args[index];
    if (given === undefined || given.startsWith("--")) throw new HarnessError(`${name} needs ${what}`);
    return given;
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--calibrate") options.calibrate = true;
    else if (arg === "--only") options.only = args[++index]?.split(",");
    else if (arg === "--checks") options.checks = args[++index]?.split(",");
    else if (arg === "--out") options.out = args[++index];
    else if (arg === "--repo") options.repo = value(++index, "--repo", "a path");
    else if (arg === "--calibration") options.calibration = value(++index, "--calibration", "a file");
    else if (arg.startsWith("--")) throw new HarnessError(`unknown option ${arg}`);
    else options.file = arg;
  }
  if (!options.calibrate && !options.file) {
    console.error(
      "usage: node tools/mutants/mutants.mjs <mutants.json> [--only M01,M02] [--checks gleam-test,e2e] [--out DIR] [--repo DIR] [--calibration FILE]\n       node tools/mutants/mutants.mjs --calibrate [--repo DIR] [--calibration FILE]",
    );
    return 2;
  }
  const target = options.repo ? await stepsOf(options.repo) : { dir: ownSteps.root, steps: ownSteps };
  const calibrationFile = options.calibration ? resolve(options.calibration) : join(dirname(fileURLToPath(import.meta.url)), "calibration.json");
  let calibration;
  try {
    calibration = JSON.parse(readFileSync(calibrationFile, "utf8"));
  } catch (error) {
    throw new HarnessError(`the calibration ${calibrationFile} cannot be read (${error.code ?? error.message})`);
  }
  const mutants = options.calibrate ? [] : JSON.parse(readFileSync(options.file, "utf8"));
  const every = defaultChecks(target.steps);
  const wanted = options.checks;
  const checks = wanted ? every.filter((check) => check.build || wanted.includes(check.id) || (wanted.includes("e2e") && check.id.startsWith("e2e:"))) : every;
  const unknown = (wanted ?? []).filter((name) => name !== "e2e" && !every.some((check) => check.id === name));
  if (unknown.length > 0) throw new HarnessError(`unknown check ${unknown.join(", ")}. Checks: ${every.map((check) => check.id).join(", ")}, e2e`);
  const outDir = resolve(options.out ?? join(toolRoot, ".mutants", new Date().toISOString().replace(/[:.]/g, "-")));
  let run;
  try {
    run = await runMutants({
      root: target.dir,
      mutants,
      calibration,
      checks,
      outDir,
      only: options.only,
      calibrationOnly: options.calibrate,
      log: (line) => console.log(line),
    });
  } catch (error) {
    if (error instanceof HarnessError && options.repo && !options.calibration && error.message.startsWith("bad mutants")) {
      throw new HarnessError(`${error.message}\nThe calibration is this tool's own, written for its own source. For ${options.repo}, give --calibration <file>.`, error.records);
    }
    throw error;
  }
  const { calibration: proven, results } = run;
  const summary = `Calibration passed: ${proven.map((entry) => `${entry.id} ${entry.status}`).join(", ")}.\n\n${table(results)}\n`;
  writeFileSync(join(outDir, "summary.md"), summary);
  console.log(`\n${summary}\nOutput of every check: ${outDir}`);
  return results.some((result) => result.status === "MISSED") ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    if (!(error instanceof HarnessError)) throw error;
    console.error(`\nstopped: ${error.message}`);
    process.exit(2);
  }
}
