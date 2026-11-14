// Break cases for the planted-bug harness (`tools/mutants/mutants.mjs`). Each
// runs the real tool on a small git repository whose checks are scripts that
// can be told to misbehave, and checks that the tool says no, or says what
// happened, and leaves the repository as it found it.
//
//   node --test tools/mutants/mutants.test.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { readers, root } from "../../test/steps.mjs";
import { HarnessError, classify, defaultChecks, runMutants, validate } from "./mutants.mjs";

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
    else {
      if (mode === "big") for (let line = 0; line < 20000; line++) console.log("line " + line + " of a long report");
      const failed = ["alpha", "beta"].filter((word) => !src.includes(word)).length;
      finish(failed === 0 ? "\\n2 passed, no failures" : "\\n" + (2 - failed) + " passed, " + failed + " failures", failed === 0 ? 0 : 1);
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

function toy({ mode = "", timeoutMs = 20_000 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "toy-"));
  const logDir = mkdtempSync(join(tmpdir(), "toy-log-"));
  const log = join(logDir, "ran.log");
  const outDir = join(logDir, "out");
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const git = (...args) =>
    execFileSync("git", ["-c", "user.name=toy", "-c", "user.email=toy@example.com", ...args], { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "toy");
  const step = (id, file, extra = {}) => ({
    id,
    cwd: dir,
    counted: true,
    command: () => ["node", file],
    read: readers.gleeunit,
    env: { TOY_LOG: log, TOY_MODE: id === "unit" ? mode : "" },
    ...extra,
  });
  const checks = [step("build", "build.mjs", { counted: false, build: true }), step("unit", "unit.mjs"), step("second", "second.mjs")];
  return {
    dir,
    outDir,
    checks,
    log,
    // The checks that ran, in order, while `planted` was in the source. With nothing given, every check that ran.
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

  test("a test that cannot compile is INVALID, not CAUGHT", async () => {
    const t = toy();
    t.checks[1].compileFailed = (output) => /^error:/m.test(output);
    const { results } = await t.run([mutant("M-types", "delta", "NOCOMPILE")]);
    assert.equal(by(results, "M-types").status, "INVALID");
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
