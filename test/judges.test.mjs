import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { compare, inventoryOf, judged, loadParsers } from "./inventory.mjs";
import { covers, describeFailures, parseArgs, sort, trailersOf } from "./judges.mjs";
import { useScratch } from "./scratch.mjs";
import { root } from "./steps.mjs";

const scratch = useScratch();
const parsers = await loadParsers(root);

const inv = (files) => inventoryOf(new Map(Object.entries(files)), parsers);
const changes = (before, after) => compare(inv(before), inv(after));
const named = (result) => result.items.map((item) => `${item.what}: ${item.id}`);

const e2e = (body) => `import { expect, test } from 'e2e';\nimport { add } from './add.ts';\n${body}\n`;
const spec = "e2e/tests/sum.e2e.ts";
const sums = e2e(`test('adds', async () => {
  const sum = add(1, 2);
  expect(sum).toBe(3);
  expect(sum + 1).toBe(4);
});
test('subtracts', async () => {
  await expect(add(5, -2)).toBe(3);
});`);

const swap = (text, from, to) => {
  assert.ok(text.includes(from), `${from} is not in the text`);
  return text.replace(from, to);
};

describe("e2e tests: what makes one weaker", () => {
  const before = { [spec]: sums };
  const weakened = (after) => named(changes(before, { [spec]: after }));

  test("the same file, reformatted, with a new test, a new assertion and a new line, changes nothing", () => {
    const after = swap(sums, "expect(sum + 1).toBe(4);", "expect(sum+1).toBe(4);\n  expect(sum).toBeGreaterThan(0);\n  console.log('x');") + "test('new', async () => { expect(1).toBe(1); });\n";
    assert.deepEqual(weakened(after), []);
  });

  test("toBe turned into toBeTruthy", () => {
    assert.deepEqual(weakened(swap(sums, "expect(sum).toBe(3);", "expect(sum).toBeTruthy();")), [`weakened-test: ${spec} > adds`]);
  });

  test("an expect removed", () => {
    assert.deepEqual(weakened(swap(sums, "  expect(sum + 1).toBe(4);\n", "")), [`weakened-test: ${spec} > adds`]);
  });

  test("an expected value changed to match the code", () => {
    assert.deepEqual(weakened(swap(sums, "toBe(4)", "toBe(5)")), [`weakened-test: ${spec} > adds`]);
  });

  test("a tolerance widened", () => {
    const tight = e2e("test('close', async () => {\n  expect(1.001).toBeCloseTo(1, 4);\n});");
    const wide = swap(tight, "toBeCloseTo(1, 4)", "toBeCloseTo(1, 0)");
    assert.deepEqual(named(changes({ [spec]: tight }, { [spec]: wide })), [`weakened-test: ${spec} > close`]);
  });

  test("an await dropped in front of an assertion that returns a promise", () => {
    assert.deepEqual(weakened(swap(sums, "await expect(add(5, -2))", "expect(add(5, -2))")), [`weakened-test: ${spec} > subtracts`]);
  });

  test("an assertion wrapped in a condition, or in a try", () => {
    assert.deepEqual(weakened(swap(sums, "expect(sum).toBe(3);", "if (sum > 100) { expect(sum).toBe(3); }")), [`weakened-test: ${spec} > adds`]);
    assert.deepEqual(weakened(swap(sums, "expect(sum).toBe(3);", "try { expect(sum).toBe(3); } catch {}")), [`weakened-test: ${spec} > adds`]);
  });

  test("an early return, or a skip, put in front of the assertions", () => {
    assert.deepEqual(weakened(swap(sums, "const sum = add(1, 2);", "const sum = add(1, 2);\n  if (sum) return;")), [`weakened-test: ${spec} > adds`]);
    assert.deepEqual(weakened(swap(sums, "const sum = add(1, 2);", "test.skip(sum === 3);\n  const sum = add(1, 2);")), [`weakened-test: ${spec} > adds`]);
  });

  test("a test marked skip or fail, or given a skip option", () => {
    for (const mark of ["test.skip('adds'", "test.fail('adds'"]) {
      assert.deepEqual(weakened(swap(sums, "test('adds'", mark)), [`weakened-test: ${spec} > adds`], mark);
    }
    assert.deepEqual(weakened(swap(sums, "test('adds', async", "test('adds', { skip: true }, async")), [`weakened-test: ${spec} > adds`]);
  });

  test("a describe marked skip passes that on to the tests under it", () => {
    const grouped = e2e("test.describe('math', () => {\n  test('adds', async () => {\n    expect(add(1, 2)).toBe(3);\n  });\n});");
    const skipped = swap(grouped, "test.describe('math'", "test.describe.skip('math'");
    assert.deepEqual(named(changes({ [spec]: grouped }, { [spec]: skipped })), [`weakened-test: ${spec} > math > adds`]);
  });

  test("a test gone, and a file gone", () => {
    assert.deepEqual(named(changes(before, { [spec]: e2e("test('adds', async () => {\n  const sum = add(1, 2);\n  expect(sum).toBe(3);\n  expect(sum + 1).toBe(4);\n});") })), [`removed-test: ${spec} > subtracts`]);
    const gone = changes(before, {});
    assert.deepEqual(named(gone), [`removed-file: ${spec}`]);
    assert.match(gone.items[0].why, /2 tests/);
  });

  test("a file moved with its tests unchanged is not a removal", () => {
    assert.deepEqual(named(changes(before, { "e2e/tests/total.e2e.ts": sums })), []);
  });

  test("a test given another name with the same body was moved, not removed", () => {
    assert.deepEqual(weakened(swap(sums, "test('adds'", "test('sums two numbers'")), []);
    assert.deepEqual(named(changes(before, { [spec]: swap(sums, "test('adds'", "test('sums two numbers'") })), []);
  });

  test("tests inside describe are named by the group, and are judged the same", () => {
    const grouped = e2e("test.describe('math', () => {\n  test('adds', async () => {\n    expect(add(1, 2)).toBe(3);\n  });\n});");
    const weaker = swap(grouped, "toBe(3)", "toBeTruthy()");
    assert.deepEqual(named(changes({ [spec]: grouped }, { [spec]: weaker })), [`weakened-test: ${spec} > math > adds`]);
  });

  test("a file the branch broke so that it cannot be read is reported, not skipped", () => {
    const result = changes(before, { [spec]: `${sums}\ntest('x', async () => {` });
    assert.equal(result.items[0].what, "unreadable");
  });
});

describe("e2e helpers", () => {
  const helper = "e2e/tests/editing.ts";
  const code = "import { expect } from 'e2e';\nexport class Editing {\n  async shown() { return 1; }\n  async expectNote(text: string) {\n    expect(text).toBe('x');\n    expect(text.length).toBe(1);\n  }\n}\nexport const note = 'alpha';\n";

  test("an assertion helper made to assert less is a change", () => {
    const result = changes({ [helper]: code }, { [helper]: swap(code, "    expect(text.length).toBe(1);\n", "") });
    assert.deepEqual(named(result), [`weakened-helper: ${helper}::class:Editing.expectNote`]);
  });

  test("a helper that does not assert may change, and is listed as a note", () => {
    const result = changes({ [helper]: code }, { [helper]: swap(swap(code, "return 1;", "return 2;"), "'alpha'", "'beta'") });
    assert.deepEqual(result.items, []);
    assert.equal(result.notes.length, 2);
  });

  test("a helper added is free", () => {
    assert.deepEqual(changes({ [helper]: code }, { [helper]: `${code}export async function more() { return 3; }\n` }).items, []);
  });
});

describe("node tests", () => {
  const file = "test/sum.test.mjs";
  const body = `import assert from "node:assert/strict";
import { describe, test } from "node:test";
test("adds", () => {
  assert.equal(1 + 1, 2);
  assert.ok(Math.abs(0.1 + 0.2 - 0.3) < 0.001);
});
describe("zero", () => {
  test("is the identity", () => {
    assert.equal(0 + 7, 7);
  });
});
`;
  const weakened = (after) => named(changes({ [file]: body }, { [file]: after }));

  test("an assert.equal turned into assert.ok, an assertion removed, a tolerance widened", () => {
    assert.deepEqual(weakened(swap(body, "assert.equal(1 + 1, 2);", "assert.ok(1 + 1);")), [`weakened-test: ${file} > adds`]);
    assert.deepEqual(weakened(swap(body, "  assert.equal(1 + 1, 2);\n", "")), [`weakened-test: ${file} > adds`]);
    assert.deepEqual(weakened(swap(body, "< 0.001", "< 1")), [`weakened-test: ${file} > adds`]);
  });

  test("a skip or a todo", () => {
    assert.deepEqual(weakened(swap(body, 'test("adds", () => {', 'test.skip("adds", () => {')), [`weakened-test: ${file} > adds`]);
    assert.deepEqual(weakened(swap(body, 'test("adds", () => {', 'test("adds", { todo: true }, () => {')), [`weakened-test: ${file} > adds`]);
  });

  test("a test in a describe is named by it", () => {
    assert.deepEqual(weakened(swap(body, "assert.equal(0 + 7, 7)", "assert.ok(true)")), [`weakened-test: ${file} > zero > is the identity`]);
  });

  test("a test added, and an assertion added, are free", () => {
    assert.deepEqual(weakened(`${swap(body, "assert.equal(1 + 1, 2);", "assert.equal(1 + 1, 2);\n  assert.equal(2 + 2, 4);")}test("new", () => {\n  assert.ok(true);\n});\n`), []);
  });
});

describe("gleam tests", () => {
  const file = "test/sum_test.gleam";
  const body = `import gleam/bool
import gleeunit/should

fn helper(x: Int) -> Int {
  x + 1
}

pub fn adds_test() {
  assert helper(1) == 2
  assert helper(2) == 3
}

pub fn subtracts_test() {
  helper(3) |> should.equal(4)
}
`;
  const weakened = (after) => named(changes({ [file]: body }, { [file]: after }));

  test("an assertion changed or removed", () => {
    assert.deepEqual(weakened(swap(body, "assert helper(1) == 2", "assert helper(1) > 0")), [`weakened-test: ${file}::adds_test`]);
    assert.deepEqual(weakened(swap(body, "  assert helper(2) == 3\n", "")), [`weakened-test: ${file}::adds_test`]);
    assert.deepEqual(weakened(swap(body, "helper(3) |> should.equal(4)", "helper(3) |> should.be_ok")), [`weakened-test: ${file}::subtracts_test`]);
  });

  test("a test removed", () => {
    assert.deepEqual(weakened(swap(body, "pub fn subtracts_test() {\n  helper(3) |> should.equal(4)\n}\n", "")), [`removed-test: ${file}::subtracts_test`]);
  });

  test("a return before the assertions is an early exit", () => {
    assert.deepEqual(weakened(swap(body, "pub fn adds_test() {\n", "pub fn adds_test() {\n  use <- bool.guard(True, Nil)\n")), [`weakened-test: ${file}::adds_test`]);
  });

  test("a helper that asserts, made to assert less, and one that does not", () => {
    const asserting = swap(body, "  x + 1\n", "  assert x > 0\n  x + 1\n");
    const result = changes({ [file]: asserting }, { [file]: swap(asserting, "  assert x > 0\n", "") });
    assert.deepEqual(named(result), [`weakened-helper: ${file}::fn:helper`]);
    const plain = swap(body, "pub fn subtracts_test", "fn unread(x: Int) -> Int {\n  x + 1\n}\n\npub fn subtracts_test");
    assert.deepEqual(changes({ [file]: plain }, { [file]: swap(plain, "  x + 1\n}\n\npub fn subtracts_test", "  x + 2\n}\n\npub fn subtracts_test") }).items, []);
  });

  test("a test added, and an assertion added, are free", () => {
    assert.deepEqual(weakened(`${swap(body, "assert helper(2) == 3", "assert helper(2) == 3\n  assert helper(3) == 4")}\npub fn new_test() {\n  assert 1 == 1\n}\n`), []);
  });

  test("a private function named like a test is no test, so it is not judged as one", () => {
    const hidden = swap(body, "pub fn subtracts_test", "fn subtracts_test");
    assert.deepEqual(weakened(hidden), [`removed-test: ${file}::subtracts_test`]);
  });
});

describe("what is not a change", () => {
  const file = "test/place_test.gleam";
  const body = `import gleeunit/should

fn place(row row: Int, col col: Int) -> Int {
  row + col
}

pub fn first_test() {
  assert place(row: 1, col: 2) == 3
}

pub fn second_test() {
  assert place(row: 2, col: 2) == 4
  place(col: 3, row: 3) |> should.equal(6)
}
`;
  const free = (after) => named(changes({ [file]: body }, { [file]: after }));

  test("a test inserted above a gleam test that passes labelled arguments does not change it", () => {
    assert.deepEqual(free(swap(body, "pub fn second_test", "pub fn between_test() {\n  assert 1 == 1\n}\n\npub fn second_test")), []);
  });

  test("a comment or blank lines above a gleam test that passes labelled arguments do not change it", () => {
    assert.deepEqual(free(`// a comment\n\n\n${body}`), []);
    assert.deepEqual(free(swap(body, "pub fn second_test", "// about the second\n\n\npub fn second_test")), []);
  });

  test("a changed value, and a changed label, in a labelled argument are still caught", () => {
    assert.deepEqual(free(swap(body, "place(row: 2, col: 2)", "place(row: 2, col: 3)")), [`weakened-test: ${file}::second_test`]);
    assert.deepEqual(free(swap(body, "place(col: 3, row: 3)", "place(col: 3, row: 4)")), [`weakened-test: ${file}::second_test`]);
    assert.deepEqual(free(swap(body, "place(row: 1, col: 2)", "place(row: 1, cols: 2)")), [`weakened-test: ${file}::first_test`]);
  });

  test("a comment and a test inserted above every real gleam test file change none of them", () => {
    const dir = join(root, "test");
    const files = readdirSync(dir).filter((name) => name.endsWith(".gleam"));
    assert.ok(files.length > 5);
    for (const name of files) {
      const text = readFileSync(join(dir, name), "utf8");
      const path = `test/${name}`;
      const first = text.search(/^pub fn /m);
      const inserted = first < 0 ? text : `${text.slice(0, first)}pub fn inserted_above_test() {\n  assert 1 == 1\n}\n\n${text.slice(first)}`;
      assert.deepEqual(named(changes({ [path]: text }, { [path]: `// a comment\n\n${inserted}` })), [], path);
    }
  });

  test("a comment and blank lines above the code of every real javascript and typescript judge change none of them", () => {
    const found = [];
    for (const dir of ["test", "e2e/tests", "tools/mutants", "e2e"]) {
      for (const name of readdirSync(join(root, dir))) if (/\.[cm]?[jt]s$/.test(name) && !name.endsWith(".d.ts")) found.push(`${dir}/${name}`);
    }
    assert.ok(found.length > 20);
    const files = Object.fromEntries(found.map((path) => [path, readFileSync(join(root, path), "utf8")]));
    const shifted = Object.fromEntries(found.map((path) => [path, `// a comment\n\n\n${files[path]}`]));
    assert.deepEqual(named(changes(files, shifted)), []);
  });
});

describe("a renamed local variable is not a change", () => {
  const rename = (text, from, to) => text.replace(new RegExp(`\\b${from}\\b`, "g"), to);

  describe("in gleam", () => {
    const file = "test/names_test.gleam";
    const body = `import gleam/list
import gleeunit/should

fn helper(x: Int) -> Int {
  x + 1
}

pub fn locals_test() {
  let sum = helper(1)
  assert sum == 2
  let #(left, right) = #(helper(2), helper(3))
  assert left == 3
  assert right == 4
  let doubled = list.map([sum, left], fn(n) { n * 2 })
  assert doubled == [4, 6]
  case helper(4) {
    5 -> should.equal(sum, 2)
    other -> should.equal(other, 0)
  }
}
`;
    const after = (text) => named(changes({ [file]: body }, { [file]: text }));

    test("a let, a destructured pair, a closure parameter and a case variable renamed change nothing", () => {
      let renamed = body;
      for (const [from, to] of [["sum", "total"], ["left", "l"], ["right", "r"], ["doubled", "twice"], ["n", "m"], ["other", "rest"]]) renamed = rename(renamed, from, to);
      assert.notEqual(renamed, body);
      assert.deepEqual(after(renamed), []);
    });

    test("a new local put between the old ones, or above them, changes nothing", () => {
      assert.deepEqual(after(swap(body, "  assert sum == 2\n", "  let unrelated = helper(9)\n  assert sum == 2\n")), []);
      assert.deepEqual(after(swap(body, "  let sum = helper(1)\n", "  let first = helper(7)\n  let second = first\n  let sum = helper(1)\n")), []);
    });

    test("an assertion that reads another local, or the other half of a pair, is a change", () => {
      assert.deepEqual(after(swap(body, "assert left == 3", "assert right == 3")), [`weakened-test: ${file}::locals_test`]);
      assert.deepEqual(after(swap(body, "assert doubled == [4, 6]", "assert sum == [4, 6]")), [`weakened-test: ${file}::locals_test`]);
      assert.deepEqual(after(swap(body, "fn(n) { n * 2 }", "fn(n) { sum * 2 }")), [`weakened-test: ${file}::locals_test`]);
      assert.deepEqual(after(swap(body, "should.equal(other, 0)", "should.equal(sum, 0)")), [`weakened-test: ${file}::locals_test`]);
    });

    test("two locals defined alike are still two", () => {
      const twins = swap(body, "  assert sum == 2\n", "  let a = helper(5)\n  let b = helper(5)\n  assert a == b\n  assert sum == 2\n");
      assert.deepEqual(named(changes({ [file]: twins }, { [file]: rename(rename(twins, "a", "x"), "b", "y") })), []);
      assert.deepEqual(named(changes({ [file]: twins }, { [file]: swap(twins, "assert a == b", "assert a == a") })), [`weakened-test: ${file}::locals_test`]);
    });

    test("a local that takes the name of a function the test calls is not that function", () => {
      assert.deepEqual(after(swap(body, "  let sum = helper(1)\n", "  let helper = fn(x) { x }\n  let sum = helper(1)\n")), [`weakened-test: ${file}::locals_test`]);
    });
  });

  describe("in typescript", () => {
    const code = e2e(`test('locals', async ({ app, page }) => {
  const sum = add(1, 2);
  const { first, rest: [second] } = await app.read();
  expect(sum).toBe(3);
  expect(first).toBe(second);
  const rows = [1, 2].map((row) => row + sum);
  expect(rows).toEqual([4, 5]);
  try { await page.go(); } catch (error) { expect(error).toBeUndefined(); }
});`);
    const after = (text) => named(changes({ [spec]: code }, { [spec]: text }));

    test("a const, a destructured pair, a closure parameter, a catch variable and a renamed fixture change nothing", () => {
      let renamed = swap(code, "({ app, page })", "({ app: shell, page: tab })");
      renamed = swap(renamed, "{ first, rest: [second] }", "{ first: one, rest: [two] }");
      renamed = swap(renamed, "expect(first).toBe(second)", "expect(one).toBe(two)");
      renamed = rename(rename(renamed, "app\\.read", "shell.read"), "page\\.go", "tab.go");
      for (const [from, to] of [["sum", "total"], ["row", "item"], ["error", "failure"], ["rows", "lines"]]) renamed = rename(renamed, from, to);
      assert.notEqual(renamed, code);
      assert.deepEqual(after(renamed), []);
    });

    test("a new local put between the old ones changes nothing", () => {
      assert.deepEqual(after(swap(code, "  expect(sum).toBe(3);\n", "  const unrelated = 5;\n  expect(sum).toBe(3);\n")), []);
      assert.deepEqual(after(swap(code, "  const sum = add(1, 2);\n", "  const extra = add(7, 7);\n  const sum = add(1, 2);\n")), []);
    });

    test("an assertion that reads another local, a property of another name, or another fixture is a change", () => {
      assert.deepEqual(after(swap(code, "expect(first).toBe(second)", "expect(second).toBe(first)")), [`weakened-test: ${spec} > locals`]);
      assert.deepEqual(after(swap(code, "(row) => row + sum", "(row) => row + 1")), [`weakened-test: ${spec} > locals`]);
      assert.deepEqual(after(swap(code, "await app.read()", "await app.write()")), [`weakened-test: ${spec} > locals`]);
      assert.deepEqual(after(swap(code, "await page.go()", "await app.go()")), [`weakened-test: ${spec} > locals`]);
    });

    test("two consts defined alike are still two", () => {
      const twins = swap(code, "  expect(sum).toBe(3);\n", "  const a = add(5, 5);\n  const b = add(5, 5);\n  expect(a).toBe(b);\n  expect(sum).toBe(3);\n");
      assert.deepEqual(named(changes({ [spec]: twins }, { [spec]: rename(rename(twins, "a", "x"), "b", "y") })), []);
      assert.deepEqual(named(changes({ [spec]: twins }, { [spec]: swap(twins, "expect(a).toBe(b)", "expect(a).toBe(a)") })), [`weakened-test: ${spec} > locals`]);
    });

    test("a renamed key of an object that carries a local is a change, because it names a property", () => {
      const keyed = swap(code, "  expect(sum).toBe(3);\n", "  expect({ sum }).toEqual({ sum: 3 });\n");
      assert.deepEqual(named(changes({ [spec]: keyed }, { [spec]: rename(keyed, "sum", "total") })), [`weakened-test: ${spec} > locals`]);
    });
  });
});

describe("what a test reads is judged with it", () => {
  const helper = "e2e/tests/helpers.ts";
  const helpers = `export const widths = [390, 1280];
export const long = 'long '.repeat(80);
const unread = 1;
export function rows(part: string) {
  return part.split('\\n');
}
export function shown(part: string) {
  return rows(part).length + widths.length;
}
export class Editing {
  async saved() {
    return this.shown();
  }
  async shown() {
    return rows('a').length;
  }
  async unused() {
    return 7;
  }
}
export const table = [{ id: 'a', holds: () => 1 }, { id: 'b', holds: () => 2 }];
`;
  const code = e2e(`import { long, shown, table, widths } from './helpers.ts';
import * as h from './helpers.ts';
const own = 'owned';
const apart = 5;
test('reads', async ({ app }) => {
  expect(shown(long)).toBe(3);
  expect(own).toBe('owned');
  expect(await app.editing.saved()).toBe(1);
  for (const width of widths) expect(width).toBeGreaterThan(0);
  expect(table.length).toBe(2);
  expect(h.rows('x\\ny')).toEqual(['x', 'y']);
});`);
  const files = { [spec]: code, [helper]: helpers };
  const flagged = (changed) => named(changes(files, { ...files, ...changed })).sort();
  const edited = (from, to, path = helper) => ({ [path]: swap(files[path], from, to) });

  test("a const, a table or a reader that a test reads, changed in the same file or in a helper, is a change", () => {
    assert.deepEqual(flagged(edited("'long '.repeat(80)", "'long '.repeat(2)")), [`changed-input: ${helper}::var:long`]);
    assert.deepEqual(flagged(edited("[390, 1280]", "[1280]")), [`changed-input: ${helper}::var:widths`]);
    assert.deepEqual(flagged(edited("rows(part).length + widths.length", "rows(part).length")), [`changed-input: ${helper}::fn:shown`]);
  });

  test("a reader that a reader calls is read too, and a method a test calls is a change", () => {
    assert.deepEqual(flagged(edited("part.split('\\n')", "part.split(',')")), [`changed-input: ${helper}::fn:rows`]);
    assert.deepEqual(flagged(edited("return rows('a').length;", "return 0;")), [`changed-input: ${helper}::class:Editing.shown`]);
    assert.deepEqual(flagged(edited("return this.shown();", "return 1;")), [`changed-input: ${helper}::class:Editing.saved`]);
  });

  test("a const in the test file that the test reads is a change, and one it does not read is not", () => {
    assert.deepEqual(flagged({ [spec]: swap(code, "const own = 'owned';", "const own = 'changed';") }), [`changed-input: ${spec}::var:own`]);
    const result = changes(files, { ...files, [spec]: swap(code, "const apart = 5;", "const apart = 6;") });
    assert.deepEqual(named(result), []);
    assert.equal(result.notes.length, 1);
  });

  test("what no test reads may change, and what is new is free", () => {
    assert.deepEqual(flagged(edited("const unread = 1;", "const unread = 2;")), []);
    assert.deepEqual(flagged(edited("async unused() {\n    return 7;", "async unused() {\n    return 8;")), []);
    assert.deepEqual(flagged({ [helper]: `${helpers}export const more = 3;\nexport function extra() {\n  return 1;\n}\n` }), []);
  });

  test("a rename of a local, a reformat or a comment inside what a test reads is not a change", () => {
    assert.deepEqual(flagged(edited("export function rows(part: string) {\n  return part.split('\\n');\n}", "// split\nexport function rows(text: string) {\n    return text.split('\\n');\n}")), []);
  });

  test("a row added to a table is free, and a row removed or changed is a change", () => {
    assert.deepEqual(flagged(edited("{ id: 'b', holds: () => 2 }];", "{ id: 'b', holds: () => 2 }, { id: 'c', holds: () => 3 }];")), []);
    assert.deepEqual(flagged(edited("{ id: 'a', holds: () => 1 }, ", "")), [`changed-input: ${helper}::var:table`]);
    assert.deepEqual(flagged(edited("holds: () => 2", "holds: () => null")), [`changed-input: ${helper}::var:table`]);
  });

  test("a helper file gone, or an import of a test pointed at another file, is a change", () => {
    assert.deepEqual(named(changes(files, { [spec]: code })), [`removed-file: ${helper}`]);
    assert.deepEqual(flagged({ [spec]: swap(code, "from './helpers.ts';\nimport * as h", "from './other.ts';\nimport * as h") }), ["long", "shown", "table", "widths"].map((name) => `changed-input: ${spec}::import:${name}`));
  });

  test("a data file next to the tests that changes is a change", () => {
    const data = "e2e/tests/note.json";
    assert.deepEqual(named(changes({ [data]: '{"a": 1}' }, { [data]: '{"a":1}' })), []);
    assert.deepEqual(named(changes({ [data]: '{"a": 1}' }, { [data]: '{"a":2}' })), [`changed-gate: ${data}`]);
  });

  describe("in gleam", () => {
    const module = "test/helpers.gleam";
    const gleamHelpers = `pub const gap = 150

pub fn read(row: Int) -> Int {
  row + gap
}

pub fn unused() -> Int {
  1
}
`;
    const test_ = "test/gap_test.gleam";
    const gleamTest = `import helpers.{read as read_it}
import gleeunit/should

const corpus = [1, 2, 3]

const apart = 9

fn total(rows: List(Int)) -> Int {
  case rows {
    [] -> 0
    [first, ..rest] -> first + total(rest)
  }
}

pub fn reads_test() {
  assert total(corpus) == 6
  assert helpers.read(1) == 151
  assert read_it(2) == 152
  helpers.gap |> should.equal(150)
}
`;
    const gleamFiles = { [test_]: gleamTest, [module]: gleamHelpers };
    const gleamFlagged = (changed) => named(changes(gleamFiles, { ...gleamFiles, ...changed })).sort();

    test("a const, a table and a helper that a test reads are a change", () => {
      assert.deepEqual(gleamFlagged({ [test_]: swap(gleamTest, "const corpus = [1, 2, 3]", "const corpus = []") }), [`changed-input: ${test_}::const:corpus`]);
      assert.deepEqual(gleamFlagged({ [test_]: swap(gleamTest, "[] -> 0", "[] -> 1") }), [`changed-input: ${test_}::fn:total`]);
      assert.deepEqual(gleamFlagged({ [test_]: swap(gleamTest, "const apart = 9", "const apart = 9\n\nconst unread = helpers.gap") }), []);
    });

    test("a row added to a table is free, a row removed is a change, what no test reads is free, and a module of the tests that is no test is as strict as a script", () => {
      assert.deepEqual(gleamFlagged({ [test_]: swap(gleamTest, "[1, 2, 3]", "[1, 2, 3, 4]") }), []);
      assert.deepEqual(gleamFlagged({ [test_]: swap(gleamTest, "[1, 2, 3]", "[1, 3]") }), [`changed-input: ${test_}::const:corpus`]);
      assert.deepEqual(gleamFlagged({ [test_]: swap(gleamTest, "const apart = 9", "const apart = 10") }), []);
      assert.deepEqual(gleamFlagged({ [module]: swap(gleamHelpers, "pub const gap = 150", "pub const gap = 999") }), [`changed-gate: ${module}::const:gap`]);
    });

    test("an import that a test uses, pointed at another module, is a change, and an added unqualified import is not", () => {
      assert.deepEqual(gleamFlagged({ [test_]: swap(gleamTest, "import gleeunit/should", "import other/should") }), [`changed-input: ${test_}::import:should`]);
      assert.deepEqual(gleamFlagged({ [test_]: swap(gleamTest, "import helpers.{read as read_it}", "import helpers.{read as read_it, unused}") }), []);
    });
  });
});

describe("the files that decide", () => {
  const script = "test/steps.mjs";
  const code = "export const a = 1;\nexport function gate() {\n  return 2;\n}\n";

  test("a function changed or removed is a change, and a function added is not", () => {
    assert.deepEqual(named(changes({ [script]: code }, { [script]: swap(code, "return 2;", "return 3;") })), [`changed-gate: ${script}::fn:gate`]);
    assert.deepEqual(named(changes({ [script]: code }, { [script]: "export const a = 1;\n" })), [`changed-gate: ${script}::fn:gate`]);
    assert.deepEqual(changes({ [script]: code }, { [script]: `${code}export function more() {}\n` }).items, []);
  });

  test("comments and formatting are not changes", () => {
    assert.deepEqual(changes({ [script]: code }, { [script]: "// why\nexport const a = 1;\nexport function gate() { return 2 }\n" }).items, []);
  });

  test("a hook, a workflow and a data file are compared as text", () => {
    const hook = ".githooks/pre-push";
    assert.deepEqual(named(changes({ [hook]: "a\nb\n" }, { [hook]: "a\nb\n" })), []);
    assert.deepEqual(named(changes({ [hook]: "a\nb\n" }, { [hook]: "a\n" })), [`changed-gate: ${hook}`]);
    assert.deepEqual(named(changes({ [hook]: "a\n" }, {})), [`removed-file: ${hook}`]);
    assert.deepEqual(named(changes({ "test/data.json": '{"a": 1}' }, { "test/data.json": '{"a":1}' })), []);
    assert.deepEqual(named(changes({ "test/data.json": '{"a": 1}' }, { "test/data.json": '{"a":2}' })), ["changed-gate: test/data.json"]);
  });

  test("the counts file, the pick map, the e2e dependencies and its output and the readmes are not judges, and the rest of test, tools and e2e are", () => {
    for (const path of ["test/test_counts.json", "test/pick_map.json", "e2e/package.json", "e2e/package-lock.json", "e2e/node_modules/x/index.js", "e2e/.e2e/out/report.json", "tools/mutants/README.md", "test/commonmark/README.md"]) assert.ok(!judged(path), path);
    for (const path of ["test/steps.mjs", "tools/mutants/mutants.mjs", "e2e/serve.mjs", "e2e/e2e.config.ts", "e2e/tests/undo.e2e.ts", ".githooks/pre-push", ".github/workflows/test.yml"]) assert.ok(judged(path), path);
  });
});

describe("a Changes-test trailer", () => {
  const item = { file: "test/a_test.gleam", id: "test/a_test.gleam::x_test" };
  const trailer = (subject, reason = "because") => ({ commit: "abc1234", subject, reason, text: `${subject} — ${reason}` });

  test("covers the test it names, the file it is in, or the group it is under", () => {
    assert.ok(covers(trailer("test/a_test.gleam::x_test"), item));
    assert.ok(covers(trailer("test/a_test.gleam"), item));
    assert.ok(covers(trailer("e2e/tests/a.e2e.ts > group"), { file: "e2e/tests/a.e2e.ts", id: "e2e/tests/a.e2e.ts > group > title" }));
    assert.ok(covers(trailer("test/a.test.mjs > group > leaf"), { file: "test/a.test.mjs", id: "test/a.test.mjs > leaf", leaf: "leaf" }));
    assert.ok(covers(trailer("test/a.test.mjs > group > leaf"), { file: "test/a.test.mjs", id: "test/a.test.mjs > group", leaf: "group" }));
  });

  test("covers nothing it does not name", () => {
    assert.ok(!covers(trailer("test/a_test.gleam::y_test"), item));
    assert.ok(!covers(trailer("test/b_test.gleam"), item));
    assert.ok(!covers(trailer("test/a_test.gleam::x"), item));
    assert.ok(!covers(trailer("e2e/tests/a.e2e.ts > gro"), { file: "e2e/tests/a.e2e.ts", id: "e2e/tests/a.e2e.ts > group > title" }));
  });

  test("with no reason covers nothing, and one that names nothing is listed as unused", () => {
    const result = sort([item], [trailer(item.id, "")]);
    assert.equal(result.failing.length, 1);
    assert.equal(result.noReason.length, 1);
    const unused = sort([item], [trailer(item.id), trailer("test/z.gleam")]);
    assert.equal(unused.failing.length, 0);
    assert.deepEqual(unused.unused.map((one) => one.subject), ["test/z.gleam"]);
  });
});

const fakeGleam = "#!/bin/sh\nexit 0\n";

const toyFiles = {
  ".gitignore": "build\ne2e/node_modules\n",
  "src/toy.mjs": "export const add = (a, b) => a + b;\n",
  "test/toy.test.mjs": `import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { add } from "../src/toy.mjs";
test("adds small numbers", () => {
  const sum = add(1, 2);
  assert.equal(sum, 3);
  assert.ok(Math.abs(add(0.1, 0.2) - 0.3) < 0.001);
});
test("adds negatives", () => {
  assert.equal(add(-1, -1), -2);
});
describe("zero", () => {
  test("is the identity", () => {
    assert.equal(add(0, 7), 7);
  });
});
`,
  "test/toy_test.gleam": "pub fn adds_test() {\n  assert 1 + 1 == 2\n}\n\npub fn subtracts_test() {\n  assert 3 - 1 == 2\n}\n",
  "test/test_counts.json": '{\n  "toy": 3\n}\n',
  "test/steps.mjs": 'import { nodeTest } from "./steps_real.mjs";\nexport * from "./steps_real.mjs";\nexport const gateSteps = () => [nodeTest("toy", "test/toy.test.mjs")];\n',
};

const copied = ["test/judges.mjs", "test/inventory.mjs", "test/fingerprint.mjs", "test/pick.mjs", "test/e2e_discovery.mjs", "test/test_counts.mjs", ".githooks/pre-push"];

const clean = () => Object.fromEntries(Object.entries(process.env).filter(([name]) => !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "NODE_TEST_CONTEXT"].includes(name)));
const sh = (cwd, args, env = {}) => spawnSync(args[0], args.slice(1), { cwd, env: { ...clean(), ...env }, encoding: "utf8" });
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: clean(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const put = (dir, path, text) => {
  mkdirSync(join(dir, path, ".."), { recursive: true });
  writeFileSync(join(dir, path), text);
};

function toy({ withJudges = true } = {}) {
  const home = scratch.make("judges-toy-");
  const bin = join(home, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gleam"), fakeGleam);
  chmodSync(join(bin, "gleam"), 0o755);
  const origin = join(home, "origin.git");
  git(home, "init", "--bare", "-b", "main", origin);
  const first = join(home, "first");
  mkdirSync(first);
  git(first, "init", "-b", "main");
  for (const [path, text] of Object.entries(toyFiles)) put(first, path, text);
  copyFileSync(join(root, "test", "steps.mjs"), join(first, "test", "steps_real.mjs"));
  for (const path of copied) if (withJudges || !/judges|inventory|fingerprint|pick/.test(path)) {
    mkdirSync(join(first, path, ".."), { recursive: true });
    copyFileSync(join(root, path), join(first, path));
  }
  git(first, "-c", "user.name=t", "-c", "user.email=t@t", "add", "-A");
  git(first, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "main");
  git(first, "remote", "add", "origin", origin);
  git(first, "push", "-q", "origin", "main");
  let cases = 0;
  const branch = () => {
    const dir = join(home, `case-${++cases}`);
    git(home, "clone", "-q", origin, dir);
    git(dir, "config", "user.name", "t");
    git(dir, "config", "user.email", "t@t");
    git(dir, "checkout", "-q", "-b", "feature");
    mkdirSync(join(dir, "e2e"), { recursive: true });
    symlinkSync(join(root, "build"), join(dir, "build"));
    symlinkSync(join(root, "e2e", "node_modules"), join(dir, "e2e", "node_modules"));
    return {
      dir,
      read: (path) => readFileSync(join(dir, path), "utf8"),
      write: (path, text) => put(dir, path, text),
      edit(path, from, to) {
        put(dir, path, swap(readFileSync(join(dir, path), "utf8"), from, to));
      },
      commit(message) {
        git(dir, "add", "-A");
        git(dir, "commit", "-q", "-m", message);
      },
      push: () => {
        const run = sh(dir, ["sh", ".githooks/pre-push"], { PATH: `${bin}:${process.env.PATH}` });
        return { status: run.status, out: `${run.stdout}${run.stderr}` };
      },
    };
  };
  return { branch };
}

describe("the pre-push gate on a branch", () => {
  const base = toy();
  const caught = (run, ...needles) => {
    assert.equal(run.status, 1, run.out);
    for (const needle of needles) assert.match(run.out, needle, run.out);
  };
  const toyTest = "test/toy.test.mjs";

  test("a clean branch passes, with a new test and a change to src", () => {
    const branch = base.branch();
    branch.write("src/toy.mjs", "export const add = (a, b) => a + b;\nexport const twice = (a) => a * 2;\n");
    branch.edit(toyTest, 'describe("zero", () => {', 'test("twice", () => {\n  assert.equal(twice(2), 4);\n});\ndescribe("zero", () => {');
    branch.edit(toyTest, 'import { add } from', 'import { add, twice } from');
    branch.write("test/test_counts.json", '{\n  "toy": 4\n}\n');
    branch.commit("add twice");
    const run = branch.push();
    assert.equal(run.status, 0, run.out);
    assert.match(run.out, /every test and script of main's is still here/);
    assert.match(run.out, /main's copy/);
    assert.match(run.out, /only the 1 test file of main's that differ \(test\/toy\.test\.mjs\)/);
    assert.match(run.out, /toy: 3 tests pass on this branch's code/);
  });

  test("deleting a test of main's fails and names it", () => {
    const branch = base.branch();
    branch.edit(toyTest, 'test("adds negatives", () => {\n  assert.equal(add(-1, -1), -2);\n});\n', "");
    branch.write("test/test_counts.json", '{\n  "toy": 2\n}\n');
    branch.commit("drop a test");
    caught(branch.push(), /FAIL 1 judge/, new RegExp(`${toyTest} > adds negatives`), /no test of this name is left/, /Changes-test: test\/toy\.test\.mjs > adds negatives — /);
  });

  test("deleting a gleam test of main's fails and names it", () => {
    const branch = base.branch();
    branch.edit("test/toy_test.gleam", "\npub fn subtracts_test() {\n  assert 3 - 1 == 2\n}\n", "");
    branch.commit("drop a gleam test");
    caught(branch.push(), /test\/toy_test\.gleam::subtracts_test/);
  });

  for (const [name, from, to, expected] of [
    ["a toBe turned into a truthy check", "assert.equal(sum, 3);", "assert.ok(sum);", "adds small numbers"],
    ["an assertion removed", "  assert.equal(add(-1, -1), -2);\n", "", "adds negatives"],
    ["a tolerance widened", "< 0.001", "< 5", "adds small numbers"],
    ["an expected value changed to what the code gives", "assert.equal(add(0, 7), 7);", "assert.equal(add(0, 7), 7 + 0);", "zero > is the identity"],
  ]) {
    test(`loosening: ${name} fails and names the test`, () => {
      const branch = base.branch();
      branch.edit(toyTest, from, to);
      branch.commit("loosen");
      caught(branch.push(), new RegExp(expected), /made check less/);
    });
  }

  test("a loosened gleam assertion fails", () => {
    const branch = base.branch();
    branch.edit("test/toy_test.gleam", "assert 1 + 1 == 2", "assert 1 + 1 > 0");
    branch.commit("loosen gleam");
    caught(branch.push(), /test\/toy_test\.gleam::adds_test/);
  });

  test("with a Changes-test trailer naming the test and giving a reason, the change passes and the trailer is printed", () => {
    const branch = base.branch();
    branch.edit(toyTest, "assert.equal(add(0, 7), 7);", "assert.equal(add(0, 7), 7 + 0);");
    branch.commit("zero is now one more\n\nChanges-test: test/toy.test.mjs > zero > is the identity — the identity is one more now");
    const run = branch.push();
    assert.equal(run.status, 0, run.out);
    assert.match(run.out, /Changes-test trailers on this branch\. Put them in the PR description/);
    assert.match(run.out, /Changes-test: test\/toy\.test\.mjs > zero > is the identity — the identity is one more now/);
  });

  test("a trailer for the file covers every test in it, and one for another test covers nothing here", () => {
    const branch = base.branch();
    branch.edit(toyTest, "assert.equal(add(0, 7), 7);", "assert.equal(add(0, 7), 7 + 0);");
    branch.commit("other\n\nChanges-test: test/toy.test.mjs > adds negatives — not this one");
    caught(branch.push(), /zero > is the identity/, /names nothing this branch changed/);
    const file = base.branch();
    file.edit(toyTest, "assert.equal(add(0, 7), 7);", "assert.equal(add(0, 7), 7 + 0);");
    file.commit("file\n\nChanges-test: test/toy.test.mjs — the file moved on");
    assert.equal(file.push().status, 0);
  });

  test("a trailer with no reason after the dash is refused", () => {
    const branch = base.branch();
    branch.edit(toyTest, "assert.equal(add(0, 7), 7);", "assert.equal(add(0, 7), 7 + 0);");
    branch.commit("no reason\n\nChanges-test: test/toy.test.mjs > zero > is the identity");
    caught(branch.push(), /has no reason after the dash/);
  });

  test("a branch that edits its own copy of the judge to let itself through is still judged by main's copy", () => {
    const branch = base.branch();
    branch.edit(toyTest, 'test("adds negatives", () => {\n  assert.equal(add(-1, -1), -2);\n});\n', "");
    branch.write("test/judges.mjs", "console.log('skipped');\nprocess.exit(0);\n");
    branch.write("test/inventory.mjs", "export const judged = () => false;\nexport const loadParsers = async () => ({});\nexport const inventoryOf = () => new Map();\nexport const compare = () => ({ items: [], notes: [] });\n");
    branch.write("test/pick.mjs", "export const runPicked = async () => ({ ok: true, ms: 0 });\n");
    branch.write("test/steps.mjs", "export * from './steps_real.mjs';\nexport const gateSteps = () => [];\n");
    branch.write("test/test_counts.json", '{\n  "toy": 2\n}\n');
    branch.commit("let me through");
    const run = branch.push();
    caught(run, new RegExp(`${toyTest} > adds negatives`));
    assert.doesNotMatch(run.out, /skipped/);
    assert.match(run.out, /main's copy/);
  });

  test("an edit of a gate script that deletes no test is itself a change, until a trailer names it", () => {
    const branch = base.branch();
    branch.edit("test/test_counts.mjs", "ran 0 tests", "ran zero tests");
    branch.commit("edit the gate");
    caught(branch.push(), /test\/test_counts\.mjs::fn:judge/, /a script or file that decides/);
    const named = base.branch();
    named.edit("test/test_counts.mjs", "ran 0 tests", "ran zero tests");
    named.commit("edit the gate\n\nChanges-test: test/test_counts.mjs — the count wording");
    const run = named.push();
    assert.equal(run.status, 0, run.out);
    assert.doesNotMatch(run.out, /only the \d+ test file/, "a changed gate script means main's tests all run");
    assert.match(run.out, /toy: 3 tests pass on this branch's code/);
  });

  test("main's test that fails on the branch's code fails the gate before the branch's own run, and a trailer for it passes", () => {
    const branch = base.branch();
    branch.write("src/toy.mjs", "export const add = (a, b) => a - b;\n");
    branch.edit(toyTest, 'describe("zero"', 'test("extra", () => {\n  assert.ok(true);\n});\ndescribe("zero"');
    branch.write("test/test_counts.json", '{\n  "toy": 4\n}\n');
    branch.commit("break add");
    const run = branch.push();
    caught(run, /main's tests fail on this branch's code/, /adds small numbers/, /fails on this branch's code/);
    const kept = base.branch();
    kept.write("src/toy.mjs", "export const add = (a, b) => a - b;\n");
    kept.edit(toyTest, "assert.equal(sum, 3);", "assert.equal(sum, -1);");
    kept.edit(toyTest, "assert.ok(Math.abs(add(0.1, 0.2) - 0.3) < 0.001);", "assert.ok(Math.abs(add(0.1, 0.2) + 0.1) < 0.001);");
    kept.edit(toyTest, "assert.equal(add(-1, -1), -2);", "assert.equal(add(-1, -1), 0);");
    kept.edit(toyTest, "assert.equal(add(0, 7), 7);", "assert.equal(add(0, 7), -7);");
    kept.commit("subtract\n\nChanges-test: test/toy.test.mjs — add is subtract now");
    const passed = kept.push();
    assert.equal(passed.status, 0, passed.out);
    assert.match(passed.out, /covered by a trailer/);
  });

  test("a branch that changes only src, so main's tests are its tests, runs the gate once", () => {
    const branch = base.branch();
    branch.write("src/toy.mjs", "export const add = (a, b) => a + b + 0;\n");
    branch.commit("src only");
    const run = branch.push();
    assert.equal(run.status, 0, run.out);
    assert.match(run.out, /every test and script of main's is the branch's own byte for byte/);
  });

  test("when main has no judge scripts yet, the branch's own are used and the run says so", () => {
    const bare = toy({ withJudges: false });
    const branch = bare.branch();
    for (const path of ["test/judges.mjs", "test/inventory.mjs", "test/fingerprint.mjs", "test/pick.mjs"]) branch.write(path, readFileSync(join(root, path), "utf8"));
    branch.commit("add the judges");
    const run = branch.push();
    assert.equal(run.status, 0, run.out);
    assert.match(run.out, /main has no test\/judges\.mjs yet/);
    assert.match(run.out, /nothing stops this branch from editing them/);
  });

  test("when main has no judge scripts yet, the branch is still judged against main's tests", () => {
    const bare = toy({ withJudges: false });
    const branch = bare.branch();
    for (const path of ["test/judges.mjs", "test/inventory.mjs", "test/fingerprint.mjs", "test/pick.mjs"]) branch.write(path, readFileSync(join(root, path), "utf8"));
    branch.edit(toyTest, 'test("adds negatives", () => {\n  assert.equal(add(-1, -1), -2);\n});\n', "");
    branch.commit("add the judges and drop a test");
    caught(branch.push(), /adds negatives/);
  });
});

describe("the failures printed", () => {
  const item = (n) => ({ id: `test/a.mjs > t${n}`, file: "test/a.mjs", what: "fails-on-branch", why: "fails on this branch's code" });

  test("a few are each given with the trailer line to paste", () => {
    const lines = describeFailures([item(1), item(2)]);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /Changes-test: test\/a\.mjs > t1/);
  });

  test("a deleted test is first, and the many parts of one rewritten gate script are one line, so neither is lost in the list", () => {
    const part = (n) => ({ id: `test/inventory.mjs::var:p${n}`, file: "test/inventory.mjs", what: "changed-gate", why: "changed" });
    const gone = { id: "test/toy.test.mjs > adds negatives", file: "test/toy.test.mjs", what: "removed-test", why: "gone" };
    const lines = describeFailures([...Array.from({ length: 118 }, (_, n) => part(n)), gone]);
    assert.equal(lines.length, 2);
    assert.match(lines[0], /toy\.test\.mjs > adds negatives/);
    assert.match(lines[1], /Changes-test: test\/inventory\.mjs —/);
    assert.match(lines[1], /118 parts of it changed/);
  });

  test("hundreds are cut to the first few and a line that says the run itself probably broke", () => {
    const lines = describeFailures(Array.from({ length: 416 }, (_, n) => item(n)));
    assert.equal(lines.length, 11);
    assert.match(lines[10], /and 406 more.*run itself broke/);
  });
});

describe("the arguments of a run", () => {
  test("hand the gate no flag unless one is given, so the commit check of the counts file stays on in the hook", () => {
    assert.deepEqual(parseArgs(["run"]).options.gateArgs, []);
    assert.deepEqual(parseArgs(["run", "--base", "abc", "--repo", "/x"]).options.gateArgs, []);
    assert.deepEqual(parseArgs(["run", "--no-commit-check"]).options.gateArgs, ["--no-commit-check"]);
    assert.match(parseArgs(["run", "--nope"]).error, /--nope/);
  });
});

describe("trailers", () => {
  test("are read from the commits of the branch, not from the commits it got from main", () => {
    const dir = scratch.make("judges-trailers-");
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.name", "t");
    git(dir, "config", "user.email", "t@t");
    writeFileSync(join(dir, "a"), "1");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "old\n\nChanges-test: test/old.mjs — from main");
    const base = git(dir, "rev-parse", "HEAD").trim();
    writeFileSync(join(dir, "a"), "2");
    git(dir, "commit", "-q", "-am", "new\n\nSigned-off-by: t\nChanges-test: test/a_test.gleam::x_test — a reason with — a dash in it\nChanges-test: test/b.mjs -- ascii dashes");
    const found = trailersOf(dir, base);
    assert.deepEqual(found.map((one) => [one.subject, one.reason]), [
      ["test/a_test.gleam::x_test", "a reason with — a dash in it"],
      ["test/b.mjs", "ascii dashes"],
    ]);
  });

  test("are read wherever they sit in the message, so a Co-Authored-By block under them does not hide them from git", () => {
    const dir = scratch.make("judges-trailers-loose-");
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.name", "t");
    git(dir, "config", "user.email", "t@t");
    writeFileSync(join(dir, "a"), "1");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "first");
    const base = git(dir, "rev-parse", "HEAD").trim();
    writeFileSync(join(dir, "a"), "2");
    git(dir, "commit", "-q", "-am", "second\n\nWhat it does, in prose.\n\nChanges-test: test/a.mjs — a reason\n\nCo-Authored-By: t <t@t>\nClaude-Session: https://example.test/x");
    assert.deepEqual(trailersOf(dir, base).map((one) => [one.subject, one.reason]), [["test/a.mjs", "a reason"]]);
  });
});
