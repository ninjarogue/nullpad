//// Runs a key script through the plain text box and through the real editor
//// in page view, and says where they first part.

import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import typist/page.{type Page}
import typist/script.{type Script, Script, Start}
import typist/textbox.{type Box, type Key, type State}

/// What differs.
pub type Difference {
  /// The note, or the caret in it.
  Note
  /// The text field does not show what the editor says it should.
  Field
}

pub type Divergence {
  Divergence(
    /// Keys pressed when it showed: 0 is the starting state.
    step: Int,
    key: Option(Key),
    kind: Difference,
    /// What a plain text box has.
    expected: State,
    /// What the editor has (or the field, for `Field`).
    actual: State,
    signature: String,
  )
}

/// Runs every key, comparing after each. The first difference ends the run.
pub fn run(script: Script) -> Result(Nil, Divergence) {
  let Script(note:, start:, keys:) = script
  let Start(row:, col:, width:) = start
  let at = offset(note, row, col)
  let model = textbox.new(note, at, at + width)
  let sim = page.open(note, start)
  case compare(0, None, model, sim, None) {
    Some(divergence) -> Error(divergence)
    None -> steps(keys, model, sim, 1)
  }
}

fn steps(
  keys: List(Key),
  model: Box,
  sim: Page,
  step: Int,
) -> Result(Nil, Divergence) {
  case keys {
    [] -> Ok(Nil)
    [key, ..rest] -> {
      let before = sim
      let model = textbox.press(model, key)
      let sim = page.press(sim, key)
      case compare(step, Some(key), model, sim, Some(before)) {
        Some(divergence) -> Error(divergence)
        None -> steps(rest, model, sim, step + 1)
      }
    }
  }
}

fn compare(
  step: Int,
  key: Option(Key),
  model: Box,
  sim: Page,
  before: Option(Page),
) -> Option(Divergence) {
  let expected = textbox.state(model)
  let actual = page.note(sim)
  let shown = page.field(sim)
  let wanted = page.field_wanted(sim)
  case expected == actual, shown == wanted {
    False, _ ->
      Some(Divergence(
        step:,
        key:,
        kind: Note,
        expected:,
        actual:,
        signature: signature(key, before, Note, expected, actual),
      ))
    True, False ->
      Some(Divergence(
        step:,
        key:,
        kind: Field,
        expected: wanted,
        actual: shown,
        signature: signature(key, before, Field, wanted, shown),
      ))
    True, True -> None
  }
}

/// A name for how a run went wrong, the same for every run that goes wrong
/// the same way: the key, where the caret was in the field, and what came out
/// different.
fn signature(
  key: Option(Key),
  before: Option(Page),
  kind: Difference,
  expected: State,
  actual: State,
) -> String {
  let name = case key {
    Some(key) -> textbox.label(key)
    None -> "start"
  }
  let tags = case before {
    None -> []
    Some(sim) -> {
      let field = page.field(sim)
      let whole = page.note(sim).text
      let length = string.length(field.text)
      list.flatten([
        case field.head == 0 {
          True -> ["at the start of the field"]
          False -> []
        },
        case field.head == length {
          True -> ["at the end of the field"]
          False -> []
        },
        case field.anchor != field.head {
          True -> ["with a selection"]
          False -> []
        },
        case field.text == whole {
          True -> ["field holds the note"]
          False -> ["field holds part of the note"]
        },
      ])
    }
  }
  let what = case kind, expected.text == actual.text {
    Field, _ -> "field out of step"
    Note, False -> "text differs"
    Note, True -> "selection differs"
  }
  name <> " (" <> string.join(tags, ", ") <> "): " <> what
}

fn offset(note: String, row: Int, col: Int) -> Int {
  string.split(note, "\n")
  |> list.take(row)
  |> list.fold(col, fn(sum, line) { sum + string.length(line) + 1 })
}

/// A report of one divergence, for a person to read.
pub fn describe(script: Script, divergence: Divergence) -> String {
  let Script(note:, start:, keys:) = script
  let Divergence(step:, key:, expected:, actual:, signature:, ..) = divergence
  string.join(
    [
      signature,
      "note:    " <> string.inspect(note),
      "start:   row "
        <> int.to_string(start.row)
        <> ", col "
        <> int.to_string(start.col)
        <> ", "
        <> int.to_string(start.width)
        <> " selected",
      "keys:    " <> string.join(list.map(keys, show_key), ", "),
      "first difference after key "
        <> int.to_string(step)
        <> case key {
        Some(key) -> " (" <> show_key(key) <> ")"
        None -> " (the start)"
      },
      "text box: " <> show_state(expected),
      "editor:   " <> show_state(actual),
    ],
    "\n",
  )
}

pub fn show_key(key: Key) -> String {
  case key {
    textbox.Char(char) -> string.inspect(char)
    textbox.Paste(text) -> "Paste " <> string.inspect(text)
    _ -> textbox.label(key)
  }
}

fn show_state(state: State) -> String {
  let chars = string.to_graphemes(state.text)
  let mark = fn(at) { list.take(chars, at) |> string.concat }
  let low = int.min(state.anchor, state.head)
  let high = int.max(state.anchor, state.head)
  let before = mark(low)
  let inside = list.drop(chars, low) |> list.take(high - low) |> string.concat
  let after = list.drop(chars, high) |> string.concat
  let selected = case low == high {
    True -> "|"
    False ->
      case state.head < state.anchor {
        True -> "<[" <> inside <> "]"
        False -> "[" <> inside <> "]>"
      }
  }
  string.inspect(before <> selected <> after)
}
