// What one key costs in page view, the way the app pays for it: `app.update`
// with the field's new snapshot, then `app.view` for the frame that draws it.
// The caret is in a paragraph in the middle of an ordinary note, at three
// sizes. Parses of the note are counted exactly and the rest is timed.
//
//   gleam build && node test/keystroke_cost.mjs [build directory]
//
// Exits 1 when a typed character parses the note more than once, or a caret
// move parses it at all, and then the same for every variant of
// `editor.Event`. The times are printed, never checked: they are too noisy
// for a gate.

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
  const flags = new app.Flags(storage.new$(backend), false, false, false, true);
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
    new app.EditorSent(new editor.Pointed(paragraph, "", true, "", 0, 0)),
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
  const [next] = app.update(model, new app.EditorSent(new editor.ControlChanged(shown, 0)));
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

// Every editor event, with vim off and on: one parse at most when the note
// changed, none when it did not. A variant of `editor.Event` with no entry
// here fails, so a new event cannot arrive unmeasured. An entry that gives a
// list sends all but the last before counting, to reach the state it measures.
const vim = await load("nullpad/nullpad/vim.mjs");

// `surface.view` measures a list marker's width when the caret is in a list.
globalThis.getComputedStyle = () => ({ fontSize: "16px", getPropertyValue: () => "" });
globalThis.document = {
  documentElement: {},
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: text.length * 8 }) }) }),
};
const events = {
  ControlChanged: [
    ["typed", (field) => new editor.ControlChanged(typed(field), 0)],
    ["moved", (field) => new editor.ControlChanged(moved(field, 0), 0)],
    ["typed after a pause", (field) => [
      new editor.ControlChanged(typed(field), 0),
      new editor.ControlChanged(typed(field), 60000),
    ]],
  ],
  Composing: [
    ["typed", (field) => new editor.Composing(typed(field))],
    ["moved", (field) => new editor.Composing(moved(field, 0))],
  ],
  KeyPressed: [
    ["x", (field) => new editor.KeyPressed(new vim.Char("x"), field)],
    ["l", (field) => new editor.KeyPressed(new vim.Char("l"), field)],
    ["i", (field) => new editor.KeyPressed(new vim.Char("i"), field)],
    ["Escape", (field) => new editor.KeyPressed(new vim.Escape(), field)],
    ["Enter", (field) => new editor.KeyPressed(new vim.Enter(), field)],
    ["Ctrl r", (field) => new editor.KeyPressed(new vim.Ctrl("r"), field)],
  ],
  EdgePressed: [
    ["Up", (field) => new editor.EdgePressed(new editor.Up(), 0, field)],
    ["Down", (field) => new editor.EdgePressed(new editor.Down(), 0, field)],
    ["JoinBefore", (field) => new editor.EdgePressed(new editor.JoinBefore(), 0, field)],
    ["JoinAfter", (field) => new editor.EdgePressed(new editor.JoinAfter(), 0, field)],
    ["Line up selecting", (field) => new editor.EdgePressed(new editor.Line(true, true), 0, field)],
    ["Line down selecting", (field) => new editor.EdgePressed(new editor.Line(false, true), 0, field)],
    ["Line down", (field) => new editor.EdgePressed(new editor.Line(false, false), 0, field)],
    ["Beside up", (field) => new editor.EdgePressed(new editor.Beside(true), 0, field)],
    ["Beside down", (field) => new editor.EdgePressed(new editor.Beside(false), 0, field)],
    ["SelectBefore", (field) => new editor.EdgePressed(new editor.SelectBefore(), 0, field)],
    ["SelectAfter", (field) => new editor.EdgePressed(new editor.SelectAfter(), 0, field)],
    ["SelectToStart", (field) => new editor.EdgePressed(new editor.SelectToStart(), 0, field)],
    ["SelectToEnd", (field) => new editor.EdgePressed(new editor.SelectToEnd(), 0, field)],
    ["SelectAll", (field) => new editor.EdgePressed(new editor.SelectAll(), 0, field)],
    ["Page up", (field) => new editor.EdgePressed(new editor.Page(true, false), 0, field)],
    ["Page down selecting", (field) => new editor.EdgePressed(new editor.Page(false, true), 0, field)],
    ["Widen", (field) => new editor.EdgePressed(new editor.Widen(), 0, field)],
    ["Row up", (field) => new editor.EdgePressed(new editor.Row(true, false), 0, field)],
    ["Row down selecting", (field) => new editor.EdgePressed(new editor.Row(false, true), 0, field)],
  ],
  EscapePressed: [["", (field) => new editor.EscapePressed(field)]],
  Pointed: [
    ["a row above", (_, row) => new editor.Pointed(Math.max(0, row - 9), "", true, "", 0, 0)],
    ["a row below", (_, row) => new editor.Pointed(row + 9, "", false, "", 0, 0)],
  ],
  LinePointed: [
    ["a row above", (_, row) => new editor.LinePointed(Math.max(0, row - 9), "", true, "", 0, 0)],
    ["a row below", (_, row) => new editor.LinePointed(row + 9, "", false, "", 0, 0)],
  ],
  ShiftPointed: [
    ["a row above", (field, row) => new editor.ShiftPointed(Math.max(0, row - 9), "", true, "", field, 0, 0)],
    ["a row below", (field, row) => new editor.ShiftPointed(row + 9, "", false, "", field, 0, 0)],
  ],
  WordPressed: [
    ["no place", () => new editor.WordPressed(-1, "", false, "", 0, 0)],
    ["a row above", (_, row) => new editor.WordPressed(Math.max(0, row - 9), "", true, "", 0, 0)],
    ["a row below", (_, row) => new editor.WordPressed(row + 9, "", false, "", 0, 0)],
  ],
  Grabbed: [
    ["a row above", (_, row) => new editor.Grabbed(Math.max(0, row - 9), "", true, "", 0, 0)],
    ["a row below", (_, row) => new editor.Grabbed(row + 9, "", false, "", 0, 0)],
  ],
  SelectionPointed: [
    ["a row above", (_, row) => new editor.SelectionPointed(Math.max(0, row - 9), "", true, "", 0, 0)],
    ["a row below", (_, row) => new editor.SelectionPointed(row + 9, "", false, "", 0, 0)],
  ],
  Dragged: [
    ["a row above", (_, row) => new editor.Dragged(Math.max(0, row - 9), "", true, "")],
    ["a row below", (_, row) => new editor.Dragged(row + 9, "", false, "")],
    ["in place", (_, row) => new editor.Dragged(row, "", true, "")],
  ],
  Stepped: [
    ["a row above", (_, row) => new editor.Stepped(Math.max(0, row - 9), "", true, "", 40)],
    ["a row below", (_, row) => new editor.Stepped(row + 9, "", false, "", 40)],
  ],
  Unstepped: [
    ["", () => new editor.Unstepped(40)],
    ["past the end of the note", (field) => [
      new editor.EdgePressed(new editor.Page(false, false), 0, field),
      new editor.Unstepped(40),
    ]],
  ],
  Aimed: [["moved", (field) => new editor.Aimed(moved(field, 0), 40)]],
  Nudged: [
    ["forward", (field, row) => new editor.Nudged(true, row, "", field)],
    ["back", (field, row) => new editor.Nudged(false, row, "", field)],
  ],
  Released: [["", () => new editor.Released()]],
  DragStarted: [["", () => new editor.DragStarted()]],
  Dropped: [
    ["a row above", (field, row) => new editor.Dropped(Math.max(0, row - 9), "", true, "", "x", false, field)],
    ["a row below", (field, row) => new editor.Dropped(row + 9, "", false, "", "x", false, field)],
    ["copied", (field, row) => new editor.Dropped(row + 9, "", false, "", "x", true, field)],
  ],
  FocusChanged: [
    ["blur", () => new editor.FocusChanged(false)],
    ["focus", () => new editor.FocusChanged(true)],
  ],
  UndoAsked: [
    ["nothing to undo", () => new editor.UndoAsked()],
    ["a typed character", (field) => [new editor.ControlChanged(typed(field), 0), new editor.UndoAsked()]],
    ["typing in a row left", (field, row) => [
      new editor.ControlChanged(typed(field), 0),
      new editor.Pointed(row + 9, "", false),
      new editor.UndoAsked(),
    ]],
  ],
  RedoAsked: [
    ["nothing to redo", () => new editor.RedoAsked()],
    ["an undone character", (field) => [
      new editor.ControlChanged(typed(field), 0),
      new editor.UndoAsked(),
      new editor.RedoAsked(),
    ]],
  ],
};

const { readFileSync } = await import("node:fs");
const declared = readFileSync(new URL("../src/nullpad/editor.gleam", import.meta.url), "utf8")
  .match(/pub type Event \{([^}]*)\}/)?.[1]
  .split("\n")
  .map((line) => line.trim().match(/^([A-Z]\w*)/)?.[1])
  .filter(Boolean);
if (!declared?.length) {
  console.error("Could not read the variants of editor.Event.");
  process.exit(1);
}
for (const variant of declared) {
  if (!events[variant]) {
    console.error(`editor.${variant} has no entry in test/keystroke_cost.mjs.`);
    failed = true;
  }
}

const every = [];
for (const withVim of [false, true]) {
  for (const variant of declared) {
    for (const [label, make] of events[variant] ?? []) {
      let model = opened(note(20));
      if (withVim) {
        model = model.withFields({ editor: editor.set_vim(model.editor, true).editor });
      }
      const field = editor.field_buffer(model.editor);
      const row = editor.region(model.editor)[0]?.first_row ?? 0;
      const made = [make(field, row)].flat();
      let next;
      let text;
      let count;
      try {
        for (const event of made.slice(0, -1)) [model] = app.update(model, new app.EditorSent(event));
        text = editor.text(model.editor);
        count = globalThis.parses;
        [next] = app.update(model, new app.EditorSent(made.at(-1)));
        app.view(next);
      } catch (error) {
        if (error.gleam_error !== "todo") throw error;
        every.push({ vim: withVim ? "on" : "off", event: `${variant} ${label}`.trim(), verdict: "not built yet" });
        continue;
      }
      const parses = globalThis.parses - count;
      const changed = editor.text(next.editor) !== text;
      const budget = changed ? 1 : 0;
      failed ||= parses > budget;
      every.push({
        vim: withVim ? "on" : "off",
        event: `${variant} ${label}`.trim(),
        "note changed": changed,
        parses,
        verdict: parses > budget ? `OVER BUDGET (${budget})` : "ok",
      });
    }
  }
}
console.table(every);
process.exit(failed ? 1 : 0);
