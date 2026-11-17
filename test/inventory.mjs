import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { bindings, registeredCalls } from "./e2e_discovery.mjs";

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
const hidden = new Set(["start", "end", "range", "loc", "raw", "location"]);
const printNode = (node) => JSON.stringify(node, (key, value) => (hidden.has(key) ? undefined : value));
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

function inspectStatement(node, text, names) {
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
  return { key: printNode(node), show: brief(text.slice(node.start, node.end)), asserts, suspicious };
}

function bodyStatements(callback, text, names) {
  if (callback === undefined) return [];
  const body = callback.body.type === "BlockStatement" ? callback.body.body : [callback.body];
  return body.map((statement) => inspectStatement(statement, text, names));
}

const bindingName = (pattern) => (pattern.type === "Identifier" ? pattern.name : squash(printNode(pattern)).slice(0, 60));

function declUnits(statement, text, names) {
  const exported = statement.type.startsWith("Export") && statement.declaration ? statement.declaration : null;
  const inner = exported ?? statement;
  const wrapper = exported ? statement.type : "";
  const unit = (key, node, extra) => ({ ...inspectStatement(node, text, names), key, print: printNode([wrapper, extra ?? null, node]) });
  if (inner.type === "ImportDeclaration") return [unit(`import:${inner.source.value}`, inner)];
  if (inner.type === "ClassDeclaration") {
    const name = inner.id?.name ?? "default";
    const members = inner.body.body.map((member, at) => unit(`class:${name}.${nameOf(member.key) ?? `#${at}`}${member.static ? ":static" : ""}`, member));
    return [{ ...unit(`class:${name}`, { ...inner, body: null }), asserts: false }, ...members];
  }
  if (inner.type === "FunctionDeclaration") return [unit(`fn:${inner.id?.name ?? "default"}`, inner)];
  if (inner.type === "VariableDeclaration") return inner.declarations.map((declarator) => unit(`var:${bindingName(declarator.id)}`, declarator, inner.kind));
  if (/^TS(?:TypeAlias|Interface|Enum)Declaration$/.test(inner.type)) return [unit(`type:${inner.id.name}`, inner)];
  return [unit(`stmt:${squash(text.slice(inner.start, inner.end)).slice(0, 80)}`, inner)];
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
  const visit = (node, scope, inherited = []) => {
    if (registering(node)) {
      const segments = spell(node.callee).split(".");
      const mods = [...segments.filter((word) => modWords.has(word)), ...optionMods(node.arguments)];
      const callback = [...node.arguments].reverse().find((arg) => fn.has(arg.type));
      const title = titleOf(node.arguments[0], text);
      if (segments.some((word) => groupWords.has(word))) {
        const inner = [...scope, title];
        const passed = [...inherited, ...mods];
        if (callback?.body.type === "BlockStatement") {
          const setup = callback.body.body.filter((statement) => !holdsRegistration(statement));
          if (setup.length > 0) {
            const id = `${path} > ${inner.join(" > ")} (setup)`;
            add(tests, { id, mods: [], setup: true, statements: setup.map((statement) => inspectStatement(statement, text, names)) }, id);
          }
          for (const statement of callback.body.body) visit(statement, inner, passed);
        }
        return;
      }
      const id = `${path} > ${[...scope, title].join(" > ")}`;
      const statements = bodyStatements(callback, text, names);
      add(tests, { id, mods: [...inherited, ...mods], setup: false, statements }, id);
      return;
    }
    for (const child of kids(node)) visit(child, scope, inherited);
  };
  for (const statement of program.body) {
    if (holdsRegistration(statement)) visit(statement, [], []);
    else for (const unit of declUnits(statement, text, names)) add(decls, unit, unit.key);
  }
  for (const unit of tests.values()) unit.bodyKey = JSON.stringify(unit.statements.map((statement) => statement.key));
  return { tests, decls };
}

/** A value glance built: a Gleam custom type, list, option or plain value. */
const gleamKids = (value) => {
  if (value === null || typeof value !== "object") return [];
  if (typeof value[Symbol.iterator] === "function") return [...value];
  return Object.entries(value).filter(([key]) => key !== "location").map(([, inner]) => inner);
};

export function printGleam(value) {
  if (value === null || value === undefined) return "-";
  if (typeof value !== "object") return JSON.stringify(value);
  if (typeof value[Symbol.iterator] === "function") return `[${[...value].map(printGleam).join(",")}]`;
  const fields = Object.entries(value).filter(([key]) => key !== "location");
  return `${value.constructor.name}(${fields.map(([key, inner]) => `${key}=${printGleam(inner)}`).join(",")})`;
}

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
  const statementsOf = (body) =>
    [...body].map((statement) => {
      const span = spanOf(statement);
      return { key: printGleam(statement), show: span ? brief(bytes.subarray(span.start, span.end).toString()) : "?", asserts: asserting(statement), suspicious: guarding(statement) };
    });
  const tests = new Map();
  const decls = new Map();
  const runs = /_test\.gleam$/.test(path);
  for (const definition of module.functions) {
    const found = definition.definition;
    const statements = statementsOf(found.body);
    if (runs && found.name.endsWith("_test") && found.publicity.constructor.name === "Public") {
      const id = `${path}::${found.name}`;
      tests.set(id, { id, mods: [], setup: false, statements, bodyKey: JSON.stringify(statements.map((statement) => statement.key)) });
    } else {
      decls.set(`fn:${found.name}`, { key: `fn:${found.name}`, print: printGleam(found), asserts: statements.some((statement) => statement.asserts), show: found.name });
    }
  }
  const plain = (kind, list, name) => {
    for (const definition of list) decls.set(`${kind}:${name(definition.definition)}`, { key: `${kind}:${name(definition.definition)}`, print: printGleam(definition), asserts: false, show: name(definition.definition) });
  };
  plain("import", module.imports, (found) => found.module);
  plain("const", module.constants, (found) => found.name);
  plain("type", module.custom_types, (found) => found.name);
  plain("alias", module.type_aliases, (found) => found.name);
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
    const entry = { path, role, tests: new Map(), decls: new Map(), unreadable: null, text: normalised(path, text) };
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
  return found;
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
  for (const [path, was] of base) {
    const now = branch.get(path);
    if (now === undefined) {
      const lost = [...was.tests.values()].filter((unit) => unit.setup || !bodies.has(unit.bodyKey)).length;
      const asserting = [...was.decls.values()].some((unit) => unit.asserts);
      if (was.role === "gate" || lost > 0 || asserting) items.push({ file: path, id: path, what: "removed-file", why: lost > 0 ? `the file is gone, with ${lost} test${lost === 1 ? "" : "s"}` : "the file is gone" });
      continue;
    }
    if (now.unreadable !== null) {
      items.push({ file: path, id: path, what: "unreadable", why: `${now.unreadable}, so what it still asserts cannot be told` });
      continue;
    }
    if (was.role === "gate") {
      if (was.decls.size === 0 && was.tests.size === 0) {
        if (was.text !== now.text) items.push({ file: path, id: path, what: "changed-gate", why: "the file changed" });
        continue;
      }
      for (const [key, unit] of was.decls) {
        const next = now.decls.get(key);
        if (next === undefined) items.push({ file: path, id: `${path}::${key}`, what: "changed-gate", why: `${unit.show ?? key} is gone` });
        else if (next.print !== unit.print) items.push({ file: path, id: `${path}::${key}`, what: "changed-gate", why: `${unit.show ?? key} changed` });
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
      if (next !== undefined && next.print === unit.print) continue;
      const what = next === undefined ? "gone" : "changed";
      if (unit.asserts) items.push({ file: path, id: `${path}::${key}`, what: "weakened-helper", why: `${unit.show ?? key}, which asserts, is ${what}` });
      else notes.push(`${path}::${key} is ${what}`);
    }
  }
  return { items, notes };
}
