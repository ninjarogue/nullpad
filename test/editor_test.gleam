//// Examples for the editing rule and vim, with no browser: build the
//// snapshot the text field would report, feed it in, look at what comes out.
//// See `markdown_test` for how `pending_` functions work.

import gleam/list
import gleam/string
import scribbl/buffer.{Position}
import scribbl/editor.{type Editor, type Outcome, Outcome}
import scribbl/vim

/// M1. The property the whole design rests on: we never answer the user's
/// own typing with a write to the text field.
pub fn pending_typing_never_writes_back() {
  let shown = buffer.from_text("héllo 👋")
  let Outcome(editor: ed, sync:, ..) =
    editor.new(vim: False) |> editor.update(editor.ControlChanged(shown:))

  assert sync == editor.InSync
  assert editor.text(ed) == "héllo 👋"
}

/// M1
pub fn pending_replace_is_the_one_edit() {
  let start = Position(row: 0, col: 0)
  let next_row = Position(row: 1, col: 0)
  let deleted =
    buffer.from_text("one\ntwo")
    |> buffer.replace(from: start, to: next_row, with: "")

  assert buffer.text(deleted) == "two"
  assert buffer.cursor(deleted) == start
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

/// M4: ticking a task from the rendered page rewrites one line.
pub fn pending_change_line() {
  let Outcome(editor: ed, ..) = editor.new(vim: False) |> editor.open("a\nb")
  let Outcome(editor: ed, sync:, ..) =
    editor.change_line(ed, 1, string.uppercase)

  assert editor.text(ed) == "a\nB"
  assert sync == editor.Write(editor.buffer(ed))
}

/// Press each character as a key, the way `surface` would report it: with
/// the text field showing exactly what the previous step left.
fn press(outcome: Outcome, keys: String) -> Outcome {
  use outcome, key <- list.fold(string.to_graphemes(keys), outcome)
  let ed: Editor = outcome.editor
  editor.update(ed, editor.KeyPressed(vim.Char(key), shown: editor.buffer(ed)))
}
