// Break cases for the check that every file under e2e/ that looks like a test
// is one a config discovers (`test/e2e_discovery.mjs`). Each runs the check on
// a copy of the e2e folder with the real runner's `e2e list` to say what is
// discovered, so that a file the runner never loads cannot sit there looking
// like a test.
//
//   node --test test/e2e_discovery.test.mjs

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { useScratch } from "./scratch.mjs";
import { root } from "./steps.mjs";

const scratch = useScratch();

const real = join(root, "e2e");

const body = `async () => {
  expect(1).toBe(1);
}`;
const registers = (importLine, call) => `${importLine}\nimport { expect } from 'e2e';\n${call}\n`;

const okTest = registers("import { test } from '@e2e-dev/web';", `test('fine', ${body});`);

// Files that are not tests, and so are never named, whatever they import.
const notTests = {
  "tests/ok.e2e.ts": okTest,
  "tests/helper.ts": "import { test as base } from '@e2e-dev/web';\nexport const test = base.extend({});\n",
  "tests/reexport.ts": "export * from './helper.ts';\n",
  "tests/uses-helper.e2e.ts": registers("import { test } from './helper.ts';", `test('through the helper', ${body});`),
  "tests/only-types.ts": "import type { Page } from 'e2e';\nimport { expect } from 'e2e';\nexport const same = (page: Page) => expect(page).toBeDefined();\n",
  "tests/in-a-comment.ts": "import { expect } from 'e2e';\n// test('not a test', async () => {});\nexport const text = \"test('not a test either', async () => {})\";\nexport const same = expect;\n",
  "tests/declarations.d.ts": "export declare const test: number;\n",
  "serve.mjs": "export const x = 1;\n",
  "node_modules/dep/x.e2e.ts": okTest,
  ".e2e/out/y.e2e.ts": okTest,
};

// Files that look like tests, by name or by what they do, and that the config does not discover.
const strays = {
  "other/x.e2e.ts": okTest,
  "tests/x.test.ts": okTest,
  "tests/y.spec.ts": okTest,
  "tests/z.e2e.mts": okTest,
  "tests/w.e2e.js": "import { test } from '@e2e-dev/web';\ntest('x', async () => {});\n",
  "tests/v.e2e.mjs": "import { test } from '@e2e-dev/web';\ntest('x', async () => {});\n",
  "tests/u.e2e.test.ts": okTest,
  "tests/t.e2e-spec.ts": okTest,
  "scripts/through-helper.ts": registers("import { test } from '../tests/helper.ts';", `test('x', ${body});`),
  "scripts/through-reexport.ts": registers("import { test } from '../tests/reexport.ts';", `test('x', ${body});`),
  "scripts/direct.mjs": "import { test as t } from '@e2e-dev/web';\nt.fail('x', async () => {});\n",
  "scripts/namespace.ts": "import * as e2e from 'e2e';\ne2e.test('x', async () => {});\n",
  "scripts/dynamic.ts": "const { test } = await import('@e2e-dev/web');\ntest('x', async () => {});\n",
  "scripts/required.cjs": "const { test } = require('e2e');\ntest('x', async () => {});\n",
  "scripts/grouped.ts": "import { describe, test } from '@e2e-dev/web';\ndescribe('group', () => {\n  test('x', async () => {});\n});\n",
  "scripts/looped.ts": "import { test } from '@e2e-dev/web';\nfor (const n of [1, 2]) test(`n ${n}`, async () => {});\n",
};

function toy(files, { configs = {} } = {}) {
  const dir = scratch.make("e2e-dir-");
  symlinkSync(join(real, "node_modules"), join(dir, "node_modules"));
  copyFileSync(join(real, "package.json"), join(dir, "package.json"));
  copyFileSync(join(real, "e2e.config.ts"), join(dir, "e2e.config.ts"));
  for (const [name, text] of Object.entries({ ...configs, ...files })) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

function check(dir) {
  const run = spawnSync(process.execPath, [join(root, "test/e2e_discovery.mjs"), dir], { encoding: "utf8", timeout: 120_000 });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

const names = (files) => Object.keys(files);

describe("a file under e2e/ that looks like a test", () => {
  test("is named, and the check fails, when no config discovers it", () => {
    const dir = toy({ ...notTests, ...strays });
    const { status, out } = check(dir);
    assert.equal(status, 1, out);
    for (const name of names(strays)) assert.match(out, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${name} is not named:\n${out}`);
  });

  test("none of the files that are not tests are named, whatever they import or say", () => {
    const dir = toy({ ...notTests, ...strays });
    const { out } = check(dir);
    for (const name of ["tests/helper.ts", "tests/reexport.ts", "tests/only-types.ts", "tests/in-a-comment.ts", "tests/declarations.d.ts", "serve.mjs", "tests/ok.e2e.ts", "tests/uses-helper.e2e.ts", "node_modules", ".e2e/out", "e2e.config.ts"]) {
      assert.doesNotMatch(out, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${name} is named:\n${out}`);
    }
  });

  test("passes when every such file is discovered", () => {
    const dir = toy(notTests);
    const { status, out } = check(dir);
    assert.equal(status, 0, out);
  });

  test("passes when another config of the folder is the one that discovers it", () => {
    const extra = { "extra/y.e2e.ts": okTest };
    const config = "import type { E2EConfig } from 'e2e';\nimport base from './e2e.config.ts';\nexport default { ...base, tests: ['extra/**/*.e2e.ts'] } satisfies E2EConfig;\n";
    const without = check(toy({ ...notTests, ...extra }));
    assert.equal(without.status, 1, without.out);
    assert.match(without.out, /extra\/y\.e2e\.ts/);
    const withIt = check(toy({ ...notTests, ...extra }, { configs: { "e2e.extra.config.ts": config } }));
    assert.equal(withIt.status, 0, withIt.out);
  });

  test("that cannot be read at all is named too, because a test could hide in it", () => {
    const { status, out } = check(toy({ ...notTests, "scripts/broken.ts": "import { test } from '@e2e-dev/web';\ntest('x', async () => {\n" }));
    assert.equal(status, 1, out);
    assert.match(out, /scripts\/broken\.ts/);
  });

  test("says why, and says what to do", () => {
    const { out } = check(toy({ ...notTests, "other/x.e2e.ts": okTest, "scripts/direct.mjs": strays["scripts/direct.mjs"] }));
    assert.match(out, /other\/x\.e2e\.ts.*(name|looks like a test)/is);
    assert.match(out, /scripts\/direct\.mjs.*(registers|test API)/is);
    assert.match(out, /config|tests glob|rename/i);
  });
});
