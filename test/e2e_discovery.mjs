// Fails when a file under e2e/ looks like a test and no e2e config discovers
// it, because the runner never loads such a file and nothing says so.
//
//   node test/e2e_discovery.mjs [e2e folder]
//
// A file looks like a test when its name says so (`x.e2e.mts`, `y.test.ts`,
// `z.spec.js`) or when it registers tests with the e2e test API: it calls
// `test` or `describe`, imported from `e2e`, from `@e2e-dev/*`, or from a file
// of the folder that exports them, as `tests/nullpad.ts` does with `extend`.
// The files are read with oxc-parser, which e2e itself reads tests with, so a
// call in a comment or a string is not one. What is discovered is what
// `e2e list` says each config of the folder selects.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { e2eConfigs, root } from "./steps.mjs";

const skippedFolders = new Set(["node_modules", ".e2e", ".git"]);
const source = /\.[cm]?[jt]sx?$/;
const declaration = /\.d\.[cm]?ts$/;
const config = /\.config\.[cm]?[jt]s$/;
const api = new Set(["test", "describe"]);
const hooks = new Set(["beforeAll", "beforeEach", "afterAll", "afterEach"]);
const fromE2e = (specifier) => specifier === "e2e" || specifier.startsWith("e2e/") || specifier.startsWith("@e2e-dev/");

/** Every file of `dir` the runner could load, as paths from it with `/`, outside node_modules and the folders the runner writes. Declaration files are left out. */
export function sourceFiles(dir) {
  const found = [];
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!skippedFolders.has(entry.name)) walk(path);
      } else if (source.test(entry.name) && !declaration.test(entry.name) && !config.test(entry.name)) {
        found.push(relative(dir, path).split("\\").join("/"));
      }
    }
  };
  walk(dir);
  return found.sort();
}

/** The word of a file's name that says it is a test, or null: `x.e2e.mts` and `y.test.ts` have one, `nullpad.ts` has not. */
export function testWord(file) {
  const stem = basename(file).replace(source, "");
  return stem.split(/[._-]/).find((word) => ["e2e", "test", "tests", "spec"].includes(word)) ?? null;
}

const children = (node) => Object.values(node).flatMap((value) => (Array.isArray(value) ? value : [value])).filter((value) => value !== null && typeof value === "object" && typeof value.type === "string");

function walk(node, visit) {
  visit(node);
  for (const child of children(node)) walk(child, visit);
}

const stringOf = (node) => (node?.type === "Literal" && typeof node.value === "string" ? node.value : null);

/** What `program` imports from the e2e API: `{ names: local name -> imported name, spaces: Set of local names of the whole module }`. `provides(specifier)` says whether a module is that API. */
function imported(program, provides) {
  const names = new Map();
  const spaces = new Set();
  const bind = (pattern, request) => {
    if (!provides(request)) return;
    if (pattern.type === "Identifier") spaces.add(pattern.name);
    if (pattern.type === "ObjectPattern") {
      for (const property of pattern.properties) {
        if (property.type === "Property" && property.key.type === "Identifier" && property.value.type === "Identifier") names.set(property.value.name, property.key.name);
      }
    }
  };
  walk(program, (node) => {
    if (node.type === "ImportDeclaration" && node.importKind !== "type" && provides(stringOf(node.source) ?? "")) {
      for (const specifier of node.specifiers) {
        if (specifier.importKind === "type") continue;
        if (specifier.type === "ImportSpecifier") names.set(specifier.local.name, specifier.imported.name ?? specifier.imported.value);
        if (specifier.type === "ImportNamespaceSpecifier") spaces.add(specifier.local.name);
      }
    }
    if (node.type === "VariableDeclarator" && node.init) {
      let init = node.init;
      if (init.type === "AwaitExpression") init = init.argument;
      if (init.type === "ImportExpression") bind(node.id, stringOf(init.source) ?? "");
      if (init.type === "CallExpression" && init.callee.type === "Identifier" && init.callee.name === "require") bind(node.id, stringOf(init.arguments[0]) ?? "");
    }
  });
  return { names, spaces };
}

/** Whether `program` exports `test` or `describe`, as a helper that extends them does, or everything another module does. */
function exportsApi(program) {
  let yes = false;
  walk(program, (node) => {
    if (node.type === "ExportAllDeclaration") yes = true;
    if (node.type !== "ExportNamedDeclaration") return;
    for (const specifier of node.specifiers ?? []) if (api.has(specifier.exported.name ?? specifier.exported.value)) yes = true;
    const inner = node.declaration;
    if (inner?.type === "VariableDeclaration") for (const declarator of inner.declarations) if (declarator.id.type === "Identifier" && api.has(declarator.id.name)) yes = true;
  });
  return yes;
}

const isFunction = (node) => node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";
const isTitle = (node) => node?.type === "Literal" || node?.type === "TemplateLiteral";

/** The calls of `program` that register a test or a group with an API the file imports: `test('x', fn)`, `test.fail('x', fn)`, `describe(...)`, `e2e.test(...)`. */
function registrations(program, { names, spaces }) {
  const found = [];
  walk(program, (node) => {
    if (node.type !== "CallExpression") return;
    const chain = [];
    let at = node.callee;
    while (at.type === "MemberExpression" && !at.computed) {
      chain.unshift(at.property.name);
      at = at.object;
    }
    if (at.type !== "Identifier") return;
    let imports = names.get(at.name);
    if (imports === undefined && spaces.has(at.name) && chain.length > 0) imports = chain.shift();
    if (imports === undefined || hooks.has(imports) || !api.has(imports)) return;
    if (chain[0] === "extend" || chain[0] === "use") return;
    const args = node.arguments;
    const last = args.at(-1);
    if (args.length >= 2 && (isFunction(last) || (isTitle(args[0]) && ["Identifier", "MemberExpression", "CallExpression"].includes(last.type)))) {
      found.push(`${[imports, ...chain].join(".")}(${stringOf(args[0]) === null ? "..." : JSON.stringify(stringOf(args[0]))}, ...)`);
    }
  });
  return found;
}

/** The files `e2e list` selects for each config of `dir`, as paths from it. Throws what a config that cannot be listed said. */
export function discovered(dir) {
  const files = new Set();
  for (const name of e2eConfigs(dir)) {
    const run = spawnSync("npx", ["e2e", "list", "--config", name, "--reporter", "json", "--pass-with-no-tests"], { cwd: dir, encoding: "utf8", env: { ...process.env, E2E_TELEMETRY_DISABLED: "1", NODE_DISABLE_COMPILE_CACHE: "1" }, timeout: 120_000 });
    let pairs;
    try {
      ({ pairs } = JSON.parse(run.stdout));
    } catch {
      throw new Error(`e2e list for ${name} said nothing readable (exit ${run.status}): ${`${run.stderr}${run.stdout}`.trim().slice(0, 400)}`);
    }
    for (const pair of pairs) files.add(pair.file);
  }
  return files;
}

/**
 * What is wrong with the files of `dir`: each is `{ file, why }`. `found` is
 * the set of files a config discovers. A file that cannot be parsed is a
 * problem too, because a test could be in it.
 */
export function problems(dir, found) {
  const { parseSync } = createRequire(join(dir, "package.json"))("oxc-parser");
  const parsed = new Map();
  const wrong = [];
  for (const file of sourceFiles(dir)) {
    const result = parseSync(file, readFileSync(join(dir, file), "utf8"));
    if (result.errors.length > 0) wrong.push({ file, why: `cannot be parsed (${result.errors[0].message}), so the check cannot tell whether it holds tests` });
    else parsed.set(file, result.program);
  }
  const providers = new Set([...parsed].filter(([, program]) => exportsApi(program)).map(([file]) => file));
  const local = (from) => (specifier) => {
    if (!specifier.startsWith(".")) return false;
    const target = posix.join(dirname(from), specifier);
    return [target, target.replace(/\.[cm]?js$/, ".ts"), `${target}.ts`, `${target}/index.ts`].some((candidate) => providers.has(candidate));
  };
  for (const [file, program] of parsed) {
    if (found.has(file)) continue;
    const word = testWord(file);
    const calls = registrations(program, imported(program, (specifier) => fromE2e(specifier) || local(file)(specifier)));
    if (word === null && calls.length === 0) continue;
    const reasons = [];
    if (word !== null) reasons.push(`its name says it is a test ("${word}")`);
    if (calls.length > 0) reasons.push(`it registers tests with the e2e test API (${calls.slice(0, 2).join(", ")}${calls.length > 2 ? ", ..." : ""})`);
    wrong.push({ file, why: `${reasons.join(" and ")}, and no config discovers it` });
  }
  return wrong.sort((a, b) => (a.file < b.file ? -1 : 1));
}

function main(args) {
  const dir = args[0] ?? join(root, "e2e");
  let found;
  try {
    found = discovered(dir);
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    return 1;
  }
  const wrong = problems(dir, found);
  for (const { file, why } of wrong) console.error(`FAIL ${file}: ${why}`);
  if (wrong.length > 0) {
    console.error("A file the runner never loads checks nothing. Put it where a config's tests glob finds it, give it a config of its own (e2e.<name>.config.ts), or rename it if it is not a test.");
    return 1;
  }
  console.log(`e2e discovery: every file that looks like a test is one of the ${found.size} the configs discover`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
