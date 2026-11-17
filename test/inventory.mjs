import { createRequire } from "node:module";
import { join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { bindings, registeredCalls } from "./e2e_discovery.mjs";
import { gleamPrinter, hidden, jsPrinter, printGleam, printNode } from "./fingerprint.mjs";

/**
 * What the tests and the gate scripts say, read from their syntax trees: JavaScript and
 * TypeScript with oxc-parser, Gleam with glance (compiled to JavaScript in `build/`).
 * `judged` says which files are judges, `inventoryOf` reads them, and `compare` says
 * what a branch took away from, or changed in, the judges it inherited.
 */

const excluded = (path) => /\.md$/.test(path) || path === "test/test_counts.json" || path === "test/pick_map.json" || /^e2e\/(?:node_modules|\.e2e)\//.test(path) || /^e2e\/package(?:-lock)?\.json$/.test(path);

export const judged = (path) => /^(?:test|tools|e2e|\.githooks|\.github)\//.test(path) && !excluded(path);

/** A `test` holds tests, a `support` file is what they call, a `gate` file is what decides. */
export function roleOf(path) {
  if (/_test\.gleam$/.test(path) || /\.e2e\.[cm]?[jt]sx?$/.test(path) || /\.test\.[cm]?[jt]sx?$/.test(path)) return "test";
  if (/^e2e\/(?:tests|typist)\//.test(path)) return "support";
  return "gate";
}

export async function loadParsers(repo) {
  const { parseSync } = createRequire(join(repo, "e2e", "package.json"))("oxc-parser");
  const glance = await import(pathToFileURL(join(repo, "build", "dev", "javascript", "glance", "glance.mjs")).href);
  return { oxc: parseSync, glance };
}

const isCode = (path) => /\.[cm]?[jt]sx?$/.test(path) || path.endsWith(".gleam");
const squash = (text) => text.replace(/\s+/g, " ").trim();
const brief = (text) => (squash(text).length > 110 ? `${squash(text).slice(0, 107)}...` : squash(text));

const fn = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"]);

const kids = (node) =>
  Object.entries(node)
    .filter(([key]) => !hidden.has(key))
    .flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
    .filter((value) => value !== null && typeof value === "object" && typeof value.type === "string");

function walk(node, visit, into = () => true) {
  visit(node);
  for (const child of kids(node)) if (into(child)) walk(child, visit, into);
}

const nameOf = (node) => (node?.type === "Identifier" ? node.name : node?.type === "Literal" ? String(node.value) : null);

function spell(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression") return `${spell(node.object)}.${node.computed ? "..." : (nameOf(node.property) ?? "...")}`;
  if (node.type === "ChainExpression" || node.type === "AwaitExpression") return spell(node.expression ?? node.argument);
  return "...";
}

const weakWords = new Set(["skip", "fixme", "fail", "todo"]);
const groupWords = new Set(["describe", "suite", "group"]);
const modWords = new Set(["skip", "fixme", "fail", "todo", "only", "slow"]);

function titleOf(node, text) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral") return text.slice(node.start + 1, node.end - 1);
  return node === undefined ? "?" : `<${squash(text.slice(node.start, node.end))}>`;
}

function optionMods(args) {
  const found = [];
  for (const arg of args) {
    if (arg.type !== "ObjectExpression") continue;
    for (const property of arg.properties) {
      const key = property.type === "Property" ? nameOf(property.key) : null;
      if (key !== null && weakWords.has(key)) found.push(key);
    }
  }
  return found;
}

function assertionNames(program) {
  const names = new Set(["expect"]);
  walk(program, (node) => {
    if (node.type !== "ImportDeclaration" || !/^(?:node:)?assert(?:\/strict)?$/.test(String(node.source.value))) return;
    for (const specifier of node.specifiers) names.add(specifier.local.name);
  });
  return names;
}

function rootName(node) {
  let at = node;
  for (;;) {
    if (at.type === "CallExpression") at = at.callee;
    else if (at.type === "MemberExpression") at = at.object;
    else if (at.type === "AwaitExpression") at = at.argument;
    else if (at.type === "ChainExpression") at = at.expression;
    else return at.type === "Identifier" ? at.name : null;
  }
}

const exiting = new Set(["skip", "fixme", "fail", "slow"]);

function inspectStatement(node, text, names, print) {
  let asserts = false;
  let suspicious = false;
  walk(node, (inner) => {
    if (inner.type !== "CallExpression") return;
    const root = rootName(inner.callee);
    if (root !== null && names.has(root)) asserts = true;
  });
  walk(
    node,
    (inner) => {
      if (inner.type === "CallExpression" && inner.callee.type === "MemberExpression" && exiting.has(nameOf(inner.callee.property) ?? "")) suspicious = true;
      if (inner.type === "ReturnStatement" || inner.type === "TryStatement") suspicious = true;
    },
    (child) => !fn.has(child.type),
  );
  return { key: print(node), show: brief(text.slice(node.start, node.end)), asserts, suspicious };
}

function bodyStatements(callback, text, names, printer) {
  if (callback === undefined) return { statements: [], refs: new Set() };
  return printer.within(() => {
    const [statements, refs] = printer.collect(() => {
      printer.bindParams(callback.params);
      const body = callback.body.type === "BlockStatement" ? callback.body.body : [callback.body];
      printer.hoist(body);
      return body.map((statement) => inspectStatement(statement, text, names, printer.print));
    });
    return { statements, refs };
  });
}

const bindingName = (pattern) => (pattern.type === "Identifier" ? pattern.name : squash(printNode(pattern)).slice(0, 60));

function boundNames(pattern) {
  switch (pattern?.type) {
    case "Identifier":
      return [pattern.name];
    case "ObjectPattern":
      return pattern.properties.flatMap((property) => boundNames(property.type === "RestElement" ? property.argument : property.value));
    case "ArrayPattern":
      return pattern.elements.flatMap(boundNames);
    case "AssignmentPattern":
      return boundNames(pattern.left);
    case "RestElement":
      return boundNames(pattern.argument);
    default:
      return [];
  }
}

const unwrapped = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression"]);

/** The rows of a table: an array, an object, or a call that ends in one. A row may be added, and none may go or change. */
function tableOf(node) {
  if (node?.type === "ArrayExpression") return { rows: node.elements, rebuild: () => ({ ...node, elements: [] }) };
  if (node?.type === "ObjectExpression") return { rows: node.properties, rebuild: () => ({ ...node, properties: [] }) };
  if (unwrapped.has(node?.type)) {
    const inner = tableOf(node.expression);
    return inner && { rows: inner.rows, rebuild: () => ({ ...node, expression: inner.rebuild() }) };
  }
  if (node?.type === "CallExpression" && node.arguments.length > 0) {
    const inner = tableOf(node.arguments.at(-1));
    return inner && { rows: inner.rows, rebuild: () => ({ ...node, arguments: [...node.arguments.slice(0, -1), inner.rebuild()] }) };
  }
  return null;
}

function declUnits(statement, text, names) {
  const exported = statement.type.startsWith("Export") && statement.declaration ? statement.declaration : null;
  const inner = exported ?? statement;
  const wrapper = exported ? statement.type : "";
  const unit = (key, node, extra, more = {}) => {
    const printer = jsPrinter();
    const found = inspectStatement(node, text, names, printer.unit);
    return { ...found, key, print: JSON.stringify([wrapper, extra ?? null, found.key]), refs: printer.refs, binds: [], ...more };
  };
  if (inner.type === "ImportDeclaration") {
    const source = String(inner.source.value);
    const here = (key, node, imported, binds) => ({ key, print: `${source}|${imported}|${inner.importKind}|${node.importKind ?? ""}`, show: brief(text.slice(node.start, node.end)), asserts: false, suspicious: false, refs: new Set(), binds, from: { source, imported, namespace: imported === "*" } });
    if (inner.specifiers.length === 0) return [{ ...here(`side-effect-import:${source}`, inner, "", []), effect: true }];
    return inner.specifiers.map((specifier) => {
      const imported = specifier.type === "ImportNamespaceSpecifier" ? "*" : specifier.type === "ImportDefaultSpecifier" ? "default" : nameOf(specifier.imported);
      return here(`import:${specifier.local.name}`, specifier, imported, [specifier.local.name]);
    });
  }
  if (inner.type === "ClassDeclaration") {
    const name = inner.id?.name ?? "default";
    const members = inner.body.body.map((member, at) => {
      const own = !member.computed && nameOf(member.key) !== null ? [`.${nameOf(member.key)}`] : [];
      return unit(`class:${name}.${nameOf(member.key) ?? `#${at}`}${member.static ? ":static" : ""}`, member, undefined, { binds: own });
    });
    return [{ ...unit(`class:${name}`, { ...inner, body: null }, undefined, { binds: [name] }), asserts: false }, ...members];
  }
  if (inner.type === "FunctionDeclaration") return [unit(`fn:${inner.id?.name ?? "default"}`, inner, undefined, { binds: inner.id ? [inner.id.name] : [] })];
  if (inner.type === "VariableDeclaration") {
    return inner.declarations.map((declarator) => {
      const whole = unit(`var:${bindingName(declarator.id)}`, declarator, inner.kind, { binds: boundNames(declarator.id) });
      const table = tableOf(declarator.init);
      if (table === null) return whole;
      const printer = jsPrinter();
      const rows = table.rows.map((row) => printer.print(row));
      return { ...whole, rows, print: JSON.stringify([wrapper, inner.kind, printer.unit({ ...declarator, init: table.rebuild() })]), refs: printer.refs };
    });
  }
  if (/^TS(?:TypeAlias|Interface|Enum)Declaration$/.test(inner.type)) return [unit(`type:${inner.id.name}`, inner)];
  return [unit(`stmt:${squash(text.slice(inner.start, inner.end)).slice(0, 80)}`, inner, undefined, { effect: true })];
}

function nodeTestCalls(program) {
  const local = new Map();
  walk(program, (node) => {
    if (node.type !== "ImportDeclaration" || !/^node:test$/.test(String(node.source.value))) return;
    for (const specifier of node.specifiers) if (specifier.type === "ImportSpecifier") local.set(specifier.local.name, nameOf(specifier.imported));
    for (const specifier of node.specifiers) if (specifier.type === "ImportDefaultSpecifier") local.set(specifier.local.name, "test");
  });
  const calls = new Set();
  walk(program, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = node.callee;
    const head = callee.type === "Identifier" ? callee : callee.type === "MemberExpression" && callee.object.type === "Identifier" ? callee.object : null;
    if (head === null || !local.has(head.name)) return;
    if (!["test", "it", "describe", "suite"].includes(local.get(head.name))) return;
    if (node.arguments.length >= 2 || (node.arguments.length === 1 && callee.type === "MemberExpression")) calls.add(node);
  });
  return calls;
}

function jsFile({ path, text, program, calls, names }) {
  const tests = new Map();
  const decls = new Map();
  const seen = new Map();
  const add = (map, unit, key) => {
    const times = (seen.get(key) ?? 0) + 1;
    seen.set(key, times);
    map.set(times === 1 ? key : `${key}#${times}`, unit);
  };
  const registering = (node) => calls.has(node);
  const holdsRegistration = (node) => {
    let found = false;
    walk(node, (inner) => {
      if (registering(inner)) found = true;
    });
    return found;
  };
  const visit = (node, scope, inherited, shared) => {
    if (registering(node)) {
      const segments = spell(node.callee).split(".");
      const mods = [...segments.filter((word) => modWords.has(word)), ...optionMods(node.arguments)];
      const callback = [...node.arguments].reverse().find((arg) => fn.has(arg.type));
      const title = titleOf(node.arguments[0], text);
      if (segments.some((word) => groupWords.has(word))) {
        const inner = [...scope, title];
        const passed = [...inherited, ...mods];
        if (callback?.body.type === "BlockStatement") {
          const printer = shared ?? jsPrinter();
          printer.within(() => {
            const setup = callback.body.body.filter((statement) => !holdsRegistration(statement));
            if (setup.length > 0) {
              const id = `${path} > ${inner.join(" > ")} (setup)`;
              const [statements, refs] = printer.collect(() => {
                printer.hoist(setup);
                return setup.map((statement) => inspectStatement(statement, text, names, printer.print));
              });
              add(tests, { id, mods: [], setup: true, statements, refs }, id);
            }
            for (const statement of callback.body.body) visit(statement, inner, passed, printer);
          });
        }
        return;
      }
      const id = `${path} > ${[...scope, title].join(" > ")}`;
      const { statements, refs } = bodyStatements(callback, text, names, shared ?? jsPrinter());
      add(tests, { id, mods: [...inherited, ...mods], setup: false, statements, refs }, id);
      return;
    }
    for (const child of kids(node)) visit(child, scope, inherited, shared);
  };
  for (const statement of program.body) {
    if (holdsRegistration(statement)) visit(statement, [], [], null);
    else for (const unit of declUnits(statement, text, names)) add(decls, unit, unit.key);
  }
  for (const unit of tests.values()) unit.bodyKey = JSON.stringify(unit.statements.map((statement) => statement.key));
  return { tests, decls };
}

/** A value glance built: a Gleam custom type, list, option or plain value. */
const isSpan = (value) => value?.constructor?.name === "Span";

const gleamKids = (value) => {
  if (value === null || typeof value !== "object") return [];
  if (typeof value[Symbol.iterator] === "function") return [...value];
  return Object.entries(value).filter(([, inner]) => !isSpan(inner)).map(([, inner]) => inner);
};

function gleamWalk(value, visit) {
  visit(value);
  for (const child of gleamKids(value)) gleamWalk(child, visit);
}

const spanOf = (value) => value?.location ?? value?.[0]?.location;

function gleamFile({ path, text, module }) {
  const bytes = Buffer.from(text);
  const should = new Set();
  for (const definition of module.imports) {
    const found = definition.definition;
    if (found.module !== "gleeunit/should") continue;
    const alias = found.alias;
    should.add(alias?.[0]?.[0] ?? alias?.[0] ?? "should");
  }
  const asserting = (statement) => {
    let found = false;
    gleamWalk(statement, (inner) => {
      const kind = inner?.constructor?.name;
      if (kind === "Assert") found = true;
      if (kind === "Assignment" && inner.kind?.constructor?.name === "LetAssert") found = true;
      if (kind === "FieldAccess" && inner.container?.constructor?.name === "Variable" && should.has(inner.container.name)) found = true;
    });
    return found;
  };
  const guarding = (statement) => statement?.constructor?.name === "Use" && /guard/.test(printGleam(statement.function));
  const statementsOf = (body, parameters = []) => {
    const printer = gleamPrinter();
    printer.parameters(parameters);
    const statements = [...body].map((statement) => {
      const span = spanOf(statement);
      return { key: printer.print(statement), show: span ? brief(bytes.subarray(span.start, span.end).toString()) : "?", asserts: asserting(statement), suspicious: guarding(statement) };
    });
    return { statements, refs: printer.refs };
  };
  const tests = new Map();
  const decls = new Map();
  const runs = /_test\.gleam$/.test(path);
  const declare = (key, print, show, more = {}) => decls.set(key, { key, print, show, asserts: false, refs: new Set(), binds: [], ...more });
  for (const definition of module.functions) {
    const found = definition.definition;
    const { statements, refs } = statementsOf(found.body, found.parameters);
    if (runs && found.name.endsWith("_test") && found.publicity.constructor.name === "Public") {
      const id = `${path}::${found.name}`;
      tests.set(id, { id, mods: [], setup: false, statements, refs, bodyKey: JSON.stringify(statements.map((statement) => statement.key)) });
    } else {
      const printer = gleamPrinter();
      declare(`fn:${found.name}`, printer.print(definition), found.name, { asserts: statements.some((statement) => statement.asserts), refs: printer.refs, binds: [found.name] });
    }
  }
  for (const definition of module.imports) {
    const found = definition.definition;
    const alias = found.alias;
    const local = alias === undefined || alias === null || alias[0] === undefined ? found.module.split("/").at(-1) : alias[0][0];
    declare(`import:${local}`, `${found.module} as ${local}`, found.module, { binds: [local], from: { module: found.module, namespace: true } });
    for (const value of found.unqualified_values) {
      const bound = value.alias?.[0] ?? value.name;
      declare(`import-value:${bound}`, `${found.module}.${value.name}`, `${found.module}.${value.name}`, { binds: [bound], from: { module: found.module, imported: value.name, namespace: false } });
    }
  }
  for (const definition of module.constants) {
    const found = definition.definition;
    const printer = gleamPrinter();
    const whole = printer.print(definition);
    const listed = found.value?.constructor?.name === "List" && found.value.rest?.[0] === undefined;
    const rows = listed ? [...found.value.elements].map(printer.print) : undefined;
    const frame = listed ? `${printer.print(definition.attributes)}|${found.name}|${printer.print(found.publicity)}|${printer.print(found.annotation)}|list` : whole;
    declare(`const:${found.name}`, frame, found.name, { refs: printer.refs, binds: [found.name], rows });
  }
  for (const definition of module.custom_types) declare(`type:${definition.definition.name}`, printGleam(definition), definition.definition.name);
  for (const definition of module.type_aliases) declare(`alias:${definition.definition.name}`, printGleam(definition), definition.definition.name);
  return { tests, decls };
}

const normalised = (path, text) => {
  if (path.endsWith(".json")) {
    try {
      return JSON.stringify(JSON.parse(text));
    } catch {}
  }
  return text.replace(/[ \t]+$/gm, "").replace(/\n+$/, "");
};

/** One entry per judged file: its role, its tests and what they call, or why it could not be read. */
export function inventoryOf(files, parsers) {
  const found = new Map();
  const e2eFiles = [...files.keys()].filter((path) => path.startsWith("e2e/") && /\.[cm]?[jt]sx?$/.test(path) && !/\.d\.[cm]?ts$/.test(path) && !/^e2e\/[^/]+\.config\.[cm]?[jt]s$/.test(path));
  const programs = new Map();
  const failed = new Map();
  const parse = (path) => {
    const result = parsers.oxc(path, files.get(path));
    if (result.errors.length > 0) failed.set(path, result.errors[0].message);
    return result.errors.length > 0 ? null : result.program;
  };
  for (const path of e2eFiles) {
    const program = parse(path);
    if (program !== null) programs.set(path.slice("e2e/".length), program);
  }
  const resolve = bindings(programs);
  for (const [path, text] of files) {
    const role = roleOf(path);
    const entry = { path, role, tests: new Map(), decls: new Map(), unreadable: null, text: normalised(path, text), data: !isCode(path), byName: new Map() };
    found.set(path, entry);
    if (!isCode(path)) continue;
    if (path.endsWith(".gleam")) {
      const parsed = parsers.glance.module(text);
      if (!parsed.isOk()) {
        entry.unreadable = `glance cannot parse it (${String(parsed[0]?.constructor?.name ?? "error")})`;
        continue;
      }
      Object.assign(entry, gleamFile({ path, text, module: parsed[0] }));
      continue;
    }
    const inE2e = programs.has(path.slice("e2e/".length)) && path.startsWith("e2e/");
    const program = inE2e ? programs.get(path.slice("e2e/".length)) : failed.has(path) ? null : parse(path);
    if (program === null || program === undefined) {
      entry.unreadable = failed.get(path) ?? "cannot be parsed";
      continue;
    }
    const names = assertionNames(program);
    const calls = new Set(inE2e ? registeredCalls(program, resolve(path.slice("e2e/".length))) : nodeTestCalls(program));
    Object.assign(entry, jsFile({ path, text, program, calls, names }));
  }
  for (const entry of found.values()) {
    for (const [key, unit] of entry.decls) for (const bound of unit.binds ?? []) if (!bound.startsWith(".")) entry.byName.set(bound, [...(entry.byName.get(bound) ?? []), key]);
  }
  return found;
}

const EXTENSIONS = ["", ".ts", ".mts", ".mjs", ".js", ".tsx", "/index.ts", "/index.mjs", "/index.js"];

/** The judged file that an import names, or null: a Gleam module of `test/`, or a relative path. */
function moduleFile(inventory, path, from) {
  if (from.module !== undefined) return inventory.has(`test/${from.module}.gleam`) ? `test/${from.module}.gleam` : null;
  if (!from.source.startsWith(".")) return null;
  const joined = posix.normalize(posix.join(posix.dirname(path), from.source));
  const bare = joined.replace(/\.[cm]?[jt]sx?$/, "");
  return [...EXTENSIONS.map((extension) => joined + extension), ...EXTENSIONS.slice(1).map((extension) => bare + extension)].find((candidate) => inventory.has(candidate)) ?? null;
}

/**
 * Every top-level declaration that a test reads, as `path::key`: what its statements name, what those
 * name in turn, through imports into other judged files, and the methods of a class that a test
 * calls (a call on an object is followed by the name of the method). A statement at the top of a
 * test file, or of a file that a test reaches, runs with the tests and is read by them.
 */
export function readBy(inventory) {
  const members = new Map();
  for (const [path, entry] of inventory) for (const [key, unit] of entry.decls) for (const bound of unit.binds ?? []) if (bound.startsWith(".")) members.set(bound, [...(members.get(bound) ?? []), [path, key]]);
  const reached = new Set();
  const loaded = new Set();
  const queue = [];
  const load = (path) => {
    if (loaded.has(path)) return;
    loaded.add(path);
    for (const [key, unit] of inventory.get(path).decls) if (unit.effect) reach(path, key);
  };
  const reach = (path, key) => {
    if (reached.has(`${path}::${key}`)) return;
    reached.add(`${path}::${key}`);
    queue.push([path, key]);
    load(path);
  };
  const follow = (path, refs) => {
    const entry = inventory.get(path);
    for (const ref of refs) {
      if (ref.startsWith(".")) {
        for (const [where, key] of members.get(ref) ?? []) reach(where, key);
        continue;
      }
      const dot = ref.indexOf(".");
      for (const key of entry.byName.get(dot < 0 ? ref : ref.slice(0, dot)) ?? []) {
        if (dot < 0) reach(path, key);
        else if (entry.decls.get(key).from?.namespace) {
          const target = moduleFile(inventory, path, entry.decls.get(key).from);
          for (const inside of target === null ? [] : (inventory.get(target).byName.get(ref.slice(dot + 1)) ?? [])) reach(target, inside);
        }
      }
    }
  };
  for (const [path, entry] of inventory) {
    if (entry.role !== "test") continue;
    load(path);
    for (const test of entry.tests.values()) follow(path, test.refs ?? []);
  }
  for (let at = 0; at < queue.length; at++) {
    const [path, key] = queue[at];
    const unit = inventory.get(path).decls.get(key);
    follow(path, unit.refs ?? []);
    if (unit.from === undefined) continue;
    const target = moduleFile(inventory, path, unit.from);
    if (target === null) continue;
    load(target);
    if (!unit.from.namespace) for (const inside of inventory.get(target).byName.get(unit.from.imported) ?? []) reach(target, inside);
  }
  return reached;
}

/** A unit changed when it is gone or prints otherwise. A table may gain rows unless `strict`. */
function changed(unit, next, strict) {
  if (next === undefined || next.print !== unit.print) return true;
  if (unit.rows === undefined) return false;
  if (next.rows === undefined) return true;
  if (strict) return unit.rows.length !== next.rows.length || unit.rows.some((row, at) => row !== next.rows[at]);
  let at = 0;
  for (const row of next.rows) if (at < unit.rows.length && row === unit.rows[at]) at++;
  return at < unit.rows.length;
}

const rank = (mods) => mods.filter((word) => weakWords.has(word)).length;

function weaker(base, branch) {
  const reasons = [];
  let at = 0;
  const added = [];
  for (const statement of branch.statements) {
    if (at < base.statements.length && statement.key === base.statements[at].key) at++;
    else added.push(statement);
  }
  if (at < base.statements.length) {
    const lost = base.statements[at];
    reasons.push(`${lost.asserts ? "an assertion" : "a statement"} was removed or changed: ${lost.show}`);
  }
  const exit = added.find((statement) => statement.suspicious);
  if (exit) reasons.push(`a new early exit, skip or try was added: ${exit.show}`);
  if (rank(branch.mods) > rank(base.mods)) reasons.push(`it is now marked ${branch.mods.filter((word) => weakWords.has(word)).join(", ")}`);
  return reasons.join("; ");
}

/**
 * What the branch's judges lost or changed since the base's. A test may grow, so new tests,
 * new statements and new assertions are free. It may not shrink: each statement of a base
 * test must still be there, in order, unchanged. A test whose body is the same under another
 * name was moved. What decides (`gate` files) may not be changed at all, only added to.
 */
export function compare(base, branch) {
  const items = [];
  const notes = [];
  const bodies = new Set([...branch.values()].flatMap((entry) => [...entry.tests.values()].map((unit) => unit.bodyKey)));
  const read = readBy(base);
  const kept = new Set([...branch.values()].flatMap((entry) => [...entry.decls].map(([key, unit]) => `${key}|${unit.print}`)));
  for (const [path, was] of base) {
    const now = branch.get(path);
    if (now === undefined) {
      const lost = [...was.tests.values()].filter((unit) => unit.setup || !bodies.has(unit.bodyKey)).length;
      const asserting = [...was.decls].some(([key, unit]) => (unit.asserts || read.has(`${path}::${key}`)) && !kept.has(`${key}|${unit.print}`));
      if (was.role === "gate" || was.data || lost > 0 || asserting) items.push({ file: path, id: path, what: "removed-file", why: lost > 0 ? `the file is gone, with ${lost} test${lost === 1 ? "" : "s"}` : "the file is gone" });
      continue;
    }
    if (now.unreadable !== null) {
      items.push({ file: path, id: path, what: "unreadable", why: `${now.unreadable}, so what it still asserts cannot be told` });
      continue;
    }
    if (was.data || (was.role === "gate" && was.decls.size === 0 && was.tests.size === 0)) {
      if (was.text !== now.text) items.push({ file: path, id: path, what: "changed-gate", why: "the file changed" });
      continue;
    }
    if (was.role === "gate") {
      for (const [key, unit] of was.decls) {
        const next = now.decls.get(key);
        if (!changed(unit, next, true)) continue;
        items.push({ file: path, id: `${path}::${key}`, what: "changed-gate", why: `${unit.show ?? key} ${next === undefined ? "is gone" : "changed"}` });
      }
      continue;
    }
    for (const unit of was.tests.values()) {
      const next = now.tests.get(unit.id);
      if (next === undefined) {
        if (!unit.setup && bodies.has(unit.bodyKey)) continue;
        items.push({ file: path, id: unit.id, what: unit.setup ? "weakened-test" : "removed-test", why: unit.setup ? "the setup of the group is gone" : "no test of this name is left in the file" });
        continue;
      }
      const why = weaker(unit, next);
      if (why !== "") items.push({ file: path, id: unit.id, what: "weakened-test", why });
    }
    for (const [key, unit] of was.decls) {
      const next = now.decls.get(key);
      if (!changed(unit, next, false)) continue;
      const what = next === undefined ? "gone" : "changed";
      const id = `${path}::${key}`;
      if (unit.asserts) items.push({ file: path, id, what: "weakened-helper", why: `${unit.show ?? key}, which asserts, is ${what}` });
      else if (read.has(id)) items.push({ file: path, id, what: "changed-input", why: `${unit.show ?? key}, which a test of main's reads, is ${what}` });
      else notes.push(`${id} is ${what}`);
    }
  }
  return { items, notes };
}
