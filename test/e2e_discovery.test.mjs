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


// Registrations a person writes without a literal title or a function last: each sits in a file
// that is not named like a test, and no config discovers it. `helpers` are files that are not tests.
const helpers = {
  "tests/custom.ts": "import { test as base } from '@e2e-dev/web';\nexport const spec = base.extend({});\nexport default base.extend({});\nexport const aliased = base;\n",
  "tests/renamed.ts": "export { test as it } from './helper.ts';\n",
  "tests/starred.ts": "export * from './custom.ts';\n",
  "tests/viaconst.ts": "import { spec } from './custom.ts';\nexport const again = spec;\n",
};

const run = "const run = async () => {};\nconst name = 'x';\n";
const moreStrays = {
  "scripts/loop-title.ts": "import { test } from '@e2e-dev/web';\nconst cases = [{ title: 'a', run: async () => {} }];\nfor (const c of cases) test(c.title, c.run);\n",
  "scripts/plain-arguments.ts": `import { test } from '@e2e-dev/web';\n${run}test(name, run);\n`,
  "scripts/alias-const.ts": `import { test } from '@e2e-dev/web';\n${run}const t = test;\nt(name, run);\n`,
  "scripts/alias-let.ts": `import { test } from '@e2e-dev/web';\n${run}let t;\nt = test;\nt(name, run);\n`,
  "scripts/default-import.ts": `import e2e from 'e2e';\n${run}e2e.test(name, run);\n`,
  "scripts/namespace-alias.ts": `import * as e2e from 'e2e';\n${run}const t = e2e.test;\nt(name, run);\n`,
  "scripts/namespace-destructured.ts": `import * as e2e from '@e2e-dev/web';\n${run}const { test: t } = e2e;\nt(name, run);\n`,
  "scripts/extend-here.ts": `import { test } from '@e2e-dev/web';\n${run}const it = test.extend({});\nit(name, run);\n`,
  "scripts/extend-called.ts": `import { test } from '@e2e-dev/web';\n${run}test.extend({})(name, run);\n`,
  "scripts/extend-named-helper.ts": `import { spec } from '../tests/custom.ts';\n${run}spec(name, run);\n`,
  "scripts/extend-default-helper.ts": `import it from '../tests/custom.ts';\n${run}it(name, run);\n`,
  "scripts/extend-aliased-helper.ts": `import { aliased as t } from '../tests/custom.ts';\n${run}t(name, run);\n`,
  "scripts/extend-renamed-export.ts": `import { it } from '../tests/renamed.ts';\n${run}it(name, run);\n`,
  "scripts/extend-starred-export.ts": `import { spec } from '../tests/starred.ts';\n${run}spec(name, run);\n`,
  "scripts/extend-through-const.ts": `import { again } from '../tests/viaconst.ts';\n${run}again(name, run);\n`,
  "scripts/helper-namespace.ts": `import * as h from '../tests/helper.ts';\n${run}h.test(name, run);\n`,
  "scripts/dynamic-member.ts": `${run}(await import('e2e')).test(name, run);\n`,
  "scripts/dynamic-web-member.ts": `${run}(await import('@e2e-dev/web')).test(name, run);\n`,
  "scripts/dynamic-helper.ts": `${run}const h = await import('../tests/custom.ts');\nh.spec(name, run);\n`,
  "scripts/required-namespace.cjs": `const e2e = require('e2e');\n${run}e2e.test(name, run);\n`,
  "scripts/skip-with-names.ts": `import { test } from '@e2e-dev/web';\n${run}test.skip(name, run);\n`,
  "scripts/only-with-names.ts": `import { test } from '@e2e-dev/web';\n${run}test.only(name, run);\n`,
  "scripts/describe-with-names.ts": `import { describe } from '@e2e-dev/web';\nconst body = () => {};\ndescribe(name, body);\n`,
  "scripts/in-a-function.ts": `import { test } from '@e2e-dev/web';\n${run}export function register(): void {\n  test(name, run);\n}\n`,
  "scripts/for-each.ts": "import { test } from '@e2e-dev/web';\n[{ title: 'a', run: async () => {} }].forEach((c) => test(c.title, c.run));\n",
  "tests/x.config.ts": "import { test } from '@e2e-dev/web';\ntest('x', async () => {});\n",
  "tests/nested/y.config.mjs": "import { test } from '@e2e-dev/web';\ntest('y', async () => {});\n",
};

// Files that use the e2e API without registering a test.
const moreNotTests = {
  ...helpers,
  "tests/in-a-body.ts": "import { test } from '@e2e-dev/web';\nexport function guard(on: boolean): void {\n  test.skip(on, 'a reason');\n  test.fail(on, 'another');\n  test.skip('always');\n  test.fail('known gap');\n}\n",
  "tests/own-registrar.ts": "export function test(title: string, body: () => void): void {\n  body();\n}\ntest('not the e2e one', () => {});\n",
  "tests/alias-not-called.ts": "import { test } from '@e2e-dev/web';\nexport const t = test;\nexport const same = test.extend({});\n",
  "tests/hooks-only.ts": "import { afterAll, beforeEach } from 'e2e';\nbeforeEach(async () => {});\nafterAll(async () => {});\n",
  "tests/namespace-members.ts": "import e2e from 'e2e';\nimport * as all from '@e2e-dev/web';\nexport const same = e2e.expect;\nexport const other = all.web;\nconst t = e2e.expect;\nt(1);\n",
  "tests/uses-helper-namespace.e2e.ts": "import * as h from './helper.ts';\nh.test('through a namespace', async () => {});\n",
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

const lazily = (make) => {
  let value;
  return () => (value ??= make());
};

describe("a registration whatever its arguments, through whatever binds the e2e test API", () => {
  const everything = lazily(() => check(toy({ ...notTests, ...moreNotTests, ...moreStrays })));
  for (const name of names(moreStrays)) {
    test(`${name} is named`, () => {
      const { status, out } = everything();
      assert.equal(status, 1, out);
      assert.match(out, new RegExp(`FAIL ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`), `${name} is not named:\n${out}`);
    });
  }

  test("none of the files that use the API without registering a test are named", () => {
    const { out } = everything();
    for (const name of names(moreNotTests)) {
      assert.doesNotMatch(out, new RegExp(`FAIL ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`), `${name} is named:\n${out}`);
    }
  });

  test("passes when only the files that use the API without registering are there", () => {
    const { status, out } = check(toy({ ...notTests, ...moreNotTests }));
    assert.equal(status, 0, out);
  });
});
