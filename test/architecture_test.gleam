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
      let edits = case break {
        Break(path:, change:, ..) -> [#(path, change)]
        Breaks(edits:, ..) -> edits
      }
      let paths = list.map(edits, fn(edit) { edit.0 })
      let texts =
        list.map(edits, fn(edit) {
          let before = read_text(edit.0)
          #(edit.0, before, edit.1(before))
        })
      let idle = list.any(texts, fn(text) { text.1 == text.2 })
      let report =
        rules.judge(list.append(
          list.map(texts, fn(text) { rules.read(Source(text.0, text.2)) }),
          list.filter(files, fn(file) {
            !list.contains(paths, rules.path(file))
          }),
        ))
      let fails = report.broken != [] || report.faults != []
      let breaks = fn(rule) {
        report.faults == []
        && list.any(report.broken, fn(one) { one.rule == rule })
      }
      case idle, break.kind {
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
  list.flatten([
    breaks(),
    outside_breaks(),
    second_round(),
    third_round(),
    fourth_round(),
    fifth_round(),
  ])
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
  /// A break that edits more than one file.
  Breaks(kind: Kind, name: String, edits: List(#(String, fn(String) -> String)))
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

fn instead(old: String, new: String) -> fn(String) -> String {
  fn(rest) { string.replace(rest, old, new) }
}

const edge_decoder =
  "fn edge_decoder(
  on_event: fn(editor.Event) -> msg,
) -> Decoder(event.Handler(msg)) {
"

const view =
  "pub fn view(editor: Editor, on_event: fn(editor.Event) -> msg) -> Element(msg) {
"

/// An attribute of the text field, in the view, where the editor is drawn.
const view_attribute = "        attribute.aria_label(\"Note text\"),\n"

/// Where the view has the field's handlers made. It hands them no editor:
/// they read the one the last message left when the event comes.
const field_events = "..field_events(on_event)"

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
      Caught(rules.DecoderState),
      "a decoder reads the editor the last message left from JavaScript before the event comes",
      surface,
      after(edge_decoder, "  let _ = editor.is_painted(current_editor())\n"),
    ),
    Break(
      Caught(rules.DecoderState),
      "a decoder reads a JavaScript record through a helper before the event comes",
      surface,
      both(
        last(
          "fn waiting_now() -> Bool {\n  editor.is_waiting(current_editor())\n}",
        ),
        after(
          "fn hold_decoder(\n  on_event: fn(editor.Event) -> msg,\n) -> Decoder(event.Handler(msg)) {\n",
          "  let _ = waiting_now()\n",
        ),
      ),
    ),
    Break(
      Clean,
      "a decoder reads a JavaScript record through a helper when the event comes",
      surface,
      both(
        last(
          "fn waiting_now() -> Bool {\n  editor.is_waiting(current_editor())\n}",
        ),
        after(
          "  use key_code <- decode.optional_field(\"keyCode\", 0, decode.int)\n",
          "  let _ = waiting_now()\n",
        ),
      ),
    ),
    Break(
      Clean,
      "a callback made outside the decoders reads a JavaScript record",
      surface,
      last(
        "fn waits_now() -> fn() -> Bool {\n  fn() { editor.is_waiting(current_editor()) }\n}",
      ),
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
        "fn tab_decoder(on_event: fn(editor.Event) -> msg) -> Decoder(msg) {\n  use shown <- decode.then(shown_decoder())\n  decode.success(on_event(editor.ControlChanged(shown:, at: 0)))\n}",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
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
        "type Handling(msg) =\n  Decoder(event.Handler(msg))\n\nfn shortcut(editor: Editor, on_event: fn(editor.Event) -> msg) -> Handling(msg) {\n  let _ = editor.is_idle(editor)\n  key_decoder(on_event)\n}",
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
      "a decoder takes the notes",
      surface,
      both(
        after(
          "import nullpad/live\n",
          "import nullpad/library.{type Library}\n",
        ),
        after("fn key_decoder(\n", "  notes: Library,\n"),
      ),
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
      "a measure a decoder calls reads the editor JavaScript keeps",
      surface_js,
      after(
        "export function headLine(id, liveClass, paintedClass, painted) {\n",
        "  painted = current != null && painted;\n",
      ),
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

/// From a third attacker, who had not read the breaks above: decoders made
/// where no function is named a decoder, closures over the drawn editor, a
/// measure that hands back app state, and an import alias.
fn third_round() -> List(Break) {
  let surface = "nullpad/surface.gleam"
  let inline_decoder =
    "event.on(\"dblclick\", decode.success(on_event(editor.FocusChanged(editor.is_idle(editor))))),\n"
  [
    Break(
      Caught(rules.DecoderState),
      "the view hands a decoder a callback over the editor it draws",
      surface,
      instead(field_events, "..field_events(fn() { editor }, on_event)"),
    ),
    Break(
      Caught(rules.DecoderState),
      "a decoder is handed a closure over the editor outside the view",
      surface,
      last(
        "fn painted_edge(editor: Editor, on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.advanced(\"keydown\", edge_decoder(fn(event) {\n    case editor.is_painted(editor) {\n      True -> on_event(event)\n      False -> on_event(editor.Released)\n    }\n  }))\n}",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a decoder is handed a capture of an editor function over the editor",
      surface,
      last(
        "fn claimed(editor: Editor, on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.advanced(\"keydown\", key_decoder(released_unless(editor.claims(editor, vim.Escape), on_event, _)))\n}",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "an attribute helper makes a decoder from the editor",
      surface,
      last(
        "fn double_click(editor: Editor, on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.on(\"dblclick\", decode.success(on_event(editor.FocusChanged(editor.is_idle(editor)))))\n}",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "the view makes a decoder inline from the editor it draws",
      surface,
      after(view_attribute, "        " <> inline_decoder),
    ),
    Break(
      Caught(rules.DecoderState),
      "the view makes a decoder from the editor in the body of a use",
      surface,
      after(
        view_attribute,
        "        event.on(\"dblclick\", {\n          use _ <- decode.map(decode.dynamic)\n          on_event(editor.FocusChanged(editor.is_idle(editor)))\n        }),\n",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a decoder is handed a value read from the editor through a pipe",
      surface,
      last(
        "fn idle_now(editor: Editor, on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  let idle = editor.is_idle(editor)\n  event.on(\"dblclick\", on_event(editor.FocusChanged(idle)) |> decode.success)\n}",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a measure hands back the editor JavaScript keeps",
      surface,
      last(
        "@external(javascript, \"./surface.ffi.mjs\", \"pastedText\")\nfn last_editor(paste: Dynamic) -> Editor",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a decoder named through an import alias takes the editor",
      surface,
      both(
        fn(rest) {
          string.replace(
            rest,
            "import gleam/dynamic/decode.{type Decoder}",
            "import gleam/dynamic/decode.{type Decoder, type Decoder as Dec}",
          )
        },
        last(
          "fn tab(editor: Editor, done: msg) -> Dec(msg) {\n  case editor.is_idle(editor) {\n    True -> decode.success(done)\n    False -> decode.failure(done, \"idle\")\n  }\n}",
        ),
      ),
    ),
    Break(
      Clean,
      "the field's handlers read the record through a helper when the event comes",
      surface,
      both(
        instead(
          "      _, False -> on_event(editor.ControlChanged(shown:, at:))\n",
          "      _, False if latest() == latest() -> on_event(editor.ControlChanged(shown:, at:))\n      _, False -> on_event(editor.Released)\n",
        ),
        last("fn latest() -> Editor {\n  current_editor()\n}"),
      ),
    ),
    Break(
      Clean,
      "a decoder made from a message and a constructor of the editor module",
      surface,
      after(
        "    event.on(\"input\", typed),\n",
        "    event.on(\"dblclick\", decode.success(on_event(editor.Released))),\n",
      ),
    ),
    Break(
      Escapes,
      "a plain value read from the drawn editor reaches a decoder through a helper's parameter",
      surface,
      both(
        last(
          "fn on_double_click(idle: Bool, on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.on(\"dblclick\", decode.success(on_event(editor.FocusChanged(idle))))\n}",
        ),
        after(
          view_attribute,
          "        on_double_click(editor.is_idle(editor), on_event),\n",
        ),
      ),
    ),
  ]
}

/// From a fourth attacker, who had not read the breaks above, ported to
/// the code as it now stands: the field's handlers are made in `field_events`
/// and `page_events`, and app's in small functions that take no model. A
/// handler is handed no editor and reads the record when its event comes, so
/// the callbacks for the editor these first went through are gone, and a
/// closure over app state handed to a maker is caught however it is bound.
fn fourth_round() -> List(Break) {
  let app = "nullpad/app.gleam"
  let surface = "nullpad/surface.gleam"
  let moved =
    "  let moved = {\n    use name <- decode.field(\"key\", decode.string)\n    use composing <- decode.field(\"isComposing\", decode.bool)\n"
  let page_some =
    "Some(_) -> [attribute.class(\"page \" <> live_class), ..page_events(on_event)]"
  let page_head = "pub fn page(\n  editor: Editor,\n"
  let app_field =
    "  let field = #(\"field\", surface.view(model.editor, EditorSent))"
  let note_row_end = "  note_button(summary.id, title:, current:)\n}"
  let dblclick_painted =
    "event.on(\"dblclick\", case editor.is_painted(editor) {\n        True -> decode.success(on_event(editor.Released))\n        False -> decode.failure(on_event(editor.Released), expected: \"painted\")\n      }), "
  [
    Break(
      Caught(rules.DecoderState),
      "a01: the view reads the record while it draws and hands on a callback over the value",
      surface,
      both(
        after(view, "  let latest = current_editor()\n"),
        instead(
          field_events,
          "..field_events(fn(event) {\n          case editor.is_waiting(latest) {\n            True -> on_event(editor.Released)\n            False -> on_event(event)\n          }\n        })",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a01b: a handler's maker reads the record before its decoder",
      surface,
      instead(
        moved,
        "  let moved = {\n    let latest = current_editor()\n    use name <- decode.field(\"key\", decode.string)\n    use composing <- decode.field(\"isComposing\", decode.bool)\n    let composing = composing || editor.is_waiting(latest)\n",
      ),
    ),
    Break(
      Clean,
      "a01c: a decoder reads the record when the event comes",
      surface,
      after(
        moved,
        "    let composing = composing || editor.is_waiting(current_editor())\n",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a02: the view shadows the editor with the record and hands on a callback over it",
      surface,
      both(
        after(view, "  let editor = current_editor()\n"),
        instead(
          field_events,
          "..field_events(fn(event) {\n          case editor.is_waiting(editor) {\n            True -> on_event(editor.Released)\n            False -> on_event(event)\n          }\n        })",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a02b: a handler's maker shadows the editor with the record before its decoder",
      surface,
      instead(
        moved,
        "  let moved = {\n    let editor = current_editor()\n    use name <- decode.field(\"key\", decode.string)\n    use composing <- decode.field(\"isComposing\", decode.bool)\n    let composing = composing || editor.is_waiting(editor)\n",
      ),
    ),
    Break(
      Escapes,
      "a03: the page hands the press handler a value read from the drawn editor",
      surface,
      both(
        instead(
          "..page_events(on_event)]",
          "..page_events(editor.is_painted(editor), on_event)]",
        ),
        both(
          instead("fn page_events(\n", "fn page_events(\n  painted: Bool,\n"),
          instead(
            "    on_point(on_event),\n",
            "    on_point(on_event),\n    on_shift_click(fn(event) { case painted { True -> on_event(editor.Released) False -> on_event(event) } }),\n",
          ),
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a04: app hands the field a message callback over the model",
      app,
      instead(
        app_field,
        "  let field = #(\n    \"field\",\n    surface.view(model.editor, fn(event) {\n      case model.menu {\n        Some(_) -> UserClosedMenu\n        None -> EditorSent(event)\n      }\n    }),\n  )",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a05: the page hands its handlers a message callback over the drawn editor",
      surface,
      instead(
        "..page_events(on_event)]",
        "..page_events(fn(event) {\n      case editor.is_painted(editor) {\n        True -> on_event(editor.Released)\n        False -> on_event(event)\n      }\n    })]",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a06: the view makes a handler for the kind of block it draws",
      surface,
      after(
        view_attribute,
        "        case kind {\n          Some(live.ListItem(task: True, ..)) ->\n            event.on(\"keydown\", {\n              use name <- decode.field(\"key\", decode.string)\n              case name {\n                \"Tab\" -> decode.success(on_event(editor.Released))\n                _ -> decode.failure(on_event(editor.Released), expected: \"Tab\")\n              }\n            })\n          Some(_) | None -> attribute.none()\n        },\n",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a06b: the view makes a handler from a value a case takes from the editor",
      surface,
      after(
        view_attribute,
        "        case editor.kind(editor) {\n          Some(live.ListItem(task:, ..)) ->\n            event.on(\"keydown\", {\n              use name <- decode.field(\"key\", decode.string)\n              case name == \"Tab\" && task {\n                True -> decode.success(on_event(editor.Released))\n                False -> decode.failure(on_event(editor.Released), expected: \"Tab\")\n              }\n            })\n          Some(_) | None -> attribute.none()\n        },\n",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a06c: the view makes a handler from a value a let takes from the editor",
      surface,
      after(
        view_attribute,
        "        {\n          let task = editor.kind(editor) == Some(live.ListItem(marker: \"- [ ] \", task: True))\n          event.on(\"keydown\", {\n            use name <- decode.field(\"key\", decode.string)\n            case name == \"Tab\" && task {\n              True -> decode.success(on_event(editor.Released))\n              False -> decode.failure(on_event(editor.Released), expected: \"Tab\")\n            }\n          })\n        },\n",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a07: the view makes a handler inside an option.map over the region",
      surface,
      after(
        view_attribute,
        "        editor.region(editor)\n          |> option.map(fn(region) {\n            event.on(\"dblclick\", {\n              use y <- decode.field(\"clientY\", decode.float)\n              case y <. int.to_float(region.first_row) {\n                True -> decode.success(on_event(editor.Released))\n                False -> decode.failure(on_event(editor.Released), expected: \"above\")\n              }\n            })\n          })\n          |> option.unwrap(attribute.none()),\n",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a08: app maps the field's messages through a closure over the model",
      app,
      instead(
        app_field,
        "  let field = #(\n    \"field\",\n    surface.view(model.editor, fn(event) { event })\n      |> element.map(fn(event) {\n        case model.menu {\n          Some(_) -> UserClosedMenu\n          None -> EditorSent(event)\n        }\n      }),\n  )",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a09: a handler's maker takes the notes",
      app,
      last(
        "fn delete_key(library: Library, id: NoteId) -> attribute.Attribute(Msg) {\n  event.on(\"keydown\", {\n    use key <- decode.field(\"key\", decode.string)\n    case key, library.deleting(library) {\n      \"Delete\", None | \"Backspace\", None -> decode.success(UserDeletedNote(id))\n      _, _ -> decode.failure(UserClosedMenu, expected: \"the Delete key\")\n    }\n  })\n}",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a10: the page makes a handler from a value a use takes from the editor",
      surface,
      both(
        after(
          page_head
            <> "  on_event: fn(editor.Event) -> msg,\n) -> List(attribute.Attribute(msg)) {\n",
          "  use <- bool.guard(editor.region(editor) == None, [attribute.class(\"page\")])\n  use #(_, head) <- list.flat_map([buffer.selection(editor.buffer(editor))])\n",
        ),
        instead(
          page_some,
          "Some(_) -> [attribute.class(\"page \" <> live_class), event.on(\"dblclick\", {\n      use y <- decode.field(\"clientY\", decode.float)\n      case y >. int.to_float(head.row) {\n        True -> decode.success(on_event(editor.Released))\n        False -> decode.failure(on_event(editor.Released), expected: \"below\")\n      }\n    }), ..page_events(on_event)]",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a11: sync hands a drag listener a callback over the editor",
      surface,
      instead(
        "            fn(row, visible, at_end, next) {\n              dispatch(on_event(editor.Dragged(row:, visible:, at_end:, next:)))\n            },\n",
        "            fn(row, visible, at_end, next) {\n              let #(_, head) = buffer.selection(editor.buffer(editor))\n              case row == head.row && !at_end {\n                True -> Nil\n                False -> dispatch(on_event(editor.Dragged(row:, visible:, at_end:, next:)))\n              }\n            },\n",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a12: the view makes a handler through a local name for event.on",
      surface,
      both(
        after(view, "  let on = event.on\n"),
        after(view_attribute, "        on(\"keyup\", key_up),\n"),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a13: a note row takes the editor out of the model for a handler",
      app,
      instead(
        note_row_end,
        "  let Model(editor: drawn, ..) = model\n  html.div(\n    [\n      event.on(\"keydown\", {\n        use key <- decode.field(\"key\", decode.string)\n        case key {\n          \"Delete\" if drawn == drawn -> decode.success(UserDeletedNote(summary.id))\n          _ -> decode.failure(UserClosedMenu, expected: \"the Delete key\")\n        }\n      }),\n    ],\n    [note_button(summary.id, title:, current:)],\n  )\n}",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a13b: a note row's handler calls a closure a case made over the model",
      app,
      instead(
        note_row_end,
        "  let empty = case model {\n    Model(editor:, ..) -> fn() { editor.text(editor) == \"\" }\n  }\n  html.div(\n    [\n      event.on(\"keydown\", {\n        use key <- decode.field(\"key\", decode.string)\n        case key == \"Delete\" && empty() {\n          True -> decode.failure(UserClosedMenu, expected: \"a note with text\")\n          False -> decode.success(UserDeletedNote(summary.id))\n        }\n      }),\n    ],\n    [note_button(summary.id, title:, current:)],\n  )\n}",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a13b: a note row hands its button a callback a case made over the model",
      app,
      instead(
        note_row_end,
        "  let empty = case model {\n    Model(editor:, ..) -> fn() { editor.text(editor) == \"\" }\n  }\n  note_button(summary.id, title:, current:, empty:)\n}",
      ),
    ),
    Breaks(
      Caught(rules.DecoderState),
      "a14: the page takes the editor under an alias from the editor module",
      [
        #(
          "nullpad/editor.gleam",
          instead(
            "pub opaque type Editor {",
            "pub type Drawn =\n  Editor\n\npub opaque type Editor {",
          ),
        ),
        #(
          surface,
          both(
            instead(page_head, "pub fn page(\n  editor: editor.Drawn,\n"),
            instead(
              page_some,
              "Some(_) -> [" <> dblclick_painted <> "..page_events(on_event)]",
            ),
          ),
        ),
      ],
    ),
    Break(
      Caught(rules.DecoderState),
      "a14c: the page makes a handler from the editor it draws",
      surface,
      instead(
        page_some,
        "Some(_) -> [" <> dblclick_painted <> "..page_events(on_event)]",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "c01: the view hands the field's handlers a capture over the editor it draws",
      surface,
      instead(field_events, "..field_events(drawn(editor, on_event, _))"),
    ),
    Break(
      Caught(rules.DecoderState),
      "c02: the view hands the field's handlers a callback a helper made over the editor",
      surface,
      both(
        instead(field_events, "..field_events(drawn_of(editor, on_event))"),
        last(
          "fn drawn_of(editor: Editor, on_event: fn(editor.Event) -> msg) -> fn(editor.Event) -> msg {\n  fn(event) {\n    case editor.is_idle(editor) {\n      True -> on_event(editor.Released)\n      False -> on_event(event)\n    }\n  }\n}",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "c03: the view hands on a callback over a tuple that holds the editor",
      surface,
      both(
        after(view, "  let drawn = #(editor, 0)\n"),
        instead(
          field_events,
          "..field_events(fn(event) {\n          case editor.is_idle(drawn.0) {\n            True -> on_event(editor.Released)\n            False -> on_event(event)\n          }\n        })",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "c04: the view hands on a callback over a list that holds the editor",
      surface,
      instead(
        field_events,
        "..field_events(fn(event) { list.fold([editor], on_event(event), fn(message, _) { message }) })",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "c05: the field's handlers take the drawn editor as well",
      surface,
      both(
        instead(
          "fn field_events(\n  on_event",
          "fn field_events(\n  drawn: Editor,\n  on_event",
        ),
        after(
          moved,
          "    let composing = composing || editor.is_waiting(drawn)\n",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "c06: the view maps the field's decoder over the editor it draws",
      surface,
      after(
        view_attribute,
        "        event.on(\"select\", shown_decoder() |> decode.map(fn(shown) {\n          case shown == editor.field_buffer(editor) {\n            True -> on_event(editor.Released)\n            False -> on_event(editor.ControlChanged(shown:, at: 0))\n          }\n        })),\n",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "c07: app makes a key handler from the mode of the editor in the model",
      app,
      after(
        "    markdown_button(model.showing),\n",
        "    html.span(\n      [\n        event.on_keydown(fn(key) {\n          case key, editor.mode(model.editor) {\n            \"Escape\", editor.Insert -> UserToggledMarkdown\n            _, _ -> UserClosedMenu\n          }\n        }),\n      ],\n      [],\n    ),\n",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "c08: the page takes the editor under a local alias",
      surface,
      both(
        first("type Drawn =\n  Editor\n\n"),
        both(
          instead(page_head, "pub fn page(\n  editor: Drawn,\n"),
          instead(
            page_some,
            "Some(_) -> [" <> dblclick_painted <> "..page_events(on_event)]",
          ),
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "c09: the page takes the editor under an import alias",
      surface,
      both(
        instead(
          "import nullpad/editor.{type Editor}",
          "import nullpad/editor.{type Editor, type Editor as Note}",
        ),
        both(
          instead(page_head, "pub fn page(\n  editor: Note,\n"),
          instead(
            page_some,
            "Some(_) -> [" <> dblclick_painted <> "..page_events(on_event)]",
          ),
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "c10: a note row makes a handler from the menu in the model",
      app,
      instead(
        note_row_end,
        "  html.div(\n    [\n      event.on(\"keydown\", {\n        use key <- decode.field(\"key\", decode.string)\n        case key {\n          \"Delete\" if model.menu == None -> decode.success(UserDeletedNote(summary.id))\n          _ -> decode.failure(UserClosedMenu, expected: \"the Delete key\")\n        }\n      }),\n    ],\n    [note_button(summary.id, title:, current:)],\n  )\n}",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "c12: a decoder is handed a callback for the editor",
      surface,
      both(
        instead(
          "fn hold_decoder(\n  on_event: fn(editor.Event) -> msg,\n) -> Decoder(event.Handler(msg)) {\n",
          "fn hold_decoder(\n  drawn: fn() -> Editor,\n  on_event: fn(editor.Event) -> msg,\n) -> Decoder(event.Handler(msg)) {\n  let waits = fn() { editor.is_waiting(drawn()) }\n",
        ),
        instead(
          "decode.one_of(hold_decoder(on_event), [",
          "decode.one_of(hold_decoder(current_editor, on_event), [",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "c13: the view hands on a callback over a let that holds the editor",
      surface,
      both(
        after(view, "  let drawn = editor\n"),
        instead(
          field_events,
          "..field_events(fn(event) {\n          case editor.is_idle(drawn) {\n            True -> on_event(editor.Released)\n            False -> on_event(event)\n          }\n        })",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "c14: the view hands on a callback over the editor that a let holds",
      surface,
      both(
        after(
          view,
          "  let pick = fn(event) {\n    case editor.is_idle(editor) {\n      True -> on_event(editor.Released)\n      False -> on_event(event)\n    }\n  }\n",
        ),
        instead(field_events, "..field_events(on_event: pick)"),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "f02: a key handler's maker takes a callback for the editor",
      surface,
      last(
        "fn on_keydown(\n  now: fn() -> Editor,\n  on_event: fn(editor.Event) -> msg,\n) -> attribute.Attribute(msg) {\n  let _ = now\n  event.advanced(\"keydown\", keydown_decoder(on_event))\n}",
      ),
    ),
    Break(
      Clean,
      "f03a: a decoder takes an editor event decoded from the event",
      surface,
      last(
        "fn asked_decoder(\n  asked: Result(editor.Event, Nil),\n  on_event: fn(editor.Event) -> msg,\n) -> Decoder(msg) {\n  case asked {\n    Ok(asked) -> decode.success(on_event(asked))\n    Error(Nil) -> decode.failure(on_event(editor.Released), expected: \"an undo\")\n  }\n}",
      ),
    ),
    Break(
      Clean,
      "f03b: a decoder takes a key decoded from the event",
      surface,
      last(
        "fn pressed_decoder(\n  key: vim.Key,\n  on_event: fn(editor.Event) -> msg,\n) -> Decoder(event.Handler(msg)) {\n  use shown <- decode.map(shown_decoder())\n  on_event(editor.KeyPressed(key:, shown:))\n  |> event.handler(prevent_default: True, stop_propagation: False)\n}",
      ),
    ),
    Break(
      Clean,
      "f03c: a decoder takes the buffer the field reported",
      surface,
      last(
        "fn escaped(\n  pressed: Bool,\n  shown: Buffer,\n  on_event: fn(editor.Event) -> msg,\n) -> Decoder(event.Handler(msg)) {\n  let handler =\n    on_event(editor.EscapePressed(shown:))\n    |> event.handler(prevent_default: False, stop_propagation: False)\n  case pressed {\n    True -> decode.success(handler)\n    False -> decode.failure(handler, expected: \"Escape\")\n  }\n}",
      ),
    ),
    Break(
      Clean,
      "f04: app runs a decoder it makes from the model at once",
      app,
      last(
        "pub fn restored(model: Model, saved: Dynamic) -> Model {\n  let settings = {\n    use vim <- decode.optional_field(\"vim\", model.vim, decode.bool)\n    decode.success(vim)\n  }\n  case decode.run(saved, settings) {\n    Ok(vim) -> Model(..model, vim:)\n    Error(_) -> model\n  }\n}",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "f05: app makes a handler inline with a message from the model",
      app,
      after(
        "    markdown_button(model.showing),\n",
        "    html.span(\n      [event.on(\"dblclick\", decode.success(UserToggledVim(on: !model.vim)))],\n      [],\n    ),\n",
      ),
    ),
    Break(
      Clean,
      "f07: sync runs a decoder that falls back on the editor at once",
      surface,
      instead(
        "          #(-4, _, _, _, x) -> {\n            case decode.run(find_control(control_id), control_decoder()) {",
        "          #(-4, _, _, _, x) -> {\n            let shown =\n              decode.one_of(control_decoder(), [\n                decode.success(editor.field_buffer(editor)),\n              ])\n            case decode.run(find_control(control_id), shown) {",
      ),
    ),
  ]
}

/// From a fifth attacker, who had not read the breaks above, ported to
/// handlers that are handed no editor: each name starts with the attacker's
/// script. Most of these got past the rule that let a maker take a callback
/// for the editor, or raised it over code that was right.
fn fifth_round() -> List(Break) {
  [
    Break(
      Caught(rules.DecoderState),
      "a00, b00: the view hands a copy handler a message callback over the editor it draws",
      "nullpad/surface.gleam",
      both(
        after(
          view_attribute,
          "        on_copy(fn(event) {\n          case editor.is_painted(editor) {\n            True -> on_event(event)\n            False -> on_event(editor.Released)\n          }\n        }),\n",
        ),
        last(
          "fn on_copy(on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a01, b01: the callback over the drawn editor is chosen by a case written as the argument",
      "nullpad/surface.gleam",
      both(
        after(
          view_attribute,
          "        on_copy(case editor.region(editor) {\n          None -> on_event\n          Some(_) -> fn(event) {\n          case editor.is_painted(editor) {\n            True -> on_event(event)\n            False -> on_event(editor.Released)\n          }\n        }\n        }),\n",
        ),
        last(
          "fn on_copy(on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a02, b02: the callback over the drawn editor is written inside a tuple",
      "nullpad/surface.gleam",
      both(
        after(
          view_attribute,
          "        on_copy(#(fn(event) {\n          case editor.is_painted(editor) {\n            True -> on_event(event)\n            False -> on_event(editor.Released)\n          }\n        }, 0)),\n",
        ),
        last(
          "fn on_copy(asks: #(fn(editor.Event) -> msg, Int)) -> attribute.Attribute(msg) {\n  let #(on_event, _) = asks\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a03, b03: the callback over the drawn editor is written inside Some",
      "nullpad/surface.gleam",
      both(
        after(
          view_attribute,
          "        on_copy(Some(fn(event) {\n          case editor.is_painted(editor) {\n            True -> on_event(event)\n            False -> on_event(editor.Released)\n          }\n        }), on_event),\n",
        ),
        last(
          "fn on_copy(picked: Option(fn(editor.Event) -> msg), on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  let on_event = option.unwrap(picked, on_event)\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "b04: the callback over the drawn editor is a field of a record",
      "nullpad/surface.gleam",
      both(
        first(
          "type Copying(msg) {\n  Copying(on_event: fn(editor.Event) -> msg, rows: Int)\n}\n\n",
        ),
        both(
          after(
            view_attribute,
            "        on_copy(Copying(on_event: fn(event) {\n          case editor.is_painted(editor) {\n            True -> on_event(event)\n            False -> on_event(editor.Released)\n          }\n        }, rows: 0)),\n",
          ),
          last(
            "fn on_copy(copying: Copying(msg)) -> attribute.Attribute(msg) {\n  let Copying(on_event:, ..) = copying\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
          ),
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "b05: the callback over the drawn editor is one of a list",
      "nullpad/surface.gleam",
      both(
        after(
          view_attribute,
          "        on_copy([fn(event) {\n          case editor.is_painted(editor) {\n            True -> on_event(event)\n            False -> on_event(editor.Released)\n          }\n        }], on_event),\n",
        ),
        last(
          "fn on_copy(pickers: List(fn(editor.Event) -> msg), on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  let on_event = list.first(pickers) |> result.unwrap(on_event)\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a18, b07: the view binds the callback over the drawn editor with let and hands it on",
      "nullpad/surface.gleam",
      both(
        after(
          view,
          "  let pick = fn(event) {\n    case editor.is_painted(editor) {\n      True -> on_event(event)\n      False -> on_event(editor.Released)\n    }\n  }\n",
        ),
        both(
          after(view_attribute, "        on_copy(pick),\n"),
          last(
            "fn on_copy(on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
          ),
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a20, b08: a helper makes the callback over the drawn editor",
      "nullpad/surface.gleam",
      both(
        both(
          after(
            view_attribute,
            "        on_copy(painted_now(editor, on_event)),\n",
          ),
          last(
            "fn on_copy(on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
          ),
        ),
        last(
          "fn painted_now(editor: Editor, on_event: fn(editor.Event) -> msg) -> fn(editor.Event) -> msg {\n  fn(event) {\n    case editor.is_painted(editor) {\n      True -> on_event(event)\n      False -> on_event(editor.Released)\n    }\n  }\n}",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a23, b09: the view reads the record while it draws and hands on a callback over the value",
      "nullpad/surface.gleam",
      both(
        after(view, "  let latest = current_editor()\n"),
        both(
          after(
            view_attribute,
            "        on_copy(fn(event) {\n          case editor.is_painted(latest) {\n            True -> on_event(event)\n            False -> on_event(editor.Released)\n          }\n        }),\n",
          ),
          last(
            "fn on_copy(on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
          ),
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "b11: a handler's maker calls a closure bound with let that reads the record",
      "nullpad/surface.gleam",
      both(
        after(view_attribute, "        on_copy(on_event),\n"),
        last(
          "fn on_copy(on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  let painted = fn() { editor.is_painted(current_editor()) }\n  let _ = painted()\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "b11c: a handler's maker reads the record before its decoder",
      "nullpad/surface.gleam",
      both(
        after(view_attribute, "        on_copy(on_event),\n"),
        last(
          "fn on_copy(on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  let _ = editor.is_painted(current_editor())\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "b12: the view binds the editor with let under another name and hands on a callback over it",
      "nullpad/surface.gleam",
      both(
        after(view, "  let drawn = editor\n"),
        both(
          after(
            view_attribute,
            "        on_copy(fn(event) {\n          case editor.is_painted(drawn) {\n            True -> on_event(event)\n            False -> on_event(editor.Released)\n          }\n        }),\n",
          ),
          last(
            "fn on_copy(on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
          ),
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "b13: a handler's maker is handed a callback that hands back a Bool",
      "nullpad/surface.gleam",
      both(
        after(
          view_attribute,
          "        on_copy(fn() { editor.is_painted(current_editor()) }, on_event),\n",
        ),
        last(
          "fn on_copy(paints: fn() -> Bool, on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    let _ = paints()\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a05: the field's handlers are chosen by a closure bound with let that reads the record",
      "nullpad/surface.gleam",
      both(
        after(
          "fn field_events(\n  on_event: fn(editor.Event) -> msg,\n) -> List(attribute.Attribute(msg)) {\n",
          "  let in_vim = fn() { editor.mode(current_editor()) != editor.Plain }\n",
        ),
        instead(
          "    event.advanced(\"keydown\", keydown_decoder(on_event)),\n",
          "    event.advanced(\"keydown\", case in_vim() {\n      True -> keydown_decoder(on_event)\n      False -> hold_decoder(on_event)\n    }),\n",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a06: the field's handlers hand the record to a helper that reads it at once",
      "nullpad/surface.gleam",
      both(
        instead(
          "    event.advanced(\"keydown\", keydown_decoder(on_event)),\n",
          "    event.advanced(\"keydown\", case in_vim(current_editor) {\n      True -> keydown_decoder(on_event)\n      False -> hold_decoder(on_event)\n    }),\n",
        ),
        last(
          "fn in_vim(now: fn() -> Editor) -> Bool {\n  editor.mode(now()) != editor.Plain\n}",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a07: the field's handlers take a record that holds a callback for the editor",
      "nullpad/surface.gleam",
      both(
        instead(
          "fn field_events(\n  on_event: fn(editor.Event) -> msg,\n) -> List(attribute.Attribute(msg)) {\n",
          "type Reads(msg) {\n  Reads(now: fn() -> Editor, on_event: fn(editor.Event) -> msg)\n}\n\nfn field_events(reads: Reads(msg)) -> List(attribute.Attribute(msg)) {\n  let Reads(on_event:, ..) = reads\n",
        ),
        instead(
          "..field_events(on_event)",
          "..field_events(Reads(now: current_editor, on_event:))",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a08: the field's handlers take a tuple that holds a callback for the editor",
      "nullpad/surface.gleam",
      both(
        instead(
          "fn field_events(\n  on_event: fn(editor.Event) -> msg,\n) -> List(attribute.Attribute(msg)) {\n",
          "fn field_events(\n  reads: #(fn() -> Editor, fn(editor.Event) -> msg),\n) -> List(attribute.Attribute(msg)) {\n  let #(_, on_event) = reads\n",
        ),
        instead(
          "..field_events(on_event)",
          "..field_events(#(current_editor, on_event))",
        ),
      ),
    ),
    Breaks(
      Caught(rules.DecoderState),
      "a12: the field's handlers take a callback for the editor under an alias from the editor module",
      [
        #(
          "nullpad/editor.gleam",
          instead(
            "pub type Mode {",
            "pub type Latest =\n  fn() -> Editor\n\npub type Mode {",
          ),
        ),
        #(
          "nullpad/surface.gleam",
          instead(
            "fn field_events(\n  on_event: fn(editor.Event) -> msg,\n) -> List(attribute.Attribute(msg)) {\n",
            "fn field_events(\n  now: editor.Latest,\n  on_event: fn(editor.Event) -> msg,\n) -> List(attribute.Attribute(msg)) {\n",
          ),
        ),
      ],
    ),
    Break(
      Caught(rules.DecoderState),
      "a12b: the field's handlers take a callback for the editor under a local alias",
      "nullpad/surface.gleam",
      both(
        first("type Latest =\n  fn() -> Editor\n\n"),
        instead(
          "fn field_events(\n  on_event: fn(editor.Event) -> msg,\n) -> List(attribute.Attribute(msg)) {\n",
          "fn field_events(\n  now: Latest,\n  on_event: fn(editor.Event) -> msg,\n) -> List(attribute.Attribute(msg)) {\n",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a13: sync hands the drag listener a release callback that calls a closure over the editor",
      "nullpad/surface.gleam",
      instead(
        "            fn() { dispatch(on_event(editor.Released)) },\n          )\n        })\n      effect.batch([placed, followed, painted])",
        "            fn() {\n              draw(dispatch)\n              dispatch(on_event(editor.Released))\n            },\n          )\n        })\n      effect.batch([placed, followed, painted])",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a13b: sync hands the drag listener a release callback that paints the editor",
      "nullpad/surface.gleam",
      instead(
        "            fn() { dispatch(on_event(editor.Released)) },\n          )\n        })\n      effect.batch([placed, followed, painted])",
        "            fn() {\n              paint(editor)\n              dispatch(on_event(editor.Released))\n            },\n          )\n        })\n      effect.batch([placed, followed, painted])",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a14: app maps a storage answer through a closure over the model",
      "nullpad/app.gleam",
      instead(
        "      storage.load(model.storage, id, answer(library.StorageLoaded)),\n",
        "      storage.load(model.storage, id, answer(library.StorageLoaded))\n        |> effect.map(fn(loaded) {\n          case editor.mode(model.editor) {\n            editor.Plain -> loaded\n            editor.Normal | editor.Insert -> loaded\n          }\n        }),\n",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a16: the sidebar makes a handler in a closure bound with let, with the model in scope",
      "nullpad/app.gleam",
      instead(
        "fn sidebar(model: Model) -> Element(Msg) {\n",
        "fn sidebar(model: Model) -> Element(Msg) {\n  let _new_note = fn() {\n    html.button([event.on_click(ToLibrary(library.UserAskedForNewNote))], [])\n  }\n",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a17: a decoder takes a callback for the editor and calls it before the event comes",
      "nullpad/surface.gleam",
      instead(
        "fn edge_decoder(\n  on_event",
        "fn edge_decoder(\n  now: fn() -> Editor,\n  on_event",
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a19: the field's handlers take a record of callbacks written over the drawn editor",
      "nullpad/surface.gleam",
      both(
        instead(
          "fn field_events(\n  on_event: fn(editor.Event) -> msg,\n) -> List(attribute.Attribute(msg)) {\n",
          "type Asks {\n  Asks(waits: fn() -> Bool, claims: fn(vim.Key) -> Bool)\n}\n\nfn field_events(\n  asks: Asks,\n  on_event: fn(editor.Event) -> msg,\n) -> List(attribute.Attribute(msg)) {\n  let Asks(..) = asks\n",
        ),
        instead(
          "..field_events(on_event)",
          "..field_events(\n          Asks(\n            waits: fn() { editor.is_waiting(editor) },\n            claims: fn(key) { editor.claims(editor, key) },\n          ),\n          on_event,\n        )",
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a29: the title field's callback over the model is chosen by a case written as the argument",
      "nullpad/app.gleam",
      both(
        instead(
          "      title_field(\n        open.title,\n        placeholder: storage.display_title(None, editor.text(model.editor)),\n      ),",
          "      title_field(\n        open.title,\n        placeholder: storage.display_title(None, editor.text(model.editor)),\n        renamed: case open.title {\n          None -> fn(title) {\n            ToLibrary(library.UserRenamedNote(case title {\n              \"\" -> storage.display_title(None, editor.text(model.editor))\n              _ -> title\n            }))\n          }\n          Some(_) -> fn(title) { ToLibrary(library.UserRenamedNote(title)) }\n        },\n      ),",
        ),
        both(
          instead(
            "fn title_field(\n  title: Option(String),\n  placeholder placeholder: String,\n) -> Element(Msg) {",
            "fn title_field(\n  title: Option(String),\n  placeholder placeholder: String,\n  renamed renamed: fn(String) -> Msg,\n) -> Element(Msg) {",
          ),
          instead(
            "    event.on_input(fn(title) { ToLibrary(library.UserRenamedNote(title)) }),",
            "    event.on_input(renamed),",
          ),
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a29c: the title field is handed a callback over the model",
      "nullpad/app.gleam",
      both(
        instead(
          "      title_field(\n        open.title,\n        placeholder: storage.display_title(None, editor.text(model.editor)),\n      ),",
          "      title_field(\n        open.title,\n        placeholder: storage.display_title(None, editor.text(model.editor)),\n        renamed: fn(title) {\n          ToLibrary(library.UserRenamedNote(case title {\n            \"\" -> storage.display_title(None, editor.text(model.editor))\n            _ -> title\n          }))\n        },\n      ),",
        ),
        both(
          instead(
            "fn title_field(\n  title: Option(String),\n  placeholder placeholder: String,\n) -> Element(Msg) {",
            "fn title_field(\n  title: Option(String),\n  placeholder placeholder: String,\n  renamed renamed: fn(String) -> Msg,\n) -> Element(Msg) {",
          ),
          instead(
            "    event.on_input(fn(title) { ToLibrary(library.UserRenamedNote(title)) }),",
            "    event.on_input(renamed),",
          ),
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a31: the toolbar binds the editor with let and hands the title field a callback over it",
      "nullpad/app.gleam",
      both(
        after(
          "fn toolbar(model: Model) -> Element(Msg) {\n",
          "  let drawn = model.editor\n",
        ),
        both(
          instead(
            "      title_field(\n        open.title,\n        placeholder: storage.display_title(None, editor.text(model.editor)),\n      ),",
            "      title_field(\n        open.title,\n        placeholder: storage.display_title(None, editor.text(model.editor)),\n        renamed: fn(title) {\n          ToLibrary(library.UserRenamedNote(case title {\n            \"\" -> storage.display_title(None, editor.text(drawn))\n            _ -> title\n          }))\n        },\n      ),",
          ),
          both(
            instead(
              "fn title_field(\n  title: Option(String),\n  placeholder placeholder: String,\n) -> Element(Msg) {",
              "fn title_field(\n  title: Option(String),\n  placeholder placeholder: String,\n  renamed renamed: fn(String) -> Msg,\n) -> Element(Msg) {",
            ),
            instead(
              "    event.on_input(fn(title) { ToLibrary(library.UserRenamedNote(title)) }),",
              "    event.on_input(renamed),",
            ),
          ),
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a32: the toolbar takes the editor out of the model with let and hands the title field a callback over it",
      "nullpad/app.gleam",
      both(
        after(
          "fn toolbar(model: Model) -> Element(Msg) {\n",
          "  let Model(editor: note, ..) = model\n",
        ),
        both(
          instead(
            "      title_field(\n        open.title,\n        placeholder: storage.display_title(None, editor.text(model.editor)),\n      ),",
            "      title_field(\n        open.title,\n        placeholder: storage.display_title(None, editor.text(model.editor)),\n        renamed: fn(title) {\n          ToLibrary(library.UserRenamedNote(case title {\n            \"\" -> storage.display_title(None, editor.text(note))\n            _ -> title\n          }))\n        },\n      ),",
          ),
          both(
            instead(
              "fn title_field(\n  title: Option(String),\n  placeholder placeholder: String,\n) -> Element(Msg) {",
              "fn title_field(\n  title: Option(String),\n  placeholder placeholder: String,\n  renamed renamed: fn(String) -> Msg,\n) -> Element(Msg) {",
            ),
            instead(
              "    event.on_input(fn(title) { ToLibrary(library.UserRenamedNote(title)) }),",
              "    event.on_input(renamed),",
            ),
          ),
        ),
      ),
    ),
    Breaks(
      Caught(rules.DecoderState),
      "a33: a copy handler's maker takes the editor under an alias from the editor module",
      [
        #(
          "nullpad/editor.gleam",
          instead(
            "pub type Mode {",
            "pub type Drawn =\n  Editor\n\npub type Mode {",
          ),
        ),
        #(
          "nullpad/surface.gleam",
          both(
            after(view_attribute, "        on_copy(editor, on_event),\n"),
            last(
              "fn on_copy(drawn: editor.Drawn, on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
            ),
          ),
        ),
      ],
    ),
    Breaks(
      Caught(rules.DecoderState),
      "a34: a copy handler's maker takes a new type that holds the editor",
      [
        #(
          "nullpad/editor.gleam",
          instead(
            "pub type Mode {",
            "pub type Shown {\n  Shown(rows: Int, of: Option(Editor))\n}\n\npub type Mode {",
          ),
        ),
        #(
          "nullpad/surface.gleam",
          both(
            after(
              view_attribute,
              "        on_copy(editor.Shown(rows: 0, of: Some(editor)), on_event),\n",
            ),
            last(
              "fn on_copy(shown: editor.Shown, on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
            ),
          ),
        ),
      ],
    ),
    Break(
      Caught(rules.DecoderState),
      "a35: the view hands a handler's maker the rest of its block, which names the editor",
      "nullpad/surface.gleam",
      both(
        after(
          "  html.div([attribute.class(classes(editor, kind)), marker(kind)], [\n",
          "",
        ),
        both(
          instead(
            "  html.div([attribute.class(classes(editor, kind)), marker(kind)], [\n",
            "  use <- with_copy(on_event)\n  let _ = editor.is_painted(editor)\n  html.div([attribute.class(classes(editor, kind)), marker(kind)], [\n",
          ),
          last(
            "fn with_copy(on_event: fn(editor.Event) -> msg, then: fn() -> Element(msg)) -> Element(msg) {\n  html.div([event.on(\"copy\", decode.success(on_event(editor.Released)))], [then()])\n}",
          ),
        ),
      ),
    ),
    Break(
      Caught(rules.DecoderState),
      "a36: app takes the editor out of the model with let and hands the field a callback over it",
      "nullpad/app.gleam",
      instead(
        "fn page(model: Model) -> Element(Msg) {\n",
        "fn page(model: Model) -> Element(Msg) {\n  let Model(editor: note, ..) = model\n  let _ = surface.view(note, fn(event) {\n    case editor.is_idle(note) {\n      True -> EditorSent(event)\n      False -> EditorSent(editor.Released)\n    }\n  })\n",
      ),
    ),
    Breaks(
      Escapes,
      "a15, b06: a new record in the editor module copies what a handler needs from the drawn editor",
      [
        #(
          "nullpad/editor.gleam",
          instead(
            "pub type Mode {",
            "pub type Keyboard {\n  Keyboard(waiting: Bool, painted: Bool)\n}\n\npub fn keyboard(editor: Editor) -> Keyboard {\n  Keyboard(waiting: is_waiting(editor), painted: is_painted(editor))\n}\n\npub type Mode {",
          ),
        ),
        #(
          "nullpad/surface.gleam",
          both(
            after(
              view_attribute,
              "        on_copy(editor.keyboard(editor), on_event),\n",
            ),
            last(
              "fn on_copy(keyboard: editor.Keyboard, on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    use <- bool.guard(!keyboard.painted, decode.failure(on_event(editor.Released), \"painted\"))\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
            ),
          ),
        ),
      ],
    ),
    Break(
      Escapes,
      "a21, b10: the view hands a copy handler a plain value read from the drawn editor",
      "nullpad/surface.gleam",
      both(
        after(
          view_attribute,
          "        on_copy(editor.is_painted(editor), on_event),\n",
        ),
        last(
          "fn on_copy(painted: Bool, on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    use <- bool.guard(!painted, decode.failure(on_event(editor.Released), \"painted\"))\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
        ),
      ),
    ),
    Break(
      Escapes,
      "a25: app sets a timer whose message carries the buffer of the editor it has now",
      "nullpad/app.gleam",
      instead(
        "      #(model, effect.batch([synced, remembered]))\n",
        "      let reread =\n        platform.after(\n          50,\n          EditorSent(editor.ControlChanged(shown: editor.buffer(model.editor), at: 0)),\n        )\n      #(model, effect.batch([synced, remembered, reread]))\n",
      ),
    ),
    Break(
      Clean,
      "a04: a handler's maker writes a capture that reads the record each time it is called",
      "nullpad/surface.gleam",
      after(
        "fn field_events(\n  on_event: fn(editor.Event) -> msg,\n) -> List(attribute.Attribute(msg)) {\n",
        "  let _claims = editor.claims(current_editor(), _)\n",
      ),
    ),
    Break(
      Clean,
      "a09: app maps the field's messages through a constructor",
      "nullpad/app.gleam",
      instead(
        "  let field = #(\"field\", surface.view(model.editor, EditorSent))",
        "  let field = #(\n    \"field\",\n    surface.view(model.editor, fn(event) { event }) |> element.map(EditorSent),\n  )",
      ),
    ),
    Break(
      Clean,
      "a10: a view helper in app takes a render callback over the model and calls it at once",
      "nullpad/app.gleam",
      both(
        instead(
          "fn sidebar(model: Model) -> Element(Msg) {\n  html.nav([attribute.class(\"sidebar\"), attribute.aria_label(\"Notes\")], [\n",
          "fn sidebar(model: Model) -> Element(Msg) {\n  html.nav([attribute.class(\"sidebar\"), attribute.aria_label(\"Notes\")], [\n    titled(fn() { toolbar(model) }),\n",
        ),
        last(
          "fn titled(render: fn() -> Element(Msg)) -> Element(Msg) {\n  html.div([], [render()])\n}",
        ),
      ),
    ),
    Break(
      Clean,
      "a11: a decoder takes a record of its own that is named like a type in the editor module",
      "nullpad/surface.gleam",
      last(
        "type Keys {\n  Keys(ctrl: Bool, meta: Bool)\n}\n\nfn claimed_decoder(\n  keys: Keys,\n  on_event: fn(editor.Event) -> msg,\n) -> Decoder(event.Handler(msg)) {\n  let Keys(ctrl:, ..) = keys\n  case ctrl {\n    True -> decode.success(on_event(editor.Released) |> event.handler(prevent_default: False, stop_propagation: False))\n    False -> decode.failure(on_event(editor.Released) |> event.handler(prevent_default: False, stop_propagation: False), \"ctrl\")\n  }\n}",
      ),
    ),
    Breaks(
      Clean,
      "a12: the field's handlers take a message callback under an alias from the editor module",
      [
        #(
          "nullpad/editor.gleam",
          instead(
            "pub type Mode {",
            "pub type OnEvent(msg) =\n  fn(Event) -> msg\n\npub type Mode {",
          ),
        ),
        #(
          "nullpad/surface.gleam",
          instead(
            "fn field_events(\n  on_event: fn(editor.Event) -> msg,\n) -> List(attribute.Attribute(msg)) {\n",
            "fn field_events(\n  on_event: editor.OnEvent(msg),\n) -> List(attribute.Attribute(msg)) {\n",
          ),
        ),
      ],
    ),
    Break(
      Clean,
      "a27: a decoder reads a record bound under a second name when the event comes",
      "nullpad/surface.gleam",
      both(
        after(
          "  use key_code <- decode.optional_field(\"keyCode\", 0, decode.int)\n",
          "  let _ = editor.is_waiting(latest_editor())\n",
        ),
        last(
          "@external(javascript, \"./surface.ffi.mjs\", \"currentEditor\")\nfn latest_editor() -> Editor",
        ),
      ),
    ),
    Break(
      Clean,
      "a28: sync moves an effect that acts on its editor at once into a helper",
      "nullpad/surface.gleam",
      both(
        instead(
          "  let noted =\n    effect.from(fn(_) {\n",
          "  let noted =\n    at_once(fn() {\n",
        ),
        last(
          "fn at_once(run: fn() -> Nil) -> Effect(msg) {\n  use _ <- effect.from\n  run()\n}",
        ),
      ),
    ),
    Break(
      Clean,
      "b00b: a copy handler reads the record when the copy comes",
      "nullpad/surface.gleam",
      both(
        after(view_attribute, "        on_copy(on_event),\n"),
        last(
          "fn on_copy(on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {\n  event.advanced(\"copy\", {\n    use _ <- decode.then(decode.dynamic)\n    use <- bool.guard(!editor.is_painted(current_editor()), decode.failure(on_event(editor.Released), \"painted\"))\n    on_event(editor.Released)\n    |> event.handler(prevent_default: True, stop_propagation: False)\n    |> decode.success\n  })\n}",
        ),
      ),
    ),
    Break(
      Escapes,
      "the author's: a handler's maker hands a closure that reads the record to a helper that calls it at once",
      "nullpad/surface.gleam",
      both(
        after(
          "fn field_events(\n  on_event: fn(editor.Event) -> msg,\n) -> List(attribute.Attribute(msg)) {\n",
          "  let _ = call_now(fn() { editor.is_waiting(current_editor()) })\n",
        ),
        last("fn call_now(run: fn() -> Bool) -> Bool {\n  run()\n}"),
      ),
    ),
    Break(
      Escapes,
      "the author's: app maps the field's messages through a callback a helper made over the model",
      "nullpad/app.gleam",
      both(
        instead(
          "  let field = #(\"field\", surface.view(model.editor, EditorSent))",
          "  let field = #(\n    \"field\",\n    surface.view(model.editor, fn(event) { event }) |> element.map(mapped(model)),\n  )",
        ),
        last(
          "fn mapped(model: Model) -> fn(editor.Event) -> Msg {\n  fn(event) {\n    case model.menu {\n      Some(_) -> UserClosedMenu\n      None -> EditorSent(event)\n    }\n  }\n}",
        ),
      ),
    ),
  ]
}
