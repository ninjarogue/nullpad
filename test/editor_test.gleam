//// Examples for the editing rule and vim, with no browser: build the
//// snapshot the text field would report, feed it in, look at what comes out.
//// See `markdown_test` for how `pending_` functions work.

import gleam/list
import gleam/option.{None, Some}
import gleam/string
import nullpad/buffer.{Position}
import nullpad/editor.{type Editor, type Outcome, Outcome}
import nullpad/live.{Region}
import nullpad/vim

pub fn typing_never_writes_back_test() {
  let shown = buffer.from_text("héllo 👋")
  let Outcome(editor: ed, sync:, ..) =
    editor.new(vim: False) |> editor.update(editor.ControlChanged(shown:))

  assert sync == editor.InSync
  assert editor.text(ed) == "héllo 👋"
}

pub fn moving_the_caret_never_writes_back_test() {
  let end = Position(row: 0, col: 2)
  let shown = buffer.from_text("hi") |> buffer.select(anchor: end, head: end)
  let Outcome(editor: ed, sync:, ..) =
    editor.new(vim: False) |> editor.update(editor.ControlChanged(shown:))

  assert sync == editor.InSync
  assert buffer.cursor(editor.buffer(ed)) == end
}

pub fn opening_a_note_writes_test() {
  let Outcome(editor: ed, sync:, ..) =
    editor.new(vim: False) |> editor.open("one\ntwo")

  assert editor.text(ed) == "one\ntwo"
  let assert editor.Write(written) = sync
  let start = Position(row: 0, col: 0)
  assert buffer.text(written) == "one\ntwo"
  assert buffer.selection(written) == #(start, start)
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

pub fn replace_line_test() {
  let Outcome(editor: ed, ..) = editor.new(vim: False) |> editor.open("a\nb\nc")
  let Outcome(editor: ed, sync:, ..) = editor.replace_line(ed, 1, with: "- [x]")

  assert editor.text(ed) == "a\n- [x]\nc"
  assert sync == editor.WriteQuietly(editor.buffer(ed))
}

pub fn replace_line_ignores_a_missing_row_test() {
  let Outcome(editor: ed, ..) = editor.new(vim: False) |> editor.open("a\nb")
  let Outcome(editor: unchanged, sync:, ..) =
    editor.replace_line(ed, 7, with: "x")
  let Outcome(editor: also_unchanged, ..) =
    editor.replace_line(ed, -1, with: "x")

  assert editor.text(unchanged) == "a\nb"
  assert sync == editor.InSync
  assert editor.text(also_unchanged) == "a\nb"
}

/// Press each character as a key, the way `surface` would report it: with
/// the text field showing exactly what the previous step left.
fn press(outcome: Outcome, keys: String) -> Outcome {
  use outcome, key <- list.fold(string.to_graphemes(keys), outcome)
  let ed: Editor = outcome.editor
  editor.update(ed, editor.KeyPressed(vim.Char(key), shown: editor.buffer(ed)))
}

const live_note = "# Trip\n\nFlights are **booked**.\n\n- one\n- two"

fn live(text: String) -> Editor {
  let opened = editor.new(vim: False) |> editor.open(text)
  editor.set_live(opened.editor, True).editor
}

fn caret(text: String, row: Int, col: Int) -> buffer.Buffer {
  let at = Position(row:, col:)
  buffer.from_text(text) |> buffer.select(anchor: at, head: at)
}

pub fn live_view_puts_only_the_cursors_block_in_the_field_test() {
  let Outcome(editor: ed, sync:, ..) =
    editor.new(vim: False)
    |> editor.open(live_note)
    |> fn(opened: Outcome) { editor.set_live(opened.editor, True) }

  assert sync == editor.Write(caret("# Trip", 0, 0))
  assert editor.region(ed) == Some(Region(0, 0))
  assert editor.around(ed) == #("", "\nFlights are **booked**.\n\n- one\n- two")
  assert editor.text(ed) == live_note
}

pub fn typing_in_the_field_changes_only_its_rows_test() {
  let shown = caret("# Trip!", 0, 7)
  let Outcome(editor: ed, sync:, ..) =
    live(live_note) |> editor.update(editor.ControlChanged(shown:))

  assert sync == editor.InSync
  assert editor.text(ed) == "# Trip!\n\nFlights are **booked**.\n\n- one\n- two"
  assert buffer.cursor(editor.buffer(ed)) == Position(row: 0, col: 7)
}

pub fn a_new_block_takes_the_field_and_the_old_one_is_drawn_test() {
  let shown = caret("# Trip\n\nNew", 2, 3)
  let Outcome(editor: ed, sync:, ..) =
    live("# Trip") |> editor.update(editor.ControlChanged(shown:))

  assert sync == editor.Write(caret("New", 0, 3))
  assert editor.region(ed) == Some(Region(2, 2))
  assert editor.around(ed) == #("# Trip\n", "")
}

pub fn the_field_is_left_alone_during_a_composition_test() {
  let shown = caret("# Trip\n\nNew", 2, 3)
  let Outcome(editor: ed, sync:, ..) =
    live("# Trip") |> editor.update(editor.Composing(shown:))

  assert sync == editor.InSync
  assert editor.region(ed) == Some(Region(0, 2))
  assert editor.text(ed) == "# Trip\n\nNew"

  let Outcome(sync:, ..) = editor.update(ed, editor.ControlChanged(shown:))
  assert sync == editor.Write(caret("New", 0, 3))
}

pub fn text_that_joins_two_blocks_brings_both_into_the_field_test() {
  let Outcome(editor: ed, ..) =
    live("one\n\ntwo")
    |> editor.update(editor.Pointed(row: 1, visible: "", at_end: False))
  assert editor.region(ed) == Some(Region(1, 1))

  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.ControlChanged(shown: caret("x", 0, 1)))
  assert sync == editor.Write(caret("one\nx\ntwo", 1, 1))
  assert editor.region(ed) == Some(Region(0, 2))
}

pub fn arrow_up_at_the_top_of_the_field_moves_to_the_row_above_test() {
  let Outcome(editor: ed, ..) =
    live(live_note)
    |> editor.update(editor.Pointed(row: 2, visible: "Fli", at_end: False))
  assert editor.region(ed) == Some(Region(2, 2))

  let shown = editor.field_buffer(ed)
  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.EdgePressed(editor.Up, x: 24.0, shown:))
  assert sync
    == editor.WriteAndAim(caret("", 0, 0), x: 24.0, line: editor.LastLine)
  assert editor.region(ed) == Some(Region(1, 1))
}

pub fn arrow_down_at_the_bottom_of_the_field_moves_to_the_row_below_test() {
  let shown = caret("# Trip", 0, 3)
  let Outcome(editor: ed, sync:, ..) =
    live(live_note)
    |> editor.update(editor.EdgePressed(editor.Down, x: 9.5, shown:))

  assert sync
    == editor.WriteAndAim(caret("", 0, 0), x: 9.5, line: editor.FirstLine)
  assert editor.region(ed) == Some(Region(1, 1))
}

pub fn backspace_at_the_start_of_the_field_joins_the_row_above_test() {
  let Outcome(editor: ed, ..) =
    live("one\ntwo\n\nthree")
    |> editor.update(editor.Pointed(row: 3, visible: "", at_end: False))
  let shown = editor.field_buffer(ed)
  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.EdgePressed(editor.JoinBefore, x: 0.0, shown:))

  assert editor.text(ed) == "one\ntwo\nthree"
  assert sync == editor.Write(caret("one\ntwo\nthree", 2, 0))
}

pub fn delete_at_the_end_of_the_field_joins_the_row_below_test() {
  let shown = caret("one", 0, 3)
  let Outcome(editor: ed, sync:, ..) =
    live("one\n\ntwo")
    |> editor.update(editor.EdgePressed(editor.JoinAfter, x: 0.0, shown:))

  assert editor.text(ed) == "one\ntwo"
  assert sync == editor.Write(caret("one\ntwo", 0, 3))
}

pub fn an_edge_key_with_no_row_to_go_to_changes_nothing_test() {
  let shown = caret("only", 0, 0)
  let Outcome(editor: ed, sync:, ..) =
    live("only")
    |> editor.update(editor.EdgePressed(editor.JoinBefore, x: 0.0, shown:))

  assert sync == editor.InSync
  assert editor.text(ed) == "only"
}

pub fn a_click_on_the_drawn_page_moves_the_field_there_test() {
  let Outcome(editor: ed, sync:, ..) =
    live(live_note)
    |> editor.update(editor.Pointed(
      row: 2,
      visible: "Flights are boo",
      at_end: False,
    ))

  assert sync == editor.Write(caret("Flights are **booked**.", 0, 17))
  assert editor.region(ed) == Some(Region(2, 2))
}

pub fn ticking_a_drawn_task_leaves_the_field_alone_test() {
  let Outcome(editor: ed, sync:, ..) =
    live("# Trip\n\n- [ ] one") |> editor.replace_line(2, with: "- [x] one")

  assert sync == editor.InSync
  assert editor.text(ed) == "# Trip\n\n- [x] one"
  assert editor.region(ed) == Some(Region(0, 0))
}

pub fn the_whole_note_is_drawn_while_the_field_is_out_of_focus_test() {
  let ed = live(live_note)
  assert editor.is_idle(ed)

  let Outcome(editor: ed, ..) = editor.update(ed, editor.FocusChanged(True))
  assert !editor.is_idle(ed)
  assert !editor.is_idle(editor.new(vim: False))
}

pub fn leaving_live_view_puts_the_whole_note_back_test() {
  let Outcome(editor: ed, ..) =
    live(live_note)
    |> editor.update(editor.Pointed(row: 4, visible: "on", at_end: False))
  let Outcome(editor: ed, sync:, ..) = editor.set_live(ed, False)

  assert sync == editor.Write(caret(live_note, 4, 4))
  assert editor.region(ed) == None
}
