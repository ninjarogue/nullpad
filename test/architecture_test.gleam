//// Runs the architecture rules over `src`, then breaks the architecture on
//// purpose, one change at a time, and checks what the rules say about each.
////
////   gleam test                        both, with the other unit tests
////   gleam run -m architecture_test    print what each rule examined

import architecture/rules.{type File, type Report, type Rule, Source}
import gleam/io
import gleam/list
import gleam/string
import simplifile

pub fn main() -> Nil {
  let report = rules.judge(source())
  list.each(rules.rules, fn(rule) {
    let at =
      list.filter(report.looked, fn(one) { one.0 == rule })
      |> list.map(fn(one) { one.1 })
    io.println(rules.says(rule) <> "\n    " <> string.join(at, ", "))
  })
  io.println(describe(report))
}

pub fn source_follows_the_rules_test() {
  let report = rules.judge(source())
  case report.broken, report.faults {
    [], [] -> Nil
    _, _ -> panic as describe(report)
  }
}

pub fn every_break_is_judged_as_listed_test() {
  let files = source()
  let wrong =
    list.filter_map(breaks(), fn(break) {
      let before = read_text(break.path)
      let after = break.change(before)
      let changed = rules.read(Source(break.path, after))
      let report =
        rules.judge([
          changed,
          ..list.filter(files, fn(file) { rules.path(file) != break.path })
        ])
      let fails = report.broken != [] || report.faults != []
      let breaks = fn(rule) {
        report.faults == []
        && list.any(report.broken, fn(one) { one.rule == rule })
      }
      case after == before, break.kind {
        True, _ -> Error("the edit did nothing: " <> break.name)
        False, Caught(rule) ->
          case breaks(rule) {
            True -> Ok(Nil)
            False ->
              Error(
                "missed: "
                <> break.name
                <> "\n  wanted: "
                <> rules.says(rule)
                <> "\n  got: "
                <> describe(report),
              )
          }
        False, Clean ->
          case fails {
            True ->
              Error("false alarm: " <> break.name <> "\n" <> describe(report))
            False -> Ok(Nil)
          }
        False, Escapes ->
          case fails {
            True -> Error("now caught, list it as Caught: " <> break.name)
            False -> Ok(Nil)
          }
      }
      |> swap
    })
  case wrong {
    [] -> Nil
    _ -> panic as string.join(wrong, "\n")
  }
}

fn swap(result: Result(a, b)) -> Result(b, a) {
  case result {
    Ok(value) -> Error(value)
    Error(value) -> Ok(value)
  }
}

fn describe(report: Report) -> String {
  let broken =
    list.map(report.broken, fn(broken) {
      broken.path
      <> "  "
      <> rules.says(broken.rule)
      <> "\n    "
      <> broken.detail
    })
  let faults =
    list.map(report.faults, fn(fault) { "the check itself: " <> fault })
  case list.append(broken, faults) {
    [] -> "architecture: the rules hold"
    lines ->
      "architecture: "
      <> string.inspect(list.length(lines))
      <> " broken\n\n"
      <> string.join(lines, "\n\n")
      <> "\n\nThe rules are in CLAUDE.md."
  }
}

fn source() -> List(File) {
  let assert Ok(paths) = simplifile.get_files("src")
  paths
  |> list.filter(fn(path) {
    string.ends_with(path, ".gleam") || string.ends_with(path, ".mjs")
  })
  |> list.map(fn(path) {
    let assert Ok(text) = simplifile.read(path)
    rules.read(Source(string.drop_start(path, 4), text))
  })
}

fn read_text(path: String) -> String {
  case simplifile.read("src/" <> path) {
    Ok(text) -> text
    Error(_) -> ""
  }
}

type Kind {
  /// This rule must fail, and the changed file must still parse.
  Caught(Rule)
  /// The rules must pass: a false alarm would train us to ignore them.
  Clean
  /// The rules are known to miss this. Review has to catch it.
  Escapes
}

type Break {
  Break(kind: Kind, name: String, path: String, change: fn(String) -> String)
}

fn first(text: String) -> fn(String) -> String {
  fn(rest) { text <> rest }
}

fn last(text: String) -> fn(String) -> String {
  fn(rest) { rest <> "\n" <> text <> "\n" }
}

fn both(
  one: fn(String) -> String,
  other: fn(String) -> String,
) -> fn(String) -> String {
  fn(rest) { other(one(rest)) }
}

fn after(anchor: String, text: String) -> fn(String) -> String {
  fn(rest) { string.replace(rest, anchor, anchor <> text) }
}

const edge_decoder =
  "fn edge_decoder(
  on_event: fn(editor.Event) -> msg,
) -> Decoder(event.Handler(msg)) {
"

const view =
  "pub fn view(editor: Editor, on_event: fn(editor.Event) -> msg) -> Element(msg) {
"

fn breaks() -> List(Break) {
  let surface = "nullpad/surface.gleam"
  let surface_js = "nullpad/surface.ffi.mjs"
  let platform_js = "nullpad/platform.ffi.mjs"
  let markdown_js = "nullpad/markdown.ffi.mjs"
  [
    Break(
      Caught(rules.CoreImports),
      "core imports Lustre",
      "nullpad/editor.gleam",
      first("import lustre/effect\n"),
    ),
    Break(
      Caught(rules.CoreImports),
      "core imports Lustre under an alias",
      "nullpad/live.gleam",
      first("import lustre/element as el\n"),
    ),
    Break(
      Caught(rules.CoreImports),
      "core imports the shell",
      "nullpad/vim.gleam",
      first("import nullpad/surface\n"),
    ),
    Break(
      Caught(rules.CoreImports),
      "core imports storage, which imports Lustre",
      "nullpad/buffer.gleam",
      first("import nullpad/storage\n"),
    ),
    Break(
      Caught(rules.CoreImports),
      "core imports a package",
      "nullpad/markdown.gleam",
      first("import plinth/browser/window\n"),
    ),
    Break(
      Caught(rules.CoreJavaScript),
      "core JavaScript reads the document",
      markdown_js,
      last("export const w = () => document.title;"),
    ),
    Break(
      Caught(rules.CoreJavaScript),
      "core JavaScript goes through globalThis",
      markdown_js,
      last("export const w = () => globalThis.document;"),
    ),
    Break(
      Caught(rules.JavaScriptFile),
      "a core module gets a JavaScript file",
      "nullpad/vim.ffi.mjs",
      first("export const now = () => Date.now();\n"),
    ),
    Break(
      Caught(rules.CallsJavaScript),
      "editor calls JavaScript",
      "nullpad/editor.gleam",
      last(
        "@external(javascript, \"./surface.ffi.mjs\", \"focusControl\")\nfn poke(id: String) -> Nil",
      ),
    ),
    Break(
      Caught(rules.CallsJavaScript),
      "app calls JavaScript",
      "nullpad/app.gleam",
      last(
        "@external(javascript, \"./platform.ffi.mjs\", \"below\")\nfn poke(id: String) -> Nil",
      ),
    ),
    Break(
      Caught(rules.BackendImport),
      "app imports a storage backend",
      "nullpad/app.gleam",
      first("import nullpad/storage/indexeddb\n"),
    ),
    Break(
      Caught(rules.BackendImport),
      "library imports a storage backend",
      "nullpad/library.gleam",
      first("import nullpad/storage/indexeddb as db\n"),
    ),
    Break(
      Caught(rules.FieldWrite),
      "platform JavaScript assigns the field",
      platform_js,
      last("export function w(el) { el.value = 'x'; }"),
    ),
    Break(
      Caught(rules.FieldWrite),
      "platform JavaScript appends to the field",
      platform_js,
      last("export function w(el) { el.value += 'x'; }"),
    ),
    Break(
      Caught(rules.FieldWrite),
      "platform JavaScript uses setRangeText",
      platform_js,
      last("export function w(el) { el.setRangeText('x'); }"),
    ),
    Break(
      Caught(rules.FieldWrite),
      "platform JavaScript moves the caret",
      platform_js,
      last("export function w(el) { el.selectionStart = 0; }"),
    ),
    Break(
      Caught(rules.JavaScriptRegex),
      "the old list-marker regex",
      surface_js,
      last("export const m = (s) => /^\\s*(?:[-*+]|\\d+[.)])\\s/.exec(s);"),
    ),
    Break(
      Caught(rules.JavaScriptRegex),
      "a heading regex with no character class",
      surface_js,
      last("export const h = (s) => /^#{1,6} /.test(s);"),
    ),
    Break(
      Caught(rules.JavaScriptRegex),
      "a regex built with new RegExp",
      surface_js,
      last("export const m = (s) => new RegExp('^x').exec(s);"),
    ),
    Break(
      Caught(rules.MarkdownMarker),
      "JavaScript finds list items with startsWith",
      surface_js,
      last("export const m = (s) => s.startsWith('- ') || s.startsWith('* ');"),
    ),
    Break(
      Caught(rules.MarkdownMarker),
      "a shell module finds list items by hand",
      surface,
      last(
        "fn is_item(line: String) -> Bool {\n  string.starts_with(line, \"- \")\n}",
      ),
    ),
    Break(
      Caught(rules.MarkdownMarker),
      "a shell module matches a marker in a pattern",
      surface,
      last(
        "fn is_item(line: String) -> Bool {\n  case line {\n    \"* \" <> _ -> True\n    _ -> False\n  }\n}",
      ),
    ),
    Break(
      Caught(rules.MarkdownMarker),
      "a marker built from two strings",
      surface,
      last(
        "fn is_item(line: String) -> Bool {\n  string.starts_with(line, \"-\" <> \" \")\n}",
      ),
    ),
    Break(
      Caught(rules.MarkdownMarker),
      "app finds headings by hand",
      "nullpad/app.gleam",
      last(
        "fn is_heading(line: String) -> Bool {\n  string.starts_with(line, \"# \")\n}",
      ),
    ),
    Break(
      Caught(rules.MarkdownMarker),
      "storage finds task boxes by hand",
      "nullpad/storage.gleam",
      last(
        "fn is_task(line: String) -> Bool {\n  string.contains(line, \"[x]\")\n}",
      ),
    ),
    Break(
      Caught(rules.ChangesPage),
      "a decoder blurs the field",
      surface,
      after(edge_decoder, "  blur_control(control_id)\n"),
    ),
    Break(
      Caught(rules.ChangesPage),
      "a decoder blurs the field through a helper",
      surface,
      both(
        after(edge_decoder, "  quiet(control_id)\n"),
        last("fn quiet(id: String) -> Nil {\n  blur_control(id)\n}"),
      ),
    ),
    Break(
      Caught(rules.ChangesPage),
      "a decoder blurs through two helpers",
      surface,
      both(
        after(edge_decoder, "  quiet(control_id)\n"),
        last(
          "fn quiet(id: String) -> Nil {\n  quieter(id)\n}\n\nfn quieter(id: String) -> Nil {\n  blur_control(id)\n}",
        ),
      ),
    ),
    Break(
      Caught(rules.ChangesPage),
      "a decoder passes the blur as a value",
      surface,
      after(edge_decoder, "  list.each([control_id], blur_control)\n"),
    ),
    Break(
      Caught(rules.ChangesPage),
      "a decoder focuses through platform",
      surface,
      both(
        first("import nullpad/platform\n"),
        after(edge_decoder, "  let _ = platform.focus(control_id)\n"),
      ),
    ),
    Break(
      Caught(rules.ChangesPage),
      "the view writes the field while drawing",
      surface,
      after(view, "  write_control(control_id, \"\", 0, 0)\n"),
    ),
    Break(
      Caught(rules.ChangesPage),
      "app draws and saves a setting at once",
      "nullpad/app.gleam",
      fn(rest) {
        string.replace(
          rest,
          "fn view(model: Model) -> Element(Msg) {\n",
          "fn view(model: Model) -> Element(Msg) {\n  let _ = platform.remember_vim_setting(True)\n",
        )
      },
    ),
    Break(
      Caught(rules.DecoderTakesEditor),
      "the edge decoder takes the editor again",
      surface,
      fn(rest) {
        string.replace(
          rest,
          "fn edge_decoder(\n",
          "fn edge_decoder(\n  editor: Editor,\n",
        )
      },
    ),
    Break(
      Caught(rules.ChangesPage),
      "new JavaScript is used from the view unlisted",
      surface,
      both(
        after(view, "  let _ = peek(control_id)\n"),
        last(
          "@external(javascript, \"./surface.ffi.mjs\", \"peek\")\nfn peek(id: String) -> Int",
        ),
      ),
    ),
    Break(
      Caught(rules.MeasureChanges),
      "a measure starts changing the page",
      surface_js,
      after(
        "export function caretLine(id) {\n",
        "  document.activeElement?.blur();\n",
      ),
    ),
    Break(
      Caught(rules.ChangesPage),
      "a function that returns a list of attributes blurs",
      surface,
      last(
        "fn extras() -> List(Attribute(msg)) {\n  blur_control(control_id)\n  []\n}",
      ),
    ),
    Break(
      Clean,
      "a commented-out import",
      "nullpad/editor.gleam",
      first("// import lustre/effect\n"),
    ),
    Break(
      Clean,
      "division in JavaScript",
      surface_js,
      last("export const half = (a, b) => a[0] / 2 + b[1] / 2;"),
    ),
    Break(
      Clean,
      "a core module imports another core module",
      "nullpad/vim.gleam",
      first("import nullpad/markdown\n"),
    ),
    Break(
      Clean,
      "a dash in ordinary interface text",
      "nullpad/app.gleam",
      last("const label = \"Saved - just now\""),
    ),
    Break(
      Clean,
      "a marker inside a comment",
      surface,
      last("// a list item starts with \"- \""),
    ),
    Break(
      Clean,
      "a new effect in surface",
      surface,
      last(
        "pub fn release() -> Effect(msg) {\n  effect.from(fn(_) { blur_control(control_id) })\n}",
      ),
    ),
    Break(
      Escapes,
      "a browser global spelled in pieces",
      markdown_js,
      last("export const w = () => Function('return this')()['doc' + 'ument'];"),
    ),
    Break(
      Escapes,
      "markdown knowledge with no marker literal",
      surface_js,
      last(
        "export const m = (s) => s.charCodeAt(0) === 45 && s.charCodeAt(1) === 32;",
      ),
    ),
    Break(
      Escapes,
      "a marker spelled as a code point",
      surface,
      last(
        "fn is_item(line: String) -> Bool {\n  string.to_utf_codepoints(line) |> list.first == string.utf_codepoint(45)\n}",
      ),
    ),
    Break(
      Escapes,
      "logic added to app instead of a pure module",
      "nullpad/app.gleam",
      last("fn decide(count: Int) -> Bool {\n  count > 3 && count % 2 == 0\n}"),
    ),
    Break(
      Escapes,
      "a field write through a computed property",
      platform_js,
      last("export function w(el) { el['val' + 'ue'] = 'x'; }"),
    ),
    Break(
      Escapes,
      "a measure changes the page through a helper",
      surface_js,
      both(
        after("export function caretLine(id) {\n", "  sneak();\n"),
        last("function sneak() { document.activeElement?.blur(); }"),
      ),
    ),
  ]
}
