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

const excluded = (path) => /\.md$/.test(path) || path === "test/pick_map.json" || /^e2e\/(?:node_modules|\.e2e)\//.test(path) || /^e2e\/package-lock\.json$/.test(path);

export const COUNTS = "test/test_counts.json";

/** What is judged by what it says, not by the code in it: the counts of tests, and the scripts of a package. */
export const ofValues = (path) => path === COUNTS || /(?:^|\/)package\.json$/.test(path);

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

/** A property that marks a test or a row: it says skip, fixme, fail, todo or only. */
const isMark = (property) => property.type === "Property" && !property.computed && (weakWords.has(nameOf(property.key) ?? "") || nameOf(property.key) === "only");

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
      if (key !== null && (weakWords.has(key) || key === "only")) found.push(key);
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
const switches = new Set([...exiting, "only", "configure"]);
const testRoots = new Set(["test", "it", "describe", "suite"]);
const ofTestApi = (node) => testRoots.has(rootName(node) ?? "");
const hookNames = new Set(["beforeEach", "afterEach", "beforeAll", "afterAll"]);

/** A call that runs around every test of its file or group: a hook, or `test.use`. */
const hooks = (node) =>
  node.type === "CallExpression" &&
  ((node.callee.type === "Identifier" && hookNames.has(node.callee.name)) ||
    (node.callee.type === "MemberExpression" && !node.callee.computed && (hookNames.has(nameOf(node.callee.property) ?? "") || nameOf(node.callee.property) === "use") && ofTestApi(node.callee.object)));

/** A statement that, anywhere in it, takes a skip, a fixme, an only or a configure out of the test API. */
function switchesOff(node) {
  let found = false;
  walk(node, (inner) => {
    if (inner.type === "MemberExpression" && !inner.computed && switches.has(nameOf(inner.property) ?? "") && ofTestApi(inner.object)) found = true;
    if (inner.type === "VariableDeclarator" && inner.id.type === "ObjectPattern" && inner.init && ofTestApi(inner.init)) {
      if (inner.id.properties.some((property) => property.type === "Property" && switches.has(nameOf(property.key) ?? ""))) found = true;
    }
  });
  return found;
}

function inspectStatement(node, text, names, printer, how = "print") {
  let asserts = false;
  const off = switchesOff(node);
  let suspicious = off;
  walk(node, (inner) => {
    if (inner.type !== "CallExpression") return;
    const root = rootName(inner.callee);
    if (root !== null && names.has(root)) asserts = true;
  });
  walk(
    node,
    (inner) => {
      if (inner.type === "CallExpression" && inner.callee.type === "MemberExpression" && exiting.has(nameOf(inner.callee.property) ?? "") && ofTestApi(inner.callee.object)) suspicious = true;
      if (inner.type === "ReturnStatement" || inner.type === "TryStatement" || hooks(inner)) suspicious = true;
    },
    (child) => !fn.has(child.type),
  );
  const key = printer[how](node);
  const { reads, writes, shares } = printer.touched();
  if (shares.size > 0) suspicious = true;
  return { key, show: brief(text.slice(node.start, node.end)), asserts, suspicious, off, reads, writes };
}

function bodyStatements(callback, text, names, printer) {
  if (callback === undefined) return { statements: [], refs: new Set() };
  return printer.within(() => {
    const [statements, refs] = printer.collect(() => {
      printer.bindParams(callback.params);
      const body = callback.body.type === "BlockStatement" ? callback.body.body : [callback.body];
      printer.hoist(body);
      return body.map((statement) => inspectStatement(statement, text, names, printer));
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

const isFieldInit = (statement) => {
  const left = statement.type === "ExpressionStatement" && statement.expression.type === "AssignmentExpression" && statement.expression.operator === "=" ? statement.expression.left : null;
  return left?.type === "MemberExpression" && left.object.type === "ThisExpression" && !left.computed && left.property.type === "Identifier" ? left.property.name : null;
};

/**
 * A constructor is a table of its statements. One may gain `this.name = value` for a field that no
 * other statement sets, which a new locator is. Any other statement put in it, and a field set twice, switch to a change.
 */
function constructorRows(member) {
  const body = member.value.body.body;
  const printer = jsPrinter();
  const rows = printer.within(() => {
    printer.bindParams(member.value.params);
    printer.hoist(body);
    return body.map((statement) => printer.print(statement));
  });
  const sets = body.map(isFieldInit);
  const switching = body.flatMap((statement, at) => (sets[at] !== null && sets.filter((name) => name === sets[at]).length === 1 ? [] : [rows[at]]));
  const frame = jsPrinter();
  const emptied = { ...member, value: { ...member.value, body: { ...member.value.body, body: [] } } };
  return { rows, switching, print: JSON.stringify([null, null, frame.unit(emptied)]) };
}

function declUnits(statement, text, names) {
  const exported = statement.type.startsWith("Export") && statement.declaration ? statement.declaration : null;
  const inner = exported ?? statement;
  const wrapper = exported && statement.type === "ExportDefaultDeclaration" ? statement.type : "";
  const unit = (key, node, extra, more = {}) => {
    const printer = jsPrinter();
    const found = inspectStatement(node, text, names, printer, "unit");
    return { ...found, key, print: JSON.stringify([wrapper, extra ?? null, found.key]), refs: printer.refs, binds: [], disables: found.off, ...more };
  };
  if (inner.type === "ImportDeclaration") {
    const source = String(inner.source.value);
    const here = (key, node, imported, binds) => ({ key, print: `${source}|${imported}|${inner.importKind}|${node.importKind ?? ""}`, show: brief(text.slice(node.start, node.end)), asserts: false, suspicious: false, refs: new Set(), binds, from: { source, imported, namespace: imported === "*" }, disables: false });
    if (inner.specifiers.length === 0) return [{ ...here(`side-effect-import:${source}`, inner, "", []), effect: true, disables: true }];
    return inner.specifiers.map((specifier) => {
      const imported = specifier.type === "ImportNamespaceSpecifier" ? "*" : specifier.type === "ImportDefaultSpecifier" ? "default" : nameOf(specifier.imported);
      return here(`import:${specifier.local.name}`, specifier, imported, [specifier.local.name]);
    });
  }
  if (inner.type === "ClassDeclaration") {
    const name = inner.id?.name ?? "default";
    const members = inner.body.body.map((member, at) => {
      const own = !member.computed && nameOf(member.key) !== null ? [`.${nameOf(member.key)}`] : [];
      const found = unit(`class:${name}.${nameOf(member.key) ?? `#${at}`}${member.static ? ":static" : ""}`, member, undefined, { binds: own });
      return member.type === "MethodDefinition" && member.kind === "constructor" ? { ...found, ...constructorRows(member) } : found;
    });
    const built = members.filter((member) => member.key.endsWith(".constructor")).map((member) => member.key);
    return [{ ...unit(`class:${name}`, { ...inner, body: null }, undefined, { binds: [name] }), asserts: false, alongside: built }, ...members];
  }
  if (inner.type === "FunctionDeclaration") return [unit(`fn:${inner.id?.name ?? "default"}`, inner, undefined, { binds: inner.id ? [inner.id.name] : [] })];
  if (inner.type === "VariableDeclaration") {
    return inner.declarations.map((declarator) => {
      const whole = unit(`var:${bindingName(declarator.id)}`, declarator, inner.kind, { binds: boundNames(declarator.id) });
      const table = tableOf(declarator.init);
      if (table === null) return whole;
      const printer = jsPrinter();
      const rows = table.rows.map((row) => printer.print(row));
      const switching = table.rows.flatMap((row, at) => (isMark(row) ? [rows[at]] : []));
      return { ...whole, rows, switching, print: JSON.stringify([wrapper, inner.kind, printer.unit({ ...declarator, init: table.rebuild() })]), refs: printer.refs };
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

const exits = new Set(["ContinueStatement", "BreakStatement", "ReturnStatement", "ThrowStatement"]);

/** A statement that, outside any function in it, can leave the code after it undone. */
function leaves(node) {
  let found = false;
  walk(
    node,
    (inner) => {
      if (exits.has(inner.type)) found = true;
    },
    (child) => !fn.has(child.type),
  );
  return found;
}

/**
 * What a test is run inside: the loops, conditions and calls that enclose its registration, as
 * headers, and the statements before it in each block it is in. A header that changes is a change,
 * a header over an array may gain rows, and a statement may be added unless it can skip the test.
 * Printing binds the locals that the headers declare, so the test body reads them as locals.
 */
function aroundOf(node, child, text, printer) {
  const [made, refs] = printer.collect(() => {
    const table = (expression) => {
      const found = tableOf(expression);
      return found === null ? { frame: printer.print(expression) } : { frame: printer.print(found.rebuild()), rows: found.rows.map((row) => printer.print(row)) };
    };
    const head = (parts, rows) => ({ key: parts.join("|"), rows });
    switch (node.type) {
      case "ForStatement":
        return child === node.body ? head(["for", printer.print(node.init), printer.print(node.test), printer.print(node.update)]) : null;
      case "ForOfStatement":
      case "ForInStatement": {
        if (child !== node.body) return null;
        const left = printer.print(node.left);
        const right = table(node.right);
        return head([node.type, node.await ?? false, left, right.frame], right.rows);
      }
      case "WhileStatement":
      case "DoWhileStatement":
        return child === node.body ? head([node.type, printer.print(node.test)]) : null;
      case "IfStatement":
      case "ConditionalExpression":
        return child === node.test ? null : head([node.type, printer.print(node.test), child === node.consequent ? "then" : "else"]);
      case "LogicalExpression":
        return child === node.right ? head([node.type, node.operator, printer.print(node.left)]) : null;
      case "SwitchStatement":
        return child === node.discriminant ? null : head([node.type, printer.print(node.discriminant)]);
      case "SwitchCase":
        return child === node.test ? null : head([node.type, printer.print(node.test)]);
      case "CallExpression": {
        if (!fn.has(child.type)) return null;
        const callee = node.callee.type === "MemberExpression" && !node.callee.computed ? { object: table(node.callee.object), property: nameOf(node.callee.property) } : { object: { frame: printer.print(node.callee) }, property: "" };
        const others = node.arguments.filter((arg) => arg !== child).map((arg) => printer.print(arg));
        return head([node.type, callee.object.frame, callee.property, ...others], callee.object.rows);
      }
      default:
        return null;
    }
  });
  printer.touched();
  if (made === null) return [];
  return [{ key: made.key, rows: made.rows, show: brief(text.slice(node.start, child.start)), suspicious: true, refs }];
}

function statementEntry(statement, text, names, printer) {
  const [found, refs] = printer.collect(() => inspectStatement(statement, text, names, printer));
  return { key: found.key, show: found.show, suspicious: found.suspicious || leaves(statement), refs };
}

/**
 * What a test or group is given besides its title and its callback, printed, and the names that it
 * reads. The marks (`skip`, `fixme`, `fail`, `todo`, `only`) are left out, because the test's marks say them.
 */
function optionsOf(args, callback, printer) {
  const given = [];
  for (const arg of args) {
    if (arg === callback) continue;
    const marks = arg.type === "ObjectExpression" ? arg.properties.filter(isMark) : [];
    if (marks.length > 0 && marks.length === arg.properties.length) continue;
    given.push(marks.length > 0 ? { ...arg, properties: arg.properties.filter((property) => !isMark(property)) } : arg);
  }
  const [printed, refs] = printer.collect(() => given.map((arg) => printer.print(arg)));
  return { given: printed, refs };
}

function jsFile({ path, text, program, calls, names }) {
  const tests = new Map();
  const decls = new Map();
  const groups = new Map();
  const seen = new Map();
  const add = (map, unit, key) => {
    const times = (seen.get(key) ?? 0) + 1;
    seen.set(key, times);
    map.set(times === 1 ? key : `${key}#${times}`, unit);
  };
  const registering = (node) => calls.has(node);
  const holds = new WeakMap();
  const holdsRegistration = (node) => {
    if (!holds.has(node)) {
      let found = false;
      walk(node, (inner) => {
        if (registering(inner)) found = true;
      });
      holds.set(node, found);
    }
    return holds.get(node);
  };
  const visit = (node, scope, inherited, printer, around) => {
    if (registering(node)) {
      const segments = spell(node.callee).split(".");
      const mods = [...segments.filter((word) => modWords.has(word)), ...optionMods(node.arguments)];
      const callback = [...node.arguments].reverse().find((arg) => fn.has(arg.type));
      const title = titleOf(node.arguments[0], text);
      const options = optionsOf(node.arguments.slice(1), callback, printer);
      const [, titleRefs] = printer.collect(() => (node.arguments[0] === callback ? [] : [printer.print(node.arguments[0])]));
      const optionRefs = options.refs;
      printer.touched();
      if (segments.some((word) => groupWords.has(word))) {
        const inner = [...scope, title];
        const passed = { mods: [...inherited.mods, ...mods], given: [...inherited.given, ...options.given], optionRefs: new Set([...inherited.optionRefs, ...optionRefs]) };
        groups.set(`${path} > ${inner.join(" > ")}`, mods);
        if (callback?.body.type === "BlockStatement") {
          printer.within(() => {
            const setup = callback.body.body.filter((statement) => !holdsRegistration(statement));
            if (setup.length > 0) {
              const id = `${path} > ${inner.join(" > ")} (setup)`;
              const [statements, refs] = printer.collect(() => {
                printer.hoist(setup);
                return setup.map((statement) => inspectStatement(statement, text, names, printer));
              });
              add(tests, { id, mods: [], setup: true, statements, refs, given: [], around: [] }, id);
            }
            for (const statement of callback.body.body) visit(statement, inner, passed, printer, around);
          });
        }
        return;
      }
      const id = `${path} > ${[...scope, title].join(" > ")}`;
      const { statements, refs } = bodyStatements(callback, text, names, printer);
      for (const name of [...titleRefs, ...optionRefs]) refs.add(name);
      for (const entry of around) for (const name of entry.refs) refs.add(name);
      add(tests, { id, mods: [...inherited.mods, ...mods], setup: false, statements, refs, given: [...inherited.given, ...options.given], optionRefs: new Set([...inherited.optionRefs, ...optionRefs]), around }, id);
      return;
    }
    descend(node, scope, inherited, printer, around);
  };
  const descend = (node, scope, inherited, printer, around) => {
    if (node.type === "BlockStatement") {
      printer.within(() => {
        printer.hoist(node.body);
        const before = [];
        for (const statement of node.body) {
          if (holdsRegistration(statement)) visit(statement, scope, inherited, printer, [...around, ...before]);
          else before.push(statementEntry(statement, text, names, printer));
        }
      });
      return;
    }
    for (const child of kids(node).filter(holdsRegistration)) {
      printer.within(() => {
        if (fn.has(node.type) && child === node.body) printer.bindParams(node.params);
        visit(child, scope, inherited, printer, [...around, ...aroundOf(node, child, text, printer)]);
      });
    }
  };
  for (const statement of program.body) {
    if (holdsRegistration(statement)) visit(statement, [], { mods: [], given: [], optionRefs: new Set() }, jsPrinter(), []);
    else for (const unit of declUnits(statement, text, names)) add(decls, unit, unit.key);
  }
  for (const unit of tests.values()) unit.bodyKey = JSON.stringify([unit.statements.map((statement) => statement.key), unit.given, unit.around.map((entry) => [entry.key, entry.rows])]);
  return { tests, decls, groups };
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
  const guarding = (statement) => statement?.constructor?.name === "Use";
  const statementsOf = (body, parameters = []) => {
    const printer = gleamPrinter();
    printer.parameters(parameters);
    const statements = [...body].map((statement) => {
      const span = spanOf(statement);
      return { key: printer.print(statement), show: span ? brief(text.slice(span.start, span.end)) : "?", asserts: asserting(statement), suspicious: guarding(statement) };
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
      const attributes = [...definition.attributes];
      if (attributes.length > 0) statements.unshift({ key: `attributes:${printGleam(attributes)}`, show: attributes.map((attribute) => `@${attribute.name}`).join(" "), asserts: false, suspicious: true });
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
    const entry = { path, role, tests: new Map(), decls: new Map(), unreadable: null, text: normalised(path, text), data: !isCode(path), byName: new Map(), groups: new Map() };
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
 * What the code of a set of tests reads: every top-level declaration that they name, what those
 * name in turn, through imports into other judged files, and the methods of a class that they
 * call (a call on an object is followed by the name of the method). A statement at the top of a
 * test file, or of a file that a test reaches, runs with the tests and is read by them, and a class
 * that is reached is reached with its constructor. A name given to a test as its options is
 * `strict`: a const behind it may not gain a row.
 */
export function reader(inventory) {
  const members = new Map();
  for (const [path, entry] of inventory) for (const [key, unit] of entry.decls) for (const bound of unit.binds ?? []) if (bound.startsWith(".")) members.set(bound, [...(members.get(bound) ?? []), [path, key]]);
  return (seeds) => {
    const reached = new Set();
    const strict = new Set();
    const loaded = new Set();
    const queue = [];
    const load = (path) => {
      if (loaded.has(path)) return;
      loaded.add(path);
      for (const [key, unit] of inventory.get(path).decls) if (unit.effect) reach(path, key);
    };
    const reach = (path, key, tight = false) => {
      if (tight) strict.add(`${path}::${key}`);
      if (reached.has(`${path}::${key}`)) return;
      reached.add(`${path}::${key}`);
      queue.push([path, key]);
      load(path);
      for (const other of inventory.get(path).decls.get(key)?.alongside ?? []) reach(path, other);
    };
    const follow = (path, refs, tight = false) => {
      const entry = inventory.get(path);
      for (const ref of refs) {
        if (ref.startsWith(".")) {
          for (const [where, key] of members.get(ref) ?? []) reach(where, key);
          continue;
        }
        const dot = ref.indexOf(".");
        for (const key of entry.byName.get(dot < 0 ? ref : ref.slice(0, dot)) ?? []) {
          if (dot < 0) reach(path, key, tight);
          else if (entry.decls.get(key).from?.namespace) {
            const target = moduleFile(inventory, path, entry.decls.get(key).from);
            for (const inside of target === null ? [] : (inventory.get(target).byName.get(ref.slice(dot + 1)) ?? [])) reach(target, inside, tight);
          }
        }
      }
    };
    for (const { path, test } of seeds) {
      load(path);
      follow(path, test?.refs ?? []);
      follow(path, test?.optionRefs ?? [], true);
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
    return { reached, strict };
  };
}

/** What every test of every test file reads. */
export function readBy(inventory) {
  const seeds = [];
  for (const [path, entry] of inventory) if (entry.role === "test") seeds.push({ path, test: null }, ...[...entry.tests.values()].map((test) => ({ path, test })));
  return reader(inventory)(seeds);
}

/** What one test stands on, apart from where it is: the declarations it reads, as what they say. */
function standsOn(inventory, find, path, test) {
  const { reached } = find([{ path, test }]);
  return [...reached]
    .map((id) => {
      const at = id.indexOf("::");
      const unit = inventory.get(id.slice(0, at)).decls.get(id.slice(at + 2));
      return `${id.slice(at + 2)}|${unit.print}|${JSON.stringify(unit.rows ?? null)}`;
    })
    .sort()
    .join("\n");
}

/** The rows of a table that lists what is let through: a row added to it is as much a change as a row removed. */
const lets = /expected|known|allow|exempt|failures|skip/i;

/** Every row of `was` is in `now`, in order, though `now` may have more. */
function holdsRows(was, now) {
  let at = 0;
  for (const row of now) if (at < was.length && row === was[at]) at++;
  return at >= was.length;
}

/** A unit changed when it is gone or prints otherwise. A table may gain rows unless `strict`, or it lists what is let through. */
function changed(unit, next, strict) {
  if (next === undefined || next.print !== unit.print) return true;
  if (unit.rows === undefined) return false;
  if (next.rows === undefined) return true;
  if (next.switching?.some((row) => !unit.rows.includes(row))) return true;
  if (strict || (unit.binds ?? []).some((name) => lets.test(name))) return unit.rows.length !== next.rows.length || unit.rows.some((row, at) => row !== next.rows[at]);
  return !holdsRows(unit.rows, next.rows);
}

const rank = (mods) => mods.filter((word) => weakWords.has(word)).length;
const marked = (mods) => mods.filter((word) => word === "skip" || word === "fixme" || word === "only");

/** The places of `branch` that carry on `base` in order and the ones that are added, and the first item of `base` that is not carried on. */
function aligned(base, branch, same = (was, now) => was.key === now.key) {
  let at = 0;
  const kept = [];
  const added = [];
  branch.forEach((item, index) => {
    if (at < base.length && same(base[at], item)) {
      at++;
      kept.push(index);
    } else added.push(index);
  });
  return { lost: at < base.length ? base[at] : null, kept, added };
}

function weaker(base, branch) {
  const reasons = [];
  const { lost, kept, added } = aligned(base.statements, branch.statements);
  if (lost) reasons.push(`${lost.asserts ? "an assertion" : "a statement"} was removed or changed: ${lost.show}`);
  const exit = added.map((index) => branch.statements[index]).find((statement) => statement.suspicious);
  if (exit) reasons.push(`a new early exit, skip, use, hook, switch-off or write to a name tests share was added: ${exit.show}`);
  const lastRead = new Map();
  for (const index of kept) for (const id of branch.statements[index].reads?.keys() ?? []) lastRead.set(id, index);
  for (const index of added) {
    for (const [id, name] of branch.statements[index].writes ?? []) {
      if ((lastRead.get(id) ?? -1) > index) reasons.push(`a new statement assigns ${name}, which the test reads after it: ${branch.statements[index].show}`);
    }
  }
  if (rank(branch.mods) > rank(base.mods)) reasons.push(`it is now marked ${branch.mods.filter((word) => weakWords.has(word)).join(", ")}`);
  if (branch.mods.includes("only") && !base.mods.includes("only")) reasons.push("it is now marked only, so no other test of the run runs");
  if (JSON.stringify(base.given ?? []) !== JSON.stringify(branch.given ?? [])) reasons.push("the options it is registered with changed");
  const around = aligned(base.around ?? [], branch.around ?? [], (was, now) => was.key === now.key && (was.rows === undefined || (now.rows !== undefined && holdsRows(was.rows, now.rows))));
  if (around.lost) reasons.push(`code around it was removed or changed: ${around.lost.show}`);
  const wrapped = around.added.map((index) => branch.around[index]).find((entry) => entry.suspicious);
  if (wrapped) reasons.push(`code that can leave it out was added around it: ${wrapped.show}`);
  return reasons.join("; ");
}

const parsed = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** A count of tests that is lower than the base's, or gone. A held count (expected-fail, todo) may fall. */
function loweredCounts(path, was, now) {
  const before = parsed(was) ?? {};
  const after = parsed(now);
  if (after === null) return [{ file: path, id: path, what: "unreadable", why: "it is not JSON, so what it counts cannot be told" }];
  return Object.entries(before)
    .filter(([step, count]) => typeof count === "number" && !/ (?:expected-fail|todo)$/.test(step) && !(after[step] >= count))
    .map(([step, count]) => ({ file: path, id: `${path}::${step}`, what: "lowered-count", why: after[step] === undefined ? `the count of ${step} (${count}) is gone` : `the count of ${step} fell from ${count} to ${after[step]}` }));
}

/** A script of a package that is gone or says something else. A script added is free. */
function changedScripts(path, was, now) {
  const before = parsed(was)?.scripts ?? {};
  const after = parsed(now)?.scripts ?? {};
  return Object.entries(before)
    .filter(([name, command]) => after[name] !== command)
    .map(([name, command]) => ({ file: path, id: `${path}::scripts.${name}`, what: "changed-gate", why: after[name] === undefined ? `the script ${name} is gone` : `the script ${name} changed from "${command}" to "${after[name]}"` }));
}

/**
 * What each unit of main's became in this file. A statement is keyed by its first words, which a
 * renamed local changes, so one with no unit of its key pairs with a new statement that prints alike.
 */
function pairedUnits(was, now) {
  const taken = new Set();
  const pairs = new Map();
  for (const [key, unit] of was.decls) {
    if (now.decls.has(key)) {
      pairs.set(key, now.decls.get(key));
      continue;
    }
    if (!unit.effect) continue;
    const found = [...now.decls].find(([other, next]) => next.effect && !was.decls.has(other) && !taken.has(other) && next.print === unit.print);
    if (found === undefined) continue;
    taken.add(found[0]);
    pairs.set(key, found[1]);
  }
  return { pairs, taken };
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
  const copies = new Map();
  for (const [path, entry] of branch) for (const unit of entry.tests.values()) copies.set(unit.bodyKey, [...(copies.get(unit.bodyKey) ?? []), { path, unit }]);
  const baseBodies = new Set([...base.values()].flatMap((entry) => [...entry.tests.values()].map((unit) => unit.bodyKey)));
  const { reached: read, strict } = readBy(base);
  const findBase = reader(base);
  const findBranch = reader(branch);
  const standing = new Map();
  const stands = (inventory, find, path, unit) => {
    if (!standing.has(unit)) standing.set(unit, standsOn(inventory, find, path, unit));
    return standing.get(unit);
  };
  /** The tests of the branch that are this test of main's, wherever they are: the same body in the same file, or in another that gives its names the same meaning. */
  const movedTo = (path, unit) => (copies.get(unit.bodyKey) ?? []).filter((copy) => copy.path === path || stands(base, findBase, path, unit) === stands(branch, findBranch, copy.path, copy.unit));
  const kept = new Set([...branch.values()].flatMap((entry) => [...entry.decls].map(([key, unit]) => `${key}|${unit.print}`)));
  for (const [path, was] of base) {
    const now = branch.get(path);
    if (now === undefined) {
      const lost = [...was.tests.values()].filter((unit) => unit.setup || movedTo(path, unit).length === 0).length;
      const asserting = [...was.decls].some(([key, unit]) => (unit.asserts || read.has(`${path}::${key}`)) && !kept.has(`${key}|${unit.print}`));
      if (was.role === "gate" || was.data || lost > 0 || asserting) items.push({ file: path, id: path, what: "removed-file", why: lost > 0 ? `the file is gone, with ${lost} test${lost === 1 ? "" : "s"}` : "the file is gone" });
      continue;
    }
    if (now.unreadable !== null) {
      items.push({ file: path, id: path, what: "unreadable", why: `${now.unreadable}, so what it still asserts cannot be told` });
      continue;
    }
    if (path === COUNTS) {
      items.push(...loweredCounts(path, was.text, now.text));
      continue;
    }
    if (/(?:^|\/)package\.json$/.test(path)) {
      items.push(...changedScripts(path, was.text, now.text));
      continue;
    }
    if (was.data || (was.role === "gate" && was.decls.size === 0 && was.tests.size === 0)) {
      if (was.text !== now.text) items.push({ file: path, id: path, what: "changed-gate", why: "the file changed" });
      continue;
    }
    const { pairs, taken } = pairedUnits(was, now);
    if (was.role === "gate") {
      for (const [key, unit] of was.decls) {
        const next = pairs.get(key);
        if (!changed(unit, next, true)) continue;
        items.push({ file: path, id: `${path}::${key}`, what: "changed-gate", why: `${unit.show ?? key} ${next === undefined ? "is gone" : "changed"}` });
      }
      const goneStatements = [...was.decls].filter(([key, unit]) => unit.effect && !pairs.has(key)).length;
      const newStatements = [...now.decls].filter(([key, unit]) => unit.effect && !was.decls.has(key) && !taken.has(key));
      if (newStatements.length > goneStatements) {
        for (const [key, unit] of newStatements) items.push({ file: path, id: `${path}::${key}`, what: "changed-gate", why: `${unit.show ?? key} is a statement this branch put at the top of a script that decides` });
      }
      continue;
    }
    for (const [key, unit] of was.tests) {
      const next = now.tests.get(key);
      if (next === undefined) {
        const same = unit.setup ? [] : movedTo(path, unit).map((copy) => copy.unit.mods);
        if (!unit.setup && same.some((mods) => rank(mods) <= rank(unit.mods) && marked(mods).length <= marked(unit.mods).length)) continue;
        if (!unit.setup && same.length > 0) items.push({ file: path, id: unit.id, what: "weakened-test", why: "its copy under another name is marked skip, fixme or only" });
        else items.push({ file: path, id: unit.id, what: unit.setup ? "weakened-test" : "removed-test", why: unit.setup ? "the setup of the group is gone" : "no test of this name is left in the file" });
        continue;
      }
      const why = weaker(unit, next);
      if (why !== "") items.push({ file: path, id: unit.id, what: "weakened-test", why });
    }
    const fresh = [];
    for (const [id, unit] of now.tests) {
      if (was.tests.has(id)) continue;
      const exit = unit.setup && was.groups.has(id.replace(/ \(setup\)$/, "")) ? unit.statements.find((statement) => statement.suspicious) : undefined;
      if (exit) fresh.push({ file: path, id, what: "added-setup", why: `${exit.show} is new in a group that had no setup, where it runs with every test in it` });
      if (unit.setup || baseBodies.has(unit.bodyKey)) continue;
      const bad = marked(unit.mods);
      if (bad.length > 0) fresh.push({ file: path, id, what: "disabled", why: `is a new test marked ${bad.join(", ")}` });
    }
    for (const [id, mods] of now.groups) {
      if (was.groups.has(id) || marked(mods).length === 0 || fresh.some((item) => item.id.startsWith(`${id} > `))) continue;
      fresh.push({ file: path, id, what: "disabled", why: `is a new group marked ${marked(mods).join(", ")}` });
    }
    items.push(...fresh);
    for (const [key, unit] of now.decls) {
      if (was.decls.has(key) || taken.has(key)) continue;
      if (unit.disables) items.push({ file: path, id: `${path}::${key}`, what: "disabled", why: `${unit.show ?? key} is new, and it can switch checks off` });
      else if (was.role === "test" && unit.effect) items.push({ file: path, id: `${path}::${key}`, what: "added-setup", why: `${unit.show ?? key} is new at the top of a test file, so it runs with every test in it` });
    }
    for (const [key, unit] of was.decls) {
      const next = pairs.get(key);
      if (!changed(unit, next, strict.has(`${path}::${key}`))) continue;
      const what = next === undefined ? "gone" : "changed";
      const id = `${path}::${key}`;
      if (unit.asserts) items.push({ file: path, id, what: "weakened-helper", why: `${unit.show ?? key}, which asserts, is ${what}` });
      else if (read.has(id)) items.push({ file: path, id, what: "changed-input", why: `${unit.show ?? key}, which a test of main's reads, is ${what}` });
      else notes.push(`${id} is ${what}`);
    }
  }
  return { items, notes };
}
