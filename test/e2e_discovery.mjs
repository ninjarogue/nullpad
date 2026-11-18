import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { e2eConfigs, root } from "./steps.mjs";

const skippedFolders = new Set(["node_modules", ".e2e", ".git"]);
const source = /\.[cm]?[jt]sx?$/;
const declaration = /\.d\.[cm]?ts$/;
const hooks = new Set(["beforeAll", "beforeEach", "afterAll", "afterEach"]);
const fromE2e = (specifier) => specifier === "e2e" || specifier.startsWith("e2e/") || specifier.startsWith("@e2e-dev/");

export function sourceFiles(dir) {
  const found = [];
  const configs = new Set(e2eConfigs(dir));
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!skippedFolders.has(entry.name)) walk(path);
      } else if (source.test(entry.name) && !declaration.test(entry.name)) {
        const name = relative(dir, path).split("\\").join("/");
        if (!configs.has(name)) found.push(name);
      }
    }
  };
  walk(dir);
  return found.sort();
}

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

const registering = new Set(["test", "describe"]);
const API = Object.freeze({ kind: "api" });
const CALL = Object.freeze({ kind: "call" });
const moduleValue = (file) => Object.freeze({ kind: "module", file });
const wrappers = new Set(["ParenthesizedExpression", "TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "TSInstantiationExpression", "ChainExpression"]);
const untyped = (kind) => kind !== "type";
const extensions = [".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"];

const keyOf = (node) => (node.computed ? stringOf(node.property) : node.property.type === "Identifier" ? node.property.name : null);
const nameOf = (node) => (node.type === "Identifier" ? node.name : stringOf(node));

export function bindings(programs) {
  const state = new Map([...programs.keys()].map((file) => [file, { env: new Map(), exports: new Map() }]));
  let changed = false;
  const set = (map, name, value) => {
    if (value !== null && value !== undefined && !map.has(name)) {
      map.set(name, value);
      changed = true;
    }
  };
  const find = (from, specifier) => {
    if (!specifier.startsWith(".")) return null;
    const target = posix.join(dirname(from), specifier);
    const bare = target.replace(/\.[cm]?[jt]sx?$/, "");
    return [target, ...extensions.map((ext) => bare + ext), ...extensions.map((ext) => target + ext), ...extensions.map((ext) => `${target}/index${ext}`)].find((candidate) => programs.has(candidate)) ?? null;
  };
  const moduleOf = (from, specifier) => {
    if (fromE2e(specifier)) return API;
    const found = find(from, specifier);
    return found === null ? null : moduleValue(found);
  };
  const member = (object, key) => {
    if (object === API) return registering.has(key) ? CALL : key === "default" ? API : null;
    if (object === CALL) return nonRegistering.has(key) ? null : CALL;
    if (object?.kind === "module") return state.get(object.file).exports.get(key) ?? null;
    return null;
  };
  const valueOf = (node, file) => {
    if (node === null || node === undefined) return null;
    if (wrappers.has(node.type)) return valueOf(node.expression, file);
    if (node.type === "AwaitExpression") return valueOf(node.argument, file);
    if (node.type === "ConditionalExpression") return valueOf(node.consequent, file) ?? valueOf(node.alternate, file);
    if (node.type === "LogicalExpression") return valueOf(node.left, file) ?? valueOf(node.right, file);
    if (node.type === "Identifier") return state.get(file).env.get(node.name) ?? null;
    if (node.type === "ImportExpression") return stringOf(node.source) === null ? null : moduleOf(file, stringOf(node.source));
    if (node.type === "MemberExpression") {
      const key = keyOf(node);
      const object = valueOf(node.object, file);
      return key === null || object === null ? null : member(object, key);
    }
    if (node.type === "CallExpression") {
      const callee = node.callee;
      if (callee.type === "Identifier" && callee.name === "require" && stringOf(node.arguments[0]) !== null) return moduleOf(file, stringOf(node.arguments[0]));
      if (callee.type === "MemberExpression" && keyOf(callee) === "extend" && valueOf(callee.object, file) === CALL) return CALL;
    }
    return null;
  };
  const bind = (pattern, value, file) => {
    if (value === null || value === undefined) return;
    if (pattern.type === "Identifier") set(state.get(file).env, pattern.name, value);
    if (pattern.type === "AssignmentPattern") bind(pattern.left, value, file);
    if (pattern.type !== "ObjectPattern") return;
    for (const property of pattern.properties) {
      if (property.type !== "Property") continue;
      const key = property.computed ? stringOf(property.key) : nameOf(property.key);
      if (key !== null) bind(property.value, member(value, key), file);
    }
  };
  const functions = new Map([...programs].map(([file, program]) => {
    const found = new Map();
    walk(program, (node) => {
      if (node.type === "FunctionDeclaration" && node.id) found.set(node.id.name, node.params);
      if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && ["ArrowFunctionExpression", "FunctionExpression"].includes(node.init?.type)) found.set(node.id.name, node.init.params);
    });
    return [file, found];
  }));
  const visit = (node, file) => {
    const { env, exports } = state.get(file);
    if (node.type === "CallExpression" && node.callee.type === "Identifier" && functions.get(file).has(node.callee.name)) {
      const params = functions.get(file).get(node.callee.name);
      node.arguments.forEach((argument, index) => {
        if (params[index] !== undefined && params[index].type !== "RestElement") bind(params[index], valueOf(argument, file), file);
      });
    }
    if (node.type === "ImportDeclaration" && untyped(node.importKind)) {
      const module = moduleOf(file, stringOf(node.source) ?? "");
      for (const specifier of module === null ? [] : node.specifiers) {
        if (!untyped(specifier.importKind)) continue;
        if (specifier.type === "ImportNamespaceSpecifier") set(env, specifier.local.name, module);
        if (specifier.type === "ImportDefaultSpecifier") set(env, specifier.local.name, module === API ? API : member(module, "default"));
        if (specifier.type === "ImportSpecifier") set(env, specifier.local.name, member(module, nameOf(specifier.imported)));
      }
    }
    if (node.type === "VariableDeclarator") bind(node.id, valueOf(node.init, file), file);
    if (node.type === "AssignmentExpression" && node.operator === "=" && node.left.type === "Identifier") set(env, node.left.name, valueOf(node.right, file));
    if (node.type === "ExportDefaultDeclaration") set(exports, "default", valueOf(node.declaration, file));
    if (node.type === "ExportAllDeclaration" && untyped(node.exportKind)) {
      const module = moduleOf(file, stringOf(node.source) ?? "");
      if (module === null) return;
      if (node.exported) set(exports, nameOf(node.exported), module);
      else if (module === API) for (const name of registering) set(exports, name, CALL);
      else for (const [name, value] of state.get(module.file).exports) if (name !== "default") set(exports, name, value);
    }
    if (node.type === "ExportNamedDeclaration" && untyped(node.exportKind)) {
      const module = node.source ? moduleOf(file, stringOf(node.source) ?? "") : null;
      for (const specifier of node.specifiers ?? []) {
        if (!untyped(specifier.exportKind)) continue;
        const exported = nameOf(specifier.exported);
        if (node.source) set(exports, exported, module === null ? null : member(module, nameOf(specifier.local)));
        else if (specifier.local.type === "Identifier") set(exports, exported, env.get(specifier.local.name));
      }
      if (node.declaration?.type === "VariableDeclaration") {
        for (const declarator of node.declaration.declarations) if (declarator.id.type === "Identifier") set(exports, declarator.id.name, env.get(declarator.id.name));
      }
    }
  };
  for (let round = 0; round < 25; round++) {
    changed = false;
    for (const [file, program] of programs) walk(program, (node) => visit(node, file));
    if (!changed) break;
  }
  return (file) => ({ valueOf: (node) => valueOf(node, file), member });
}

const nonRegistering = new Set(["extend", "use", ...hooks]);
const registeringMembers = new Set(["only", "skip", "fail", "describe"]);
const isText = (node) => (node?.type === "Literal" && typeof node.value === "string") || node?.type === "TemplateLiteral";

const spell = (node) => {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") return `${spell(node.object)}.${keyOf(node) ?? "..."}`;
  if (wrappers.has(node.type) || node.type === "AwaitExpression") return spell(node.expression ?? node.argument);
  return node.type === "ImportExpression" ? `import(${JSON.stringify(stringOf(node.source) ?? "...")})` : "...";
};

export function registeredCalls(program, { valueOf }) {
  const found = [];
  walk(program, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = node.callee;
    if (callee.type === "MemberExpression" && nonRegistering.has(keyOf(callee))) return;
    if (valueOf(callee) !== CALL) return;
    const args = node.arguments;
    if (callee.type === "MemberExpression" && valueOf(callee.object) === CALL) {
      const key = keyOf(callee);
      if (!registeringMembers.has(key)) return;
      const inBody = args.length < 2 || (args.length === 2 && isText(args[1]));
      if (inBody) return;
    }
    found.push(node);
  });
  return found;
}

const registrations = (program, resolver) => registeredCalls(program, resolver).map((node) => `${spell(node.callee)}(${stringOf(node.arguments[0]) === null ? "..." : JSON.stringify(stringOf(node.arguments[0]))}, ...)`);

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

export function problems(dir, found) {
  const { parseSync } = createRequire(join(dir, "package.json"))("oxc-parser");
  const parsed = new Map();
  const wrong = [];
  for (const file of sourceFiles(dir)) {
    const result = parseSync(file, readFileSync(join(dir, file), "utf8"));
    if (result.errors.length > 0) wrong.push({ file, why: `cannot be parsed (${result.errors[0].message}), so the check cannot tell whether it holds tests` });
    else parsed.set(file, result.program);
  }
  const resolve = bindings(parsed);
  for (const [file, program] of parsed) {
    if (found.has(file)) continue;
    const word = testWord(file);
    const calls = registrations(program, resolve(file));
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
