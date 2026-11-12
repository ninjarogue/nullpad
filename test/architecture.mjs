import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const src = join(root, "src");

const core = ["buffer", "vim", "editor", "live", "markdown", "library"];
const shell = ["app", "surface", "preview", "platform"];
const mayCallJavaScript = ["surface", "platform", "markdown", "storage/indexeddb"];
const browserGlobals = /\b(document|window|navigator|localStorage|indexedDB)\b/;

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

function moduleOf(file) {
  return relative(src, file)
    .replace(/\.(gleam|ffi\.mjs)$/, "")
    .replace(/^nullpad\//, "");
}

const rules = [
  {
    says: "a core module imports no Lustre",
    applies: (module, file) => core.includes(module) && file.endsWith(".gleam"),
    breaks: (line) => /^import lustre\b/.test(line),
  },
  {
    says: "a core module imports no shell module",
    applies: (module, file) => core.includes(module) && file.endsWith(".gleam"),
    breaks: (line) => shell.some((name) => line.startsWith(`import nullpad/${name}`)),
  },
  {
    says: "a core module's JavaScript touches no browser",
    applies: (module, file) => core.includes(module) && file.endsWith(".mjs"),
    breaks: (line) => browserGlobals.test(line),
  },
  {
    says: "only surface, platform, markdown and a storage backend call JavaScript",
    applies: (module, file) => !mayCallJavaScript.includes(module) && file.endsWith(".gleam"),
    breaks: (line) => line.startsWith("@external("),
  },
  {
    says: "only src/nullpad.gleam imports a storage backend",
    applies: (module, file) => module !== "nullpad" && file.endsWith(".gleam"),
    breaks: (line) => line.startsWith("import nullpad/storage/"),
  },
  {
    says: "only surface writes the text field",
    applies: (module, file) => module !== "surface" && file.endsWith(".mjs"),
    breaks: (line) => /\.(value|selectionStart|selectionEnd)\s*=[^=]/.test(line) || /setSelectionRange/.test(line),
  },
  {
    says: "JavaScript parses no text, the Gleam parser does",
    applies: (module, file) => !core.includes(module) && file.endsWith(".mjs"),
    breaks: (line) => regexBodies(line).some((body) => /\[|\\d/.test(body)),
  },
];

function regexBodies(line) {
  return [...line.matchAll(/(?:^|[=(,:\s])\/((?:\\.|[^/\\\n])+)\/[dgimsuy]*\s*[.,);]/g)].map((found) => found[1]);
}

function decoderChangesToThePage(lines) {
  const external = [];
  lines.forEach((line, index) => {
    if (line.startsWith("@external(")) {
      const end = lines.findIndex((later, at) => at > index && later.trim() === "");
      const declared = lines.slice(index + 1, end === -1 ? undefined : end).join(" ");
      const name = /fn (\w+)\(/.exec(declared)?.[1];
      if (name && /->\s*Nil\s*$/.test(declared)) external.push(name);
    }
  });
  const found = [];
  let decoder = null;
  lines.forEach((line, index) => {
    if (/^[^\s)]/.test(line)) decoder = /^(?:pub )?fn (\w*decoder)\(/.exec(line)?.[1] ?? null;
    else if (decoder && external.some((name) => new RegExp(`\\b${name}\\(`).test(line))) {
      found.push({ index, line: line.trim() });
    }
  });
  return found;
}

const broken = [];
for (const file of files(src)) {
  const module = moduleOf(file);
  const lines = readFileSync(file, "utf8").split("\n");
  if (file.endsWith(".gleam") && shell.includes(module)) {
    for (const call of decoderChangesToThePage(lines)) {
      broken.push(
        `${relative(root, file)}:${call.index + 1}  a decoder may measure the page but never changes it\n    ${call.line}`,
      );
    }
  }
  for (const rule of rules) {
    if (!rule.applies(module, file)) continue;
    lines.forEach((line, index) => {
      if (rule.breaks(line.trim())) {
        broken.push(`${relative(root, file)}:${index + 1}  ${rule.says}\n    ${line.trim()}`);
      }
    });
  }
}

if (broken.length > 0) {
  console.error(`architecture: ${broken.length} broken\n\n${broken.join("\n\n")}\n\nThe rules are in CLAUDE.md.`);
  process.exit(1);
}
console.log(`architecture: ${rules.length + 1} rules hold`);
