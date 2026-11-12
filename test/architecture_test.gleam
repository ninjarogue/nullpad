//// Runs the architecture rules over `src`, then breaks the architecture on
//// purpose, one change at a time, and checks what the rules say about each.
////
////   gleam test                        both, with the other unit tests
////   gleam run -m architecture_test    print what each rule examined

import architecture/rules.{type File, type Report, type Rule, Source}
import gleam/int
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
    list.filter_map(all_breaks(), fn(break) {
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
  let all = all_breaks()
  let count = fn(wanted: fn(Kind) -> Bool) {
    int.to_string(list.count(all, fn(break) { wanted(break.kind) }))
  }
  io.println(
    "Architecture breaks: "
    <> count(fn(kind) { kind != Clean && kind != Escapes })
    <> " caught, "
    <> count(fn(kind) { kind == Clean })
    <> " harmless changes pass, "
    <> count(fn(kind) { kind == Escapes })
    <> " known escapes",
  )
  case wrong {
    [] -> Nil
    _ -> panic as string.join(wrong, "\n")
  }
}

pub fn every_rule_has_a_break_that_proves_it_test() {
  let unproven =
    list.filter(rules.rules, fn(rule) {
      !list.any(all_breaks(), fn(break) { break.kind == Caught(rule) })
    })
  case unproven {
    [] -> Nil
    _ ->
      panic as {
        "no break proves these rules catch anything: "
        <> string.join(list.map(unproven, rules.says), "; ")
      }
  }
}

fn all_breaks() -> List(Break) {
  list.flatten([breaks(), outside_breaks(), second_round()])
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
      <> "\n\nThe rules are in AGENTS.md."
  }
}

fn source() -> List(File) {
  let assert Ok(paths) = simplifile.get_files("src")
  paths
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
      Caught(rules.DecoderState),
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
      "a core module imports another core module",
      "nullpad/vim.gleam",
      first("import nullpad/markdown\n"),
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
      "logic added to app instead of a pure module",
      "nullpad/app.gleam",
      last("fn decide(count: Int) -> Bool {\n  count > 3 && count % 2 == 0\n}"),
    ),
  ]
}

/// Found by an attacker who had not seen `breaks`. The check as first
/// written missed every `Caught` here and raised every `Clean` here.
fn outside_breaks() -> List(Break) {
  let app = "nullpad/app.gleam"
  let surface = "nullpad/surface.gleam"
  let preview = "nullpad/preview.gleam"
  [
    Break(
      Caught(rules.Annotated),
      "a view helper with no return type focuses",
      app,
      last(
        "fn badge(count: Int) {\n  let _ = platform.focus(\"nullpad-control\")\n  html.span([], [element.text(\"x\")])\n}",
      ),
    ),
    Break(
      Caught(rules.ChangesPage),
      "a view helper that returns a String focuses",
      app,
      last(
        "fn badge(count: Int) -> String {\n  let _ = platform.focus(\"nullpad-control\")\n  \"x\"\n}",
      ),
    ),
    Break(
      Caught(rules.Annotated),
      "an inline key handler with no types focuses",
      surface,
      last(
        "fn on_enter(msg) {\n  event.on(\"keydown\", {\n    focus_control(control_id)\n    decode.success(msg)\n  })\n}",
      ),
    ),
    Break(
      Caught(rules.Listed),
      "a new settings module nobody listed",
      "nullpad/settings.gleam",
      first(
        "import lustre/element.{type Element}\nimport lustre/element/html\nimport nullpad/platform\n\npub fn view() -> Element(msg) {\n  let _ = platform.focus(\"nullpad-control\")\n  html.div([], [element.text(\"Settings\")])\n}\n",
      ),
    ),
    Break(
      Caught(rules.ChangesPage),
      "a new settings module focuses while drawing",
      "nullpad/settings.gleam",
      first(
        "import lustre/element.{type Element}\nimport lustre/element/html\nimport nullpad/platform\n\npub fn view() -> Element(msg) {\n  let _ = platform.focus(\"nullpad-control\")\n  html.div([], [element.text(\"Settings\")])\n}\n",
      ),
    ),
    Break(
      Caught(rules.Listed),
      "a new search module imports Lustre and platform",
      "nullpad/search.gleam",
      first(
        "import lustre/effect.{type Effect}\nimport nullpad/platform\n\npub fn jump(id: String) -> Effect(msg) {\n  platform.focus(id)\n}\n",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a decoder in app takes the model",
      app,
      last(
        "fn tab_decoder(model: Model) -> decode.Decoder(Msg) {\n  case model.vim {\n    True -> decode.success(UserClosedMenu)\n    False -> decode.success(UserClosedMenu)\n  }\n}",
      ),
    ),
    Break(
      Caught(rules.Annotated),
      "a decoder takes an untyped editor",
      surface,
      last(
        "fn quiet_decoder(editor) -> Decoder(Bool) {\n  decode.success(editor.is_idle(editor))\n}",
      ),
    ),
    Break(
      Caught(rules.FieldWrite),
      "app draws its own textarea",
      app,
      last(
        "fn scratch(model: Model) -> Element(Msg) {\n  html.textarea([attribute.value(editor.text(model.editor))], \"\")\n}",
      ),
    ),
    Break(
      Caught(rules.JavaScriptFile),
      "JavaScript in a plain .js file",
      "nullpad/extra.js",
      first(
        "export function wipe() {\n  document.querySelector(\"textarea\").value = \"\";\n}\n",
      ),
    ),
    Break(
      Caught(rules.CallsJavaScript),
      "platform calls another file's JavaScript",
      "nullpad/platform.gleam",
      last(
        "@external(javascript, \"./extra.js\", \"wipe\")\npub fn wipe() -> Nil",
      ),
    ),
    Break(
      Caught(rules.SkipsOutcome),
      "a public editor function hands back a bare Editor",
      "nullpad/editor.gleam",
      last("pub fn shout(editor: Editor) -> Editor {\n  editor\n}"),
    ),
    Break(
      Caught(rules.RawHtml),
      "preview draws raw HTML",
      preview,
      last(
        "fn raw(html: String) -> Element(msg) {\n  element.unsafe_raw_html(\"\", \"span\", [], html)\n}",
      ),
    ),
    Break(
      Clean,
      "a second storage backend",
      "nullpad/storage/localstorage.gleam",
      first(
        "@external(javascript, \"./localstorage.ffi.mjs\", \"count\")\npub fn count() -> Int\n",
      ),
    ),
    Break(
      Clean,
      "a second storage backend's JavaScript",
      "nullpad/storage/localstorage.ffi.mjs",
      first("export function count() {\n  return localStorage.length;\n}\n"),
    ),
    Break(
      Clean,
      "a parameter named like a function that changes the page",
      app,
      last(
        "fn tag(run: Bool) -> Element(Msg) {\n  case run {\n    True -> element.text(\"on\")\n    False -> element.none()\n  }\n}",
      ),
    ),
    Break(
      Clean,
      "a new effect in platform that scrolls",
      "nullpad/platform.gleam",
      last(
        "pub fn scroll_to(id: String) -> Effect(msg) {\n  effect.from(fn(_) { focus_element(id) })\n}",
      ),
    ),
    Break(
      Escapes,
      "a decoder decides what a key does",
      surface,
      last(
        "fn tab_decoder(on_event: fn(editor.Event) -> msg) -> Decoder(msg) {\n  use shown <- decode.then(shown_decoder())\n  decode.success(on_event(editor.ControlChanged(shown:)))\n}",
      ),
    ),
    Break(
      Escapes,
      "an inline handler reads the editor it was drawn with",
      surface,
      last(
        "fn mode_aware(editor: Editor, msg: msg) -> attribute.Attribute(msg) {\n  event.on(\"keydown\", {\n    case editor.is_idle(editor) {\n      True -> decode.success(msg)\n      False -> decode.failure(msg, \"idle\")\n    }\n  })\n}",
      ),
    ),
    Break(
      Escapes,
      "a wildcard in a case",
      app,
      last(
        "fn flip(showing: Bool) -> Bool {\n  case showing {\n    True -> False\n    _ -> True\n  }\n}",
      ),
    ),
  ]
}

/// From a second attacker. `Escapes` here is also the record of what moved
/// from a rule to review: the JavaScript text rules and the marker rule let
/// most of that attacker's breaks through and flagged ordinary code.
fn second_round() -> List(Break) {
  let app = "nullpad/app.gleam"
  let surface = "nullpad/surface.gleam"
  let editor = "nullpad/editor.gleam"
  let platform_js = "nullpad/platform.ffi.mjs"
  let surface_js = "nullpad/surface.ffi.mjs"
  [
    Break(
      Caught(rules.ChangesPage),
      "a constant holds a function that changes the page",
      app,
      last(
        "const poke = platform.focus\n\nfn badge(count: Int) -> String {\n  let _ = poke(\"nullpad-control\")\n  \"x\"\n}",
      ),
    ),
    Break(
      Caught(rules.RawHtml),
      "a constant holds unsafe_raw_html",
      app,
      last(
        "const raw = element.unsafe_raw_html\n\nfn banner() -> Element(Msg) {\n  raw(\"\", \"div\", [], \"<b>hi</b>\")\n}",
      ),
    ),
    Break(
      Caught(rules.FieldWrite),
      "a constant holds html.textarea",
      app,
      last(
        "const field = html.textarea\n\nfn second() -> Element(Msg) {\n  field([], \"\")\n}",
      ),
    ),
    Break(
      Caught(rules.FieldWrite),
      "a second text field through element.element",
      "nullpad/preview.gleam",
      last(
        "fn second_field(text: String) -> Element(msg) {\n  element.element(\"textarea\", [], [element.text(text)])\n}",
      ),
    ),
    Break(
      Caught(rules.FieldWrite),
      "a contenteditable element",
      app,
      last(
        "fn editable() -> attribute.Attribute(Msg) {\n  attribute.attribute(\"contenteditable\", \"true\")\n}",
      ),
    ),
    Break(
      Caught(rules.Annotated),
      "annotated with the hole type",
      app,
      last("fn twice(x: _) -> _ {\n  x\n}"),
    ),
    Break(
      Caught(rules.DecoderState),
      "a decoder hidden behind a type alias",
      surface,
      last(
        "type Handling(msg) =\n  Decoder(event.Handler(msg))\n\nfn shortcut(editor: Editor, on_event: fn(editor.Event) -> msg) -> Handling(msg) {\n  key_decoder(editor, on_event)\n}",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a decoder reads the editor through a callback",
      surface,
      last(
        "fn tab_decoder(read: fn() -> Editor, done: msg) -> Decoder(msg) {\n  case editor.is_idle(read()) {\n    True -> decode.success(done)\n    False -> decode.failure(done, \"idle\")\n  }\n}",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "the allowed decoder takes more state",
      surface,
      after("fn key_decoder(\n", "  last: Buffer,\n"),
    ),
    Break(
      Caught(rules.SkipsOutcome),
      "a public editor function returns an alias of Editor",
      editor,
      last(
        "pub type Edited =\n  Editor\n\npub fn blank(editor: Editor) -> Edited {\n  editor\n}",
      ),
    ),
    Break(
      Caught(rules.Listed),
      "a backend placed outside src/nullpad",
      "storage/memory.gleam",
      first("pub fn size() -> Int {\n  1\n}\n"),
    ),
    Break(
      Clean,
      "a decoder that takes a message",
      app,
      last(
        "fn tap_decoder(done: msg) -> decode.Decoder(msg) {\n  decode.success(done)\n}",
      ),
    ),
    Break(
      Clean,
      "a decoder that takes a list of key names",
      app,
      last(
        "fn keys_decoder(keys: List(String)) -> decode.Decoder(Bool) {\n  decode.success(keys == [])\n}",
      ),
    ),
    Break(
      Clean,
      "an effect behind a type alias",
      app,
      last(
        "type Fx =\n  Effect(Msg)\n\nfn nudge() -> Fx {\n  platform.after(10, UserClosedMenu)\n}",
      ),
    ),
    Break(
      Clean,
      "key names that look like markdown markers",
      app,
      last(
        "fn zoom_step(key: String) -> Int {\n  case key {\n    \"+\" -> 1\n    \"-\" -> -1\n    _ -> 0\n  }\n}",
      ),
    ),
    Break(
      Escapes,
      "a closure stored in the model is called from the view",
      app,
      both(
        after(
          "    menu: Option(Menu),\n",
          "    poke: fn(String) -> Effect(Msg),\n",
        ),
        both(
          after("      menu: None,\n", "      poke: platform.focus,\n"),
          after(
            "fn toggles(model: Model) -> Element(Msg) {\n",
            "  let _ = model.poke(\"nullpad-control\")\n",
          ),
        ),
      ),
    ),
    Break(
      Escapes,
      "a public editor function over a type that wraps Editor",
      editor,
      last(
        "pub type Session {\n  Session(editor: Editor, edits: Int)\n}\n\npub fn bump(session: Session) -> Session {\n  Session(..session, edits: session.edits + 1)\n}",
      ),
    ),
    Break(
      Escapes,
      "a storage backend's JavaScript changes the page",
      "nullpad/storage/indexeddb.ffi.mjs",
      last("export function announce(text) {\n  document.title = text;\n}"),
    ),
    Break(
      Escapes,
      "a shell module finds list items by hand",
      surface,
      last(
        "fn is_item(line: String) -> Bool {\n  string.starts_with(line, \"- \")\n}",
      ),
    ),
    Break(
      Escapes,
      "JavaScript finds list items with a regex",
      surface_js,
      last("export const m = (s) => /^\\s*(?:[-*+]|\\d+[.)])\\s/.exec(s);"),
    ),
    Break(
      Escapes,
      "platform JavaScript writes the field",
      platform_js,
      last("export function w(el) { el.value = 'x'; }"),
    ),
    Break(
      Escapes,
      "a measure starts changing the page",
      surface_js,
      after(
        "export function caretLine(id) {\n",
        "  document.activeElement?.blur();\n",
      ),
    ),
    Break(
      Escapes,
      "core JavaScript reads the document",
      "nullpad/markdown.ffi.mjs",
      last("export const w = () => document.title;"),
    ),
  ]
}
