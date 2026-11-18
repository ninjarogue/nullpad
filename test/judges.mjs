import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compare, inventoryOf, judged, loadParsers, ofValues, roleOf } from "./inventory.mjs";

/**
 * Main's tests judge the branch. A pre-push run takes the tests and the gate scripts as the
 * merge base with `origin/main` has them, lays this branch's `src/` and `assets/` over them in
 * a scratch copy, and runs them there. Both sides are what a commit holds (the base, and HEAD),
 * never the working tree. A test of main's that the branch deleted, loosened or changed fails
 * the gate, and so does one that fails on the branch's code, a thing a test reads (a const, a
 * table, a helper, an import, a data file) that changed, a statement added that switches checks
 * off, a script that runs the tests that changed, and a count lower than main's, unless a commit
 * on the branch carries `Changes-test: <file or test id> — <reason>` naming it. The hook runs
 * the copy of this file that main has, so a branch cannot edit the judge to let itself through.
 *
 * Known escapes, listed in AGENTS.md: a bump or override of a dependency, `gleam.toml`, the test
 * API reached by another name (`const t = test; t.skip()`, a cast, a computed key), which the count
 * gate backstops, and `--no-verify`. A helper extracted from a test, or renamed, reads as a change.
 */

export const root = fileURLToPath(new URL("..", import.meta.url));
const self = fileURLToPath(import.meta.url);
const TRAILER = "Changes-test";

const withoutGitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"].includes(name)));

export function git(repo, args, options = {}) {
  return execFileSync("git", args, { cwd: repo, env: { ...withoutGitEnv(), GIT_TERMINAL_PROMPT: "0" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28, ...options });
}

export function resolveBase(repo, { fetch = true, remote = "origin", branch = "main" } = {}) {
  const ref = `${remote}/${branch}`;
  let warning = null;
  if (fetch) {
    try {
      git(repo, ["fetch", "--quiet", remote, branch], { timeout: 60_000 });
    } catch (error) {
      warning = `could not fetch ${ref} (${String(error.stderr ?? error.message).trim().split("\n")[0]}), so the copy fetched last is the base`;
    }
  }
  try {
    return { sha: git(repo, ["merge-base", "HEAD", ref]).trim(), ref, warning };
  } catch {
    throw new Error(`no merge base of HEAD and ${ref}: fetch it (git fetch ${remote} ${branch}), or this branch shares no history with main`);
  }
}

export function extractTree(repo, sha, into) {
  const archive = execFileSync("git", ["archive", sha], { cwd: repo, env: withoutGitEnv(), maxBuffer: 1 << 29 });
  execFileSync("tar", ["-x", "-C", into], { input: archive, maxBuffer: 1 << 29 });
}

function readJudged(dir, list) {
  const files = new Map();
  for (const path of list.filter(judged)) {
    try {
      files.set(path, readFileSync(join(dir, path), "utf8"));
    } catch {}
  }
  return files;
}

const filesOf = (repo, sha) => git(repo, ["ls-tree", "-r", "-z", "--name-only", sha]).split("\0").filter(Boolean);

/**
 * The `Changes-test:` lines of the commits since the base, wherever they sit in the message. Git's own
 * trailer parser only reads the last paragraph, and a `Co-Authored-By` block added below a trailer would
 * hide it, so the lines are read as they are.
 */
export function trailersOf(repo, base) {
  const out = git(repo, ["log", "--format=%H%x1f%B%x1d", `${base}..HEAD`]);
  const line = new RegExp(`^${TRAILER}:[ \\t]*(.+)$`, "gm");
  const found = [];
  for (const record of out.split("\x1d")) {
    const [hash, message] = record.replace(/^\n/, "").split("\x1f");
    if (!hash || !message) continue;
    for (const [, value] of message.matchAll(line)) {
      const split = value.trim().match(/^(.*?)\s+(?:—|--)\s+(.*)$/s);
      found.push({ commit: hash.trim().slice(0, 7), subject: (split?.[1] ?? value).trim(), reason: (split?.[2] ?? "").trim(), text: value.trim() });
    }
  }
  return found;
}

export function covers(trailer, item) {
  const named = trailer.subject;
  return named === item.id || named === item.file || item.id.startsWith(`${named} > `) || item.id.startsWith(`${named}::`) || (item.leaf !== undefined && named.startsWith(`${item.file} > `) && (named.endsWith(` > ${item.leaf}`) || named.includes(` > ${item.leaf} > `)));
}

const hint = (item) => `${TRAILER}: ${item.id} — <why this test may change>`;

/** Splits what changed into what a trailer covers and what fails the gate. */
export function sort(items, trailers) {
  const usable = trailers.filter((trailer) => trailer.reason !== "");
  const covered = [];
  const failing = [];
  for (const item of items) {
    const by = usable.find((trailer) => covers(trailer, item));
    if (by) covered.push({ item, by });
    else failing.push(item);
  }
  const unused = trailers.filter((trailer) => !items.some((item) => covers(trailer, item)));
  return { covered, failing, unused, noReason: trailers.filter((trailer) => trailer.reason === "") };
}

const reasons = {
  "removed-test": "is a test of main's that this branch no longer has",
  "removed-file": "is a file of main's judges that this branch no longer has",
  "weakened-test": "is a test of main's that this branch made check less",
  "weakened-helper": "is a helper of main's tests that this branch made check less",
  disabled: "is a statement, test or group that this branch added and that switches checks off or leaves the others out",
  "added-setup": "is a statement or hook that this branch put at the top of a test file, where it runs with every test in it",
  "lowered-count": "is a count of tests that this branch lowered",
  "changed-input": "is a const, table, helper or import that a test of main's reads, and this branch changed it",
  "changed-gate": "is a script or file that decides, and this branch changed it",
  unreadable: "is a judge that cannot be read",
  "fails-on-branch": "is a test of main's that fails on this branch's code",
};

export function describeFailure(item) {
  return [`  ${item.id}`, `    ${reasons[item.what] ?? item.what}: ${item.why}`, `    to keep the change, put this line in a commit message: ${hint(item)}`].join("\n");
}

const MOST_SHOWN = 10;
const rank = { "changed-gate": 2, "weakened-helper": 1, "changed-input": 1, "lowered-count": 1, unreadable: 1, "removed-file": 1 };

/**
 * The failures as lines. The tests that were removed, weakened or fail come first, and the parts of one
 * gate script that changed are one line, so a script rewritten whole cannot push a deleted test out of
 * view. Only the first few are given in full: hundreds at once mean the run broke (the app or the
 * browser stopped), and a list of that many trailers to paste would hide it.
 */
export function describeFailures(items) {
  const gate = new Map();
  const merged = [];
  for (const item of items) {
    const seen = item.what === "changed-gate" ? gate.get(item.file) : undefined;
    if (seen) seen.parts++;
    else {
      const entry = { item, parts: 1 };
      if (item.what === "changed-gate") gate.set(item.file, entry);
      merged.push(entry);
    }
  }
  const lines = merged
    .map(({ item, parts }) => ({ item: parts > 1 ? { ...item, id: item.file, why: `${parts} parts of it changed, the first is ${item.why}` } : item, rank: rank[item.what] ?? 0 }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
  const shown = lines.slice(0, MOST_SHOWN).map(describeFailure);
  if (lines.length > MOST_SHOWN) shown.push(`  and ${lines.length - MOST_SHOWN} more. This many at once usually means the run itself broke (the app or the browser stopped): push again before adding trailers.`);
  return shown;
}

const MOST_LISTED = 20;

/** The changes a trailer covers, listed when it covers more than the one it names, so that a reviewer sees each one. */
function coverageLines(trailer, covered) {
  const under = covered.filter(({ by }) => by === trailer).map(({ item }) => item);
  if (under.length === 0 || (under.length === 1 && under[0].id === trailer.subject)) return [];
  return [
    `    covers ${under.length} change${under.length === 1 ? "" : "s"}:`,
    ...under.slice(0, MOST_LISTED).map((item) => `      ${item.id}  (${item.what})`),
    ...(under.length > MOST_LISTED ? [`      and ${under.length - MOST_LISTED} more`] : []),
  ];
}

export function describeTrailers(trailers, covered = []) {
  if (trailers.length === 0) return "";
  const lines = [`${TRAILER} trailers on this branch. Put them in the PR description:`];
  for (const trailer of trailers) lines.push(`  ${TRAILER}: ${trailer.text}  (${trailer.commit})`, ...coverageLines(trailer, covered));
  return [...lines, ""].join("\n");
}

/** The changes that a trailer covered during the run of main's tests, trailer by trailer. */
export function describeCovered(trailers, covered) {
  return trailers.flatMap((trailer) => (covered.some(({ by }) => by === trailer) ? [`  ${TRAILER}: ${trailer.text}  (${trailer.commit})`, ...coverageLines(trailer, covered)] : []));
}

function staticJudge({ repo, base, tree, head, parsers }) {
  const baseFiles = readJudged(tree, filesOf(repo, base));
  const branchFiles = readJudged(head, filesOf(repo, "HEAD"));
  const differing = [...baseFiles].filter(([path, text]) => branchFiles.get(path) !== text && !ofValues(path)).map(([path]) => path);
  const valued = [...baseFiles].some(([path, text]) => ofValues(path) && branchFiles.get(path) !== text);
  if (differing.length === 0 && !valued) return { items: [], notes: [], differing };
  const { items, notes } = compare(inventoryOf(baseFiles, parsers), inventoryOf(branchFiles, parsers));
  return { items, notes, differing };
}

/** Steps that test the scripts of the gate and not src, which the branch's own run covers: main's copy of them is not run on the branch's code. */
const tooling = new Set(["test-counts", "mutants-tool", "test-cleanup", "e2e-discovery-tool", "e2e-types", "e2e-discovery", "judges", "pick"]);

function attribute(step, name) {
  if (step.id === "gleam-test") {
    const at = name.lastIndexOf(".");
    const file = `test/${name.slice(0, at)}.gleam`;
    return { file, id: `${file}::${name.slice(at + 1)}` };
  }
  if (step.id.startsWith("e2e:")) {
    const file = `e2e/${name.split(" > ")[0]}`;
    return { file, id: `e2e/${name}` };
  }
  const file = step.id === "keystroke-cost" ? "test/keystroke_cost.mjs" : (step.command("").find((arg) => /\.test\.[cm]?[jt]s$/.test(arg)) ?? step.id);
  return { file, id: `${file} > ${name}`, leaf: name };
}

const seconds = (ms) => (ms < 90_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`);
const plain = (text) => text.replace(/\u001b\[[0-9;]*m/g, "");
const gleamFilesIn = (output) => [...new Set(plain(output).split(/^(?=error|warning)/m).filter((block) => block.startsWith("error")).flatMap((block) => [...block.matchAll(/(?:┌─|-->)\s+(\S+?\.gleam):\d+/g)].map((found) => found[1])))];

/**
 * Lays this branch's `src/` and `assets/` over main's copy and runs main's gate steps there.
 * When the branch changed only test files, every other file is the branch's own byte for byte,
 * so the branch's run covers it, and only the test files that differ run here (`narrow`).
 */
async function overlayRun({ repo, tree, head, trailers, narrow, log }) {
  for (const name of ["src", "assets"]) {
    rmSync(join(tree, name), { recursive: true, force: true });
    if (existsSync(join(head, name))) cpSync(join(head, name), join(tree, name), { recursive: true });
  }
  for (const name of ["gleam.toml", "manifest.toml"]) if (existsSync(join(head, name))) cpSync(join(head, name), join(tree, name));
  if (existsSync(join(repo, "build"))) {
    cpSync(join(repo, "build"), join(tree, "build"), { recursive: true, dereference: true, preserveTimestamps: true });
    rmSync(join(tree, "build", "dev", "javascript", "nullpad"), { recursive: true, force: true });
  }
  if (existsSync(join(repo, "e2e", "node_modules"))) {
    mkdirSync(join(tree, "e2e"), { recursive: true });
    symlinkSync(join(repo, "e2e", "node_modules"), join(tree, "e2e", "node_modules"));
  }
  const steps = await import(pathToFileURL(join(tree, "test", "steps.mjs")).href);
  const counts = await import(pathToFileURL(join(tree, "test", "test_counts.mjs")).href);
  const { capture, runGleeunit } = await import("./pick.mjs");
  const known = counts.loadCounts(join(tree, "test", "test_counts.json"));
  const usable = trailers.filter((trailer) => trailer.reason !== "");
  const exempt = (item) => usable.some((trailer) => covers(trailer, item));
  const covered = [];
  const failures = [];
  const only = narrow === null ? null : new Set(narrow);
  const stop = counts.stopOnSignals((signal) => {
    rmSync(tree, { recursive: true, force: true });
    console.error(`\n${signal}: the overlay run is stopped and its copy of main is removed`);
  });

  const dropBroken = (output) => {
    const broken = gleamFilesIn(output).map((file) => file.replace(`${tree}/`, ""));
    const dropped = broken.filter((file) => exempt({ file, id: file }));
    if (broken.length === 0 || dropped.length !== broken.length) return false;
    for (const file of dropped) {
      unlinkSync(join(tree, file));
      covered.push({ item: { file, id: file, what: "fails-on-branch", why: "main's copy no longer compiles against this branch's src" }, by: usable.find((trailer) => covers(trailer, { file, id: file })) });
    }
    return true;
  };

  const runStep = async (step) => {
    if (only === null) {
      let run = await counts.runCheck(step, {});
      let waived = false;
      for (let round = 0; step.id === "gleam-test" && run.counts === null && step.compileFailed?.(run.output) && round < 12 && dropBroken(run.output); round++) {
        waived = true;
        run = await counts.runCheck(step, {});
      }
      return { run, waived };
    }
    if (step.id === "gleam-test") {
      const modules = [...only].filter((path) => path.endsWith("_test.gleam") && existsSync(join(tree, path))).map((path) => ({ path }));
      if (modules.length === 0) return null;
      let built = await capture(["gleam", "build"], { cwd: tree });
      for (let round = 0; built.code !== 0 && round < 12 && dropBroken(built.output); round++) built = await capture(["gleam", "build"], { cwd: tree });
      if (built.code !== 0) return { run: { exitCode: built.code, signal: null, output: built.output, counts: null, held: {}, failing: [], problem: `main's tests do not compile against this branch's src:\n${plain(built.output).split("\n").slice(-25).join("\n")}` }, waived: true };
      const live = modules.filter(({ path }) => existsSync(join(tree, path)));
      const ran = await runGleeunit({ repo: tree, modules: live });
      let found = null;
      let problem;
      try {
        found = steps.gleamTest.read({ output: ran.output });
      } catch (error) {
        problem = error.message;
      }
      return { run: { exitCode: ran.code, signal: null, output: ran.output, counts: found, held: {}, failing: steps.gleamTest.failing({ output: ran.output }), problem }, waived: true };
    }
    if (step.id.startsWith("e2e:")) {
      const files = [...only].filter((path) => /^e2e\/.+\.e2e\.[cm]?[jt]s$/.test(path) && existsSync(join(tree, path)));
      if (files.length === 0) return null;
      const run = await counts.runCheck(steps.e2e(step.id.slice(4), ["--pass-with-no-tests", ...files.map((file) => file.replace(/^e2e\//, ""))]), {});
      if (run.counts !== null && run.counts.passed + run.counts.failed + run.counts.skipped === 0) return null;
      return { run, waived: true };
    }
    const file = attribute(step, "").file;
    if (!only.has(file)) return null;
    return { run: await counts.runCheck(step, {}), waived: true };
  };

  try {
    for (const step of steps.gateSteps().filter((one) => !tooling.has(one.id))) {
      if (step.needs && !existsSync(step.needs)) {
        failures.push(`${step.id}: ${step.hint ?? `${step.needs} is missing`}`);
        break;
      }
      const started = Date.now();
      const result = await runStep(step);
      if (result === null) continue;
      const { run, waived } = result;
      const items = (run.failing ?? []).map((name) => attribute(step, name));
      const uncovered = items.filter((item) => !exempt(item));
      const named = run.counts !== null && items.length > 0 && items.length >= run.counts.failed;
      let judging = run.counts;
      let exitCode = run.exitCode;
      let ignored = 0;
      if (named && uncovered.length === 0) {
        ignored = items.length;
        judging = { ...run.counts, passed: run.counts.passed + run.counts.failed, failed: 0 };
        exitCode = 0;
        for (const item of items) covered.push({ item: { ...item, what: "fails-on-branch", why: "fails on this branch's code" }, by: usable.find((trailer) => covers(trailer, item)) });
      }
      const verdict = counts.judge({ id: step.id, known: waived || ignored > 0 ? undefined : known[step.id], exitCode, signal: run.signal, counts: judging, problem: run.problem });
      const heldKnown = Object.fromEntries(Object.keys(run.held ?? {}).map((name) => [name, known[`${step.id} ${name}`] ?? 0]));
      const held = counts.judgeHeld({ id: step.id, known: heldKnown, held: run.held ?? {} });
      const bad = [...verdict.failures, ...held.failures];
      if (bad.length === 0) {
        log(`  ${step.id}: ${judging.passed} tests pass on this branch's code in ${seconds(Date.now() - started)}${ignored > 0 ? `, ${ignored} covered by a trailer` : ""}`);
        continue;
      }
      failures.push(...bad, ...describeFailures(uncovered.map((item) => ({ ...item, what: "fails-on-branch", why: "fails on this branch's code" }))));
      failures.push(`  last lines of ${step.id}:\n${plain(run.output).trimEnd().split("\n").slice(-30).join("\n").replace(/^/gm, "    ")}`);
      break;
    }
  } finally {
    stop();
  }
  return { failures, covered };
}

function runGate(repo, args) {
  return new Promise((done) => {
    const child = spawn("node", [join(repo, "test", "test_counts.mjs"), "run", ...args], { cwd: repo, stdio: "inherit" });
    child.on("close", (code, signal) => done(signal ? 128 : code));
  });
}

export async function run({ repo, base: given, gateArgs = [], pick = true, only = false, gate = true, log = console.log, fromMain = join(repo, "test", "judges.mjs") !== self }) {
  const started = Date.now();
  const timing = {};
  const base = given ?? resolveBase(repo);
  const sha = typeof base === "string" ? base : base.sha;
  if (typeof base !== "string" && base.warning) log(`!!! ${base.warning}`);
  const hasJudge = filesOf(repo, sha).includes("test/judges.mjs");
  log(`judges: main at ${sha.slice(0, 7)}. The judge scripts are ${fromMain ? "main's copy" : hasJudge ? "this branch's copy (main has them, but the hook did not use them)" : "this branch's own: main has none yet, so nothing stops this branch from editing them"}.`);
  try {
    execFileSync("gleam", ["build"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 26 });
  } catch (error) {
    log(`FAIL gleam build failed, so there is nothing to judge:\n${plain(`${error.stdout ?? ""}${error.stderr ?? error.message}`).split("\n").slice(-30).join("\n")}`);
    return 1;
  }
  const parsers = await loadParsers(repo);
  const tree = mkdtempSync(join(tmpdir(), "judges-"));
  const head = mkdtempSync(join(tmpdir(), "judges-head-"));
  const cleanup = () => {
    rmSync(tree, { recursive: true, force: true });
    rmSync(head, { recursive: true, force: true });
  };
  try {
    extractTree(repo, sha, tree);
    extractTree(repo, "HEAD", head);
    if (git(repo, ["status", "--porcelain", "--untracked-files=no"]).trim() !== "" || git(repo, ["ls-files", "--others", "--exclude-standard"]).trim() !== "") {
      log("note: the working tree has uncommitted changes. The judge reads what HEAD holds, which is what a push sends, so they are not judged.");
    }
    const trailers = trailersOf(repo, sha);
    const statics = staticJudge({ repo, base: sha, tree, head, parsers });
    const sorted = sort(statics.items, trailers);
    const printed = describeTrailers(trailers, sorted.covered);
    if (printed) log(printed);
    for (const trailer of sorted.noReason) log(`FAIL ${TRAILER}: ${trailer.text} (${trailer.commit}) has no reason after the dash`);
    for (const trailer of sorted.unused) log(`note: ${TRAILER}: ${trailer.subject} (${trailer.commit}) names nothing this branch changed`);
    if (statics.notes.length > 0) log(`note: helpers of main's tests that do not assert were changed (not judged): ${statics.notes.slice(0, 5).join("; ")}${statics.notes.length > 5 ? `; and ${statics.notes.length - 5} more` : ""}`);
    if (sorted.failing.length > 0 || sorted.noReason.length > 0) {
      log(`FAIL ${sorted.failing.length} judge${sorted.failing.length === 1 ? "" : "s"} of main's changed without a ${TRAILER} trailer:`);
      for (const line of describeFailures(sorted.failing)) log(line);
      return 1;
    }
    log(`judges: every test and script of main's is still here${sorted.covered.length > 0 ? `, ${sorted.covered.length} changed under a trailer` : ""}`);
    if (only) return 0;
    if (pick) {
      const { runPicked } = await import("./pick.mjs");
      const picked = await runPicked({ repo, base: sha, log });
      timing.picked = picked.ms;
      if (!picked.ok) return 1;
    }
    if (statics.differing.length === 0 || !existsSync(join(tree, "test", "steps.mjs"))) {
      log(statics.differing.length === 0 ? "judges: every test and script of main's is the branch's own byte for byte, so the gate run below is main's run too" : "judges: main has no gate scripts to run");
    } else {
      const narrow = statics.differing.every((path) => roleOf(path) === "test") ? statics.differing : null;
      log(`==> main's tests and gate scripts on this branch's src and assets${narrow === null ? "" : `: only the ${narrow.length} test file${narrow.length === 1 ? "" : "s"} of main's that differ (${narrow.slice(0, 4).join(", ")}${narrow.length > 4 ? ", ..." : ""}), because every other judged file is the branch's own byte for byte`}`);
      const at = Date.now();
      const overlay = await overlayRun({ repo, tree, head, trailers, narrow, log });
      timing.overlay = Date.now() - at;
      if (overlay.failures.length > 0) {
        log(`FAIL main's tests fail on this branch's code:\n${overlay.failures.join("\n")}`);
        return 1;
      }
      if (overlay.covered.length > 0) log([`judges: ${overlay.covered.length} of main's tests fail or do not compile here, covered by a trailer:`, ...describeCovered(trailers, overlay.covered)].join("\n"));
    }
  } finally {
    cleanup();
  }
  if (!gate) {
    log(`judges: stopped before the full gate (--no-gate), after ${seconds(Date.now() - started)}`);
    return 0;
  }
  const at = Date.now();
  const code = await runGate(repo, gateArgs);
  timing.gate = Date.now() - at;
  log(["", `judges: ${timing.picked === undefined ? "no picked set" : `picked set ${seconds(timing.picked)}`}, main's tests on this branch ${timing.overlay === undefined ? "skipped" : seconds(timing.overlay)}, full gate ${seconds(timing.gate)}, ${seconds(Date.now() - started)} in all`].join("\n"));
  return code;
}

export function parseArgs(args) {
  const [command, ...rest] = args;
  const options = { repo: null, base: null, pick: true, gate: true, gateArgs: [] };
  for (let at = 0; at < rest.length; at++) {
    if (rest[at] === "--base") options.base = rest[++at];
    else if (rest[at] === "--repo") options.repo = rest[++at];
    else if (rest[at] === "--no-pick") options.pick = false;
    else if (rest[at] === "--no-gate") options.gate = false;
    else if (rest[at] === "--no-commit-check") options.gateArgs.push(rest[at]);
    else return { error: `unknown option ${rest[at]}` };
  }
  return { command, options };
}

const usage = "usage: node test/judges.mjs run [--base <sha>] [--repo <dir>] [--no-pick] [--no-gate] [--no-commit-check]\n       node test/judges.mjs check [--base <sha>] [--repo <dir>]   (only what main's tests and scripts lost or changed)";

async function main(args) {
  const { command, options, error } = parseArgs(args);
  if (error || (command !== "run" && command !== "check")) {
    console.error(error ?? usage);
    return 2;
  }
  const repo = options.repo ?? git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  return run({ repo, base: options.base ?? undefined, gateArgs: options.gateArgs, pick: options.pick, gate: options.gate, only: command === "check" });
}

if (process.argv[1] === self || (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
