// Proof that the node tests of the gate leave nothing in the temp directory.
// Each test file is run in a process of its own with TMPDIR pointing at a new
// empty directory, and what is left there afterwards is what the file leaked.
// The detector is itself tried on a file that leaks on purpose, so that a
// proof that finds nothing has been shown able to find something.
//
//   node --test test/scratch.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { nodeTestFiles } from "./steps.mjs";

const repo = fileURLToPath(new URL("..", import.meta.url));
const scratchModule = pathToFileURL(join(repo, "test/scratch.mjs")).href;

const own = [];
after(() => {
  for (const dir of own) rmSync(dir, { recursive: true, force: true });
});
const ownDir = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  own.push(dir);
  return dir;
};

/** Runs `file` under node's test runner with a private temp directory, and gives what it left there. */
function leftBehind(file) {
  const tmp = ownDir("scratch-tmp-");
  // Inside a test run this is set, and a nested `node --test` then runs nothing and says so only on stderr.
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;
  const run = spawnSync(process.execPath, ["--test", "--test-reporter=tap", file], {
    cwd: repo,
    env: { ...env, TMPDIR: tmp },
    encoding: "utf8",
    timeout: 120_000,
  });
  const output = `${run.stdout}${run.stderr}`;
  const total = Number(output.match(/^# tests (\d+)$/m)?.[1] ?? 0);
  assert.ok(total > 0, `${file} ran no tests, so what it left proves nothing:\n${output}`);
  return { status: run.status, left: readdirSync(tmp), output, total };
}

function fixture(name, source) {
  const file = join(ownDir("scratch-fixture-"), name);
  writeFileSync(file, source);
  return file;
}

const header = `import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
`;
const dirWithAFile = `const dir = mkdtempSync(join(tmpdir(), "made-")); writeFileSync(join(dir, "file"), "x");`;

describe("the detector", () => {
  test("finds the directory a test file leaves behind", () => {
    const file = fixture("leaky.test.mjs", `${header}test("leaks", () => { ${dirWithAFile} });\n`);
    const result = leftBehind(file);
    assert.equal(result.status, 0, result.output);
    assert.equal(result.left.length, 1, "the leaked directory was not seen");
    assert.match(result.left[0], /^made-/);
  });

  test("finds a directory that is leaked only when the test fails", () => {
    const file = fixture("leaky-fail.test.mjs", `${header}test("leaks then fails", () => { ${dirWithAFile} throw new Error("boom"); });\n`);
    const result = leftBehind(file);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /boom/, "it failed for some other reason");
    assert.equal(result.left.length, 1);
  });
});

describe("scratch", () => {
  test("removes every directory it made, with what is in them, when the file ends", async () => {
    const file = fixture(
      "tidy.test.mjs",
      `${header}import { useScratch } from ${JSON.stringify(scratchModule)};
const scratch = useScratch();
test("makes two", () => {
  for (const prefix of ["a-", "b-"]) {
    const dir = scratch.make(prefix);
    writeFileSync(join(dir, "file"), "x");
  }
});
test("makes one more", () => { ${dirWithAFile.replace("mkdtempSync(join(tmpdir(), \"made-\"))", 'scratch.make("c-")')} });
`,
    );
    const result = leftBehind(file);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(result.left, []);
  });

  test("removes them when a test fails, too", () => {
    const file = fixture(
      "tidy-fail.test.mjs",
      `${header}import { useScratch } from ${JSON.stringify(scratchModule)};
const scratch = useScratch();
test("makes one, then fails", () => { scratch.make("d-"); throw new Error("boom"); });
`,
    );
    const result = leftBehind(file);
    assert.notEqual(result.status, 0);
    assert.match(result.output, /boom/, "it failed for some other reason");
    assert.deepEqual(result.left, []);
  });

  test("make gives a new, empty directory under the temp directory, and clean removes it at once", async () => {
    const { useScratch } = await import(scratchModule);
    const scratch = useScratch();
    const dir = scratch.make("unit-");
    try {
      assert.ok(dir.startsWith(tmpdir()));
      assert.match(dir.slice(tmpdir().length), /unit-/);
      assert.deepEqual(readdirSync(dir), []);
      writeFileSync(join(dir, "file"), "x");
      scratch.clean();
      assert.equal(existsSync(dir), false);
      scratch.clean();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the node tests of the gate", () => {
  const files = nodeTestFiles().filter((file) => file !== "test/scratch.test.mjs");

  test("there are some, so the proof is not about nothing", () => {
    assert.ok(files.length >= 2, `found ${files.join(", ")}`);
  });

  for (const file of files) {
    test(`${file} leaves nothing in the temp directory`, () => {
      const result = leftBehind(join(repo, file));
      assert.equal(result.status, 0, result.output);
      assert.deepEqual(result.left, []);
    });
  }
});
