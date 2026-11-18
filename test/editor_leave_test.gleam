//// An empty item typed right under its parent's words goes when the
//// selection leaves its row, whichever way it leaves, and one undo brings
//// it back. Through the editor, with no browser. A note is written with `|`
//// where the caret is.

import gleam/list
import gleam/option.{Some}
import gleam/string
import nullpad/buffer.{type Buffer, Position}
import nullpad/editor.{type Editor, type Outcome, Outcome}
import nullpad/live.{Region}
import nullpad/markdown
import nullpad/vim

fn at_caret(note: String) -> Buffer {
  let assert Ok(#(before, after)) = string.split_once(note, "|")
  let at = buffer.end_of(before)
  buffer.from_text(before <> after) |> buffer.select(anchor: at, head: at)
}

fn shown(ed: Editor) -> String {
  let b = editor.buffer(ed)
  let at = buffer.cursor(b)
  list.index_map(buffer.lines(b), fn(line, row) {
    case row == at.row {
      True ->
        string.slice(line, 0, at.col) <> "|" <> string.drop_start(line, at.col)
      False -> line
    }
  })
  |> string.join("\n")
}

fn opened(note: String, live: Bool) -> Editor {
  let b = at_caret(note)
  let Outcome(editor: ed, ..) =
    editor.new(vim: False, live: False, paint: True)
    |> editor.open(buffer.text(b))
  let Outcome(editor: ed, ..) =
    editor.update(ed, editor.ControlChanged(shown: b, at: 0))
  editor.set_live(ed, live).editor
}

fn live(note: String) -> Editor {
  opened(note, True)
}

fn point(ed: Editor, row: Int, at_end: Bool) -> Outcome {
  editor.update(
    ed,
    editor.Pointed(row:, visible: "", at_end:, next: "", x: 0.0, y: 0.0),
  )
}

fn typed_in_field(ed: Editor, text: String) -> Editor {
  let field = editor.field_buffer(ed)
  let at = buffer.cursor(field)
  let shown = buffer.replace(field, from: at, to: at, with: text)
  editor.update(ed, editor.ControlChanged(shown:, at: 0)).editor
}

pub fn clicking_away_takes_it_out_and_one_undo_brings_it_back_test() {
  let ed = live("- a\n- b\n- |")
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.KeyPressed(vim.Tab, shown: editor.field_buffer(ed)),
    )
  assert shown(ed) == "- a\n- b\n  - |"
  let Outcome(editor: away, sync:, ..) = point(ed, 0, True)
  assert shown(away) == "- a|\n- b"
  assert sync == editor.Press(Some(editor.field_buffer(away)), 0.0, 0.0)
  let Outcome(editor: back, ..) = editor.update(away, editor.UndoAsked)
  assert shown(back) == "- a\n- b\n  - |"
  let Outcome(editor: again, ..) = editor.update(back, editor.RedoAsked)
  assert shown(again) == "- a|\n- b"
  let Outcome(editor: back, ..) = editor.update(again, editor.UndoAsked)
  let Outcome(editor: back, ..) = editor.update(back, editor.UndoAsked)
  assert shown(back) == "- a\n- b\n- |"
}

pub fn a_click_below_it_puts_the_caret_on_the_row_that_moved_up_test() {
  let ed = live("- a\n- b\n  - |\n\nnext\n\nlast")
  let Outcome(editor: away, ..) = point(ed, 4, True)
  assert shown(away) == "- a\n- b\n\nnext|\n\nlast"
}

pub fn a_drag_from_a_click_below_it_starts_on_the_row_that_moved_up_test() {
  let ed = live("- a\n- b\n  - |\n\nnext\n\nlast")
  let Outcome(editor: away, ..) = point(ed, 4, True)
  let Outcome(editor: dragged, ..) =
    editor.update(
      away,
      editor.Dragged(row: 5, visible: "", at_end: True, next: ""),
    )
  assert buffer.selection(editor.buffer(dragged))
    == #(Position(3, 4), Position(5, 4))
}

pub fn a_double_click_below_it_selects_the_word_on_the_row_that_moved_up_test() {
  let ed = live("- a\n- b\n  - |\n\nnext\n\nlast")
  let Outcome(editor: away, ..) =
    editor.update(
      ed,
      editor.WordPointed(
        row: 4,
        visible: "",
        at_end: True,
        next: "",
        x: 0.0,
        y: 0.0,
      ),
    )
  assert editor.text(away) == "- a\n- b\n\nnext\n\nlast"
  assert buffer.selection(editor.buffer(away))
    == #(Position(3, 0), Position(3, 4))
}

pub fn an_arrow_inside_the_field_takes_it_out_test() {
  let ed = live("- a\n- b\n  - |")
  assert editor.region(ed) == Some(Region(1, 2))
  let field = editor.field_buffer(ed)
  let shown = buffer.move_to(field, Position(0, 3))
  let Outcome(editor: up, sync:, ..) =
    editor.update(ed, editor.ControlChanged(shown:, at: 0))
  assert editor.text(up) == "- a\n- b"
  assert editor.region(up) == Some(Region(1, 1))
  assert sync == editor.Write(editor.field_buffer(up))
  assert buffer.cursor(editor.buffer(up)) == Position(1, 3)
}

pub fn an_arrow_out_of_the_field_takes_it_out_test() {
  let ed = live("- a\n- b\n  - |\n\nnext")
  let Outcome(editor: down, sync:, ..) =
    editor.update(
      ed,
      editor.EdgePressed(editor.Down, x: 5.0, shown: editor.field_buffer(ed)),
    )
  assert editor.text(down) == "- a\n- b\n\nnext"
  assert buffer.cursor(editor.buffer(down)) == Position(2, 0)
  assert sync
    == editor.WriteAndAim(editor.field_buffer(down), 5.0, editor.FirstLine)
}

pub fn escape_takes_it_out_and_ends_the_caret_after_the_parents_words_test() {
  let ed = live("- a\n- b\n  - |")
  let Outcome(editor: out, sync:, ..) =
    editor.update(ed, editor.EscapePressed(shown: editor.field_buffer(ed)))
  assert editor.text(out) == "- a\n- b"
  assert sync == editor.Release(editor.field_buffer(out))
  assert buffer.cursor(editor.buffer(out)) == Position(1, 3)
  assert editor.is_idle(out)
  let Outcome(editor: blurred, sync:, ..) =
    editor.update(out, editor.FocusChanged(False))
  assert editor.text(blurred) == "- a\n- b"
  assert sync == editor.InSync
}

pub fn escape_is_one_undo_step_test() {
  let ed = live("- a\n- b\n  - |")
  let Outcome(editor: out, ..) =
    editor.update(ed, editor.EscapePressed(shown: editor.field_buffer(ed)))
  let Outcome(editor: focused, ..) =
    editor.update(out, editor.FocusChanged(True))
  let Outcome(editor: undone, ..) = editor.update(focused, editor.UndoAsked)
  assert shown(undone) == "- a\n- b\n  - |"
}

pub fn losing_the_focus_takes_it_out_without_taking_the_focus_back_test() {
  let ed = live("- a\n- b\n  - |\n\nnext")
  let Outcome(editor: out, sync:, ..) =
    editor.update(ed, editor.FocusChanged(False))
  assert editor.text(out) == "- a\n- b\n\nnext"
  assert sync == editor.WriteQuietly(editor.field_buffer(out))
  assert editor.region(out) == Some(Region(1, 1))
  let Outcome(editor: in, ..) = editor.update(out, editor.FocusChanged(True))
  let Outcome(editor: undone, ..) = editor.update(in, editor.UndoAsked)
  assert shown(undone) == "- a\n- b\n  - |\n\nnext"
}

pub fn a_blur_with_nothing_to_take_out_writes_nothing_test() {
  let ed = live("- a\n- b|\n\nnext")
  let Outcome(editor: out, sync:, ..) =
    editor.update(ed, editor.FocusChanged(False))
  assert editor.text(out) == "- a\n- b\n\nnext"
  assert sync == editor.InSync
}

pub fn a_selection_that_starts_on_it_keeps_it_until_the_selection_is_let_go_test() {
  let ed = live("- a\n- b\n  - |")
  let Outcome(editor: selected, ..) =
    editor.update(
      ed,
      editor.ShiftPointed(
        row: 0,
        visible: "",
        at_end: True,
        next: "",
        shown: editor.field_buffer(ed),
        x: 0.0,
        y: 0.0,
      ),
    )
  assert editor.text(selected) == "- a\n- b\n  - "
  let Outcome(editor: let_go, ..) = editor.update(selected, editor.Released)
  assert editor.text(let_go) == "- a\n- b\n  - "
  let Outcome(editor: away, ..) = point(let_go, 0, False)
  assert editor.text(away) == "- a\n- b"
}

pub fn a_selection_over_it_with_both_ends_elsewhere_keeps_its_text_test() {
  let ed = live("- a\n- b\n  - |\n\nnext")
  let Outcome(editor: all, ..) =
    editor.update(
      ed,
      editor.EdgePressed(
        editor.SelectAll,
        x: 0.0,
        shown: editor.field_buffer(ed),
      ),
    )
  assert editor.text(all) == "- a\n- b\n\nnext"
  assert buffer.selection(editor.buffer(all))
    == #(Position(0, 0), Position(3, 4))
}

pub fn typing_and_the_list_keys_in_it_keep_it_test() {
  let ed = live("- a\n- b\n  - |")
  assert editor.text(typed_in_field(ed, "c")) == "- a\n- b\n  - c"
  let Outcome(editor: entered, ..) =
    editor.update(
      ed,
      editor.KeyPressed(vim.Enter, shown: editor.field_buffer(ed)),
    )
  assert shown(entered) == "- a\n- b\n- |"
  let Outcome(editor: outdented, ..) =
    editor.update(
      ed,
      editor.KeyPressed(vim.BackTab, shown: editor.field_buffer(ed)),
    )
  assert shown(outdented) == "- a\n- b\n- |"
}

pub fn a_new_row_after_it_takes_its_place_test() {
  let ed = live("- a\n- b\n  - |")
  let out = typed_in_field(ed, "\n")
  assert shown(out) == "- a\n- b\n|"
}

pub fn a_real_empty_item_stays_test() {
  let ed = live("- a\n- |")
  let Outcome(editor: away, ..) = point(ed, 0, True)
  assert editor.text(away) == "- a\n- "
  let ed = live("- b\n  - c\n  - |")
  let Outcome(editor: away, ..) = point(ed, 0, True)
  assert editor.text(away) == "- b\n  - c\n  - "
}

pub fn an_empty_item_with_something_nested_under_it_stays_test() {
  let ed = live("- b\n  - |\n    1. f")
  let Outcome(editor: away, ..) = point(ed, 0, True)
  assert editor.text(away) == "- b\n  - \n    1. f"
}

pub fn the_other_markers_go_too_test() {
  let ed = live("1. b\n   1. |")
  let Outcome(editor: away, ..) = point(ed, 0, True)
  assert editor.text(away) == "1. b"
}

pub fn a_composition_never_takes_it_out_test() {
  let ed = live("- a\n- b\n  - |")
  let field = editor.field_buffer(ed)
  let at = buffer.cursor(field)
  let added = buffer.replace(field, from: at, to: at, with: "\nx")
  let Outcome(editor: composing, sync:, ..) =
    editor.update(ed, editor.Composing(shown: added))
  assert editor.text(composing) == "- a\n- b\n  - \nx"
  assert sync == editor.InSync
  let moved = buffer.move_to(field, Position(0, 1))
  let Outcome(editor: composing, sync:, ..) =
    editor.update(live("- a\n- b\n  - |"), editor.Composing(shown: moved))
  assert editor.text(composing) == "- a\n- b\n  - "
  assert sync == editor.InSync
  let Outcome(editor: ended, sync:, ..) =
    editor.update(composing, editor.ControlChanged(shown: moved, at: 0))
  assert editor.text(ended) == "- a\n- b\n  - "
  assert sync == editor.InSync
}

pub fn a_native_drag_never_takes_it_out_test() {
  let ed = live("- a\n- b\n  - |")
  let Outcome(editor: dragging, ..) = editor.update(ed, editor.DragStarted)
  let shown = buffer.move_to(editor.field_buffer(dragging), Position(0, 1))
  let Outcome(editor: moved, ..) =
    editor.update(dragging, editor.ControlChanged(shown:, at: 0))
  assert editor.text(moved) == "- a\n- b\n  - "
}

pub fn a_held_press_never_takes_it_out_test() {
  let ed = live("- a\n- b\n  - |")
  let Outcome(editor: pressed, ..) = point(ed, 2, True)
  let up = buffer.move_to(editor.field_buffer(pressed), Position(0, 1))
  let Outcome(editor: moved, ..) =
    editor.update(pressed, editor.ControlChanged(shown: up, at: 0))
  assert editor.text(moved) == "- a\n- b\n  - "
}

pub fn the_markdown_view_never_takes_it_out_test() {
  let ed = opened("- a\n- b\n  - |", False)
  let field = editor.field_buffer(ed)
  let Outcome(editor: away, ..) =
    editor.update(
      ed,
      editor.ControlChanged(shown: buffer.move_to(field, Position(0, 0)), at: 0),
    )
  assert editor.text(away) == "- a\n- b\n  - "
  let Outcome(editor: blurred, sync:, ..) =
    editor.update(away, editor.FocusChanged(False))
  assert editor.text(blurred) == "- a\n- b\n  - "
  assert sync == editor.InSync
}

pub fn undo_and_redo_never_take_it_out_test() {
  let ed = live("- b\n  - \n\nnext|")
  let typed = typed_in_field(ed, "y")
  let Outcome(editor: away, ..) = point(typed, 1, True)
  let Outcome(editor: away, ..) = editor.update(away, editor.Released)
  assert editor.text(away) == "- b\n  - \n\nnexty"
  let Outcome(editor: undone, ..) = editor.update(away, editor.UndoAsked)
  assert editor.text(undone) == "- b\n  - \n\nnext"
  let Outcome(editor: redone, ..) = editor.update(undone, editor.RedoAsked)
  assert editor.text(redone) == "- b\n  - \n\nnexty"
}

pub fn the_page_is_drawn_again_without_the_row_test() {
  let ed = live("- a\n- b\n  - |")
  let Outcome(editor: away, ..) = point(ed, 0, True)
  assert editor.blocks(away) == markdown.parse("- a\n- b")
}
