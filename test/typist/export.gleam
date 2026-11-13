//// Scripts and their answers as JSON, for the browser to replay.
////
////   gleam run -m typist_sample -- [count] [seed] [undo]
////
//// Offsets in the JSON are UTF-16 units, as `selectionStart` counts them.

import gleam/int
import gleam/list
import gleam/string
import typist/check
import typist/page
import typist/script.{type Script, Script, Start}
import typist/textbox.{type Key, type State}

pub fn document(scripts: List(Script)) -> String {
  "{\"scripts\":[\n"
  <> string.join(list.index_map(scripts, entry), ",\n")
  <> "\n]}\n"
}

fn entry(script: Script, id: Int) -> String {
  let Script(note:, start: Start(row:, col:, width:), keys:) = script
  let model = model_states(script)
  let editor = page_states(script)
  let divergence = case check.run(script) {
    Ok(Nil) -> "null"
    Error(found) ->
      object([
        #("step", int.to_string(found.step)),
        #("signature", quote(found.signature)),
      ])
  }
  object([
    #("id", int.to_string(id)),
    #("note", quote(note)),
    #(
      "start",
      object([
        #("row", int.to_string(row)),
        #("col", int.to_string(col)),
        #("width", int.to_string(width)),
      ]),
    ),
    #("keys", array(list.map(keys, action))),
    #("model", array(list.map(model, state))),
    #("page", array(list.map(editor, state))),
    #("divergence", divergence),
  ])
}

/// The text box's state before any key and after each.
fn model_states(script: Script) -> List(State) {
  let Script(note:, start: Start(row:, col:, width:), keys:) = script
  let at = offset(note, row, col)
  let box = textbox.new(note, at, at + width)
  let #(_, states) =
    list.fold(keys, #(box, [textbox.state(box)]), fn(acc, key) {
      let box = textbox.press(acc.0, key)
      #(box, [textbox.state(box), ..acc.1])
    })
  list.reverse(states)
}

fn page_states(script: Script) -> List(State) {
  let sim = page.open(script.note, script.start)
  let #(_, states) =
    list.fold(script.keys, #(sim, [page.note(sim)]), fn(acc, key) {
      let sim = page.press(acc.0, key)
      #(sim, [page.note(sim), ..acc.1])
    })
  list.reverse(states)
}

fn offset(note: String, row: Int, col: Int) -> Int {
  string.split(note, "\n")
  |> list.take(row)
  |> list.fold(col, fn(sum, line) { sum + string.length(line) + 1 })
}

fn action(key: Key) -> String {
  case key {
    textbox.Char(char) ->
      object([#("do", quote("type")), #("text", quote(char))])
    textbox.Paste(text) ->
      object([#("do", quote("paste")), #("text", quote(text))])
    _ -> object([#("do", quote("press")), #("key", quote(textbox.label(key)))])
  }
}

fn state(state: State) -> String {
  let chars = string.to_graphemes(state.text)
  let units = fn(count) {
    list.take(chars, count) |> string.concat |> utf16_length
  }
  object([
    #("text", quote(state.text)),
    #("anchor", int.to_string(units(state.anchor))),
    #("head", int.to_string(units(state.head))),
  ])
}

fn utf16_length(text: String) -> Int {
  string.to_utf_codepoints(text)
  |> list.fold(0, fn(sum, point) {
    case string.utf_codepoint_to_int(point) > 0xFFFF {
      True -> sum + 2
      False -> sum + 1
    }
  })
}

fn object(fields: List(#(String, String))) -> String {
  "{"
  <> string.join(
    list.map(fields, fn(field) { quote(field.0) <> ":" <> field.1 }),
    ",",
  )
  <> "}"
}

fn array(items: List(String)) -> String {
  "[" <> string.join(items, ",") <> "]"
}

fn quote(text: String) -> String {
  let escaped =
    string.to_utf_codepoints(text)
    |> list.map(fn(point) {
      case string.utf_codepoint_to_int(point) {
        34 -> "\\\""
        92 -> "\\\\"
        10 -> "\\n"
        13 -> "\\r"
        9 -> "\\t"
        code if code < 32 ->
          "\\u" <> string.pad_start(int.to_base16(code), 4, "0")
        _ -> string.from_utf_codepoints([point])
      }
    })
  "\"" <> string.concat(escaped) <> "\""
}
