import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { gone, interrupted } from "./interrupt.mjs";
import { useScratch } from "./scratch.mjs";
import { e2e as e2eStep, e2eConfigs, gateSteps, gleamTest, keystrokeCost, nodeTest as nodeTestStep, nodeTestFiles, readers, root } from "./steps.mjs";
import { gate, judge, loadCounts, runStep } from "./test_counts.mjs";
import * as counts from "./test_counts.mjs";

const scratch = useScratch();

const green = (text) => `\u001b[32m${text}\u001b[39m`;
const gleeunit = (passed) => `Running tests\n${".".repeat(5)}\n${green(`${passed} passed, no failures`)}\n`;

const report = ({ passed, failed = 0, skipped = 0, interrupted = 0, flaky = 0, results = passed }) =>
  JSON.stringify({
    schemaVersion: "report-1",
    run: {
      status: failed > 0 ? "failed" : "passed",
      summary: {
        discovered: passed + failed + skipped,
        selected: passed + failed + skipped,
        executed: passed + failed,
        passed,
        failed,
        interrupted,
        flaky,
        skipped,
      },
      results: Array.from({ length: results }, () => ({ kind: "test", status: "passed" })),
    },
  });

function workspace() {
  const dir = scratch.make("counts-");
  const countsFile = join(dir, "test_counts.json");
  const runner = (name, source) => {
    const file = join(dir, name);
    writeFileSync(file, source);
    return file;
  };
  const step = (id, file, read = readers.gleeunit, held) => ({
    id,
    cwd: dir,
    counted: true,
    command: (outDir) => ["node", file, outDir],
    read,
    ...(held ? { held } : {}),
  });
  const known = (counts) => writeFileSync(countsFile, JSON.stringify(counts, null, 2) + "\n");
  const stored = () => JSON.parse(readFileSync(countsFile, "utf8"));
  return { dir, countsFile, runner, step, known, stored };
}

const quietly = { log: () => {}, write: () => {} };

describe("judge", () => {
  const ok = { exitCode: 0, counts: { passed: 10, failed: 0, skipped: 0 } };

  test("a step that ran 0 tests fails, even when nothing is known about it", () => {
    const verdict = judge({ id: "s", known: undefined, ...ok, counts: { passed: 0, failed: 0, skipped: 0 } });
    assert.match(verdict.failures.join("\n"), /ran 0 tests/);
    assert.equal(verdict.raise, null);
  });

  test("a step that ran 0 tests fails against a known count", () => {
    const verdict = judge({ id: "s", known: 10, ...ok, counts: { passed: 0, failed: 0, skipped: 0 } });
    assert.match(verdict.failures.join("\n"), /ran 0 tests/);
  });

  test("a step with one test removed fails and names the count it fell from", () => {
    const verdict = judge({ id: "s", known: 11, ...ok });
    assert.equal(verdict.failures.length, 1);
    assert.match(verdict.failures[0], /ran 10 tests/);
    assert.match(verdict.failures[0], /known count is 11/);
    assert.match(verdict.failures[0], /by hand/);
    assert.equal(verdict.raise, null);
  });

  test("a step that ran the known number passes and changes nothing", () => {
    const verdict = judge({ id: "s", known: 10, ...ok });
    assert.deepEqual(verdict, { failures: [], raise: null });
  });

  test("a step with a test added passes and raises the count to what ran", () => {
    const verdict = judge({ id: "s", known: 9, ...ok });
    assert.deepEqual(verdict, { failures: [], raise: 10 });
  });

  test("the first run of a step with tests records its count", () => {
    assert.deepEqual(judge({ id: "s", known: undefined, ...ok }), { failures: [], raise: 10 });
  });

  test("a failing test fails the step, and raises nothing", () => {
    const verdict = judge({ id: "s", known: 5, exitCode: 1, counts: { passed: 10, failed: 1, skipped: 0 } });
    assert.match(verdict.failures.join("\n"), /1 test failed/);
    assert.equal(verdict.raise, null);
  });

  test("a skipped test fails the step, because it did not run", () => {
    const verdict = judge({ id: "s", known: 5, exitCode: 0, counts: { passed: 10, failed: 0, skipped: 2 } });
    assert.match(verdict.failures.join("\n"), /2 tests skipped/);
    assert.equal(verdict.raise, null);
  });

  test("a non-zero exit fails the step even when its output counts look fine", () => {
    const verdict = judge({ id: "s", known: 5, exitCode: 2, counts: ok.counts });
    assert.match(verdict.failures.join("\n"), /exited 2/);
    assert.equal(verdict.raise, null);
  });

  test("a command killed by a signal fails the step and says which", () => {
    const verdict = judge({ id: "s", known: 5, exitCode: null, signal: "SIGKILL", counts: ok.counts });
    assert.match(verdict.failures.join("\n"), /killed by SIGKILL/);
  });

  test("output with no readable count fails the step with the reason", () => {
    const verdict = judge({ id: "s", known: 5, exitCode: 0, counts: null, problem: "no summary line" });
    assert.match(verdict.failures.join("\n"), /no summary line/);
    assert.equal(verdict.raise, null);
  });
});

describe("what each runner says about itself", () => {
  test("gleeunit: the count of a clean run, with colour codes in the way", () => {
    assert.deepEqual(readers.gleeunit({ output: gleeunit(462) }), { passed: 462, failed: 0, skipped: 0 });
  });

  test("gleeunit: failures and skipped tests are told apart from passes", () => {
    assert.deepEqual(readers.gleeunit({ output: "\n3 passed, 2 failures\n" }), { passed: 3, failed: 2, skipped: 0 });
    assert.deepEqual(readers.gleeunit({ output: "\n3 passed, 0 failures, 4 skipped\n" }), { passed: 3, failed: 0, skipped: 4 });
    assert.deepEqual(readers.gleeunit({ output: "\n3 passed, 1 failures, 4 skipped\n" }), { passed: 3, failed: 1, skipped: 4 });
  });

  test("gleeunit: 'No tests found!' is a run of 0 tests", () => {
    assert.deepEqual(readers.gleeunit({ output: "\nNo tests found!\n" }), { passed: 0, failed: 0, skipped: 0 });
  });

  test("gleeunit: a line that only looks like a summary is not one", () => {
    assert.throws(() => readers.gleeunit({ output: "CommonMark 0.31.2: 458 of 652 examples pass\n" }), /summary/);
    assert.throws(() => readers.gleeunit({ output: "error: Unknown module\n" }), /summary/);
    assert.throws(() => readers.gleeunit({ output: "" }), /summary/);
    assert.throws(() => readers.gleeunit({ output: "see 7 passed, no failures above\n" }), /summary/);
  });

  test("keystroke_cost: its own summary line", () => {
    const output = "table...\nkeystroke_cost: 125 ok, 1 failed, 2 not built yet\n";
    assert.deepEqual(readers.keystroke({ output }), { passed: 125, failed: 1, skipped: 0 });
    assert.throws(() => readers.keystroke({ output: "table...\n" }), /summary/);
  });

  test("node:test: the TAP totals", () => {
    const output = "1..3\n# tests 3\n# suites 0\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n";
    assert.deepEqual(readers.nodeTest({ output }), { passed: 2, failed: 0, skipped: 1 });
    const broken = "# tests 3\n# pass 1\n# fail 1\n# cancelled 1\n# skipped 0\n";
    assert.deepEqual(readers.nodeTest({ output: broken }), { passed: 1, failed: 2, skipped: 0 });
    assert.throws(() => readers.nodeTest({ output: "Error: Cannot find module\n" }), /summary/);
  });

  test("e2e: the passed count of the report the run wrote", () => {
    const dir = scratch.make("report-");
    writeFileSync(join(dir, "report.json"), report({ passed: 332 }));
    assert.deepEqual(readers.e2e({ outDir: dir }), { passed: 332, failed: 0, skipped: 0 });
    writeFileSync(join(dir, "report.json"), report({ passed: 330, failed: 2, skipped: 3 }));
    assert.deepEqual(readers.e2e({ outDir: dir }), { passed: 330, failed: 2, skipped: 3 });
  });

  test("e2e: a test that was interrupted, or passed only on a retry, is not a pass that counts", () => {
    const dir = scratch.make("report-");
    writeFileSync(join(dir, "report.json"), report({ passed: 10, interrupted: 2, flaky: 1 }));
    assert.deepEqual(readers.e2e({ outDir: dir }), { passed: 10, failed: 3, skipped: 0 });
  });

  test("e2e: no report, a report that disagrees with itself, or a new schema is an error", () => {
    const dir = scratch.make("report-");
    assert.throws(() => readers.e2e({ outDir: dir }), /report\.json/);
    writeFileSync(join(dir, "report.json"), report({ passed: 10, results: 9 }));
    assert.throws(() => readers.e2e({ outDir: dir }), /disagrees/);
    writeFileSync(join(dir, "report.json"), report({ passed: 10 }).replace("report-1", "report-2"));
    assert.throws(() => readers.e2e({ outDir: dir }), /schema/);
    writeFileSync(join(dir, "report.json"), "{not json");
    assert.throws(() => readers.e2e({ outDir: dir }), /report\.json/);
  });
});

describe("a step run through the gate", () => {
  test("a runner that runs 0 tests fails, and the counts file stays as it was", async () => {
    const w = workspace();
    w.known({ fake: 10 });
    const file = w.runner("zero.mjs", `console.log("\\nNo tests found!"); process.exit(1);`);
    const verdict = await runStep(w.step("fake", file), { countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /ran 0 tests/);
    assert.deepEqual(w.stored(), { fake: 10 });
  });

  test("a runner that exits 0 after running 0 tests still fails", async () => {
    const w = workspace();
    w.known({ fake: 10 });
    const file = w.runner("zero.mjs", `console.log("\\nNo tests found!");`);
    const verdict = await runStep(w.step("fake", file), { countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /ran 0 tests/);
  });

  test("a runner with one test removed fails, and the counts file stays as it was", async () => {
    const w = workspace();
    w.known({ fake: 10 });
    const file = w.runner("nine.mjs", `console.log("\\n9 passed, no failures");`);
    const verdict = await runStep(w.step("fake", file), { countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /ran 9 tests/);
    assert.deepEqual(w.stored(), { fake: 10 });
  });

  test("a runner with a test added passes and raises the count in the file", async () => {
    const w = workspace();
    w.known({ fake: 10, other: 3 });
    const file = w.runner("eleven.mjs", `console.log("\\n11 passed, no failures");`);
    const verdict = await runStep(w.step("fake", file), { countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.raised, 11);
    assert.deepEqual(w.stored(), { fake: 11, other: 3 });
  });

  test("the file is written sorted, two spaces in, with a newline at the end, so a raise is one line in a diff", async () => {
    const w = workspace();
    w.known({ zeta: 2, alpha: 1 });
    const file = w.runner("eleven.mjs", `console.log("\\n11 passed, no failures");`);
    await runStep(w.step("mid", file), { countsFile: w.countsFile, ...quietly });
    assert.equal(readFileSync(w.countsFile, "utf8"), '{\n  "alpha": 1,\n  "mid": 11,\n  "zeta": 2\n}\n');
  });

  test("a step whose runner is not installed fails with how to install it, and runs nothing", async () => {
    const w = workspace();
    w.known({ fake: 10 });
    const file = w.runner("never.mjs", `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(join(w.dir, "ran"))}, "yes");`);
    const step = { ...w.step("fake", file), needs: join(w.dir, "node_modules"), hint: "run npm install once" };
    const verdict = await runStep(step, { countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /run npm install once/);
    assert.throws(() => readFileSync(join(w.dir, "ran")), /ENOENT/);
  });

  test("a count lowered by hand lets the smaller run pass", async () => {
    const w = workspace();
    w.known({ fake: 10 });
    const file = w.runner("nine.mjs", `console.log("\\n9 passed, no failures");`);
    assert.equal((await runStep(w.step("fake", file), { countsFile: w.countsFile, ...quietly })).ok, false);
    w.known({ fake: 9 });
    const verdict = await runStep(w.step("fake", file), { countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, true);
    assert.deepEqual(w.stored(), { fake: 9 });
  });

  test("a step with no known count is recorded on its first run", async () => {
    const w = workspace();
    w.known({});
    const file = w.runner("four.mjs", `console.log("\\n4 passed, no failures");`);
    const verdict = await runStep(w.step("fake", file), { countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, true);
    assert.deepEqual(w.stored(), { fake: 4 });
  });

  test("a runner that crashes before it reports fails", async () => {
    const w = workspace();
    w.known({ fake: 10 });
    const file = w.runner("crash.mjs", `console.error("TypeError: x is not a function"); process.exit(1);`);
    const verdict = await runStep(w.step("fake", file), { countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /summary/);
    assert.deepEqual(w.stored(), { fake: 10 });
  });

  test("a runner that reports failing tests fails and raises nothing", async () => {
    const w = workspace();
    w.known({ fake: 10 });
    const file = w.runner("red.mjs", `console.log("\\n20 passed, 2 failures"); process.exit(1);`);
    const verdict = await runStep(w.step("fake", file), { countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, false);
    assert.deepEqual(w.stored(), { fake: 10 });
  });

  test("the e2e report of an earlier run is not read when this run writes none", async () => {
    const w = workspace();
    w.known({ fake: 3 });
    const wrote = w.runner("wrote.mjs", `import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2] + "/report.json", ${JSON.stringify(report({ passed: 3 }))});`);
    const crashed = w.runner("crashed.mjs", `process.exit(1);`);
    const e2e = (file) => w.step("fake", file, readers.e2e);
    assert.equal((await runStep(e2e(wrote), { countsFile: w.countsFile, ...quietly })).ok, true);
    const verdict = await runStep(e2e(crashed), { countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /report\.json/);
  });

  test("a counts file with a count of 0, or one that is not a whole number, is refused", () => {
    const w = workspace();
    for (const bad of [{ fake: 0 }, { fake: 1.5 }, { fake: "10" }, { fake: -1 }, [1]]) {
      w.known(bad);
      assert.throws(() => loadCounts(w.countsFile), /test_counts\.json|count/);
    }
  });

  test("the output of a runner goes through to the person running the gate", async () => {
    const w = workspace();
    w.known({ fake: 1 });
    const file = w.runner("talk.mjs", `console.log("hello from the runner"); console.log("\\n1 passed, no failures");`);
    let seen = "";
    await runStep(w.step("fake", file), { countsFile: w.countsFile, log: () => {}, write: (text) => (seen += text) });
    assert.match(seen, /hello from the runner/);
  });
});

describe("the gate", () => {
  test("stops at the first failing step and runs no later one", async () => {
    const w = workspace();
    w.known({ a: 5, b: 5, c: 5 });
    const marker = join(w.dir, "c-ran");
    const good = w.runner("good.mjs", `console.log("\\n5 passed, no failures");`);
    const short = w.runner("short.mjs", `console.log("\\n4 passed, no failures");`);
    const last = w.runner("last.mjs", `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "ran"); console.log("\\n5 passed, no failures");`);
    const steps = [w.step("a", good), w.step("b", short), w.step("c", last)];
    const verdict = await gate({ steps, countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, false);
    assert.deepEqual(verdict.ran, ["a", "b"]);
    assert.throws(() => readFileSync(marker), /ENOENT/);
  });

  test("passes when every step holds its count, and says which counts rose", async () => {
    const w = workspace();
    w.known({ a: 5, b: 5 });
    const five = w.runner("five.mjs", `console.log("\\n5 passed, no failures");`);
    const six = w.runner("six.mjs", `console.log("\\n6 passed, no failures");`);
    const verdict = await gate({ steps: [w.step("a", five), w.step("b", six)], countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.raised, { b: 6 });
    assert.deepEqual(w.stored(), { a: 5, b: 6 });
  });

  test("a run of some steps does not need the steps it left out", async () => {
    const w = workspace();
    w.known({ a: 5, b: 5 });
    const five = w.runner("five.mjs", `console.log("\\n5 passed, no failures");`);
    const verdict = await gate({ steps: [w.step("a", five)], countsFile: w.countsFile, partial: true, ...quietly });
    assert.equal(verdict.ok, true);
  });

  test("a step that is not counted only has to exit 0", async () => {
    const w = workspace();
    w.known({});
    const fine = w.runner("fine.mjs", `console.log("types ok");`);
    const broken = w.runner("broken.mjs", `process.exit(1);`);
    const plain = (file) => ({ id: "types", cwd: w.dir, counted: false, command: () => ["node", file] });
    assert.equal((await gate({ steps: [plain(fine)], countsFile: w.countsFile, ...quietly })).ok, true);
    assert.equal((await gate({ steps: [plain(broken)], countsFile: w.countsFile, ...quietly })).ok, false);
    assert.deepEqual(w.stored(), {});
  });

  test("a known count for a step that is no longer run fails, so a removed step cannot hide", async () => {
    const w = workspace();
    w.known({ a: 5, "e2e:gone.config.ts": 40 });
    const five = w.runner("five.mjs", `console.log("\\n5 passed, no failures");`);
    const verdict = await gate({ steps: [w.step("a", five)], countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /e2e:gone\.config\.ts/);
    assert.deepEqual(w.stored(), { a: 5, "e2e:gone.config.ts": 40 });
  });
});

describe("the e2e configs", () => {
  test("every config in the e2e folder is a step, so a new one cannot go unchecked", () => {
    const dir = scratch.make("e2e-");
    for (const name of ["e2e.config.ts", "e2e.dpr2.config.mjs", "package.json", "serve.mjs", "tsconfig.json"]) {
      writeFileSync(join(dir, name), "");
    }
    mkdirSync(join(dir, "old.config.mjs"));
    mkdirSync(join(dir, "tests"));
    writeFileSync(join(dir, "tests", "x.config.ts"), "");
    assert.deepEqual(e2eConfigs(dir), ["e2e.config.ts", "e2e.dpr2.config.mjs"]);
  });
});

describe("the node tests", () => {
  test("every node test file under test/ and tools/ is a step of the gate, so a new one cannot go unrun", () => {
    const run = gateSteps().flatMap((step) => step.command("").filter((arg) => arg.endsWith(".test.mjs")));
    assert.deepEqual(run.sort(), nodeTestFiles());
  });

  test("a node test file is any *.test.mjs under test/ or tools/, outside node_modules and hidden folders", () => {
    const base = scratch.make("tree-");
    const put = (name) => {
      mkdirSync(join(base, name, ".."), { recursive: true });
      writeFileSync(join(base, name), "");
    };
    for (const name of ["test/a.test.mjs", "tools/x/b.test.mjs", "test/c.mjs", "test/node_modules/d.test.mjs", "tools/.hidden/e.test.mjs", "e2e/f.test.mjs", "g.test.mjs"]) put(name);
    assert.deepEqual(nodeTestFiles(base), ["test/a.test.mjs", "tools/x/b.test.mjs"]);
  });
});

describe("what a step holds back from its count: tests marked to fail, and todos", () => {
  const sayHeld = ({ output }) => Object.fromEntries([...output.matchAll(/^held (\S+)=(\d+)$/gm)].map(([, name, count]) => [name, Number(count)]));
  const prints = (w, heldLines) => w.runner("held.mjs", `console.log("\\n5 passed, no failures\\n${heldLines.map((line) => `held ${line}`).join("\\n")}");`);
  const run = (w, file) => runStep(w.step("fake", file, readers.gleeunit, sayHeld), { countsFile: w.countsFile, ...quietly });

  const marked = (count, { unexpectedPass = false } = {}) => {
    const parsed = JSON.parse(report({ passed: 4 }));
    for (let at = 0; at < count; at++) parsed.run.results[at].expectedFailure = { reason: "known gap" };
    if (unexpectedPass) {
      parsed.run.results.push({ kind: "test", status: "failed", expectedFailure: { reason: "was marked" } });
      parsed.run.summary.failed = 1;
    }
    return JSON.stringify(parsed);
  };

  test("an e2e step counts the tests that passed by failing as expected, apart from the passes", () => {
    const dir = scratch.make("report-");
    const step = e2eStep("e2e.config.ts");
    assert.equal(typeof step.held, "function", "an e2e step says nothing about the tests marked test.fail");
    writeFileSync(join(dir, "report.json"), marked(2, { unexpectedPass: true }));
    assert.deepEqual(step.held({ output: "", outDir: dir }), { "expected-fail": 2 });
    writeFileSync(join(dir, "report.json"), report({ passed: 4 }));
    assert.deepEqual(step.held({ output: "", outDir: dir }), { "expected-fail": 0 });
  });

  test("a node test step counts its todos, and a summary with no todo line is an error", () => {
    const step = nodeTestStep("fake", "test/fake.test.mjs");
    assert.equal(typeof step.held, "function", "a node test step says nothing about its todos");
    assert.deepEqual(step.held({ output: "# tests 5\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 3\n" }), { todo: 3 });
    assert.throws(() => step.held({ output: "# tests 5\n# pass 5\n# fail 0\n" }), /todo/);
  });

  test("a rise in the tests marked to fail fails the step, says what to edit by hand, and leaves the file alone", async () => {
    const w = workspace();
    w.known({ fake: 5 });
    const verdict = await run(w, prints(w, ["expected-fail=1"]));
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /expected-fail/);
    assert.match(verdict.failures.join("\n"), /by hand/);
    assert.deepEqual(w.stored(), { fake: 5 });
  });

  test("a rise in todos fails the step the same way", async () => {
    const w = workspace();
    w.known({ fake: 5, "fake todo": 1 });
    const verdict = await run(w, prints(w, ["todo=2"]));
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /todo/);
    assert.deepEqual(w.stored(), { fake: 5, "fake todo": 1 });
  });

  test("the number a person wrote in the file is the number that is allowed", async () => {
    const w = workspace();
    w.known({ fake: 5, "fake expected-fail": 2, "fake todo": 1 });
    const verdict = await run(w, prints(w, ["expected-fail=2", "todo=1"]));
    assert.equal(verdict.ok, true, verdict.failures.join("\n"));
    assert.deepEqual(w.stored(), { fake: 5, "fake expected-fail": 2, "fake todo": 1 });
  });

  test("a step that holds none needs no line in the file", async () => {
    const w = workspace();
    w.known({ fake: 5 });
    const verdict = await run(w, prints(w, ["expected-fail=0", "todo=0"]));
    assert.equal(verdict.ok, true, verdict.failures.join("\n"));
    assert.deepEqual(w.stored(), { fake: 5 });
  });

  test("a fall lowers the number in the file, and the last one takes the line out, so the slack cannot be spent on a new one", async () => {
    const w = workspace();
    w.known({ fake: 5, "fake expected-fail": 3 });
    const two = await run(w, prints(w, ["expected-fail=2"]));
    assert.equal(two.ok, true, two.failures.join("\n"));
    assert.deepEqual(w.stored(), { fake: 5, "fake expected-fail": 2 });
    const none = await run(w, prints(w, ["expected-fail=0"]));
    assert.equal(none.ok, true);
    assert.deepEqual(w.stored(), { fake: 5 });
    const back = await run(w, prints(w, ["expected-fail=1"]));
    assert.equal(back.ok, false);
  });

  test("a rise in the passes does not pay for a rise in the tests marked to fail", async () => {
    const w = workspace();
    w.known({ fake: 3 });
    const verdict = await run(w, prints(w, ["expected-fail=1"]));
    assert.equal(verdict.ok, false);
    assert.deepEqual(w.stored(), { fake: 3 });
  });

  test("a step that failed changes nothing in the file, not even a number that fell", async () => {
    const w = workspace();
    w.known({ fake: 5, "fake todo": 4 });
    const red = w.runner("red.mjs", `console.log("\\n5 passed, 1 failures\\nheld todo=1"); process.exit(1);`);
    const verdict = await run(w, red);
    assert.equal(verdict.ok, false);
    assert.deepEqual(w.stored(), { fake: 5, "fake todo": 4 });
  });

  test("a held number for a step the gate no longer runs fails the gate", async () => {
    const w = workspace();
    w.known({ fake: 5, "gone expected-fail": 2 });
    const verdict = await gate({ steps: [w.step("fake", prints(w, []), readers.gleeunit, sayHeld)], countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /gone expected-fail/);
  });

  test("a held number for a step that ran is not an orphan", async () => {
    const w = workspace();
    w.known({ fake: 5, "fake expected-fail": 2 });
    const verdict = await gate({ steps: [w.step("fake", prints(w, ["expected-fail=2"]), readers.gleeunit, sayHeld)], countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, true, verdict.failures.join("\n"));
  });
});

describe("node tests that no step runs, and a clone that runs no hook", () => {
  const tree = (names) => {
    const base = scratch.make("repo-");
    for (const name of names) {
      mkdirSync(join(base, name, ".."), { recursive: true });
      writeFileSync(join(base, name), "");
    }
    return base;
  };
  const running = (...files) => ({ id: "node", cwd: tmpdir(), counted: false, command: () => ["node", "-e", "", ...files] });
  const gateOf = (w, base, steps, options = {}) => gate({ steps, countsFile: w.countsFile, base, ...options, ...quietly });

  test("a *.test.mjs anywhere in the repository that no step runs fails the gate, and the gate names it", async () => {
    const w = workspace();
    w.known({});
    const names = ["src/b.test.mjs", "e2e/c.test.mjs", ".claude/skills/d.test.mjs", "tools/.hidden/e.test.mjs", "f.test.mjs", "e2e/tests/g.test.ts", "test/deep/h.test.cjs"];
    const base = tree(["test/a.test.mjs", ...names]);
    const verdict = await gateOf(w, base, [running("test/a.test.mjs")]);
    assert.equal(verdict.ok, false, "a test file nobody runs passed the gate");
    for (const name of names) assert.match(verdict.failures.join("\n"), new RegExp(name.replace(/[.]/g, "\\.")), `${name} is not named`);
    assert.doesNotMatch(verdict.failures.join("\n"), /test\/a\.test\.mjs/);
  });

  test("every test file a step runs, and none in node_modules or a folder the tools make, passes", async () => {
    const w = workspace();
    w.known({});
    const base = tree([
      "test/a.test.mjs",
      "node_modules/x.test.mjs",
      "e2e/node_modules/y/z.test.mjs",
      "build/dev/javascript/nullpad/a.test.mjs",
      ".mutants/t/b.test.mjs",
      "e2e/.e2e/step-1/c.test.mjs",
      ".git/d.test.mjs",
    ]);
    const verdict = await gateOf(w, base, [running("test/a.test.mjs")]);
    assert.equal(verdict.ok, true, verdict.failures.join("\n"));
  });

  test("a run of some steps does not look for the test files of the others", async () => {
    const w = workspace();
    w.known({});
    const base = tree(["test/a.test.mjs", "src/b.test.mjs"]);
    assert.equal((await gateOf(w, base, [running("test/a.test.mjs")], { partial: true })).ok, true);
  });

  const hooks = (base) => gate({ steps: [], countsFile: join(base, "counts.json"), base, ...quietly });

  test("a clone whose core.hooksPath is not .githooks is warned, and one that is set is not", async () => {
    const saved = { global: process.env.GIT_CONFIG_GLOBAL, system: process.env.GIT_CONFIG_SYSTEM };
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CONFIG_SYSTEM = "/dev/null";
    try {
      const base = scratch.make("hooks-");
      execFileSync("git", ["init", "-q"], { cwd: base });
      writeFileSync(join(base, "counts.json"), "{}\n");
      const unset = await hooks(base);
      assert.ok(unset.warnings?.some((line) => line.includes("core.hooksPath") && line.includes(".githooks")), `warned with ${JSON.stringify(unset.warnings)}`);
      execFileSync("git", ["config", "core.hooksPath", "elsewhere"], { cwd: base });
      assert.ok((await hooks(base)).warnings?.some((line) => line.includes("elsewhere")));
      execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: base });
      assert.deepEqual((await hooks(base)).warnings, []);
    } finally {
      for (const [name, value] of [["GIT_CONFIG_GLOBAL", saved.global], ["GIT_CONFIG_SYSTEM", saved.system]]) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe("what the docs tell a clone with no hook to run", () => {
  test("the verify skill's fallback runs the gate, not the steps that skip the count check", () => {
    const skill = readFileSync(join(root, ".claude/skills/verify-nullpad/SKILL.md"), "utf8");
    const line = skill.split("\n").find((text) => text.includes("core.hooksPath"));
    assert.ok(line, "the skill no longer says how to turn the hook on");
    assert.match(line, /node test\/test_counts\.mjs run/);
    assert.doesNotMatch(line, /gleam test/);
  });
});

describe("the gate stopped from outside, in the middle of a step", () => {
  function hangingGate() {
    const dir = scratch.make("gate-");
    const mark = join(scratch.make("gate-mark-"), "mark");
    mkdirSync(join(dir, "test"));
    copyFileSync(join(root, "test/test_counts.mjs"), join(dir, "test/test_counts.mjs"));
    writeFileSync(join(dir, "test/test_counts.json"), '{\n  "e2e:hang": 1\n}\n');
    writeFileSync(join(dir, "hang.mjs"), `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(mark)}, String(process.pid)); setInterval(() => {}, 1000);`);
    writeFileSync(
      join(dir, "test/steps.mjs"),
      `import { join } from "node:path";
import { fileURLToPath } from "node:url";
export const root = fileURLToPath(new URL("..", import.meta.url));
export const heldNames = [];
export const strayNodeTests = () => [];
export const gateSteps = () => [{ id: "e2e:hang", cwd: root, counted: true, outIn: join(root, ".e2e"), command: (outDir) => ["node", "hang.mjs", outDir], read: () => ({ passed: 1, failed: 0, skipped: 0 }) }];
`,
    );
    return { dir, mark, left: () => (existsSync(join(dir, ".e2e")) ? readdirSync(join(dir, ".e2e")).filter((name) => name.startsWith("step-")) : []) };
  }

  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]]) {
    test(`${signal} removes the folder the step wrote in and stops the step, and the gate ends with ${code}`, async () => {
      const gateDir = hangingGate();
      const ended = await interrupted({ argv: ["node", "test/test_counts.mjs", "run"], cwd: gateDir.dir, mark: gateDir.mark, signal });
      assert.equal(ended.by, null, `it was ended by ${ended.by}, so nothing cleaned up:\n${ended.output}`);
      assert.equal(ended.code, code, ended.output);
      assert.deepEqual(gateDir.left(), [], "the folder the step wrote in is still there");
      assert.ok(await gone(Number(ended.held)), "the step is still running");
    });
  }
});

describe("which tests failed, as each runner says", () => {
  const has = (step) => assert.equal(typeof step.failing, "function", `${step.id} cannot say which tests failed`);

  test("gleam test: the module and function of each failure, with the colour codes in the way", () => {
    has(gleamTest);
    const output = [
      "\u001b[32m.\u001b[39m\u001b[1m\u001b[31massert\u001b[39m\u001b[22m \u001b[90mtest/editor_test.gleam:12\u001b[39m",
      "\u001b[36m test\u001b[39m: editor_test.undo_test",
      "\u001b[36m info\u001b[39m: Assertion failed.",
      "\u001b[90mbuffer_test.move_test\u001b[39m",
      "An unexpected error occurred:",
      "",
      "  Error(Nil)",
      "",
      "1 passed, 2 failures",
    ].join("\n");
    assert.deepEqual(gleamTest.failing({ output }), ["editor_test.undo_test", "buffer_test.move_test"]);
    assert.deepEqual(gleamTest.failing({ output: "5 passed, no failures" }), []);
  });

  test("keystroke_cost: the rows over budget and the lines it printed to say what broke", () => {
    has(keystrokeCost);
    const output = [
      "│ 0 │ '20 KB' │ 'typed character' │ 2 │ 'OVER BUDGET (1)' │",
      "│ 1 │ '20 KB' │ 'caret move' │ 0 │ 'ok' │",
      "editor.Foo has no entry in test/keystroke_cost.mjs.",
      "undo history: 599 of 600 steps could be undone.",
    ].join("\n");
    const failing = keystrokeCost.failing({ output });
    assert.equal(failing.length, 3);
    assert.match(failing[0], /typed character/);
    assert.match(failing[1], /editor\.Foo has no entry/);
    assert.match(failing[2], /undo history/);
  });

  test("node:test: the names of the tests that failed, and not the todos and skips", () => {
    const step = nodeTestStep("fake", "test/fake.test.mjs");
    has(step);
    const output = "ok 1 - fine\nnot ok 2 - broken one\n  ---\nnot ok 3 - a todo # TODO\nok 4 - skipped # SKIP\nnot ok 5 - broken two # extra\n";
    assert.deepEqual(step.failing({ output }), ["broken one", "broken two"]);
  });

  test("e2e: the file and title of each test the report says did not pass", () => {
    const step = e2eStep("e2e.config.ts");
    has(step);
    const dir = scratch.make("report-");
    const parsed = JSON.parse(report({ passed: 2 }));
    parsed.run.results.push(
      { kind: "test", status: "failed", file: "tests/live.e2e.ts", titlePath: ["a describe", "a test"] },
      { kind: "test", status: "skipped", file: "tests/live.e2e.ts", titlePath: ["left out"] },
      { kind: "test", status: "interrupted", file: "tests/undo.e2e.ts", titlePath: ["cut short"] },
    );
    writeFileSync(join(dir, "report.json"), JSON.stringify(parsed));
    assert.deepEqual(step.failing({ output: "", outDir: dir }), ["tests/live.e2e.ts > a describe > a test", "tests/undo.e2e.ts > cut short"]);
  });

  test("e2e: a step can be narrowed to the tests that failed, to run them again on the clean tree", () => {
    const step = e2eStep("e2e.dpr2.config.ts", ["--max-failures", "1"]);
    assert.equal(typeof step.narrow, "function", "an e2e step cannot be run again for only the tests that failed");
    const narrowed = step.narrow(["tests/live.e2e.ts > a describe > a (test)", "tests/undo.e2e.ts > cut short"]);
    const argv = narrowed.command("/out");
    assert.equal(narrowed.id, step.id);
    assert.ok(argv.includes("e2e.dpr2.config.ts") && argv.includes("/out") && argv.includes("--max-failures"), argv.join(" "));
    const greps = argv.flatMap((arg, at) => (argv[at - 1] === "--grep" ? [arg] : []));
    assert.equal(greps.length, 2);
    assert.ok(new RegExp(greps[0]).test("a describe a (test)"), greps[0]);
    assert.ok(!new RegExp(greps[0]).test("a describe a Xtest)"), greps[0]);
    assert.ok(new RegExp(greps[1]).test("cut short"));
  });
});

describe("a counts file that the run raised, or that was changed by hand, and is not committed", () => {
  const repository = () => {
    const dir = scratch.make("counts-repo-");
    const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
    const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q");
    mkdirSync(join(dir, "test"));
    const countsFile = join(dir, "test", "test_counts.json");
    const known = (numbers) => writeFileSync(countsFile, JSON.stringify(numbers, null, 2) + "\n");
    const commit = () => {
      git("add", "-A");
      git("commit", "-q", "-m", "counts");
    };
    return { dir, countsFile, known, commit, git, stored: () => JSON.parse(readFileSync(countsFile, "utf8")) };
  };
  const printing = (w, name, passed) => w.runner(name, `console.log("\\n${passed} passed, no failures");`);
  const run = (repo, steps, options = {}) => gate({ steps, countsFile: repo.countsFile, base: repo.dir, partial: true, commitCheck: true, ...options, ...quietly });
  const said = /commit test\/test_counts\.json/;

  test("a run that raises a count fails until the file is committed, and then passes", async () => {
    const w = workspace();
    const repo = repository();
    repo.known({ a: 5 });
    repo.commit();
    const six = printing(w, "six.mjs", 6);
    const first = await run(repo, [w.step("a", six)]);
    assert.equal(first.ok, false, "a raised count that nobody committed passed the gate");
    assert.match(first.failures.join("\n"), said);
    assert.deepEqual(repo.stored(), { a: 6 });
    repo.commit();
    const second = await run(repo, [w.step("a", six)]);
    assert.equal(second.ok, true, second.failures.join("\n"));
  });

  test("a file that already differs from HEAD fails even when the run changes nothing", async () => {
    const w = workspace();
    const repo = repository();
    repo.known({ a: 5 });
    repo.commit();
    repo.known({ a: 4 });
    const verdict = await run(repo, [w.step("a", printing(w, "four.mjs", 4))]);
    assert.equal(verdict.ok, false, "a count lowered by hand and never committed passed the gate");
    assert.match(verdict.failures.join("\n"), said);
    assert.deepEqual(verdict.raised, {});
  });

  test("a file that is staged and not committed fails too", async () => {
    const w = workspace();
    const repo = repository();
    repo.known({ a: 5 });
    repo.commit();
    repo.known({ a: 4 });
    repo.git("add", "test/test_counts.json");
    assert.match((await run(repo, [w.step("a", printing(w, "four.mjs", 4))])).failures.join("\n"), said);
  });

  test("a file that is new and not committed fails", async () => {
    const w = workspace();
    const repo = repository();
    repo.known({ a: 5 });
    assert.match((await run(repo, [w.step("a", printing(w, "five.mjs", 5))])).failures.join("\n"), said);
  });

  test("a file that is committed and held passes", async () => {
    const w = workspace();
    const repo = repository();
    repo.known({ a: 5 });
    repo.commit();
    const verdict = await run(repo, [w.step("a", printing(w, "five.mjs", 5))]);
    assert.equal(verdict.ok, true, verdict.failures.join("\n"));
  });

  test("a step that fails reports its own failure, with no commit failure in the way", async () => {
    const w = workspace();
    const repo = repository();
    repo.known({ a: 5 });
    repo.commit();
    const verdict = await run(repo, [w.step("a", printing(w, "four.mjs", 4))]);
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /ran 4 tests/);
  });

  test("a deliberate local run can leave the file uncommitted, and still raises it", async () => {
    const w = workspace();
    const repo = repository();
    repo.known({ a: 5 });
    repo.commit();
    const verdict = await run(repo, [w.step("a", printing(w, "six.mjs", 6))], { commitCheck: false });
    assert.equal(verdict.ok, true, verdict.failures.join("\n"));
    assert.deepEqual(repo.stored(), { a: 6 });
  });

  test("the check is on unless the flag turns it off, and the hook does not pass the flag", () => {
    assert.equal(counts.parseArgs(["run"]).commitCheck, true);
    assert.equal(counts.parseArgs(["run", "gleam-test"]).commitCheck, true);
    const off = counts.parseArgs(["run", "--no-commit-check", "gleam-test"]);
    assert.equal(off.commitCheck, false);
    assert.deepEqual(off.selected, ["gleam-test"]);
    assert.match(counts.parseArgs(["run", "--no-such-flag"]).error, /--no-such-flag/);
    const hook = readFileSync(join(root, ".githooks/pre-push"), "utf8");
    assert.match(hook, /node test\/test_counts\.mjs run/);
    assert.doesNotMatch(hook, /no-commit-check/);
  });

  test("a counts file outside a repository fails, because nobody can say it was committed", async () => {
    const w = workspace();
    w.known({ a: 5 });
    const verdict = await gate({ steps: [w.step("a", printing(w, "five.mjs", 5))], countsFile: w.countsFile, base: w.dir, partial: true, commitCheck: true, ...quietly });
    assert.equal(verdict.ok, false);
    assert.match(verdict.failures.join("\n"), /cannot tell|commit/);
  });
});

describe("two steps with one id", () => {
  test("fail the gate before either runs, and the id is named", async () => {
    const w = workspace();
    w.known({});
    const marker = join(w.dir, "ran");
    const six = w.runner("six.mjs", `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(marker)}, "x"); console.log("\\n6 passed, no failures");`);
    const three = w.runner("three.mjs", `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(marker)}, "x"); console.log("\\n3 passed, no failures");`);
    const verdict = await gate({ steps: [w.step("same", six), w.step("other", six), w.step("same", three)], countsFile: w.countsFile, ...quietly });
    assert.equal(verdict.ok, false, "two steps with one id passed the gate");
    assert.match(verdict.failures.join("\n"), /same/);
    assert.match(verdict.failures.join("\n"), /twice|more than one|duplicate/i);
    assert.equal(existsSync(marker), false, "a step ran before the ids were checked");
    assert.deepEqual(w.stored(), {});
  });

  test("are not among the steps of the gate", () => {
    const ids = gateSteps().map((step) => step.id);
    assert.deepEqual(ids.filter((id, at) => ids.indexOf(id) !== at), []);
  });
});

describe("a counts file with a key twice", () => {
  const twice = (text) => {
    const w = workspace();
    writeFileSync(w.countsFile, text);
    return w;
  };

  test("is refused, and the key is named, because JSON.parse keeps the last", () => {
    for (const text of [
      '{ "a": 5, "a": 6 }',
      '{\n  "a": 5,\n  "b": 7,\n  "a": 4\n}\n',
      '{ "a": 5, "\\u0061": 6 }',
      '{ "e2e:e2e.config.ts": 460, "gleam-test": 465, "e2e:e2e.config.ts": 1 }',
    ]) {
      const w = twice(text);
      assert.throws(() => loadCounts(w.countsFile), /twice/, text);
    }
    assert.throws(() => loadCounts(twice('{ "a": 5, "b": 1, "a": 6 }').countsFile), /"a"/);
  });

  test("fails the gate before any step runs", async () => {
    const w = twice('{ "a": 5, "a": 6 }');
    const five = w.runner("five.mjs", `console.log("\\n5 passed, no failures");`);
    await assert.rejects(gate({ steps: [w.step("a", five)], countsFile: w.countsFile, ...quietly }), /twice/);
  });

  test("is not taken for keys that only look alike", () => {
    const w = twice('{ "a": 5, "A": 6, "a ": 7, "a todo": 1, "a expected-fail": 1 }');
    assert.deepEqual(loadCounts(w.countsFile), { a: 5, A: 6, "a ": 7, "a todo": 1, "a expected-fail": 1 });
  });
});
