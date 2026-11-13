//// Examples for the editing rule and vim, with no browser: build the
//// snapshot the text field would report, feed it in, look at what comes out.
//// See `markdown_test` for how `pending_` functions work.

import gleam/list
import gleam/option.{None, Some}
import gleam/string
import nullpad/buffer.{type Position, Position}
import nullpad/editor.{type Editor, type Outcome, Outcome}
import nullpad/live.{Region}
import nullpad/markdown
import nullpad/vim

pub fn typing_never_writes_back_test() {
  let shown = buffer.from_text("héllo 👋")
  let Outcome(editor: ed, sync:, ..) =
    editor.new(vim: False, live: False, paint: True)
    |> editor.update(editor.ControlChanged(shown:, at: 0))

  assert sync == editor.InSync
  assert editor.text(ed) == "héllo 👋"
}

pub fn moving_the_caret_never_writes_back_test() {
  let end = Position(row: 0, col: 2)
  let shown = buffer.from_text("hi") |> buffer.select(anchor: end, head: end)
  let Outcome(editor: ed, sync:, ..) =
    editor.new(vim: False, live: False, paint: True)
    |> editor.update(editor.ControlChanged(shown:, at: 0))

  assert sync == editor.InSync
  assert buffer.cursor(editor.buffer(ed)) == end
}

pub fn opening_a_note_writes_test() {
  let Outcome(editor: ed, sync:, ..) =
    editor.new(vim: False, live: False, paint: True) |> editor.open("one\ntwo")

  assert editor.text(ed) == "one\ntwo"
  let assert editor.Write(written) = sync
  let start = Position(row: 0, col: 0)
  assert buffer.text(written) == "one\ntwo"
  assert buffer.selection(written) == #(start, start)
}

/// M4
pub fn pending_dd_deletes_the_cursor_line() {
  let Outcome(editor: ed, sync:, ..) =
    editor.new(vim: True, live: False, paint: True)
    |> editor.open("one\ntwo\nthree")
    |> press("jdd")

  assert editor.text(ed) == "one\nthree"
  assert buffer.cursor(editor.buffer(ed)) == Position(row: 1, col: 0)
  assert sync == editor.Write(editor.buffer(ed))
}

/// M4: text typed natively during insert mode is one undo step.
pub fn pending_one_insert_is_one_undo_step() {
  let opened =
    editor.new(vim: True, live: False, paint: True)
    |> editor.open("ab")
    |> press("i")
  let end = Position(row: 0, col: 2)
  let typed = buffer.from_text("xyab") |> buffer.select(anchor: end, head: end)
  let Outcome(editor: ed, sync:, ..) =
    editor.update(opened.editor, editor.ControlChanged(shown: typed, at: 0))
  assert sync == editor.InSync

  let escaped =
    editor.update(ed, editor.KeyPressed(vim.Escape, shown: typed)) |> press("u")
  assert editor.text(escaped.editor) == "ab"
}

pub fn tick_test() {
  let Outcome(editor: ed, ..) =
    editor.new(vim: False, live: False, paint: True)
    |> editor.open("a\n- [ ] b\nc")
  let Outcome(editor: ed, sync:, ..) =
    editor.tick(ed, markdown.Task(checked: False, row: 1, col: 3), True)

  assert editor.text(ed) == "a\n- [x] b\nc"
  assert sync == editor.WriteQuietly(editor.buffer(ed))
}

pub fn tick_ignores_a_box_the_text_does_not_have_test() {
  let Outcome(editor: ed, ..) =
    editor.new(vim: False, live: False, paint: True)
    |> editor.open("a\n- [ ] b")
  let Outcome(editor: unchanged, sync:, ..) =
    editor.tick(ed, markdown.Task(checked: False, row: 7, col: 3), True)
  let Outcome(editor: also_unchanged, ..) =
    editor.tick(ed, markdown.Task(checked: False, row: 0, col: 3), True)

  assert editor.text(unchanged) == "a\n- [ ] b"
  assert sync == editor.InSync
  assert editor.text(also_unchanged) == "a\n- [ ] b"
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
  let opened =
    editor.new(vim: False, live: False, paint: True) |> editor.open(text)
  editor.set_live(opened.editor, True).editor
}

fn caret(text: String, row: Int, col: Int) -> buffer.Buffer {
  let at = Position(row:, col:)
  buffer.from_text(text) |> buffer.select(anchor: at, head: at)
}

pub fn live_view_puts_only_the_cursors_block_in_the_field_test() {
  let Outcome(editor: ed, sync:, ..) =
    editor.new(vim: False, live: False, paint: True)
    |> editor.open(live_note)
    |> fn(opened: Outcome) { editor.set_live(opened.editor, True) }

  assert sync == editor.Write(caret("# Trip", 0, 0))
  assert editor.region(ed) == Some(Region(0, 0))
  assert editor.text(ed) == live_note
}

pub fn typing_in_the_field_changes_only_its_rows_test() {
  let shown = caret("# Trip!", 0, 7)
  let Outcome(editor: ed, sync:, ..) =
    live(live_note) |> editor.update(editor.ControlChanged(shown:, at: 0))

  assert sync == editor.InSync
  assert editor.text(ed) == "# Trip!\n\nFlights are **booked**.\n\n- one\n- two"
  assert buffer.cursor(editor.buffer(ed)) == Position(row: 0, col: 7)
}

pub fn a_new_block_takes_the_field_and_the_old_one_is_drawn_test() {
  let shown = caret("# Trip\n\nNew", 2, 3)
  let Outcome(editor: ed, sync:, ..) =
    live("# Trip") |> editor.update(editor.ControlChanged(shown:, at: 0))

  assert sync == editor.Write(caret("New", 0, 3))
  assert editor.region(ed) == Some(Region(2, 2))
}

pub fn the_field_is_left_alone_during_a_composition_test() {
  let shown = caret("# Trip\n\nNew", 2, 3)
  let Outcome(editor: ed, sync:, ..) =
    live("# Trip") |> editor.update(editor.Composing(shown:))

  assert sync == editor.InSync
  assert editor.region(ed) == Some(Region(0, 2))
  assert editor.text(ed) == "# Trip\n\nNew"

  let Outcome(sync:, ..) =
    editor.update(ed, editor.ControlChanged(shown:, at: 0))
  assert sync == editor.Write(caret("New", 0, 3))
}

pub fn text_that_joins_two_blocks_brings_both_into_the_field_once_the_caret_leaves_its_row_test() {
  let Outcome(editor: ed, ..) =
    live("one\n\ntwo")
    |> editor.update(editor.Pointed(
      row: 1,
      visible: "",
      at_end: False,
      next: "",
      x: 0.0,
      y: 0.0,
    ))
  assert editor.region(ed) == Some(Region(1, 1))

  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.ControlChanged(shown: caret("x", 0, 1), at: 0))
  assert sync == editor.InSync
  assert editor.region(ed) == Some(Region(1, 1))

  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.EdgePressed(editor.Up, x: 0.0, shown: caret("x", 0, 1)),
    )
  assert sync
    == editor.WriteAndAim(
      caret("one\nx\ntwo", 0, 3),
      x: 0.0,
      line: editor.LastLine,
    )
  assert editor.region(ed) == Some(Region(0, 2))
}

pub fn arrow_up_at_the_top_of_the_field_moves_to_the_row_above_test() {
  let Outcome(editor: ed, ..) =
    live(live_note)
    |> editor.update(editor.Pointed(
      row: 2,
      visible: "Fli",
      at_end: False,
      next: "",
      x: 0.0,
      y: 0.0,
    ))
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
    |> editor.update(editor.Pointed(
      row: 3,
      visible: "",
      at_end: False,
      next: "",
      x: 0.0,
      y: 0.0,
    ))
  let shown = editor.field_buffer(ed)
  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.EdgePressed(editor.JoinBefore, x: 0.0, shown:))

  assert editor.text(ed) == "one\ntwo\nthree"
  assert sync == editor.InSync
  assert editor.region(ed) == Some(Region(2, 2))
}

pub fn delete_at_the_end_of_the_field_joins_the_row_below_test() {
  let shown = caret("one", 0, 3)
  let Outcome(editor: ed, sync:, ..) =
    live("one\n\ntwo")
    |> editor.update(editor.EdgePressed(editor.JoinAfter, x: 0.0, shown:))

  assert editor.text(ed) == "one\ntwo"
  assert sync == editor.InSync
  assert editor.region(ed) == Some(Region(0, 0))
}

pub fn an_edge_key_with_no_row_to_go_to_changes_nothing_test() {
  let shown = caret("only", 0, 0)
  let Outcome(editor: ed, sync:, ..) =
    live("only")
    |> editor.update(editor.EdgePressed(editor.JoinBefore, x: 0.0, shown:))

  assert sync == editor.InSync
  assert editor.text(ed) == "only"
}

pub fn an_arrow_with_no_row_to_go_to_leaves_the_caret_where_it_is_test() {
  let Outcome(editor: ed, sync:, ..) =
    live("only one")
    |> editor.update(editor.EdgePressed(
      editor.Up,
      x: 30.0,
      shown: caret("only one", 0, 4),
    ))
  assert sync == editor.InSync
  assert editor.region(ed) == Some(Region(0, 0))
  assert editor.field_buffer(ed) == caret("only one", 0, 4)

  let Outcome(sync:, ..) =
    editor.update(
      ed,
      editor.EdgePressed(editor.Down, x: 0.0, shown: caret("only one", 0, 4)),
    )
  assert sync == editor.InSync
}

pub fn an_arrow_with_no_row_to_go_to_ends_a_selection_at_the_start_or_end_test() {
  let held =
    selected(
      "abc def",
      from: Position(row: 0, col: 7),
      to: Position(row: 0, col: 4),
    )
  let Outcome(sync:, ..) =
    live("abc def")
    |> editor.update(editor.EdgePressed(editor.Up, x: 30.0, shown: held))
  assert sync == editor.Write(caret("abc def", 0, 0))

  let Outcome(sync:, ..) =
    live("abc def")
    |> editor.update(editor.EdgePressed(editor.Down, x: 30.0, shown: held))
  assert sync == editor.Write(caret("abc def", 0, 7))
}

pub fn composing_on_a_blank_row_keeps_the_blocks_around_the_field_test() {
  let note = "first\n\nsecond"
  let Outcome(editor: ed, ..) =
    live(note)
    |> editor.update(editor.Pointed(
      row: 1,
      visible: "",
      at_end: False,
      next: "",
      x: 0.0,
      y: 0.0,
    ))
  let around = editor.blocks(ed)

  let composed = caret("wo", 0, 2)
  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.Composing(shown: composed))
  assert sync == editor.InSync
  assert editor.text(ed) == "first\nwo\nsecond"
  assert editor.region(ed) == Some(Region(1, 1))
  assert editor.blocks(ed) == around

  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.ControlChanged(shown: composed, at: 0))
  assert sync == editor.InSync
  assert editor.region(ed) == Some(Region(1, 1))
  assert editor.blocks(ed) == around

  let Outcome(editor: ed, ..) = editor.update(ed, editor.FocusChanged(False))
  assert editor.blocks(ed) == markdown.parse("first\nwo\nsecond")
  let Outcome(editor: ed, ..) = editor.update(ed, editor.FocusChanged(True))
  assert editor.region(ed) == Some(Region(0, 2))
}

pub fn blocks_kept_through_a_composition_are_parsed_again_by_any_later_change_test() {
  let Outcome(editor: ed, ..) =
    live("first\n\nsecond")
    |> editor.update(editor.Pointed(
      row: 1,
      visible: "",
      at_end: False,
      next: "",
      x: 0.0,
      y: 0.0,
    ))
  let Outcome(editor: ed, ..) =
    editor.update(ed, editor.Composing(shown: caret("wo", 0, 2)))

  let Outcome(editor: ed, ..) = editor.set_live(ed, True)
  assert editor.blocks(ed) == markdown.parse("first\nwo\nsecond")
}

pub fn an_arrow_at_the_edge_of_the_field_already_there_changes_nothing_test() {
  let Outcome(sync:, ..) =
    live("only")
    |> editor.update(editor.EdgePressed(
      editor.Up,
      x: 0.0,
      shown: caret("only", 0, 0),
    ))
  assert sync == editor.InSync
}

pub fn edge_keys_never_cross_with_the_whole_note_in_the_field_test() {
  let Outcome(editor: whole, ..) =
    editor.new(vim: False, live: False, paint: True) |> editor.open("one\ntwo")
  let edge = fn(edge, shown) {
    editor.update(whole, editor.EdgePressed(edge, x: 9.0, shown:))
  }

  let Outcome(editor: ed, sync:, ..) = edge(editor.Up, caret("one\ntwo", 0, 2))
  assert sync == editor.InSync
  assert editor.region(ed) == None
  let Outcome(sync:, ..) = edge(editor.Down, caret("one\ntwo", 1, 1))
  assert sync == editor.InSync
  let Outcome(editor: ed, sync:, ..) =
    edge(editor.JoinBefore, caret("one\ntwo", 0, 0))
  assert sync == editor.InSync
  assert editor.text(ed) == "one\ntwo"
  let Outcome(editor: ed, sync:, ..) =
    edge(editor.JoinAfter, caret("one\ntwo", 1, 3))
  assert sync == editor.InSync
  assert editor.text(ed) == "one\ntwo"
}

pub fn an_arrow_crosses_from_the_rows_the_field_holds_now_test() {
  let Outcome(editor: ed, ..) =
    live(live_note)
    |> editor.update(editor.EdgePressed(
      editor.Down,
      x: 0.0,
      shown: caret("# Trip", 0, 0),
    ))
  assert editor.region(ed) == Some(Region(1, 1))

  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.EdgePressed(editor.Up, x: 0.0, shown: caret("", 0, 0)),
    )
  assert sync
    == editor.WriteAndAim(caret("# Trip", 0, 6), x: 0.0, line: editor.LastLine)
  assert editor.region(ed) == Some(Region(0, 0))
}

pub fn a_click_on_the_drawn_page_moves_the_field_there_test() {
  let Outcome(editor: ed, sync:, ..) =
    live(live_note)
    |> editor.update(editor.Pointed(
      row: 2,
      visible: "Flights are boo",
      at_end: False,
      next: "",
      x: 0.0,
      y: 0.0,
    ))

  assert sync
    == editor.Press(
      Some(caret("Flights are **booked**.", 0, 17)),
      x: 0.0,
      y: 0.0,
    )
  assert editor.region(ed) == Some(Region(2, 2))
}

pub fn ticking_a_drawn_task_leaves_the_field_alone_test() {
  let Outcome(editor: ed, sync:, ..) =
    live("# Trip\n\n- [ ] one")
    |> editor.tick(markdown.Task(checked: False, row: 2, col: 3), True)

  assert sync == editor.InSync
  assert editor.text(ed) == "# Trip\n\n- [x] one"
  assert editor.region(ed) == Some(Region(0, 0))
}

pub fn the_whole_note_is_drawn_while_the_field_is_out_of_focus_test() {
  let Outcome(editor: ed, ..) =
    editor.update(live(live_note), editor.FocusChanged(False))
  assert editor.is_idle(ed)

  let Outcome(editor: ed, ..) = editor.update(ed, editor.FocusChanged(True))
  assert !editor.is_idle(ed)
  assert !editor.is_idle(editor.new(vim: False, live: False, paint: True))
}

pub fn escape_releases_the_field_in_live_view_test() {
  let ed = live(live_note)
  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.EscapePressed(shown: editor.field_buffer(ed)))

  assert sync == editor.Release(caret("# Trip", 0, 0))
  assert editor.is_idle(ed)
  assert editor.text(ed) == live_note
}

pub fn escape_collapses_a_selection_across_blocks_to_its_head_test() {
  let ed = pressed(live_note, 2, "Fli")
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.EdgePressed(
        editor.SelectToEnd,
        x: 0.0,
        shown: editor.field_buffer(ed),
      ),
    )
  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.EscapePressed(shown: editor.field_buffer(ed)))

  let end = Position(row: 5, col: 5)
  assert buffer.selection(editor.buffer(ed)) == #(end, end)
  assert sync == editor.Release(caret("- two", 0, 5))
  assert editor.is_idle(ed)
}

pub fn escape_right_after_live_view_comes_on_releases_the_field_test() {
  let Outcome(editor: markdown, ..) =
    editor.new(vim: False, live: False, paint: True) |> editor.open(live_note)
  let Outcome(editor: ed, ..) = editor.set_live(markdown, True)
  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.EscapePressed(shown: caret("# Trip", 0, 0)))

  assert sync == editor.Release(caret("# Trip", 0, 0))
  assert editor.is_idle(ed)
}

pub fn escape_with_the_whole_note_in_the_field_changes_nothing_test() {
  let Outcome(editor: ed, ..) =
    editor.new(vim: False, live: False, paint: True) |> editor.open("one")
  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.EscapePressed(shown: caret("one", 0, 1)))

  assert sync == editor.InSync
  assert buffer.cursor(editor.buffer(ed)) == Position(row: 0, col: 1)
}

pub fn a_write_counts_as_focus_before_the_browser_says_so_test() {
  // The field is drawn in its block before it takes the keyboard.
  assert !editor.is_idle(live(live_note))

  let Outcome(editor: ed, ..) =
    editor.update(live(live_note), editor.FocusChanged(False))
    |> fn(outcome: Outcome) { outcome.editor }
    |> editor.update(editor.Pointed(
      row: 4,
      visible: "on",
      at_end: False,
      next: "",
      x: 0.0,
      y: 0.0,
    ))
  assert !editor.is_idle(ed)
}

pub fn leaving_live_view_puts_the_whole_note_back_test() {
  let Outcome(editor: ed, ..) =
    live(live_note)
    |> editor.update(editor.Pointed(
      row: 4,
      visible: "on",
      at_end: False,
      next: "",
      x: 0.0,
      y: 0.0,
    ))
  let Outcome(editor: ed, sync:, ..) = editor.set_live(ed, False)

  assert sync == editor.Write(caret(live_note, 4, 4))
  assert editor.region(ed) == None
}

pub fn the_page_is_drawn_from_the_text_after_every_change_but_typing_composing_or_joining_on_a_row_test() {
  let parsed = fn(ed: Editor) {
    editor.blocks(ed) == markdown.parse(editor.text(ed))
  }
  let ed = live(live_note)
  assert parsed(ed)

  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.ControlChanged(shown: caret("# Trips", 0, 7), at: 0),
    )
  assert editor.blocks(ed) == markdown.parse(live_note)
  let composed = caret("# Trips\n\n> a", 2, 3)
  let Outcome(editor: ed, ..) =
    editor.update(ed, editor.Composing(shown: composed))
  assert editor.region(ed) == Some(Region(0, 2))
  assert !parsed(ed)
  let Outcome(editor: ed, ..) =
    editor.update(ed, editor.ControlChanged(shown: composed, at: 0))
  assert editor.region(ed) == Some(Region(2, 2))
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.EdgePressed(editor.JoinBefore, x: 0.0, shown: caret("> a", 0, 0)),
    )
  assert editor.text(ed)
    == "# Trips\n> a\n\nFlights are **booked**.\n\n- one\n- two"
  assert !parsed(ed)
  let Outcome(editor: ed, ..) = editor.update(ed, editor.FocusChanged(False))
  assert parsed(ed)
  let Outcome(editor: ed, ..) = editor.open(ed, "1. a\n2. b")
  assert parsed(ed)
}

pub fn the_whole_note_in_the_field_has_no_blocks_to_draw_test() {
  let Outcome(editor: ed, ..) =
    editor.new(vim: False, live: False, paint: True) |> editor.open(live_note)

  assert editor.blocks(ed) == []
}

pub fn a_new_editor_in_live_view_holds_a_part_and_is_idle_test() {
  let ed = editor.new(vim: False, live: True, paint: True)
  assert editor.region(ed) == Some(Region(0, 0))
  assert editor.is_idle(ed)
}

pub fn switching_vim_asks_for_no_write_test() {
  let Outcome(editor: opened, ..) =
    editor.new(vim: False, live: False, paint: True) |> editor.open("one")
  let Outcome(editor: ed, sync:, ..) = editor.set_vim(opened, True)
  assert sync == editor.InSync
  assert editor.mode(ed) == editor.Normal
  assert editor.text(ed) == "one"
}

fn selected(
  text: String,
  from anchor: Position,
  to head: Position,
) -> buffer.Buffer {
  buffer.from_text(text) |> buffer.select(anchor:, head:)
}

fn pressed(text: String, row: Int, visible: String) -> Editor {
  let Outcome(editor: ed, ..) =
    live(text)
    |> editor.update(editor.Pointed(
      row:,
      visible:,
      at_end: False,
      next: "",
      x: 0.0,
      y: 0.0,
    ))
  ed
}

pub fn a_drag_from_a_press_selects_into_a_later_block_test() {
  let Outcome(editor: ed, sync:, ..) =
    pressed(live_note, 2, "Flights")
    |> editor.update(editor.Dragged(
      row: 4,
      visible: "o",
      at_end: False,
      next: "",
    ))

  assert editor.region(ed) == Some(Region(2, 4))
  assert sync
    == editor.WriteQuietly(selected(
      "Flights are **booked**.\n\n- one",
      from: Position(0, 7),
      to: Position(2, 3),
    ))
  assert editor.text(ed) == live_note
}

pub fn a_drag_into_an_earlier_block_keeps_the_anchor_where_the_press_was_test() {
  let Outcome(editor: ed, sync:, ..) =
    pressed(live_note, 4, "on")
    |> editor.update(editor.Dragged(
      row: 0,
      visible: "Tr",
      at_end: False,
      next: "",
    ))

  assert editor.region(ed) == Some(Region(0, 4))
  assert buffer.selection(editor.buffer(ed))
    == #(Position(row: 4, col: 4), Position(row: 0, col: 4))
  assert sync
    == editor.WriteQuietly(selected(
      "# Trip\n\nFlights are **booked**.\n\n- one",
      from: Position(4, 4),
      to: Position(0, 4),
    ))
}

pub fn a_move_with_no_press_the_editor_took_selects_nothing_test() {
  let Outcome(editor: ed, sync:, ..) =
    live(live_note)
    |> editor.update(editor.Dragged(
      row: 4,
      visible: "o",
      at_end: False,
      next: "",
    ))
  assert sync == editor.InSync
  assert editor.region(ed) == Some(Region(0, 0))

  let Outcome(editor: ed, ..) =
    pressed(live_note, 2, "Fli") |> editor.update(editor.Released)
  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.Dragged(row: 4, visible: "o", at_end: False, next: ""),
    )
  assert sync == editor.InSync
  assert editor.field_buffer(ed) == caret("Flights are **booked**.", 0, 3)
}

pub fn the_focus_a_press_brings_does_not_end_it_but_a_blur_does_test() {
  let Outcome(editor: ed, ..) =
    pressed(live_note, 2, "Flights") |> editor.update(editor.FocusChanged(True))
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.Dragged(row: 4, visible: "o", at_end: False, next: ""),
    )
  assert editor.region(ed) == Some(Region(2, 4))

  let Outcome(editor: ed, ..) =
    pressed(live_note, 2, "Flights")
    |> editor.update(editor.FocusChanged(False))
  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.Dragged(row: 4, visible: "o", at_end: False, next: ""),
    )
  assert sync == editor.InSync
  assert editor.region(ed) == Some(Region(2, 2))
}

pub fn a_drag_that_stays_in_place_writes_nothing_test() {
  let Outcome(sync:, ..) =
    pressed(live_note, 2, "Fli")
    |> editor.update(editor.Dragged(
      row: 2,
      visible: "Fli",
      at_end: False,
      next: "",
    ))
  assert sync == editor.InSync
}

pub fn shift_and_a_press_extend_the_selection_the_field_shows_test() {
  let shown = caret("Flights are **booked**.", 0, 23)
  let Outcome(editor: ed, sync:, ..) =
    pressed(live_note, 2, "")
    |> editor.update(editor.ShiftPointed(
      row: 4,
      visible: "o",
      at_end: False,
      next: "",
      shown:,
      x: 0.0,
      y: 0.0,
    ))
  assert editor.region(ed) == Some(Region(2, 4))
  assert sync
    == editor.Press(
      Some(selected(
        "Flights are **booked**.\n\n- one",
        from: Position(0, 23),
        to: Position(2, 3),
      )),
      x: 0.0,
      y: 0.0,
    )

  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.Dragged(row: 5, visible: "t", at_end: False, next: ""),
    )
  assert editor.region(ed) == Some(Region(2, 5))
  assert buffer.selection(editor.buffer(ed))
    == #(Position(row: 2, col: 23), Position(row: 5, col: 3))
}

pub fn shift_and_an_arrow_up_or_down_ask_to_step_on_the_drawn_page_test() {
  let Outcome(editor: ed, sync:, ..) =
    live(live_note)
    |> editor.update(editor.EdgePressed(
      editor.SelectDown,
      x: 12.5,
      shown: caret("# Trip", 0, 3),
    ))
  assert sync
    == editor.WriteAndStep(
      caret("# Trip", 0, 3),
      x: 12.5,
      up: False,
      queued: False,
    )
  assert buffer.selection(editor.buffer(ed))
    == #(Position(row: 0, col: 3), Position(row: 0, col: 3))

  let ed = pressed(live_note, 4, "on")
  let Outcome(sync:, ..) =
    editor.update(
      ed,
      editor.EdgePressed(
        editor.SelectUp,
        x: 7.0,
        shown: editor.field_buffer(ed),
      ),
    )
  assert sync
    == editor.WriteAndStep(
      caret("- one", 0, 4),
      x: 7.0,
      up: True,
      queued: False,
    )
}

pub fn a_step_pressed_before_the_last_is_placed_waits_for_it_test() {
  let shown = caret("# Trip", 0, 3)
  let Outcome(editor: ed, ..) =
    live(live_note)
    |> editor.update(editor.EdgePressed(editor.SelectDown, x: 12.5, shown:))
  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.EdgePressed(editor.SelectUp, x: 12.5, shown:))
  assert sync == editor.InSync

  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.Stepped(row: 1, visible: "", at_end: True, next: "", x: 12.5),
    )
  assert sync
    == editor.WriteAndStep(
      selected("# Trip\n", from: Position(0, 3), to: Position(1, 0)),
      x: 12.5,
      up: True,
      queued: True,
    )

  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.Stepped(row: 0, visible: "Tr", at_end: False, next: "", x: 12.5),
    )
  assert sync
    == editor.Write(
      caret("# Trip", 0, 4)
      |> buffer.select(anchor: Position(0, 3), head: Position(0, 4)),
    )
  let Outcome(sync:, ..) =
    editor.update(
      ed,
      editor.EdgePressed(
        editor.SelectDown,
        x: 0.0,
        shown: editor.field_buffer(ed),
      ),
    )
  let assert editor.WriteAndStep(..) = sync
}

pub fn shift_and_an_arrow_left_or_right_on_a_painted_selection_skip_hidden_marks_test() {
  let ed = pressed(live_note, 0, "Tr")
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.Dragged(row: 2, visible: "Flights are ", at_end: False, next: ""),
    )
  let ed = editor.update(ed, editor.Released).editor
  assert editor.is_painted(ed)

  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.Nudged(
        forward: True,
        row: 2,
        visible: "Flights are booked.",
        shown: editor.field_buffer(ed),
      ),
    )
  assert sync
    == editor.Write(selected(
      "# Trip\n\nFlights are **booked**.",
      from: Position(0, 4),
      to: Position(2, 15),
    ))

  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.Nudged(
        forward: False,
        row: 2,
        visible: "Flights are booked.",
        shown: editor.field_buffer(ed),
      ),
    )
  assert sync
    == editor.Write(selected(
      "# Trip\n\nFlights are **booked**.",
      from: Position(0, 4),
      to: Position(2, 12),
    ))
  assert editor.text(ed) == live_note
}

pub fn a_step_moves_the_head_and_keeps_the_anchor_test() {
  let Outcome(editor: ed, ..) =
    live(live_note)
    |> editor.update(editor.EdgePressed(
      editor.SelectDown,
      x: 12.5,
      shown: caret("# Trip", 0, 3),
    ))
  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.Stepped(row: 2, visible: "Fli", at_end: False, next: "", x: 12.5),
    )

  assert editor.region(ed) == Some(Region(0, 2))
  assert sync
    == editor.Write(selected(
      "# Trip\n\nFlights are **booked**.",
      from: Position(0, 3),
      to: Position(2, 3),
    ))
  assert editor.text(ed) == live_note
}

pub fn a_step_the_page_had_no_place_for_lets_the_next_step_go_test() {
  let shown = caret("# Trip", 0, 3)
  let Outcome(editor: ed, ..) =
    live(live_note)
    |> editor.update(editor.EdgePressed(editor.SelectDown, x: 9.0, shown:))
  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.Unstepped(x: 9.0))
  assert sync == editor.Write(shown)
  let Outcome(sync:, ..) =
    editor.update(ed, editor.EdgePressed(editor.SelectDown, x: 9.0, shown:))
  assert sync == editor.WriteAndStep(shown, x: 9.0, up: False, queued: False)
}

pub fn the_next_step_aims_where_the_last_step_aimed_test() {
  let ed =
    live(live_note)
    |> editor.update(editor.Stepped(
      row: 1,
      visible: "",
      at_end: True,
      next: "",
      x: 40.0,
    ))
  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed.editor,
      editor.EdgePressed(
        editor.SelectDown,
        x: 0.0,
        shown: editor.field_buffer(ed.editor),
      ),
    )
  let assert editor.WriteAndStep(_, x: 40.0, up: False, queued: False) = sync

  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.ShiftPointed(
        row: 2,
        visible: "Fli",
        at_end: False,
        next: "",
        shown: editor.field_buffer(ed),
        x: 0.0,
        y: 0.0,
      ),
    )
  let Outcome(sync:, ..) =
    editor.update(
      ed,
      editor.EdgePressed(
        editor.SelectUp,
        x: 3.0,
        shown: editor.field_buffer(ed),
      ),
    )
  let assert editor.WriteAndStep(_, x: 3.0, up: True, queued: False) = sync
}

pub fn shift_arrows_at_the_ends_of_the_field_cross_one_character_test() {
  let ed = pressed(live_note, 2, "")
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.EdgePressed(
        editor.SelectBefore,
        x: 0.0,
        shown: caret("Flights are **booked**.", 0, 0),
      ),
    )
  assert editor.region(ed) == Some(Region(1, 2))
  assert buffer.selection(editor.buffer(ed))
    == #(Position(row: 2, col: 0), Position(row: 1, col: 0))

  let Outcome(editor: ed, ..) =
    live(live_note)
    |> editor.update(editor.Pointed(
      row: 2,
      visible: "",
      at_end: True,
      next: "",
      x: 0.0,
      y: 0.0,
    ))
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.EdgePressed(
        editor.SelectAfter,
        x: 0.0,
        shown: caret("Flights are **booked**.", 0, 23),
      ),
    )
  assert editor.region(ed) == Some(Region(2, 3))
  assert buffer.selection(editor.buffer(ed))
    == #(Position(row: 2, col: 23), Position(row: 3, col: 0))
}

pub fn select_all_takes_the_whole_note_into_the_field_test() {
  let Outcome(editor: ed, sync:, ..) =
    live(live_note)
    |> editor.update(editor.EdgePressed(
      editor.SelectAll,
      x: 0.0,
      shown: caret("# Trip", 0, 2),
    ))

  assert editor.region(ed) == Some(Region(0, 5))
  assert sync
    == editor.Write(selected(
      live_note,
      from: Position(0, 0),
      to: Position(5, 5),
    ))
}

pub fn selecting_to_the_ends_of_the_note_keeps_the_anchor_test() {
  let ed = pressed(live_note, 2, "Fli")
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.EdgePressed(
        editor.SelectToEnd,
        x: 0.0,
        shown: editor.field_buffer(ed),
      ),
    )
  assert editor.region(ed) == Some(Region(2, 5))
  assert buffer.selection(editor.buffer(ed))
    == #(Position(row: 2, col: 3), Position(row: 5, col: 5))

  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.EdgePressed(
        editor.SelectToStart,
        x: 0.0,
        shown: editor.field_buffer(ed),
      ),
    )
  assert editor.region(ed) == Some(Region(0, 2))
  assert buffer.selection(editor.buffer(ed))
    == #(Position(row: 2, col: 3), Position(row: 0, col: 0))
}

pub fn typing_over_a_selection_across_blocks_replaces_it_test() {
  let Outcome(editor: ed, ..) =
    live(live_note)
    |> editor.update(editor.ControlChanged(shown: caret("# Trip", 0, 3), at: 0))
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.Stepped(row: 2, visible: "", at_end: False, next: "", x: 0.0),
    )

  let typed = caret("# TXFlights are **booked**.", 0, 4)
  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.ControlChanged(shown: typed, at: 0))
  assert editor.text(ed) == "# TXFlights are **booked**.\n\n- one\n- two"
  assert editor.region(ed) == Some(Region(0, 0))
  assert sync == editor.InSync
}

pub fn a_press_after_a_selection_across_blocks_puts_one_block_back_test() {
  let Outcome(editor: ed, ..) =
    live(live_note)
    |> editor.update(editor.EdgePressed(
      editor.SelectAll,
      x: 0.0,
      shown: caret("# Trip", 0, 0),
    ))
  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.Pointed(
        row: 0,
        visible: "# Trip\n\nFli",
        at_end: False,
        next: "",
        x: 0.0,
        y: 0.0,
      ),
    )

  assert editor.region(ed) == Some(Region(2, 2))
  assert sync
    == editor.Press(
      Some(caret("Flights are **booked**.", 0, 3)),
      x: 0.0,
      y: 0.0,
    )
}

pub fn selection_keys_never_cross_with_the_whole_note_in_the_field_test() {
  let Outcome(editor: whole, ..) =
    editor.new(vim: False, live: False, paint: True) |> editor.open("one\ntwo")
  let shown = caret("one\ntwo", 0, 2)
  use edge <- list.each([
    editor.SelectUp,
    editor.SelectDown,
    editor.SelectBefore,
    editor.SelectAfter,
  ])
  let Outcome(sync:, ..) =
    editor.update(whole, editor.EdgePressed(edge, x: 0.0, shown:))
  assert sync == editor.InSync
}

pub fn a_selection_that_reaches_another_block_is_painted_test() {
  let ed = pressed(live_note, 2, "Fli")
  assert !editor.is_painted(ed)

  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.Dragged(row: 2, visible: "Flights are", at_end: False, next: ""),
    )
  assert !editor.is_painted(ed)

  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.Dragged(row: 4, visible: "o", at_end: False, next: ""),
    )
  assert editor.is_painted(ed)
  assert editor.region(ed) == Some(Region(2, 4))
  assert !editor.is_idle(ed)

  let Outcome(editor: ed, ..) = editor.update(ed, editor.Released)
  assert editor.is_painted(ed)
}

pub fn select_all_paints_the_whole_note_test() {
  let Outcome(editor: ed, ..) =
    live(live_note)
    |> editor.update(editor.EdgePressed(
      editor.SelectAll,
      x: 0.0,
      shown: caret("# Trip", 0, 2),
    ))
  assert editor.is_painted(ed)
}

pub fn a_selection_across_blocks_is_not_painted_out_of_focus_test() {
  let Outcome(editor: ed, ..) =
    live(live_note)
    |> editor.update(editor.EdgePressed(
      editor.SelectAll,
      x: 0.0,
      shown: caret("# Trip", 0, 2),
    ))
  let Outcome(editor: blurred, ..) =
    editor.update(ed, editor.FocusChanged(False))
  assert !editor.is_painted(blurred)

  let Outcome(editor: back, ..) =
    editor.update(blurred, editor.FocusChanged(True))
  assert editor.is_painted(back)

  let Outcome(editor: escaped, ..) =
    editor.update(ed, editor.EscapePressed(shown: editor.field_buffer(ed)))
  assert !editor.is_painted(escaped)
}

pub fn a_selection_across_blocks_is_not_painted_where_it_cannot_be_test() {
  let opened =
    editor.new(vim: False, live: True, paint: False) |> editor.open(live_note)
  let Outcome(editor: ed, ..) =
    editor.update(
      opened.editor,
      editor.EdgePressed(editor.SelectAll, x: 0.0, shown: caret("# Trip", 0, 2)),
    )
  assert editor.region(ed) == Some(Region(0, 5))
  assert !editor.is_painted(ed)
}

pub fn a_click_takes_the_paint_off_test() {
  let Outcome(editor: ed, ..) =
    live(live_note)
    |> editor.update(editor.EdgePressed(
      editor.SelectAll,
      x: 0.0,
      shown: caret("# Trip", 0, 2),
    ))
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.Pointed(
        row: 4,
        visible: "o",
        at_end: False,
        next: "",
        x: 0.0,
        y: 0.0,
      ),
    )
  assert !editor.is_painted(ed)
}

fn show(ed: Editor, shown: buffer.Buffer) -> Editor {
  editor.update(ed, editor.ControlChanged(shown:, at: 0)).editor
}

fn point(ed: Editor, row: Int) -> Editor {
  editor.update(
    ed,
    editor.Pointed(row:, visible: "", at_end: False, next: "", x: 0.0, y: 0.0),
  ).editor
}

pub fn a_dash_typed_under_a_line_keeps_the_page_until_the_caret_leaves_its_row_test() {
  let ed = live("~~wow~~") |> show(caret("~~wow~~\n", 1, 0))
  assert editor.region(ed) == Some(Region(1, 1))
  let drawn = editor.blocks(ed)

  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.ControlChanged(shown: caret("-", 0, 1), at: 0))
  assert sync == editor.InSync
  assert editor.text(ed) == "~~wow~~\n-"
  assert editor.region(ed) == Some(Region(1, 1))
  assert editor.blocks(ed) == drawn
  assert editor.kind(ed) == Some(live.Body)

  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.EdgePressed(editor.Up, x: 0.0, shown: caret("-", 0, 1)),
    )
  assert editor.region(ed) == Some(Region(0, 1))
  assert editor.blocks(ed) == markdown.parse("~~wow~~\n-")
  assert editor.kind(ed) == Some(live.Title(markdown.H2))
}

pub fn moving_inside_a_block_never_changes_how_the_field_is_set_test() {
  let heading = "Hello\n-"
  let ed = live(heading)
  assert editor.kind(ed) == Some(live.Title(markdown.H2))

  let ed = show(ed, caret(heading, 1, 1))
  assert editor.region(ed) == Some(Region(0, 1))
  assert editor.kind(ed) == Some(live.Title(markdown.H2))
  let ed = show(ed, caret(heading, 0, 2))
  assert editor.kind(ed) == Some(live.Title(markdown.H2))

  let table = "| a | b |\n|-|-|\n| 1 | 2 |"
  let ed = live(table)
  assert editor.kind(ed) == Some(live.Mono)
  let ed = show(ed, caret(table, 1, 2))
  assert editor.kind(ed) == Some(live.Mono)
  let ed = show(ed, caret(table, 2, 0))
  assert editor.kind(ed) == Some(live.Mono)
}

pub fn a_row_typed_under_a_table_keeps_the_table_drawn_test() {
  let ed = live("| a | b |\n|-|-|\n") |> point(2)
  assert editor.region(ed) == Some(Region(2, 2))
  let drawn = editor.blocks(ed)

  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.ControlChanged(shown: caret("| 1", 0, 3), at: 0))
  assert sync == editor.InSync
  assert editor.region(ed) == Some(Region(2, 2))
  assert editor.blocks(ed) == drawn
  assert editor.kind(ed) == Some(live.Body)
}

pub fn a_block_typed_on_a_row_of_its_own_is_set_at_once_test() {
  let ed = live("top\n\n") |> point(2)

  assert editor.kind(show(ed, caret("# T", 0, 3)))
    == Some(live.Title(markdown.H1))
  assert editor.kind(show(ed, caret("- item", 0, 6)))
    == Some(live.ListItem(task: False, marker: "- "))
  assert editor.kind(show(ed, caret("```", 0, 3))) == Some(live.Mono)
}

pub fn a_row_that_joins_a_block_beyond_the_field_is_set_as_body_text_test() {
  let ed = live("# Title\ntext")
  assert editor.kind(ed) == Some(live.Title(markdown.H1))

  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.ControlChanged(shown: caret("Title", 0, 0), at: 0))
  assert sync == editor.InSync
  assert editor.region(ed) == Some(Region(0, 0))
  assert editor.blocks(ed) == markdown.parse("# Title\ntext")
  assert editor.kind(ed) == Some(live.Body)
}

pub fn typing_in_a_field_of_several_rows_keeps_how_it_is_set_test() {
  let table = "| a | b |\n|-|-|\n| 1 | 2 |"
  let broken = "| a | b |\n|x-|-|\n| 1 | 2 |"
  let ed = live(table) |> show(caret(table, 1, 1))
  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.ControlChanged(shown: caret(broken, 1, 2), at: 0))
  assert sync == editor.InSync
  assert editor.kind(ed) == Some(live.Mono)
  assert editor.blocks(ed) == markdown.parse(table)

  let ed = show(ed, caret(broken, 0, 0))
  assert editor.kind(ed) == Some(live.Body)
  assert editor.blocks(ed) == markdown.parse(broken)

  let ed = live("Hello\nworld") |> show(caret("Hello\nworld", 1, 5))
  assert editor.kind(show(ed, caret("Hello\n-", 1, 1))) == Some(live.Body)
}

pub fn leaving_the_field_draws_the_page_from_the_text_test() {
  let ed =
    live("Hello")
    |> show(caret("Hello\n", 1, 0))
    |> show(caret("-", 0, 1))
  assert editor.region(ed) == Some(Region(1, 1))

  let Outcome(editor: blurred, sync:, ..) =
    editor.update(ed, editor.FocusChanged(False))
  assert sync == editor.InSync
  assert editor.region(blurred) == Some(Region(1, 1))
  assert editor.blocks(blurred) == markdown.parse("Hello\n-")
  assert editor.is_idle(blurred)

  let Outcome(editor: back, sync:, ..) =
    editor.update(blurred, editor.FocusChanged(True))
  assert sync == editor.Write(caret("Hello\n-", 1, 1))
  assert editor.region(back) == Some(Region(0, 1))
  assert editor.kind(back) == Some(live.Title(markdown.H2))

  let Outcome(editor: escaped, sync:, ..) =
    editor.update(ed, editor.EscapePressed(shown: caret("-", 0, 1)))
  assert sync == editor.Release(caret("Hello\n-", 1, 1))
  assert editor.blocks(escaped) == markdown.parse("Hello\n-")
}

pub fn a_tick_keeps_the_page_as_it_was_laid_out_but_for_the_box_test() {
  let ed =
    live("- [ ] one\n\ntext")
    |> point(2)
    |> show(caret("text\n", 1, 0))
    |> show(caret("-", 0, 1))
  assert editor.region(ed) == Some(Region(3, 3))

  let Outcome(editor: ed, sync:, ..) =
    editor.tick(ed, markdown.Task(checked: False, row: 0, col: 3), True)
  assert sync == editor.InSync
  assert editor.text(ed) == "- [x] one\n\ntext\n-"
  assert editor.region(ed) == Some(Region(3, 3))
  assert editor.blocks(ed) == markdown.parse("- [x] one\n\ntext\n")
  assert editor.kind(ed) == Some(live.Body)
}

pub fn a_press_on_a_link_or_a_box_moves_nothing_until_it_drags_test() {
  let ed = live(live_note)
  let Outcome(editor: grabbed, sync:, ..) =
    editor.update(
      ed,
      editor.Grabbed(
        row: 2,
        visible: "Fli",
        at_end: False,
        next: "",
        x: 5.0,
        y: 6.0,
      ),
    )
  assert sync == editor.Press(None, x: 5.0, y: 6.0)
  assert editor.field_buffer(grabbed) == editor.field_buffer(ed)

  let Outcome(editor: let_go, ..) = editor.update(grabbed, editor.Released)
  let Outcome(sync:, ..) =
    editor.update(
      let_go,
      editor.Dragged(row: 4, visible: "o", at_end: False, next: ""),
    )
  assert sync == editor.InSync

  let Outcome(editor: dragged, ..) =
    editor.update(
      grabbed,
      editor.Dragged(row: 4, visible: "o", at_end: False, next: ""),
    )
  assert buffer.selection(editor.buffer(dragged))
    == #(Position(row: 2, col: 3), Position(row: 4, col: 3))
}

pub fn a_double_click_selects_a_word_and_its_drag_selects_whole_words_test() {
  let ed = live("alpha beta gamma\n\nsecond para here")
  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.WordPointed(
        row: 2,
        visible: "second pa",
        at_end: False,
        next: "",
        x: 1.0,
        y: 2.0,
      ),
    )
  let para = #(Position(2, 7), Position(2, 11))
  assert buffer.selection(editor.buffer(ed)) == para
  assert sync == editor.Press(Some(editor.field_buffer(ed)), x: 1.0, y: 2.0)

  let drag = fn(ed, row, visible) {
    editor.update(ed, editor.Dragged(row:, visible:, at_end: False, next: "")).editor
    |> editor.buffer
    |> buffer.selection
  }
  assert drag(ed, 0, "alpha be") == #(Position(2, 11), Position(0, 6))
  assert drag(ed, 2, "second p") == para
  assert drag(ed, 2, "second para he") == #(Position(2, 7), Position(2, 16))

  let Outcome(editor: let_go, ..) = editor.update(ed, editor.Released)
  let Outcome(sync:, ..) =
    editor.update(
      let_go,
      editor.Dragged(row: 0, visible: "a", at_end: False, next: ""),
    )
  assert sync == editor.InSync
}

pub fn a_triple_click_selects_a_line_and_its_drag_selects_whole_lines_test() {
  let ed = live("alpha beta\n\n- one\n- two\n\nlast")
  let line = fn(row, visible) {
    let Outcome(editor: ed, sync:, ..) =
      editor.update(
        ed,
        editor.LinePointed(
          row:,
          visible:,
          at_end: False,
          next: "",
          x: 1.0,
          y: 2.0,
        ),
      )
    assert sync == editor.Press(Some(editor.field_buffer(ed)), x: 1.0, y: 2.0)
    ed
  }
  let selected = fn(ed) { buffer.selection(editor.buffer(ed)) }
  assert selected(line(0, "alpha b")) == #(Position(0, 0), Position(0, 10))
  assert selected(line(5, "la")) == #(Position(5, 0), Position(5, 4))

  let item = line(2, "on")
  assert selected(item) == #(Position(2, 0), Position(2, 5))

  let drag = fn(row, visible) {
    editor.update(item, editor.Dragged(row:, visible:, at_end: False, next: "")).editor
    |> editor.buffer
    |> buffer.selection
  }
  assert drag(0, "alp") == #(Position(2, 5), Position(0, 0))
  assert drag(2, "o") == #(Position(2, 0), Position(2, 5))
  assert drag(5, "l") == #(Position(2, 0), Position(5, 4))
}

pub fn a_drag_from_a_box_on_the_idle_page_takes_the_focus_test() {
  let Outcome(editor: idle, ..) =
    editor.update(live(live_note), editor.FocusChanged(False))
  let Outcome(editor: grabbed, ..) =
    editor.update(
      idle,
      editor.Grabbed(
        row: 4,
        visible: "",
        at_end: False,
        next: "",
        x: 0.0,
        y: 0.0,
      ),
    )
  assert editor.is_idle(grabbed)

  let Outcome(editor: dragged, sync:, ..) =
    editor.update(
      grabbed,
      editor.Dragged(row: 5, visible: "t", at_end: False, next: ""),
    )
  assert !editor.is_idle(dragged)
  assert sync
    == editor.Write(selected(
      "- one\n- two",
      from: Position(0, 0),
      to: Position(1, 3),
    ))
}

fn rows_of(ed: Editor) -> List(#(Int, Int)) {
  list.map(editor.blocks(ed), fn(block) { #(block.first_row, block.last_row) })
}

pub fn joining_two_rows_keeps_the_page_and_moves_the_rows_below_up_test() {
  let ed = live("text\n\n-\n\nafter") |> point(1)
  let Outcome(editor: deleted, ..) =
    editor.update(
      ed,
      editor.EdgePressed(editor.JoinAfter, x: 0.0, shown: caret("", 0, 0)),
    )
  assert editor.text(deleted) == "text\n-\n\nafter"
  assert editor.region(deleted) == Some(Region(1, 1))
  assert editor.kind(deleted) == Some(live.Body)
  assert rows_of(deleted) == [#(0, 0), #(1, 1), #(3, 3)]
  let assert [markdown.Block(content: markdown.Paragraph(..), ..), ..] =
    editor.blocks(deleted)

  let ed = live("text\n\n-\n\nafter") |> point(2)
  let Outcome(editor: backspaced, ..) =
    editor.update(
      ed,
      editor.EdgePressed(editor.JoinBefore, x: 0.0, shown: caret("-", 0, 0)),
    )
  assert editor.text(backspaced) == "text\n-\n\nafter"
  assert editor.region(backspaced) == Some(Region(1, 1))
  assert editor.blocks(backspaced) == editor.blocks(deleted)

  let Outcome(editor: left, ..) =
    editor.update(
      backspaced,
      editor.ControlChanged(shown: caret("-", 0, 1), at: 0),
    )
  assert editor.blocks(left) == editor.blocks(deleted)
  let left = point(left, 3)
  assert editor.blocks(left) == markdown.parse("text\n-\n\nafter")
}

pub fn a_row_joined_inside_the_field_keeps_the_rows_below_drawn_test() {
  let ed =
    live("```\ncode\n```\n\nafter words")
    |> show(caret("```\ncode\n```", 1, 4))
  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.ControlChanged(shown: caret("```\ncode```", 1, 4), at: 0),
    )
  assert sync == editor.InSync
  assert editor.region(ed) == Some(Region(0, 1))
  assert rows_of(ed) == [#(0, 1), #(3, 3)]
  let assert [_, markdown.Block(content: markdown.Paragraph(..), ..)] =
    editor.blocks(ed)
}

pub fn composing_over_a_selection_across_blocks_keeps_the_rows_after_it_drawn_test() {
  let note = "para one\n\n# Head\ntext under head\n\nend"
  let ed = live(note)
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.EdgePressed(
        editor.SelectDown,
        x: 0.0,
        shown: caret("para one", 0, 8),
      ),
    )
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.Stepped(row: 2, visible: "", at_end: False, next: "", x: 0.0),
    )
  assert editor.region(ed) == Some(Region(0, 2))

  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.Composing(shown: caret("para oneか# Head", 0, 9)))
  assert sync == editor.InSync
  assert editor.text(ed) == "para oneか# Head\ntext under head\n\nend"
  assert editor.region(ed) == Some(Region(0, 0))
  assert list.contains(rows_of(ed), #(1, 1))
}

pub fn a_row_typed_as_another_block_keeps_the_frame_of_the_row_laid_out_test() {
  let ed = live("top\n\n\n\nbelow") |> point(2)
  assert editor.frame(ed) == Some(live.Body)

  let Outcome(editor: ed, ..) =
    editor.update(ed, editor.ControlChanged(shown: caret("- x", 0, 3), at: 0))
  assert editor.kind(ed) == Some(live.ListItem(task: False, marker: "- "))
  assert editor.frame(ed) == Some(live.Body)

  let ed = ed |> point(4) |> point(2)
  assert editor.frame(ed) == Some(live.ListItem(task: False, marker: "- "))
}

pub fn the_selection_dragged_onto_the_drawn_page_moves_there_test() {
  let shown =
    buffer.from_text("alpha beta gamma")
    |> buffer.select(anchor: Position(0, 0), head: Position(0, 5))
  let ed =
    live("alpha beta gamma\n\nsecond para here")
    |> editor.update(editor.ControlChanged(shown:, at: 0))
  let drop = fn(ed: Outcome, copy) {
    editor.update(
      ed.editor,
      editor.Dropped(
        row: 2,
        visible: "second ",
        at_end: False,
        next: "",
        text: "alpha",
        copy:,
        shown:,
      ),
    )
  }

  let Outcome(editor: moved, sync:, ..) =
    ed.editor |> editor.update(editor.DragStarted) |> drop(False)
  assert editor.text(moved) == " beta gamma\n\nsecond alphapara here"
  assert buffer.selection(editor.buffer(moved))
    == #(Position(2, 7), Position(2, 12))
  assert sync == editor.Write(editor.field_buffer(moved))
  assert editor.region(moved) == Some(Region(2, 2))

  let Outcome(editor: copied, ..) =
    ed.editor |> editor.update(editor.DragStarted) |> drop(True)
  assert editor.text(copied) == "alpha beta gamma\n\nsecond alphapara here"

  let Outcome(editor: let_go, ..) =
    ed.editor
    |> editor.update(editor.DragStarted)
    |> fn(started: Outcome) { editor.update(started.editor, editor.Released) }
  let Outcome(editor: inserted, ..) = drop(Outcome(..ed, editor: let_go), False)
  assert editor.text(inserted) == "alpha beta gamma\n\nsecond alphapara here"
  assert buffer.selection(editor.buffer(inserted))
    == #(Position(2, 7), Position(2, 12))
}

pub fn nothing_is_dropped_in_vim_normal_mode_test() {
  let opened =
    editor.new(vim: True, live: False, paint: True) |> editor.open("one\n\ntwo")
  let ed = editor.set_live(opened.editor, True).editor
  let Outcome(editor: dropped, sync:, ..) =
    editor.update(
      ed,
      editor.Dropped(
        row: 2,
        visible: "",
        at_end: False,
        next: "",
        text: "x",
        copy: False,
        shown: editor.field_buffer(ed),
      ),
    )
  assert editor.text(dropped) == "one\n\ntwo"
  assert sync == editor.InSync
}

pub fn a_selection_reaching_another_row_lays_out_the_row_typed_as_another_block_test() {
  let ed = live("- a\n- b") |> point(1) |> show(caret("# b", 0, 3))
  assert editor.region(ed) == Some(Region(1, 1))
  let assert Some(live.ListItem(..)) = editor.frame(ed)

  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.EdgePressed(editor.SelectAll, x: 0.0, shown: caret("# b", 0, 3)),
    )
  assert editor.region(ed) == Some(Region(0, 1))
  assert editor.blocks(ed) == markdown.parse("- a\n# b")
  assert editor.frame(ed) == Some(live.Body)
}

fn painted_from_trip_to_one() -> Editor {
  let ed = pressed(live_note, 0, "Tr")
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.Dragged(row: 4, visible: "o", at_end: False, next: ""),
    )
  let Outcome(editor: ed, ..) = editor.update(ed, editor.Released)
  ed
}

fn selection_pointed(ed: Editor, row: Int, visible: String) -> Outcome {
  editor.update(
    ed,
    editor.SelectionPointed(
      row:,
      visible:,
      at_end: False,
      next: "",
      x: 0.0,
      y: 0.0,
    ),
  )
}

pub fn a_press_on_a_painted_selection_holds_it_until_let_go_test() {
  let ed = painted_from_trip_to_one()
  assert editor.is_painted(ed)
  let before = editor.buffer(ed)

  let Outcome(editor: held, sync:, ..) =
    selection_pointed(ed, 2, "Flights are ")
  assert sync == editor.HoldSelection(x: 0.0, y: 0.0)
  assert editor.buffer(held) == before
  assert editor.is_painted(held)

  let Outcome(editor: let_go, sync:, ..) = editor.update(held, editor.Released)
  assert buffer.selection(editor.buffer(let_go))
    == #(Position(2, 12), Position(2, 12))
  assert !editor.is_painted(let_go)
  assert sync == editor.Write(editor.field_buffer(let_go))
}

pub fn a_painted_selection_dragged_and_dropped_moves_and_keeps_no_press_test() {
  let ed = painted_from_trip_to_one()
  let Outcome(editor: held, ..) = selection_pointed(ed, 2, "Flights are ")
  let Outcome(editor: started, sync:, ..) =
    editor.update(held, editor.DragStarted)
  assert sync == editor.InSync
  let Outcome(editor: dropped, ..) =
    editor.update(
      started,
      editor.Dropped(
        row: 5,
        visible: "two",
        at_end: True,
        next: "",
        text: "ignored",
        copy: False,
        shown: editor.field_buffer(started),
      ),
    )
  assert editor.text(dropped)
    == "# Trne\n- twoip\n\nFlights are **booked**.\n\n- o"

  let Outcome(editor: after, sync:, ..) =
    editor.update(dropped, editor.Released)
  assert editor.buffer(after) == editor.buffer(dropped)
  assert sync == editor.InSync
}

pub fn a_painted_selection_dragged_off_the_page_stays_test() {
  let ed = painted_from_trip_to_one()
  let Outcome(editor: held, ..) = selection_pointed(ed, 2, "Flights are ")
  let Outcome(editor: started, ..) = editor.update(held, editor.DragStarted)
  let Outcome(editor: let_go, sync:, ..) =
    editor.update(started, editor.Released)
  assert editor.buffer(let_go) == editor.buffer(ed)
  assert editor.is_painted(let_go)
  assert sync == editor.InSync
}

pub fn a_press_on_a_selection_no_longer_painted_is_a_plain_press_test() {
  let ed = pressed(live_note, 2, "Fli")
  let Outcome(editor: plain, sync:, ..) =
    selection_pointed(ed, 2, "Flights are ")
  let Outcome(editor: pointed, sync: pointed_sync, ..) =
    editor.update(
      ed,
      editor.Pointed(
        row: 2,
        visible: "Flights are ",
        at_end: False,
        next: "",
        x: 0.0,
        y: 0.0,
      ),
    )
  assert editor.buffer(plain) == editor.buffer(pointed)
  assert sync == pointed_sync
}
