import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { loadParsers } from "./inventory.mjs";
import { changedParts, importGraph, loadMap, MAP, moduleOf, pickE2e, pickGleam, reaching, readsSource, runGleeunit } from "./pick.mjs";
import { useScratch } from "./scratch.mjs";
import { e2eConfigs, root } from "./steps.mjs";

const scratch = useScratch();
const parsers = await loadParsers(root);
const graph = importGraph(root, parsers);
const order = (changed) => pickGleam({ graph, changed }).map(({ module }) => module);

describe("which gleeunit modules a change picks, on this repository", () => {
  test("a change to src/nullpad/markdown.gleam puts the markdown tests first, and leaves out the tests that never reach it", () => {
    const picked = pickGleam({ graph, changed: ["src/nullpad/markdown.gleam"] });
    const direct = picked.filter(({ depth }) => depth === 1).map(({ module }) => module);
    assert.ok(picked.length > 0 && picked[0].depth === 1, "the nearest tests come first");
    for (const module of ["markdown_test", "preview_test", "live_test", "commonmark_render_test", "editor_test"]) assert.ok(direct.includes(module), `${module} imports markdown, so it is first`);
    const names = picked.map(({ module }) => module);
    for (const module of ["buffer_test", "history_test", "nullpad_test"]) assert.ok(!names.includes(module), `${module} never reaches markdown`);
    assert.deepEqual(
      picked.map(({ depth }) => depth),
      picked.map(({ depth }) => depth).sort((a, b) => a - b),
    );
  });

  test("tests that reach the change only through other modules come after the ones that import it", () => {
    const picked = pickGleam({ graph, changed: ["src/nullpad/markdown.gleam"] });
    const at = (module) => picked.findIndex((one) => one.module === module);
    assert.ok(at("markdown_test") < at("commonmark_test"), "commonmark_test reaches markdown through commonmark/render");
    assert.ok(at("commonmark_test") >= 0);
  });

  test("a change to a module that few tests import picks few", () => {
    assert.ok(order(["src/nullpad/vim.gleam"]).length < order(["src/nullpad/markdown.gleam"]).length);
    assert.deepEqual(order(["src/nullpad/library.gleam"]).filter((module) => module !== "architecture_test"), ["library_test"]);
  });

  test("the ffi file of a module is part of it", () => {
    assert.equal(moduleOf("src/nullpad/markdown.ffi.mjs"), "nullpad/markdown");
    assert.deepEqual(order(["src/nullpad/markdown.ffi.mjs"]), order(["src/nullpad/markdown.gleam"]));
  });

  test("the tests that read src through simplifile are picked by any change to src", () => {
    assert.ok(order(["src/nullpad/app.gleam"]).includes("architecture_test"));
    assert.ok(!order(["assets/nullpad.css"]).includes("architecture_test"));
  });

  test("a change to a test is picked itself, and a change to a helper of the tests picks the tests that import it", () => {
    assert.deepEqual(order(["test/buffer_test.gleam"]), ["buffer_test"]);
    assert.ok(order(["test/commonmark/render.gleam"]).includes("commonmark_render_test"));
  });

  test("a change to the dependencies picks every module", () => {
    assert.equal(order(["gleam.toml"]).length, [...graph.values()].filter((node) => node.runs).length);
  });
});

describe("the graph of imports", () => {
  test("follows imports through any number of modules, and stops at a cycle", () => {
    const small = new Map([
      ["a", { imports: ["b"], runs: false }],
      ["b", { imports: ["c"], runs: false }],
      ["c", { imports: ["a"], runs: false }],
      ["d", { imports: [], runs: false }],
    ]);
    assert.deepEqual([...reaching(small, ["c"])], [["c", 0], ["b", 1], ["a", 2]]);
  });
});

describe("gleeunit on only the picked modules", () => {
  const passed = async (...paths) => {
    const run = await runGleeunit({ repo: root, modules: paths.map((path) => ({ path })) });
    const text = run.output.replace(/\u001b\[[0-9;]*m/g, "");
    assert.equal(run.code, 0, text);
    return Number(text.match(/(\d+) passed, no failures/)[1]);
  };

  test("runs the modules picked and no others", async () => {
    const one = await passed("test/buffer_test.gleam");
    const two = await passed("test/buffer_test.gleam", "test/history_test.gleam");
    assert.ok(one > 0 && two > one, `${one} tests in one module, ${two} in two`);
  });
});

const gleam = (functions, extra = "") => `import gleam/list\n${extra}\npub fn one() -> Int {\n  1\n}\n\nfn two() -> Int {\n  ${functions}\n}\n`;

describe("which functions of a source module changed", () => {
  const dir = scratch.make("pick-parts-");
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env, GIT_DIR: undefined } });
  mkdirSync(join(dir, "src"));
  git("init", "-q", "-b", "main");
  git("config", "user.name", "t");
  git("config", "user.email", "t@t");
  writeFileSync(join(dir, "src", "m.gleam"), gleam("2"));
  writeFileSync(join(dir, "src", "m.ffi.mjs"), "export const x = 1;\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const base = git("rev-parse", "HEAD").trim();
  const parts = (path, text) => {
    if (text !== null) writeFileSync(join(dir, path), text);
    return changedParts({ repo: dir, base, changed: [path], parsers });
  };

  test("a changed body names that function and no other", () => {
    const found = parts("src/m.gleam", gleam("3")).get("m");
    assert.deepEqual([...found.fns], ["two"]);
    assert.equal(found.wide, false);
  });

  test("a function added or removed is named", () => {
    assert.deepEqual([...parts("src/m.gleam", `${gleam("2")}\npub fn three() -> Int {\n  3\n}\n`).get("m").fns], ["three"]);
  });

  test("formatting and comments change nothing", () => {
    const found = parts("src/m.gleam", `// why\n${gleam("2")}`).get("m");
    assert.deepEqual([...found.fns], []);
    assert.equal(found.wide, false);
  });

  test("a change to what is not a function, or to the ffi file, is wide", () => {
    assert.equal(parts("src/m.gleam", gleam("2", "const limit = 5\n")).get("m").wide, true);
    assert.equal(parts("src/m.ffi.mjs", "export const x = 2;\n").get("m").wide, true);
  });
});

describe("which e2e files a change picks", () => {
  const map = {
    builtAt: "a".repeat(40),
    functions: { "nullpad/markdown": ["parse", "render", "split"], "nullpad/vim": ["key"] },
    files: {
      "e2e/tests/a.e2e.ts": { configs: ["e2e.config.ts"], reads: false, called: { "nullpad/markdown": [0, 1] } },
      "e2e/tests/b.e2e.ts": { configs: ["e2e.config.ts"], reads: false, called: { "nullpad/markdown": [1, 2] } },
      "e2e/tests/c.e2e.ts": { configs: ["e2e.config.ts"], reads: true, called: {} },
      "e2e/tests/d.e2e.ts": { configs: ["e2e.config.ts"], reads: false, called: { "nullpad/vim": [0] } },
    },
  };
  const picks = (parts, changed = ["src/nullpad/markdown.gleam"]) => pickE2e({ map, changed, parts: new Map(parts) }).files;

  test("a changed function picks the files that called it, the ones that called more of what changed first", () => {
    assert.deepEqual(picks([["nullpad/markdown", { wide: false, fns: new Set(["render", "split"]) }]]).slice(0, 2), ["e2e/tests/b.e2e.ts", "e2e/tests/a.e2e.ts"]);
    assert.deepEqual(picks([["nullpad/markdown", { wide: false, fns: new Set(["parse"]) }]]), ["e2e/tests/a.e2e.ts", "e2e/tests/c.e2e.ts"]);
  });

  test("a module the files never ran picks only the files that read source", () => {
    assert.deepEqual(picks([["nullpad/other", { wide: true, fns: new Set() }]], ["src/nullpad/other.gleam"]), ["e2e/tests/c.e2e.ts"]);
  });

  test("a wide change, or a function the map never saw, picks every file that ran the module", () => {
    assert.deepEqual(picks([["nullpad/markdown", { wide: true, fns: new Set() }]]).slice(0, 2).sort(), ["e2e/tests/a.e2e.ts", "e2e/tests/b.e2e.ts"]);
    assert.deepEqual(picks([["nullpad/markdown", { wide: false, fns: new Set(["brand_new"]) }]]).slice(0, 2).sort(), ["e2e/tests/a.e2e.ts", "e2e/tests/b.e2e.ts"]);
  });

  test("assets, dependencies and the e2e helpers pick every file", () => {
    for (const changed of [["assets/nullpad.css"], ["gleam.toml"], ["e2e/tests/nullpad.ts"], ["e2e/serve.mjs"]]) {
      assert.equal(pickE2e({ map, changed, parts: new Map() }).files.length, 4, changed.join());
    }
  });

  test("a changed e2e file comes first", () => {
    assert.equal(pickE2e({ map, changed: ["e2e/tests/d.e2e.ts"], parts: new Map() }).files[0], "e2e/tests/d.e2e.ts");
  });

  test("with no map, none is picked and the reason is said", () => {
    const none = pickE2e({ map: null, changed: ["src/x.gleam"], parts: new Map() });
    assert.deepEqual(none.files, []);
    assert.match(none.why, /pick_map\.json is missing/);
  });
});

describe("the committed map", () => {
  const map = loadMap(root);

  test("says which commit it was built at, and how to build it again", () => {
    assert.match(map.builtAt, /^[0-9a-f]{40}$/);
    assert.equal(map.command, "node test/pick.mjs map");
    assert.equal(MAP, "test/pick_map.json");
  });

  test("lists functions sorted, and every file's calls are indexes into them", () => {
    for (const [module, fns] of Object.entries(map.functions)) {
      assert.ok(graph.has(module) && graph.get(module).path.startsWith("src/"), `${module} is a module of src`);
      assert.deepEqual(fns, [...fns].sort(), module);
    }
    for (const [file, entry] of Object.entries(map.files)) {
      assert.ok(entry.configs.every((config) => e2eConfigs(join(root, "e2e")).includes(config)), `${file} names a config that exists`);
      for (const [module, indexes] of Object.entries(entry.called)) {
        assert.ok(indexes.every((at) => Number.isInteger(at) && at >= 0 && at < map.functions[module].length), `${file} ${module}`);
      }
    }
  });

  test("knows a file that reads source, and one that does not", () => {
    assert.equal(readsSource(root, "e2e/tests/browser-facts.e2e.ts"), true);
    assert.equal(readsSource(root, "e2e/tests/notes.e2e.ts"), false);
  });

  test("a change to a function of markdown that e2e files called picks them, from the map as committed", () => {
    const called = Object.entries(map.files).filter(([, entry]) => (entry.called["nullpad/markdown"] ?? []).length > 0);
    assert.ok(called.length > 0, "some e2e file calls markdown");
    const fn = map.functions["nullpad/markdown"][called[0][1].called["nullpad/markdown"][0]];
    const picked = pickE2e({ map, changed: ["src/nullpad/markdown.gleam"], parts: new Map([["nullpad/markdown", { wide: false, fns: new Set([fn]) }]]) }).files;
    assert.ok(picked.includes(called[0][0]));
    for (const file of picked) assert.ok(map.files[file], file);
  });
});

