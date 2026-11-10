//// Examples for the editing rule and vim, with no browser: build the
//// snapshot the text field would report, feed it in, look at what comes out.
//// See `markdown_test` for how `pending_` functions work.

import gleam/list
import gleam/string
import scribbl/buffer.{Position}
import scribbl/editor.{type Editor, type Outcome, Outcome}
import scribbl/vim

/// The property the whole design rests on: we never answer the user's own
/// typing with a write to the text field.
pub fn typing_never_writes_back_test() {
  let shown = buffer.from_text("héllo 👋")
  let Outcome(editor: ed, sync:, ..) =
    editor.new(vim: False) |> editor.update(editor.ControlChanged(shown:))

  assert sync == editor.InSync
  assert editor.text(ed) == "héllo 👋"
}

/// Moving the caret is also a `ControlChanged`. The text is the same, the
/// selection is new, and still nothing is written back.
pub fn moving_the_caret_never_writes_back_test() {
  let end = Position(row: 0, col: 2)
  let shown = buffer.from_text("hi") |> buffer.select(anchor: end, head: end)
  let Outcome(editor: ed, sync:, ..) =
    editor.new(vim: False) |> editor.update(editor.ControlChanged(shown:))

  assert sync == editor.InSync
  assert buffer.cursor(editor.buffer(ed)) == end
}

/// Loading a note is the model's turn to speak: the text field must be
/// written.
pub fn opening_a_note_writes_test() {
  let Outcome(editor: ed, sync:, ..) =
    editor.new(vim: False) |> editor.open("one\ntwo")

  assert editor.text(ed) == "one\ntwo"
  assert sync == editor.Write(editor.buffer(ed))
}

/// M4
pub fn pending_dd_deletes_the_cursor_line() {
  let Outcome(editor: ed, sync:, ..) =
    editor.new(vim: True) |> editor.open("one\ntwo\nthree") |> press("jdd")

  assert editor.text(ed) == "one\nthree"
  assert buffer.cursor(editor.buffer(ed)) == Position(row: 1, col: 0)
  assert sync == editor.Write(editor.buffer(ed))
}

/// M4: text typed natively during insert mode is one undo step.
pub fn pending_one_insert_is_one_undo_step() {
  let opened = editor.new(vim: True) |> editor.open("ab") |> press("i")
  let end = Position(row: 0, col: 2)
  let typed = buffer.from_text("xyab") |> buffer.select(anchor: end, head: end)
  let Outcome(editor: ed, sync:, ..) =
    editor.update(opened.editor, editor.ControlChanged(shown: typed))
  assert sync == editor.InSync

  let escaped =
    editor.update(ed, editor.KeyPressed(vim.Escape, shown: typed)) |> press("u")
  assert editor.text(escaped.editor) == "ab"
}

/// Ticking a task from the rendered page rewrites one line.
pub fn change_line_test() {
  let Outcome(editor: ed, ..) = editor.new(vim: False) |> editor.open("a\nb")
  let Outcome(editor: ed, sync:, ..) =
    editor.change_line(ed, 1, string.uppercase)

  assert editor.text(ed) == "a\nB"
  assert sync == editor.Write(editor.buffer(ed))
}

pub fn change_line_ignores_a_missing_row_test() {
  let Outcome(editor: ed, ..) = editor.new(vim: False) |> editor.open("a\nb")
  let Outcome(editor: unchanged, sync:, ..) =
    editor.change_line(ed, 7, string.uppercase)

  assert editor.text(unchanged) == "a\nb"
  assert sync == editor.InSync
}

/// Press each character as a key, the way `surface` would report it: with
/// the text field showing exactly what the previous step left.
fn press(outcome: Outcome, keys: String) -> Outcome {
  use outcome, key <- list.fold(string.to_graphemes(keys), outcome)
  let ed: Editor = outcome.editor
  editor.update(ed, editor.KeyPressed(vim.Char(key), shown: editor.buffer(ed)))
}
