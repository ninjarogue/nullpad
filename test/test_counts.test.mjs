// Break cases for the test-count gate (`test/test_counts.mjs`). Each case
// plants the failure the gate exists for, with a real subprocess standing in
// for a test runner, and checks that the gate says no. A run that adds tests
// raises the known count, and a run that loses tests never lowers it.
//
//   node --test test/test_counts.test.mjs

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { useScratch } from "./scratch.mjs";
import { e2e as e2eStep, e2eConfigs, gateSteps, nodeTest as nodeTestStep, nodeTestFiles, readers } from "./steps.mjs";
import { gate, judge, loadCounts, runStep } from "./test_counts.mjs";

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
