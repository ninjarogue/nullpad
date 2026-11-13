// What one key costs in page view, the way the app pays for it: `app.update`
// with the field's new snapshot, then `app.view` for the frame that draws it.
// The caret is in a paragraph in the middle of an ordinary note, at three
// sizes. Parses of the note are counted exactly and the rest is timed.
//
//   gleam build && node test/keystroke_cost.mjs [build directory]
//
// Exits 1 when a typed character parses the note more than once, or a caret
// move parses it at all. The times are printed, never checked: they are too
// noisy for a gate.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

const counter = `
export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  if (!url.endsWith("/nullpad/markdown.mjs")) return loaded;
  const text = typeof loaded.source === "string"
    ? loaded.source
    : new TextDecoder().decode(loaded.source);
  const opening = "export function parse(source) {";
  const source = text.replace(
    opening,
    opening + " globalThis.parses += 1; return parse_counted(source); }\\n" +
      "function parse_counted(source) {",
  );
  return { ...loaded, source, shortCircuit: true };
}`;
register("data:text/javascript," + encodeURIComponent(counter));
globalThis.parses = 0;

const build = process.argv[2]
  ? pathToFileURL(process.argv[2].replace(/\/?$/, "/"))
  : new URL("../build/dev/javascript/", import.meta.url);
const load = (path) => import(new URL(path, build).href);
const markdown = await load("nullpad/nullpad/markdown.mjs");
const app = await load("nullpad/nullpad/app.mjs");
const editor = await load("nullpad/nullpad/editor.mjs");
const buffer = await load("nullpad/nullpad/buffer.mjs");
const storage = await load("nullpad/nullpad/storage.mjs");

const SIZES_KB = [5, 20, 100];
const WARMUP = 5;
const KEYS = 15;

function section(day) {
  return `## Day ${day}

Some words about day ${day}, with **bold**, *emphasis*, \`code\` and a [link](https://example.com/${day}).
A second line of the same paragraph keeps going for a while, so that it wraps on a phone.

- milk
- eggs and *bread*
- [ ] call the station
- [x] book the room

1. pack
2. leave
3. arrive

> A quote that says something
> over two lines.

\`\`\`js
let day = ${day};
console.log(day);
\`\`\`

| Day | Place | Cost |
|-----|:-----:|-----:|
| ${day} | Lisbon | 120 |
| ${day + 1} | Porto | 80 |
`;
}

function note(kb) {
  const sections = [];
  let length = 0;
  while (length < kb * 1024) {
    sections.push(section(sections.length + 1));
    length += sections.at(-1).length + 1;
  }
  return sections.join("\n");
}

function opened(text) {
  const ignore = () => undefined;
  const backend = new storage.Backend(ignore, ignore, ignore, ignore, ignore);
  const flags = new app.Flags(storage.new$(backend), false, false, false);
  const [model] = app.init(flags);
  const ready = model.withFields({
    editor: editor.open(model.editor, text).editor,
  });
  const lines = text.split("\n");
  const paragraph = lines.findIndex(
    (line, row) => row > lines.length / 2 && line.startsWith("Some words"),
  );
  const [pointed] = app.update(
    ready,
    new app.EditorSent(new editor.Pointed(paragraph, "", true)),
  );
  return pointed;
}

const typed = (field) => {
  const caret = buffer.cursor(field);
  return buffer.replace(field, caret, caret, "x");
};

const moved = (field, step) => {
  const caret = buffer.cursor(field);
  const col = caret.col + (step % 2 === 0 ? -1 : 1);
  return buffer.move_to(field, new buffer.Position(caret.row, col));
};

function press(model, shown) {
  const before = globalThis.parses;
  const start = performance.now();
  const [next] = app.update(model, new app.EditorSent(new editor.ControlChanged(shown)));
  const drawn = app.view(next);
  const ms = performance.now() - start;
  return { next, drawn, ms, parses: globalThis.parses - before };
}

function keys(model, count, change) {
  const results = [];
  for (let step = 0; step < count; step++) {
    const field = editor.field_buffer(model.editor);
    const result = press(model, change(field, step));
    results.push(result);
    model = result.next;
  }
  return { model, results };
}

function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const before = globalThis.parses;
markdown.parse("a");
if (globalThis.parses !== before + 1) {
  console.error("The parse counter is not wired to markdown.parse.");
  process.exit(1);
}

let failed = false;
const rows = [];
for (const kb of SIZES_KB) {
  const text = note(kb);
  let model = opened(text);
  if (editor.region(model.editor)[0]?.first_row === undefined) {
    console.error("The field is not in page view.");
    process.exit(1);
  }
  for (const [name, change, budget] of [
    ["typed character", typed, 1],
    ["caret move", moved, 0],
  ]) {
    model = keys(model, WARMUP, change).model;
    const length = editor.text(model.editor).length;
    const run = keys(model, KEYS, change);
    model = run.model;
    const grew = editor.text(model.editor).length - length;
    if (grew !== (change === typed ? KEYS : 0)) {
      console.error(`${name} at ${kb} KB: the note grew by ${grew} characters.`);
      process.exit(1);
    }
    const times = run.results.map((result) => result.ms).sort((a, b) => a - b);
    const most = Math.max(...run.results.map((result) => result.parses));
    const over = most > budget;
    failed ||= over;
    rows.push({
      note: `${(text.length / 1024).toFixed(0)} KB`,
      key: name,
      "parses per key": most,
      "median ms": median(times).toFixed(2),
      "min ms": times[0].toFixed(2),
      "max ms": times.at(-1).toFixed(2),
      verdict: over ? `OVER BUDGET (${budget})` : "ok",
    });
  }
}

console.table(rows);
console.log(`${KEYS} keys of each kind after ${WARMUP} warm-up keys, one update and one view each`);
process.exit(failed ? 1 : 0);
