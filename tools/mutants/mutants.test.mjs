import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { alive, gone, interrupted } from "../../test/interrupt.mjs";
import { useScratch } from "../../test/scratch.mjs";
import { gleamTest, readers, root } from "../../test/steps.mjs";
import { HarnessError, classify, defaultChecks, runMutants, validate } from "./mutants.mjs";

const scratch = useScratch();

const SRC = "alpha\nbeta\ngamma\ndelta\n# note\n";

const files = {
  "src.txt": SRC,
  "build.mjs": `
    import { appendFileSync, readFileSync } from "node:fs";
    appendFileSync(process.env.TOY_LOG, "build " + readFileSync("src.txt", "utf8").replaceAll("\\n", "|") + "\\n");
    if (readFileSync("src.txt", "utf8").includes("BROKEN")) {
      console.error("error: the source does not build");
      process.exit(1);
    }`,
  "unit.mjs": `
    import { appendFileSync, readFileSync } from "node:fs";
    appendFileSync(process.env.TOY_LOG, "unit " + readFileSync("src.txt", "utf8").replaceAll("\\n", "|") + "\\n");
    const mode = process.env.TOY_MODE ?? "";
    const src = readFileSync("src.txt", "utf8");
    const finish = (text, code) => process.stdout.write(text + "\\n", () => process.exit(code));
    if (mode === "nofound0") finish("\\nNo tests found!", 0);
    else if (mode === "nofound1") finish("\\nNo tests found!", 1);
    else if (mode === "crash") { console.error("TypeError: boom"); process.exit(1); }
    else if (src.includes("NOCOMPILE")) { console.error("error: Unknown variable"); process.exit(1); }
    else if (mode === "signal") process.kill(process.pid, "SIGKILL");
    else if (mode === "lies") finish("\\n1 passed, 1 failures", 0);
    else if (mode === "silent") finish("\\n2 passed, no failures", 1);
    else if (mode === "empty") finish("\\n0 passed, no failures", 0);
    else if (mode === "hang") setInterval(() => {}, 1000);
    else if (mode === "refused") finish(" test: toy.page\\nAPP_UNREACHABLE: nothing answered at http://127.0.0.1:1/blank (ERR_CONNECTION_REFUSED)\\n\\n1 passed, 1 failures", 1);
    else if (mode === "unreachable") finish(" test: toy.page\\nAPP_UNREACHABLE: the app did not start\\n\\n1 passed, 1 failures", 1);
    else if (mode === "reset") finish(" test: toy.page\\nnet::ERR_CONNECTION_RESET at http://127.0.0.1:1/\\n\\n1 passed, 1 failures", 1);
    else if (mode === "closed") finish(" test: toy.page\\nTarget page, context or browser has been closed\\n\\n1 passed, 1 failures", 1);
    else if (mode === "again" && readFileSync(process.env.TOY_LOG, "utf8").split("\\n").filter((line) => line.startsWith("unit ")).length === 2) {
      finish(" test: toy.alpha\\n\\n1 passed, 1 failures", 1);
    } else {
      if (mode === "big") for (let line = 0; line < 20000; line++) console.log("line " + line + " of a long report");
      const missing = ["alpha", "beta"].filter((word) => !src.includes(word));
      const failed = missing.length;
      const names = missing.map((word) => " test: toy." + word).join("\\n");
      finish(failed === 0 ? "\\n2 passed, no failures" : names + "\\n\\n" + (2 - failed) + " passed, " + failed + " failures", failed === 0 ? 0 : 1);
    }`,
  "second.mjs": `
    import { appendFileSync, readFileSync } from "node:fs";
    appendFileSync(process.env.TOY_LOG, "second " + readFileSync("src.txt", "utf8").replaceAll("\\n", "|") + "\\n");
    const ok = readFileSync("src.txt", "utf8").includes("gamma");
    console.log(ok ? "\\n1 passed, no failures" : "\\n0 passed, 1 failures");
    process.exit(ok ? 0 : 1);`,
};

const mutant = (id, old, replacement, file = "src.txt") => ({ id, file, desc: `${id}: ${old} to ${replacement}`, old, new: replacement });

const calibration = {
  caught: [
    { by: "unit", ...mutant("CAL-unit", "beta", "bexa") },
    { by: "second", ...mutant("CAL-second", "gamma", "gamxa") },
  ],
  noop: mutant("CAL-noop", "# note", "# notes"),
};

const gitIn = (dir, ...args) =>
  execFileSync("git", ["-c", "user.name=toy", "-c", "user.email=toy@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });

function toy({ mode = "", timeoutMs = 20_000 } = {}) {
  const dir = scratch.make("toy-");
  const logDir = scratch.make("toy-log-");
  const log = join(logDir, "ran.log");
  const outDir = join(logDir, "out");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const git = (...args) => gitIn(dir, ...args);
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "toy");
  const step = (id, file, extra = {}) => ({
    id,
    cwd: dir,
    counted: true,
    command: () => ["node", file],
    read: readers.gleeunit,
    failing: gleamTest.failing ?? (() => []),
    env: { TOY_LOG: log, TOY_MODE: id === "unit" ? mode : "" },
    ...extra,
  });
  const checks = [step("build", "build.mjs", { counted: false, build: true }), step("unit", "unit.mjs"), step("second", "second.mjs")];
  return {
    dir,
    outDir,
    checks,
    log,
    ran: (planted = "") =>
      (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [])
        .filter((line) => line.includes(planted))
        .map((line) => line.split(" ")[0]),
    status: () => git("status", "--porcelain", "--untracked-files=all"),
    src: () => readFileSync(join(dir, "src.txt"), "utf8"),
    run: (mutants, extra = {}) => runMutants({ root: dir, mutants, calibration, checks, outDir, timeoutMs, ...extra }),
  };
}

const by = (results, id) => results.find((result) => result.id === id);

describe("a planted bug", () => {
  test("is CAUGHT by the first check that fails, MISSED by none, INVALID when the build breaks", async () => {
    const t = toy();
    const { results } = await t.run([
      mutant("M-unit", "alpha", "alpxa"),
      mutant("M-second", "gamma", "gamxa"),
      mutant("M-missed", "delta", "deltb"),
      mutant("M-invalid", "delta", "BROKEN"),
    ]);
    assert.equal(by(results, "M-unit").status, "CAUGHT");
    assert.equal(by(results, "M-unit").check, "unit");
    assert.equal(by(results, "M-second").status, "CAUGHT");
    assert.equal(by(results, "M-second").check, "second");
    assert.equal(by(results, "M-missed").status, "MISSED");
    assert.equal(by(results, "M-invalid").status, "INVALID");
    assert.equal(by(results, "M-invalid").check, "build");
  });

  test("stops at the first check that fails, so the later checks do not run for it", async () => {
    const t = toy();
    await t.run([mutant("M-unit", "alpha", "alpxa")]);
    assert.deepEqual(t.ran("alpxa"), ["build", "unit"]);
  });

  test("a broken build is INVALID and no test check runs for it", async () => {
    const t = toy();
    await t.run([mutant("M-invalid", "delta", "BROKEN")]);
    assert.deepEqual(t.ran("BROKEN"), ["build"]);
  });

  test("a test that cannot compile is CAUGHT-BY-COMPILE: not CAUGHT, because no test failed, and not INVALID, because the source builds", async () => {
    const t = toy();
    t.checks[1].compileFailed = (output) => /^error:/m.test(output);
    const { results } = await t.run([mutant("M-types", "delta", "NOCOMPILE")]);
    assert.equal(by(results, "M-types").status, "CAUGHT-BY-COMPILE");
    assert.equal(by(results, "M-types").check, "unit");
  });

  test("has the full output of every check that ran saved, however long", async () => {
    const t = toy({ mode: "big" });
    await t.run([mutant("M-missed", "delta", "deltb")]);
    const saved = readFileSync(join(t.outDir, "M-missed.unit.txt"), "utf8");
    assert.match(saved, /^line 0 of a long report$/m);
    assert.match(saved, /^line 19999 of a long report$/m);
    assert.match(saved, /2 passed, no failures\s*$/);
    assert.match(readFileSync(join(t.outDir, "M-missed.second.txt"), "utf8"), /1 passed, no failures/);
    assert.match(readFileSync(join(t.outDir, "M-missed.build.txt"), "utf8"), /^$/);
  });

  test("is written to the results file with the check that caught it", async () => {
    const t = toy();
    await t.run([mutant("M-unit", "alpha", "alpxa")]);
    const lines = readFileSync(join(t.outDir, "results.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const real = lines.find((line) => line.id === "M-unit");
    assert.equal(real.status, "CAUGHT");
    assert.equal(real.check, "unit");
    assert.equal(real.kind, "mutant");
    assert.ok(lines.some((line) => line.kind === "calibration" && line.id === "CAL-noop" && line.status === "MISSED"));
  });
});

describe("a CAUGHT mutant", () => {
  test("says which tests failed, in the result and in the results file", async () => {
    const t = toy();
    const { results } = await t.run([mutant("M-unit", "alpha", "alpxa")]);
    assert.deepEqual(by(results, "M-unit").failing, ["toy.alpha"]);
    const lines = readFileSync(join(t.outDir, "results.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(lines.find((line) => line.id === "M-unit").failing, ["toy.alpha"]);
  });

  test("is run again on the clean tree, the build first and then the check that caught it", async () => {
    const t = toy();
    await t.run([mutant("M-unit", "alpha", "alpxa")]);
    const log = readFileSync(t.log, "utf8").split("\n").filter(Boolean);
    const at = log.findIndex((line) => line.startsWith("unit ") && line.includes("alpxa"));
    assert.ok(at >= 0, "the mutant was not run");
    assert.match(log[at + 1] ?? "", /^build .*alpha/, "the build was not run on the clean tree");
    assert.match(log[at + 2] ?? "", /^unit .*alpha/, "the check that caught it was not run on the clean tree");
  });

  test("is an ERROR, and the run stops, when the check fails on the clean tree too", async () => {
    const t = toy({ mode: "again" });
    await assert.rejects(t.run([mutant("M-unit", "alpha", "alpxa")]), (error) => {
      assert.ok(error instanceof HarnessError, String(error));
      assert.match(error.message, /clean tree/);
      assert.ok(error.records.some((record) => record.status === "ERROR" && record.check === "unit"), JSON.stringify(error.records));
      assert.ok(!error.records.some((record) => record.status === "CAUGHT"), "a catch that does not hold was recorded as CAUGHT");
      return true;
    });
    assert.equal(t.src(), SRC);
    assert.equal(t.status(), "");
  });

  test("is not run again when nothing was caught, and a build that broke is not either", async () => {
    const t = toy();
    await t.run([mutant("M-missed", "delta", "deltb"), mutant("M-invalid", "delta", "BROKEN")]);
    assert.deepEqual(t.ran("deltb"), ["build", "unit", "second"]);
    assert.deepEqual(t.ran("BROKEN"), ["build"]);
    const log = readFileSync(t.log, "utf8").split("\n").filter(Boolean);
    const last = log.findLastIndex((line) => line.includes("BROKEN"));
    assert.deepEqual(log.slice(last + 1).map((line) => line.split(" ")[0]), ["build"], "only the build that clears the last bug may run after the last mutant");
  });

  test("by a test that cannot compile is run again on the clean tree, too", async () => {
    const t = toy();
    t.checks[1].compileFailed = (output) => /^error:/m.test(output);
    await t.run([mutant("M-types", "delta", "NOCOMPILE")]);
    const log = readFileSync(t.log, "utf8").split("\n").filter(Boolean);
    const at = log.findLastIndex((line) => line.startsWith("unit ") && line.includes("NOCOMPILE"));
    assert.match(log[at + 2] ?? "", /^unit .*delta/);
  });
});

describe("the tree", () => {
  test("is as it was after every mutant, with the git status clean", async () => {
    const t = toy();
    await t.run([mutant("M-unit", "alpha", "alpxa"), mutant("M-missed", "delta", "deltb"), mutant("M-invalid", "delta", "BROKEN")]);
    assert.equal(t.src(), SRC);
    assert.equal(t.status(), "");
  });

  test("is put back when a check crashes the run", async () => {
    const t = toy({ mode: "crash" });
    await assert.rejects(t.run([mutant("M-unit", "alpha", "alpxa")]), HarnessError);
    assert.equal(t.src(), SRC);
    assert.equal(t.status(), "");
  });

  test("is refused when a file is left over in it, and nothing is planted or run", async () => {
    const t = toy();
    writeFileSync(join(t.dir, "stray.txt"), "left behind");
    await assert.rejects(t.run([mutant("M-unit", "alpha", "alpxa")]), /not clean/);
    assert.deepEqual(t.ran(), []);
  });

  test("is refused when a tracked file was changed, as a bug planted by a run that was killed would be", async () => {
    const t = toy();
    writeFileSync(join(t.dir, "src.txt"), SRC.replace("alpha", "planted"));
    await assert.rejects(t.run([mutant("M-unit", "beta", "bexa")]), /not clean/);
    assert.deepEqual(t.ran(), []);
    assert.match(t.src(), /planted/);
  });
});

describe("a mutant", () => {
  test("that matches 0 times is refused before anything runs", async () => {
    const t = toy();
    await assert.rejects(t.run([mutant("M-none", "no such text", "x")]), /M-none.*0 times|exactly once/);
    assert.deepEqual(t.ran(), []);
    assert.equal(t.src(), SRC);
  });

  test("that matches twice is refused before anything runs", async () => {
    const t = toy();
    await assert.rejects(t.run([mutant("M-twice", "a", "b")]), /M-twice.*(\d+) times|exactly once/);
    assert.deepEqual(t.ran(), []);
  });

  test("that is the last of several bad ones still stops the run before the first runs", async () => {
    const t = toy();
    await assert.rejects(t.run([mutant("M-ok", "alpha", "alpxa"), mutant("M-none", "no such text", "x")]), /M-none/);
    assert.deepEqual(t.ran(), []);
  });

  test("that changes nothing is refused: the no-op belongs to the calibration", async () => {
    const t = toy();
    await assert.rejects(t.run([mutant("M-same", "alpha", "alpha")]), /M-same.*changes nothing/);
    assert.deepEqual(t.ran(), []);
  });

  test("in a file that is not there is refused", async () => {
    const t = toy();
    await assert.rejects(t.run([mutant("M-gone", "alpha", "alpxa", "gone.txt")]), /M-gone.*gone\.txt/);
  });

  test("with an id used twice is refused", async () => {
    const t = toy();
    await assert.rejects(t.run([mutant("M-a", "alpha", "alpxa"), mutant("M-a", "beta", "bexa")]), /M-a.*twice|more than once/);
  });

  test("can be chosen by id, and only those run", async () => {
    const t = toy();
    const { results } = await t.run([mutant("M-unit", "alpha", "alpxa"), mutant("M-missed", "delta", "deltb")], { only: ["M-missed"] });
    assert.deepEqual(results.map((result) => result.id), ["M-missed"]);
  });

  test("named in `only` that is not in the file is refused", async () => {
    const t = toy();
    await assert.rejects(t.run([mutant("M-unit", "alpha", "alpxa")], { only: ["M-typo"] }), /M-typo/);
  });
});

describe("the calibration", () => {
  test("lets real mutants run when the known-caught ones are CAUGHT by their checks and the no-op is MISSED", async () => {
    const t = toy();
    const { calibration: done, results } = await t.run([mutant("M-missed", "delta", "deltb")]);
    assert.deepEqual(done.map((entry) => [entry.id, entry.status]), [["CAL-unit", "CAUGHT"], ["CAL-second", "CAUGHT"], ["CAL-noop", "MISSED"]]);
    assert.equal(results.length, 1);
  });

  test("refuses real mutants when a mutant known to be caught comes out MISSED", async () => {
    const t = toy();
    const blind = { ...calibration, caught: [{ by: "unit", ...mutant("CAL-blind", "# note", "# notes") }, calibration.caught[1]] };
    await assert.rejects(t.run([mutant("M-unit", "alpha", "alpxa")], { calibration: blind }), (error) => {
      assert.ok(error instanceof HarnessError);
      assert.match(error.message, /CAL-blind.*known to be caught.*MISSED/s);
      return true;
    });
    assert.equal(readdirSync(t.outDir).some((name) => name.startsWith("M-unit")), false);
    assert.equal(t.status(), "");
  });

  test("refuses real mutants when the no-op comes out CAUGHT", async () => {
    const t = toy();
    const jumpy = { ...calibration, noop: mutant("CAL-jumpy", "beta", "bexa") };
    await assert.rejects(t.run([mutant("M-missed", "delta", "deltb")], { calibration: jumpy }), /CAL-jumpy.*no-op.*CAUGHT/s);
    assert.equal(readdirSync(t.outDir).some((name) => name.startsWith("M-missed")), false);
  });

  test("refuses real mutants when a known-caught mutant is caught by another check than its own", async () => {
    const t = toy();
    const wrong = { ...calibration, caught: [{ by: "second", ...mutant("CAL-wrong", "beta", "bexa") }, ...calibration.caught] };
    await assert.rejects(t.run([mutant("M-missed", "delta", "deltb")], { calibration: wrong }), /CAL-wrong.*second.*unit/s);
  });

  test("refuses real mutants when a check being run has no known-caught mutant to prove it", async () => {
    const t = toy();
    const thin = { ...calibration, caught: [calibration.caught[0]] };
    await assert.rejects(t.run([mutant("M-missed", "delta", "deltb")], { calibration: thin }), /second.*no known-caught mutant/s);
    assert.deepEqual(t.ran(), []);
  });

  test("is only asked of the checks being run", async () => {
    const t = toy();
    const { results } = await t.run([mutant("M-missed", "delta", "deltb")], { checks: t.checks.filter((check) => check.id !== "second") });
    assert.equal(results[0].status, "MISSED");
    assert.ok(!t.ran().includes("second"));
  });

  test("can be run alone", async () => {
    const t = toy();
    const { calibration: done, results } = await t.run([], { calibrationOnly: true });
    assert.equal(done.length, 3);
    assert.deepEqual(results, []);
  });
});

describe("a check that does not do its job is an error, never CAUGHT", () => {
  const harness = (mode, pattern) =>
    test(`${mode}: ${pattern}`, async () => {
      const t = toy({ mode });
      await assert.rejects(t.run([mutant("M-unit", "alpha", "alpxa")]), (error) => {
        assert.ok(error instanceof HarnessError, String(error));
        assert.match(error.message, pattern);
        assert.ok(!error.records.some((record) => record.status === "CAUGHT"), "no record is CAUGHT");
        return true;
      });
      assert.equal(t.src(), SRC);
      assert.equal(t.status(), "");
    });

  harness("nofound1", /No tests found/);
  harness("nofound0", /No tests found/);
  harness("crash", /crashed|summary/);
  harness("signal", /killed by SIGKILL/);
  harness("lies", /exited 0.*failed|reported failures/s);
  harness("silent", /exited 1.*no test failed|without a failed test/s);
  harness("empty", /0 tests/);
  harness("refused", /ERR_CONNECTION_REFUSED|infrastructure/);
  harness("unreachable", /APP_UNREACHABLE|infrastructure/);
  harness("reset", /ERR_CONNECTION_RESET|infrastructure/);
  harness("closed", /has been closed|infrastructure/);

  test("a check that is not there, exit 127, is an error", async () => {
    const t = toy();
    t.checks[1].command = () => ["no-such-binary-for-the-mutant-tool"];
    await assert.rejects(t.run([mutant("M-unit", "alpha", "alpxa")]), HarnessError);
  });

  test("a check that hangs is killed after its time and is an error", async () => {
    const t = toy({ mode: "hang", timeoutMs: 400 });
    await assert.rejects(t.run([mutant("M-unit", "alpha", "alpxa")]), /timed out/);
    assert.equal(t.src(), SRC);
  });
});

describe("classify", () => {
  const unit = { id: "unit", counted: true };
  const result = (over) => ({ exitCode: 0, signal: null, timedOut: false, output: "", counts: { passed: 5, failed: 0, skipped: 0 }, problem: undefined, ...over });

  test("passes a clean run of tests", () => {
    assert.equal(classify(unit, result({})).verdict, "pass");
  });

  test("catches only on a failed test the runner reported and a non-zero exit", () => {
    assert.equal(classify(unit, result({ exitCode: 1, counts: { passed: 4, failed: 1, skipped: 0 } })).verdict, "caught");
  });

  test("does not catch on a run that is killed, timed out, or reports nothing", () => {
    assert.equal(classify(unit, result({ exitCode: null, signal: "SIGKILL" })).verdict, "error");
    assert.equal(classify(unit, result({ timedOut: true })).verdict, "error");
    assert.equal(classify(unit, result({ exitCode: 1, counts: null, problem: "no summary" })).verdict, "error");
  });

  test("does not catch on 'No tests found' whatever else it says", () => {
    assert.equal(classify(unit, result({ exitCode: 1, output: "\nNo tests found!\n", counts: { passed: 0, failed: 0, skipped: 0 } })).verdict, "error");
    assert.equal(classify(unit, result({ exitCode: 1, output: "\u001b[1mNo tests found!\u001b[22m", counts: null, problem: "no summary" })).verdict, "error");
  });

  test("does not catch on a failure that is the harness's: the app unreachable, a connection refused or reset, a browser closed", () => {
    const failing = { exitCode: 1, counts: { passed: 4, failed: 1, skipped: 0 } };
    for (const output of [
      "APP_UNREACHABLE: nothing answered at http://127.0.0.1:39211/blank (ERR_CONNECTION_REFUSED)",
      "x \u001b[31mERR_CONNECTION_RESET\u001b[39m",
      "Error: connect ECONNREFUSED 127.0.0.1:8080",
      "Target page, context or browser has been closed",
      "WORKER_CRASH: the worker exited",
    ]) {
      assert.equal(classify(unit, result({ ...failing, output })).verdict, "error", output);
    }
    assert.equal(classify(unit, result({ ...failing, output: "expected 1 to be 2" })).verdict, "caught");
  });

  test("calls a test that cannot compile CAUGHT-BY-COMPILE, and only when the check can tell a compile failure", () => {
    const compiling = { id: "unit", counted: true, compileFailed: (output) => /^error:/m.test(output) };
    const noCounts = { exitCode: 1, counts: null, problem: "no summary", output: "error: Unknown variable" };
    assert.equal(classify(compiling, result(noCounts)).verdict, "caught-by-compile");
    assert.equal(classify(unit, result(noCounts)).verdict, "error");
  });

  test("treats a build that fails as invalid, and one that is killed as an error", () => {
    const build = { id: "build", counted: false, build: true };
    assert.equal(classify(build, { exitCode: 0, signal: null, timedOut: false, output: "" }).verdict, "pass");
    assert.equal(classify(build, { exitCode: 1, signal: null, timedOut: false, output: "error: x" }).verdict, "invalid");
    assert.equal(classify(build, { exitCode: null, signal: "SIGKILL", timedOut: false, output: "" }).verdict, "error");
  });
});

describe("the checks the project's own mutants run through", () => {
  test("are the build, then gleam test, keystroke_cost and each e2e config, the way the gate runs them", () => {
    const ids = defaultChecks().map((check) => check.id);
    assert.equal(ids[0], "build");
    assert.deepEqual(ids.slice(1, 3), ["gleam-test", "keystroke-cost"]);
    assert.ok(ids.slice(3).length > 0 && ids.slice(3).every((id) => id.startsWith("e2e:")));
  });

  test("stop at the first failed e2e test, so a mutant costs one failure and not the whole suite", () => {
    const [config] = defaultChecks().filter((check) => check.id.startsWith("e2e:"));
    const argv = config.command("/tmp/out");
    assert.ok(argv.includes("--max-failures") && argv[argv.indexOf("--max-failures") + 1] === "1");
  });

  test("have a known-caught mutant each in the calibration file, and the mutants in it match the source exactly once", () => {
    const committed = JSON.parse(readFileSync(join(root, "tools/mutants/calibration.json"), "utf8"));
    for (const check of defaultChecks().filter((candidate) => candidate.counted)) {
      assert.ok(committed.caught.some((entry) => entry.by === check.id), `${check.id} has a known-caught mutant`);
    }
    assert.doesNotThrow(() => validate(root, [committed.noop, ...committed.caught]));
  });
});

const stepsUrl = new URL("../../test/steps.mjs", import.meta.url).href;

function otherRepo({ steps = true, root: declared = "new URL('..', import.meta.url)", git = true } = {}) {
  const dir = scratch.make("other-");
  const logDir = scratch.make("other-log-");
  const log = join(logDir, "ran.log");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  if (steps) {
    mkdirSync(join(dir, "test"));
    writeFileSync(
      join(dir, "test/steps.mjs"),
      `import { fileURLToPath } from "node:url";
import { readers } from ${JSON.stringify(stepsUrl)};
export const root = fileURLToPath(${declared});
const env = { TOY_LOG: ${JSON.stringify(log)}, TOY_MODE: "" };
const counted = (id, file) => ({ id, cwd: root, counted: true, command: () => ["node", file], read: readers.gleeunit, env });
export const gleamBuild = { id: "build", cwd: root, counted: false, build: true, command: () => ["node", "build.mjs"], env };
export const gleamTest = counted("gleam-test", "unit.mjs");
export const keystrokeCost = counted("keystroke-cost", "second.mjs");
export const e2eConfigs = () => [];
export const e2e = () => { throw new Error("the other repository has no e2e"); };
`,
    );
  }
  if (git) {
    gitIn(dir, "init", "-q");
    gitIn(dir, "add", "-A");
    gitIn(dir, "commit", "-q", "-m", "other");
  }
  const calibrationFile = join(logDir, "calibration.json");
  const mutantsFile = join(logDir, "mutants.json");
  writeFileSync(calibrationFile, JSON.stringify({ caught: [{ by: "gleam-test", ...mutant("CAL-unit", "beta", "bexa") }, { by: "keystroke-cost", ...mutant("CAL-second", "gamma", "gamxa") }], noop: mutant("CAL-noop", "# note", "# notes") }));
  writeFileSync(mutantsFile, JSON.stringify([mutant("M-unit", "alpha", "alpxa"), mutant("M-missed", "delta", "deltb")]));
  return {
    dir,
    log,
    outDir: join(logDir, "out"),
    calibrationFile,
    mutantsFile,
    status: () => gitIn(dir, "status", "--porcelain", "--untracked-files=all"),
    ran: () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => line.split(" ")[0]) : []),
  };
}

function cli(args) {
  const run = spawnSync(process.execPath, [join(root, "tools/mutants/mutants.mjs"), ...args], { cwd: dirname(root), encoding: "utf8", timeout: 120_000 });
  return { status: run.status, out: `${run.stdout}`, err: `${run.stderr}` };
}

describe("--only, --checks and --out", () => {
  const stops = (args, option, what) => {
    const result = cli(args);
    assert.equal(result.status, 2, `${args.join(" ")}: ${result.out}${result.err}`);
    assert.match(result.err, new RegExp(`${option} needs ${what}`));
    assert.equal(existsSync(join(dirname(root), "no-such.json")), false);
  };

  for (const [option, what] of [["--only", "a list of mutant ids"], ["--checks", "a list of checks"], ["--out", "a folder"]]) {
    test(`stop when ${option} has nothing after it`, () => {
      stops(["no-such.json", option], option, what);
    });

    test(`stop when ${option} is followed by another option, which is not its value`, () => {
      stops(["no-such.json", option, "--calibration", "x.json"], option, what);
    });

    test(`stop when ${option} comes before the mutants file and has no value`, () => {
      stops([option, "--calibrate"], option, what);
    });
  }
});

describe("--repo", () => {
  test("runs the checks of the repository it is given, on that repository's source", () => {
    const other = otherRepo();
    const before = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
    const result = cli([other.mutantsFile, "--repo", other.dir, "--calibration", other.calibrationFile, "--out", other.outDir]);
    assert.equal(result.status, 1, result.out + result.err);
    assert.match(result.out, /mutant M-unit CAUGHT by gleam-test/);
    assert.match(result.out, /mutant M-missed MISSED/);
    assert.ok(other.ran().includes("unit") && other.ran().includes("second"), "the checks of the other repository did not run");
    assert.equal(other.status(), "", "the other repository was left changed");
    assert.equal(execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" }), before, "this repository was changed");
  });

  test("puts its output in this repository's .mutants by default, so the tree under attack stays clean", (t) => {
    const other = otherRepo();
    const result = cli([other.mutantsFile, "--repo", other.dir, "--calibration", other.calibrationFile, "--only", "M-unit"]);
    assert.equal(result.status, 0, result.out + result.err);
    const where = result.out.match(/Output of every check: (.+)$/m)?.[1];
    assert.ok(where, result.out);
    t.after(() => rmSync(where, { recursive: true, force: true }));
    assert.ok(where.startsWith(join(root, ".mutants")), where);
    assert.equal(other.status(), "");
  });

  test("with --calibrate, proves the checks of that repository and plants nothing else", () => {
    const other = otherRepo();
    const result = cli(["--calibrate", "--repo", other.dir, "--calibration", other.calibrationFile, "--out", other.outDir]);
    assert.equal(result.status, 0, result.out + result.err);
    assert.match(result.out, /Calibration passed: CAL-unit CAUGHT, CAL-second CAUGHT, CAL-noop MISSED/);
    assert.equal(other.status(), "");
  });

  test("stops when the repository has no test/steps.mjs, and says which file it looked for", () => {
    const other = otherRepo({ steps: false });
    const result = cli([other.mutantsFile, "--repo", other.dir, "--calibration", other.calibrationFile, "--out", other.outDir]);
    assert.equal(result.status, 2, result.out + result.err);
    assert.match(result.err, /test\/steps\.mjs/);
    assert.deepEqual(other.ran(), []);
    assert.equal(other.status(), "");
  });

  test("stops when its steps.mjs runs the checks in some other directory, which would test code that has no bug in it", () => {
    const elsewhere = scratch.make("elsewhere-");
    const other = otherRepo({ root: `${JSON.stringify(pathToFileURL(elsewhere).href)}` });
    const result = cli([other.mutantsFile, "--repo", other.dir, "--calibration", other.calibrationFile, "--out", other.outDir]);
    assert.equal(result.status, 2, result.out + result.err);
    assert.match(result.err, /runs its checks in/);
    assert.deepEqual(other.ran(), []);
  });

  test("stops when the path is not there, or is not a git repository", () => {
    const missing = cli(["--calibrate", "--repo", join(scratch.make("gone-"), "nothing")]);
    assert.equal(missing.status, 2, missing.out + missing.err);
    assert.match(missing.err, /--repo .*no such directory/);
    const plain = scratch.make("plain-");
    const notGit = cli(["--calibrate", "--repo", plain]);
    assert.equal(notGit.status, 2, notGit.out + notGit.err);
    assert.match(notGit.err, /--repo .*not a git repository/);
  });

  test("stops when --repo has no path after it", () => {
    const result = cli(["--calibrate", "--repo"]);
    assert.equal(result.status, 2, result.out + result.err);
    assert.match(result.err, /--repo needs a path/);
  });

  test("stops before planting anything when the output folder is inside the repository and git does not ignore it", () => {
    const other = otherRepo();
    const result = cli([other.mutantsFile, "--repo", other.dir, "--calibration", other.calibrationFile, "--out", join(other.dir, "out")]);
    assert.equal(result.status, 2, result.out + result.err);
    assert.match(result.err, /output folder .* inside .*not ignore/);
    assert.deepEqual(other.ran(), []);
    assert.equal(other.status(), "");
  });

  test("lets the output folder be inside the repository when git ignores it", () => {
    const other = otherRepo();
    writeFileSync(join(other.dir, ".gitignore"), "/out\n");
    gitIn(other.dir, "add", "-A");
    gitIn(other.dir, "commit", "-q", "-m", "ignore out");
    const result = cli([other.mutantsFile, "--repo", other.dir, "--calibration", other.calibrationFile, "--out", join(other.dir, "out"), "--only", "M-unit"]);
    assert.equal(result.status, 0, result.out + result.err);
    assert.equal(other.status(), "");
  });

  test("without --calibration, uses this repository's, and says to give one when it does not match the other source", () => {
    const other = otherRepo();
    const result = cli([other.mutantsFile, "--repo", other.dir, "--out", other.outDir]);
    assert.equal(result.status, 2, result.out + result.err);
    assert.match(result.err, /--calibration/);
    assert.deepEqual(other.ran(), []);
    assert.equal(other.status(), "");
  });
});

function hangRepo() {
  const dir = scratch.make("hang-");
  const logDir = scratch.make("hang-log-");
  const mark = join(logDir, "mark");
  const write = (name, text) => {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), text);
  };
  write("src.txt", SRC);
  write(".gitignore", "/.e2e\n");
  write("build.mjs", "");
  write(
    "hang.mjs",
    `import { readFileSync, writeFileSync } from "node:fs";
const src = readFileSync("src.txt", "utf8");
if (src.includes("HANG")) {
  writeFileSync(process.env.TOY_MARK, String(process.pid));
  setInterval(() => {}, 1000);
} else if (src.includes("bexa")) {
  console.log("\\n1 passed, 1 failures");
  process.exit(1);
} else {
  console.log("\\n2 passed, no failures");
}`,
  );
  write(
    "test/steps.mjs",
    `import { join } from "node:path";
import { fileURLToPath } from "node:url";
export const root = fileURLToPath(new URL("..", import.meta.url));
const env = { TOY_MARK: ${JSON.stringify(mark)} };
export const gleamBuild = { id: "build", cwd: root, counted: false, build: true, command: () => ["node", "build.mjs"] };
export const gleamTest = {
  id: "gleam-test",
  cwd: root,
  counted: true,
  outIn: join(root, ".e2e"),
  command: (outDir) => ["node", "hang.mjs", outDir],
  read: ({ output }) => ({ passed: output.includes("2 passed") ? 2 : 1, failed: output.includes("1 failures") ? 1 : 0, skipped: 0 }),
  env,
};
export const keystrokeCost = gleamTest;
export const e2eConfigs = () => [];
export const e2e = () => { throw new Error("no e2e here"); };
`,
  );
  gitIn(dir, "init", "-q");
  gitIn(dir, "add", "-A");
  gitIn(dir, "commit", "-q", "-m", "hang");
  const calibrationFile = join(logDir, "calibration.json");
  const mutantsFile = join(logDir, "mutants.json");
  writeFileSync(calibrationFile, JSON.stringify({ caught: [{ by: "gleam-test", ...mutant("CAL-unit", "beta", "bexa") }], noop: mutant("CAL-noop", "# note", "# notes") }));
  writeFileSync(mutantsFile, JSON.stringify([mutant("M-hang", "delta", "HANG")]));
  return {
    dir,
    mark,
    argv: ["node", join(root, "tools/mutants/mutants.mjs"), mutantsFile, "--repo", dir, "--calibration", calibrationFile, "--checks", "gleam-test", "--out", join(logDir, "out")],
    src: () => readFileSync(join(dir, "src.txt"), "utf8"),
    status: () => gitIn(dir, "status", "--porcelain", "--untracked-files=all"),
    left: () => (existsSync(join(dir, ".e2e")) ? readdirSync(join(dir, ".e2e")).filter((name) => name.startsWith("step-")) : []),
  };
}

describe("the tool stopped from outside, in the middle of a check", () => {
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
    test(`${signal} takes the planted bug out, removes the folder the check wrote in, and stops the check`, async () => {
      const repo = hangRepo();
      const ended = await interrupted({ argv: repo.argv, cwd: repo.dir, mark: repo.mark, signal });
      assert.equal(ended.by, null, `it was ended by ${ended.by}, so nothing put the file back:\n${ended.output}`);
      assert.equal(ended.code, code, ended.output);
      assert.equal(repo.src(), SRC, "the planted bug is still in the file");
      assert.equal(repo.status(), "");
      assert.deepEqual(repo.left(), [], "the folder the check wrote in is still there");
      assert.ok(await gone(Number(ended.held)), "the check is still running");
    });
  }
});
