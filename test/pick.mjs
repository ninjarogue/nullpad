import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { printGleam } from "./fingerprint.mjs";
import { loadParsers } from "./inventory.mjs";

/**
 * Picks the tests most likely to fail for a diff, so they run first. A gleeunit module is
 * picked when it imports, directly or through other modules, a source module the diff
 * touches (imports are read with glance). An e2e file is picked when `test/pick_map.json`
 * says it called a function the diff changed. The map is built from V8 precise coverage
 * taken over CDP while each e2e file runs (`node test/pick.mjs map` rebuilds it).
 * Picking only reorders: the full gate runs after the picked set and runs everything.
 */

export const root = fileURLToPath(new URL("..", import.meta.url));
export const MAP = "test/pick_map.json";

const gleamIn = (repo, top) => {
  const found = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".gleam")) found.push(relative(repo, path).split("\\").join("/"));
    }
  };
  walk(join(repo, top));
  return found.sort();
};

/** The Gleam module a path belongs to, or null: `src/nullpad/markdown.ffi.mjs` is part of `nullpad/markdown`. */
export function moduleOf(path) {
  const found = path.match(/^(?:src|test)\/(.+?)(?:\.gleam|\.ffi\.m?js|_ffi\.m?js)$/);
  return found ? found[1] : null;
}

export function importGraph(repo, parsers) {
  const graph = new Map();
  for (const path of [...gleamIn(repo, "src"), ...gleamIn(repo, "test")]) {
    const parsed = parsers.glance.module(readFileSync(join(repo, path), "utf8"));
    const imports = parsed.isOk() ? [...parsed[0].imports].map((definition) => definition.definition.module) : [];
    graph.set(moduleOf(path), { path, imports, runs: path.startsWith("test/") && path.endsWith("_test.gleam") });
  }
  const reads = reaching(graph, ["simplifile"]);
  for (const [name, node] of graph) node.reads = reads.has(name);
  return graph;
}

/** Every module that reaches a changed one through imports, with how many imports away it is. */
export function reaching(graph, changed) {
  const importers = new Map();
  for (const [name, { imports }] of graph) for (const imported of imports) importers.set(imported, [...(importers.get(imported) ?? []), name]);
  const depth = new Map(changed.map((name) => [name, 0]));
  const queue = [...changed];
  for (let at = 0; at < queue.length; at++) {
    for (const importer of importers.get(queue[at]) ?? []) {
      if (!depth.has(importer)) {
        depth.set(importer, depth.get(queue[at]) + 1);
        queue.push(importer);
      }
    }
  }
  return depth;
}

const gitList = (repo, args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 1 << 26 }).split("\0").filter(Boolean);

/** What differs from `base` in the work tree, committed or not. */
export function changedFiles(repo, base) {
  return [...new Set([...gitList(repo, ["diff", "--name-only", "-z", base]), ...gitList(repo, ["ls-files", "-z", "--others", "--exclude-standard"])])].sort();
}

const dependencies = (paths) => paths.some((path) => path === "gleam.toml" || path === "manifest.toml");

/**
 * The gleeunit modules to run first, nearest to the change first. A module that reads files
 * (through simplifile, as the architecture test reads `src`) is picked by any change to src.
 */
export function pickGleam({ graph, changed }) {
  const names = changed.map(moduleOf).filter((name) => name !== null);
  const all = dependencies(changed);
  const readsSrc = changed.some((path) => path.startsWith("src/"));
  const depth = reaching(graph, names);
  return [...graph]
    .filter(([name, { runs, reads }]) => runs && (all || depth.has(name) || (reads && readsSrc)))
    .map(([name, { path }]) => ({ module: name, path, depth: all ? 0 : (depth.get(name) ?? 1) }))
    .sort((a, b) => a.depth - b.depth || (a.path < b.path ? -1 : 1));
}

const entriesOf = (module) => {
  const functions = new Map([...module.functions].map((definition) => [definition.definition.name, printGleam(definition)]));
  const rest = printGleam([...module.imports, ...module.custom_types, ...module.type_aliases, ...module.constants]);
  return { functions, rest };
};

/** Per changed source module, the functions that changed, or `wide` when more than functions did. */
export function changedParts({ repo, base, changed, parsers }) {
  const parts = new Map();
  for (const path of changed.filter((one) => one.startsWith("src/"))) {
    const name = moduleOf(path);
    if (name === null) continue;
    const wide = () => parts.set(name, { wide: true, fns: new Set() });
    if (!path.endsWith(".gleam")) {
      wide();
      continue;
    }
    let before = null;
    try {
      before = parsers.glance.module(execFileSync("git", ["show", `${base}:${path}`], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26 }));
    } catch {}
    const after = existsSync(join(repo, path)) ? parsers.glance.module(readFileSync(join(repo, path), "utf8")) : null;
    if (before === null || after === null || !before.isOk() || !after.isOk()) {
      wide();
      continue;
    }
    const was = entriesOf(before[0]);
    const now = entriesOf(after[0]);
    const fns = new Set([...new Set([...was.functions.keys(), ...now.functions.keys()])].filter((fn) => was.functions.get(fn) !== now.functions.get(fn)));
    parts.set(name, { wide: was.rest !== now.rest, fns });
  }
  return parts;
}

export function loadMap(repo) {
  try {
    return JSON.parse(readFileSync(join(repo, MAP), "utf8"));
  } catch {
    return null;
  }
}

/**
 * The e2e files to run first. A file is picked when it called a changed function, or any
 * function of a module that changed in a way the map cannot follow to functions. A change the
 * map knows nothing about (a new module, a function it never saw) picks every file that ran
 * the module at all, and a change to assets, dependencies or the e2e helpers picks all of them.
 */
export function pickE2e({ map, changed, parts }) {
  if (map === null) return { files: [], why: `${MAP} is missing, so no e2e file is picked (node test/pick.mjs map)` };
  const files = Object.keys(map.files);
  const own = changed.filter((path) => /^e2e\/tests\/.+\.e2e\.ts$/.test(path) && files.includes(path));
  const helpers = changed.some((path) => (path.startsWith("e2e/") && !own.includes(path) && !path.startsWith("e2e/node_modules/") && !/^e2e\/package(?:-lock)?\.json$/.test(path)) || path.startsWith("assets/") || dependencies([path]));
  if (helpers) return { files, why: "assets, dependencies or the e2e helpers changed, so every e2e file is picked, and the full gate runs them, so they are not run twice" };
  const score = new Map(own.map((file) => [file, 1000]));
  if (changed.some((path) => path.startsWith("src/") || path.startsWith("assets/"))) for (const file of files) if (map.files[file].reads) score.set(file, score.get(file) ?? 0.5);
  for (const [module, { wide, fns }] of parts) {
    const known = map.functions[module];
    const unseen = known === undefined || [...fns].some((fn) => !known.includes(fn));
    for (const file of files) {
      const ran = map.files[file].called[module];
      if (ran === undefined) continue;
      const hit = wide || unseen ? ran.length : [...fns].filter((fn) => ran.includes(known.indexOf(fn))).length;
      if (hit > 0) score.set(file, (score.get(file) ?? 0) + hit);
    }
  }
  const ordered = [...score].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([file]) => file);
  return { files: ordered, why: null };
}

const seconds = (ms) => (ms < 90_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`);
const plain = (text) => text.replace(/\u001b\[[0-9;]*m/g, "");

export function capture(argv, { cwd, env = {} }) {
  return new Promise((done) => {
    let output = "";
    const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => done({ code: 127, output: `${output}${error.message}` }));
    child.on("close", (code) => done({ code, output }));
  });
}

/**
 * What `gleeunit.main` does for the JavaScript target, for only the modules it is given: import the
 * compiled module, run every function that ends in `_test`, and report through gleeunit's own
 * reporting, so the output and the exit code are the ones `gleam test` gives. It runs in the repo itself,
 * because the tests read files from there (the fixtures of the spec, `src` and `test` for the
 * architecture rules).
 */
const gleeunitOf = `
const [dist, gleeunit, ...modules] = process.argv.slice(1);
const reporting = await import(new URL("gleeunit/internal/reporting.mjs", gleeunit).href);
let state = reporting.new_state();
for (const path of modules) {
  const name = path.slice("test/".length).replace(".gleam", "");
  const module = await import(new URL(name + ".mjs", dist).href);
  for (const fn of Object.keys(module)) {
    if (!fn.endsWith("_test")) continue;
    try {
      await module[fn]();
      state = reporting.test_passed(state);
    } catch (error) {
      state = reporting.test_failed(state, name, fn, error);
    }
  }
}
process.exit(reporting.finished(state));
`;

export async function runGleeunit({ repo, modules }) {
  const built = pathToFileURL(join(repo, "build", "dev", "javascript") + "/").href;
  return await capture(["node", "--input-type=module", "-e", gleeunitOf, new URL("nullpad/", built).href, new URL("gleeunit/", built).href, ...modules.map(({ path }) => path)], { cwd: repo });
}

export async function pickFor({ repo, base }) {
  const parsers = await loadParsers(repo);
  const changed = changedFiles(repo, base);
  const gleam = pickGleam({ graph: importGraph(repo, parsers), changed });
  const map = loadMap(repo);
  const e2e = pickE2e({ map, changed, parts: changedParts({ repo, base, changed, parsers }) });
  return { changed, gleam, e2e, map };
}

export async function runPicked({ repo, base, log = console.log }) {
  const started = Date.now();
  const built = await capture(["gleam", "build"], { cwd: repo });
  if (built.code !== 0) {
    log(`FAIL gleam build:\n${plain(built.output).split("\n").slice(-30).join("\n")}`);
    return { ok: false, ms: Date.now() - started };
  }
  const { gleam, e2e, map } = await pickFor({ repo, base });
  const names = gleam.slice(0, 6).map(({ module }) => module).join(", ");
  log(`==> picked first: ${gleam.length} gleeunit module${gleam.length === 1 ? "" : "s"}${gleam.length > 0 ? ` (${names}${gleam.length > 6 ? ", ..." : ""})` : ""}, ${e2e.files.length} e2e file${e2e.files.length === 1 ? "" : "s"}${e2e.why ? `: ${e2e.why}` : ""}${map === null ? "" : `. The e2e map was built at ${map.builtAt.slice(0, 7)}`}`);
  const compiled = gleam.filter(({ module }) => existsSync(join(repo, "build", "dev", "javascript", "nullpad", `${module}.mjs`)));
  if (compiled.length > 0) {
    const run = await runGleeunit({ repo, modules: compiled });
    const text = plain(run.output);
    if (run.code !== 0) {
      log(`FAIL a picked gleeunit test failed:\n${text.split("\n").slice(-40).join("\n")}`);
      return { ok: false, ms: Date.now() - started };
    }
    log(`  gleeunit: ${text.match(/\d+ passed, no failures/)?.[0] ?? "passed"}`);
  }
  if (e2e.why) {
    log(`  e2e: ${e2e.why}`);
  } else if (e2e.files.length > 0) {
    const steps = await import(pathToFileURL(join(repo, "test", "steps.mjs")).href);
    const counts = await import(pathToFileURL(join(repo, "test", "test_counts.mjs")).href);
    const stop = counts.stopOnSignals();
    try {
      for (const config of steps.e2eConfigs()) {
        const files = e2e.files.filter((file) => map.files[file]?.configs.includes(config) && existsSync(join(repo, file)));
        if (files.length === 0) continue;
        const step = steps.e2e(config, files.map((file) => file.replace(/^e2e\//, "")));
        if (step.needs && !existsSync(step.needs)) {
          log(`  e2e: ${step.hint}`);
          break;
        }
        const run = await counts.runCheck(step, {});
        if (run.counts === null || run.counts.failed > 0 || run.exitCode !== 0) {
          log(`FAIL a picked e2e test failed in ${config}:\n${(run.failing ?? []).slice(0, 10).map((name) => `  ${name}`).join("\n") || plain(run.output).slice(-1500)}`);
          return { ok: false, ms: Date.now() - started };
        }
        log(`  ${config}: ${run.counts.passed} tests pass`);
      }
    } finally {
      stop();
    }
  }
  const ms = Date.now() - started;
  log(`  the picked set took ${seconds(ms)}`);
  return { ok: true, ms };
}

async function perConfig(repo) {
  const steps = await import(pathToFileURL(join(repo, "test", "steps.mjs")).href);
  const pairs = [];
  for (const config of steps.e2eConfigs(join(repo, "e2e"))) {
    const run = spawnSync("npx", ["e2e", "list", "--config", config, "--reporter", "json", "--pass-with-no-tests"], { cwd: join(repo, "e2e"), encoding: "utf8", env: { ...process.env, E2E_TELEMETRY_DISABLED: "1" }, maxBuffer: 1 << 26 });
    const listed = JSON.parse(run.stdout);
    for (const file of new Set(listed.pairs.map((pair) => pair.file))) pairs.push({ config, file });
  }
  return pairs;
}

/** Whether the file, or a file it imports, names a path under `src/` or `assets/`: it reads source, and a call it makes cannot show that. */
export function readsSource(repo, file) {
  const seen = new Set();
  const queue = [file];
  for (let at = 0; at < queue.length; at++) {
    const path = queue[at];
    if (seen.has(path) || !existsSync(join(repo, path))) continue;
    seen.add(path);
    const text = readFileSync(join(repo, path), "utf8");
    if (/['"`](?:\.\.\/)*(?:src|assets)\//.test(text)) return true;
    for (const [, specifier] of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) queue.push(join(path, "..", specifier).split("\\").join("/"));
  }
  return false;
}

/** Runs every e2e file under precise coverage and writes what it called to `test/pick_map.json`. */
export async function buildMap({ repo, log = console.log, only = [] }) {
  const parsers = await loadParsers(repo);
  const built = await capture(["gleam", "build"], { cwd: repo });
  if (built.code !== 0) throw new Error(`gleam build failed:\n${plain(built.output).slice(-1500)}`);
  const sources = new Set([...importGraph(repo, parsers)].filter(([, { path }]) => path.startsWith("src/")).map(([name]) => name));
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const dirty = gitList(repo, ["status", "--porcelain", "-z", "--", "src", "assets", "gleam.toml"]).length > 0;
  if (dirty) throw new Error("src/ or assets/ has uncommitted changes, so the map would not say which commit it was built at. Commit or stash them first.");
  const files = {};
  for (const { config, file } of await perConfig(repo)) {
    if (only.length > 0 && !only.includes(file)) continue;
    const out = mkdtempSync(join(tmpdir(), "pick-map-"));
    mkdirSync(join(repo, "e2e", ".e2e"), { recursive: true });
    const report = mkdtempSync(join(repo, "e2e", ".e2e", "pick-"));
    const started = Date.now();
    try {
      const run = await capture(["npx", "e2e", "run", "--config", "coverage.mjs", "--retries", "0", "--output", report, file], {
        cwd: join(repo, "e2e"),
        env: { PICK_COVERAGE_DIR: out, PICK_DPR2: config.includes("dpr2") ? "1" : "0", E2E_TELEMETRY_DISABLED: "1" },
      });
      const merged = {};
      for (const name of readdirSync(out).filter((entry) => entry.endsWith(".json"))) {
        for (const [module, fns] of Object.entries(JSON.parse(readFileSync(join(out, name), "utf8")))) merged[module] = [...new Set([...(merged[module] ?? []), ...fns])];
      }
      const key = `e2e/${file}`;
      files[key] ??= { configs: [], called: {}, reads: readsSource(repo, key) };
      files[key].configs.push(config);
      for (const [module, fns] of Object.entries(merged)) {
        if (!sources.has(module)) continue;
        files[key].called[module] = [...new Set([...(files[key].called[module] ?? []), ...fns])].sort();
      }
      log(`${config} ${file}: ${Object.keys(merged).filter((module) => sources.has(module)).length} modules in ${seconds(Date.now() - started)}${run.code === 0 ? "" : ` (the run exited ${run.code}: some tests failed, and the map holds what they called before they did)`}`);
    } finally {
      rmSync(out, { recursive: true, force: true });
      rmSync(report, { recursive: true, force: true });
    }
  }
  if (!Object.values(files).some(({ called }) => Object.keys(called).length > 0)) throw new Error("no e2e file called anything of src, so the coverage was not taken");
  const functions = {};
  for (const { called } of Object.values(files)) for (const [module, fns] of Object.entries(called)) functions[module] = [...new Set([...(functions[module] ?? []), ...fns])].sort();
  const indexed = (entry) => Object.fromEntries(Object.keys(entry.called).sort().map((module) => [module, entry.called[module].map((fn) => functions[module].indexOf(fn))]));
  return {
    builtAt: sha,
    command: "node test/pick.mjs map",
    note: "Which compiled functions of src each e2e file called, from V8 precise coverage over CDP. `functions` lists every function seen per module, and each file's `called` lists are indexes into it.",
    functions,
    files: Object.fromEntries(Object.keys(files).sort().map((file) => [file, { configs: files[file].configs.sort(), reads: files[file].reads, called: indexed(files[file]) }])),
  };
}

export function describeMap(map) {
  return { builtAt: map.builtAt, files: Object.keys(map.files).length, modules: Object.keys(map.functions).length };
}

const usage = "usage: node test/pick.mjs [run | list | map [file ...]] [--base <sha>]";

async function main(args) {
  const [command = "run", ...rest] = args;
  const at = rest.indexOf("--base");
  const base = at >= 0 ? rest.splice(at, 2)[1] : (await import("./judges.mjs")).resolveBase(root, { fetch: false }).sha;
  if (command === "run") return (await runPicked({ repo: root, base })).ok ? 0 : 1;
  if (command === "list") {
    const { gleam, e2e } = await pickFor({ repo: root, base });
    console.log(`gleeunit:\n${gleam.map(({ path, depth }) => `  ${path} (${depth} imports away)`).join("\n")}\ne2e${e2e.why ? ` (${e2e.why})` : ""}:\n${e2e.files.map((file) => `  ${file}`).join("\n")}`);
    return 0;
  }
  if (command === "map") {
    const map = await buildMap({ repo: root, only: rest.map((file) => file.replace(/^e2e\//, "")) });
    const [first] = Object.keys(map.files);
    if (first === undefined) throw new Error("no e2e file ran");
    writeFileSync(join(root, MAP), `${JSON.stringify(map, null, 1)}\n`);
    console.log(`${MAP}: ${Object.keys(map.files).length} files, built at ${map.builtAt.slice(0, 7)}. Commit it.`);
    return 0;
  }
  console.error(usage);
  return 2;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) process.exit(await main(process.argv.slice(2)));
