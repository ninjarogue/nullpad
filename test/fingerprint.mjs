import { createHash } from "node:crypto";

/**
 * What a piece of code says, as a string that a comment, a blank line, a position or the name of
 * a local variable cannot change. Gleam is printed from glance's tree and JavaScript and
 * TypeScript from oxc's. A local is printed as what defined it (its pattern and the value it was
 * bound to), never as its name, so renaming it changes nothing, while reading another local,
 * or one that shadows a global, does. Names that are not local are the ones a unit reads from
 * outside: a printer collects them in `refs`.
 */

export const hidden = new Set(["start", "end", "range", "loc", "raw", "location"]);
export const printNode = (node) => JSON.stringify(node, (key, value) => (hidden.has(key) ? undefined : typeof value === "bigint" ? `${value}n` : value));

const hash = (text) => createHash("sha1").update(text).digest("hex").slice(0, 8);

/** The locals in view. Two in view with one origin are told apart by how many came before. */
function scopes() {
  const stack = [];
  return {
    mark: () => stack.length,
    release(mark) {
      stack.length = mark;
    },
    lookup(name) {
      for (let at = stack.length - 1; at >= 0; at--) if (stack[at].name === name) return stack[at].id;
      return null;
    },
    bind(name, origin) {
      const base = hash(origin);
      const before = stack.filter((entry) => entry.base === base).length;
      const id = `#${base}${before === 0 ? "" : `.${before}`}`;
      stack.push({ name, base, id });
      return id;
    },
  };
}

const kind = (value) => value?.constructor?.name;
const isSpan = (value) => kind(value) === "Span";
const fieldsOf = (value) => Object.entries(value).filter(([, inner]) => !isSpan(inner));
const quoted = (text) => JSON.stringify(text);

export function gleamPrinter() {
  const scope = scopes();
  const refs = new Set();
  let subject = "";

  const within = (build) => {
    const mark = scope.mark();
    try {
      return build();
    } finally {
      scope.release(mark);
    }
  };

  const print = (value) => {
    if (value === null || value === undefined) return "-";
    if (typeof value !== "object") return JSON.stringify(value);
    if (typeof value[Symbol.iterator] === "function") return `[${[...value].map(print).join(",")}]`;
    return (handlers[kind(value)] ?? plain)(value);
  };

  const plain = (value) => `${kind(value)}(${fieldsOf(value).map(([key, inner]) => `${key}=${print(inner)}`).join(",")})`;

  const variable = (name) => {
    const id = scope.lookup(name);
    if (id !== null) return `Local(${id})`;
    refs.add(name);
    return `Variable(name=${quoted(name)})`;
  };

  const assignmentName = (name, origin, bind = true) => {
    if (kind(name) !== "Named") return "Discarded";
    if (bind) scope.bind(name[0], origin);
    return "Named";
  };

  const pattern = (node, origin, bind = true, path = "") => {
    const at = `${origin}${path}`;
    switch (kind(node)) {
      case "PatternVariable":
        if (bind) scope.bind(node.name, at);
        return "PatternVariable";
      case "PatternAssignment": {
        const inner = pattern(node.pattern, origin, bind, path);
        if (bind) scope.bind(node.name, `${at} as`);
        return `PatternAssignment(${inner})`;
      }
      case "PatternTuple":
        return `PatternTuple([${[...node.elements].map((one, index) => pattern(one, origin, bind, `${path}.${index}`)).join(",")}])`;
      case "PatternList": {
        const elements = [...node.elements].map((one, index) => pattern(one, origin, bind, `${path}.${index}`)).join(",");
        return `PatternList([${elements}],${node.tail?.[0] === undefined ? "-" : pattern(node.tail[0], origin, bind, `${path}.tail`)})`;
      }
      case "PatternConcatenate": {
        const before = kind(node.prefix_name) === "Some" ? assignmentName(node.prefix_name[0], `${at} prefix`, bind) : "-";
        const rest = assignmentName(node.rest_name, `${at} rest`, bind);
        return `PatternConcatenate(${quoted(node.prefix)},${before},${rest})`;
      }
      case "PatternBitString": {
        const segments = [...node.segments].map(([inner, options], index) => `${pattern(inner, origin, bind, `${path}.${index}`)}:${print(options)}`);
        return `PatternBitString([${segments.join(",")}])`;
      }
      case "PatternVariant": {
        const fields = [...node.arguments].map((field, index) => {
          if (kind(field) === "UnlabelledField") return pattern(field.item, origin, bind, `${path}.${index}`);
          if (kind(field) === "ShorthandField") {
            if (bind) scope.bind(field.label, `${at}.${field.label}`);
            return `${quoted(field.label)}:PatternVariable`;
          }
          return `${quoted(field.label)}:${pattern(field.item, origin, bind, `${path}.${field.label}`)}`;
        });
        return `PatternVariant(${print(node.module)},${quoted(node.constructor$)},[${fields.join(",")}],${node.with_spread})`;
      }
      default:
        return plain(node);
    }
  };

  const handlers = {
    Variable: (node) => variable(node.name),
    BitArraySizeVariable: (node) => `BitArraySizeVariable(${variable(node.name)})`,
    FieldAccess(node) {
      if (kind(node.container) === "Variable" && scope.lookup(node.container.name) === null) refs.add(`${node.container.name}.${node.label}`);
      return plain(node);
    },
    ShorthandField: (field) => `LabelledField(label=${quoted(field.label)},item=${variable(field.label)})`,
    RecordUpdateField: (field) => `RecordUpdateField(label=${quoted(field.label)},item=${kind(field.item) === "Some" ? print(field.item) : `Some(0=${variable(field.label)})`})`,
    Block: (node) => within(() => plain(node)),
    Assignment(node) {
      const value = print(node.value);
      const how = print(node.kind);
      const annotation = print(node.annotation);
      return `Assignment(kind=${how},pattern=${pattern(node.pattern, `let ${value}`)},annotation=${annotation},value=${value})`;
    },
    Use(node) {
      const callee = print(node.function);
      const patterns = [...node.patterns].map((one, index) => `${pattern(one.pattern, `use ${callee} ${index}`)}:${print(one.annotation)}`);
      return `Use(function=${callee},patterns=[${patterns.join(",")}])`;
    },
    Fn: (node) =>
      within(() => {
        const params = [...node.arguments].map((one, index) => `${assignmentName(one.name, `fn ${index} ${print(one.type_)}`)}:${print(one.type_)}`);
        return `Fn(arguments=[${params.join(",")}],return_annotation=${print(node.return_annotation)},body=${print(node.body)})`;
      }),
    Function: (node) =>
      within(() => {
        const params = [...node.parameters].map((one, index) => `${print(one.label)}:${assignmentName(one.name, `parameter ${index} ${print(one.label)} ${print(one.type_)}`)}:${print(one.type_)}`);
        return `Function(name=${quoted(node.name)},publicity=${print(node.publicity)},parameters=[${params.join(",")}],return=${print(node.return)},body=${print(node.body)})`;
      }),
    Case(node) {
      const before = subject;
      subject = print(node.subjects);
      try {
        return `Case(subjects=${subject},clauses=${print(node.clauses)})`;
      } finally {
        subject = before;
      }
    },
    Clause: (node) =>
      within(() => {
        const alternatives = [...node.patterns].map((list, index) => `[${[...list].map((one, slot) => pattern(one, `case ${subject} ${slot}`, index === 0)).join(",")}]`);
        return `Clause(patterns=[${alternatives.join(",")}],guard=${print(node.guard)},body=${print(node.body)})`;
      }),
  };

  const parameters = (list) => [...list].forEach((one, index) => assignmentName(one.name, `parameter ${index} ${print(one.label)} ${print(one.type_)}`));

  return { print, refs, parameters };
}

/** What a Gleam value says. Each call is its own scope, so what it reads from outside is by name. */
export const printGleam = (value) => gleamPrinter().print(value);

const rawKeys = new Set(["typeAnnotation", "typeArguments", "typeParameters", "returnType", "superTypeArguments", "implements"]);
const typeWrappers = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "TSInstantiationExpression"]);
const keyName = (key) => (key.type === "Identifier" ? key.name : String(key.value ?? key.name));

export function jsPrinter() {
  const scope = scopes();
  const refs = new Set();
  let top = null;

  const within = (build) => {
    const mark = scope.mark();
    try {
      return build();
    } finally {
      scope.release(mark);
    }
  };

  const print = (node) => {
    if (node === null || node === undefined) return "-";
    if (typeof node === "bigint") return `${node}n`;
    if (typeof node !== "object") return JSON.stringify(node);
    if (Array.isArray(node)) return `[${node.map(print).join(",")}]`;
    if (typeof node.type !== "string") return `{${Object.entries(node).filter(([key]) => !hidden.has(key)).map(([key, inner]) => `${key}:${print(inner)}`).join(",")}}`;
    if (node.type.startsWith("TS") && !typeWrappers.has(node.type) && !handlers[node.type]) return printNode(node);
    return (handlers[node.type] ?? generic)(node);
  };

  const generic = (node, over = {}) =>
    `{${Object.entries(node)
      .filter(([key]) => !hidden.has(key))
      .map(([key, inner]) => `${key}:${key in over ? over[key] : rawKeys.has(key) ? printNode(inner) : print(inner)}`)
      .join(",")}}`;

  const target = (key, computed) => (computed ? print(key) : printNode(key));

  const pattern = (node, origin, path = "") => {
    const annotated = (text) => (node.typeAnnotation ? `${text}${printNode(node.typeAnnotation)}` : text);
    switch (node?.type) {
      case "Identifier":
        scope.bind(node.name, `${origin}${path}`);
        return annotated("#");
      case "ObjectPattern": {
        const properties = node.properties.map((property) => (property.type === "RestElement" ? pattern(property, origin, `${path}/...`) : `${target(property.key, property.computed)}:${pattern(property.value, origin, `${path}/${keyName(property.key)}`)}`));
        return annotated(`{${properties.join(",")}}`);
      }
      case "ArrayPattern":
        return annotated(`[${node.elements.map((element, index) => (element === null ? "-" : pattern(element, origin, `${path}[${index}]`))).join(",")}]`);
      case "AssignmentPattern": {
        const right = print(node.right);
        return `(${pattern(node.left, origin, path)}=${right})`;
      }
      case "RestElement":
        return `...${pattern(node.argument, origin, `${path}...`)}`;
      default:
        return print(node);
    }
  };

  const hoist = (list) => {
    for (const statement of list) {
      const found = statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
      if (found?.type === "FunctionDeclaration" && found.id) scope.bind(found.id.name, `function ${found.params.length} ${found.async} ${found.generator}`);
    }
  };

  const declarator = (node, how, isTop) => {
    const init = print(node.init);
    return `{type:VariableDeclarator,id:${isTop ? printNode(node.id) : pattern(node.id, `${how} ${init}`)},init:${init}}`;
  };

  const callable = (node) =>
    within(() => {
      if (node.type === "FunctionExpression" && node.id) scope.bind(node.id.name, "function expression name");
      const params = node.params.map((param, index) => pattern(param, `parameter ${index}`));
      const id = node.id ? (node.type === "FunctionDeclaration" && node !== top ? print(node.id) : printNode(node.id)) : "-";
      return generic(node, { id, params: `[${params.join(",")}]`, body: print(node.body) });
    });

  const handlers = {
    Identifier(node) {
      const id = scope.lookup(node.name);
      if (id !== null) return `{Identifier:${id}}`;
      refs.add(node.name);
      return `{Identifier:${node.name}}`;
    },
    MemberExpression(node) {
      if (!node.computed && node.property.type === "Identifier") {
        refs.add(`.${node.property.name}`);
        if (node.object.type === "Identifier" && scope.lookup(node.object.name) === null) refs.add(`${node.object.name}.${node.property.name}`);
      }
      return generic(node, { property: target(node.property, node.computed) });
    },
    Property: (node) => generic(node, { key: target(node.key, node.computed), shorthand: "-" }),
    MethodDefinition: (node) => generic(node, { key: target(node.key, node.computed) }),
    PropertyDefinition: (node) => generic(node, { key: target(node.key, node.computed) }),
    AccessorProperty: (node) => generic(node, { key: target(node.key, node.computed) }),
    LabeledStatement: (node) => generic(node, { label: printNode(node.label) }),
    BreakStatement: (node) => generic(node, { label: printNode(node.label) }),
    ContinueStatement: (node) => generic(node, { label: printNode(node.label) }),
    BlockStatement: (node) =>
      within(() => {
        hoist(node.body);
        return generic(node);
      }),
    StaticBlock: (node) => within(() => generic(node)),
    FunctionDeclaration: callable,
    FunctionExpression: callable,
    ArrowFunctionExpression: callable,
    VariableDeclaration: (node) => `{type:VariableDeclaration,kind:${node.kind},declarations:[${node.declarations.map((one) => declarator(one, node.kind, false)).join(",")}]}`,
    VariableDeclarator: (node) => declarator(node, "const", node === top),
    CatchClause: (node) =>
      within(() => {
        const param = node.param ? pattern(node.param, "catch") : "-";
        return generic(node, { param });
      }),
    ForStatement: (node) => within(() => generic(node)),
    ForInStatement: (node) => within(() => generic(node)),
    ForOfStatement: (node) => within(() => generic(node)),
    SwitchStatement: (node) => within(() => generic(node)),
    ClassDeclaration(node) {
      if (node !== top && node.id) scope.bind(node.id.name, "class");
      return generic(node, { id: printNode(node.id) });
    },
  };

  /** A declaration of the top of a file. What it names is not a local, so it is printed by name. */
  const unit = (node) => {
    top = node;
    try {
      return print(node);
    } finally {
      top = null;
    }
  };

  return { print, unit, refs, bindParams: (params) => params.map((param, index) => pattern(param, `parameter ${index}`)), hoist };
}
