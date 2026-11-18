//// An empty item typed right under its parent's words, `- b` over `  - `,
//// goes when the selection leaves its row. No browser. A note is written
//// with `|` where the caret is.

import gleam/list
import gleam/string
import nullpad/buffer.{type Buffer, type Position, Position}
import nullpad/list_keys
import nullpad/markdown

fn at_caret(note: String) -> Buffer {
  let assert Ok(#(before, after)) = string.split_once(note, "|")
  let at = buffer.end_of(before)
  buffer.from_text(before <> after) |> buffer.select(anchor: at, head: at)
}

fn shown(b: Buffer) -> String {
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

fn leave(from: String, to to: String, focused focused: Bool) -> String {
  let old = at_caret(from)
  let blocks = markdown.parse(buffer.text(old))
  list_keys.leave(from: old, blocks:, to: at_caret(to), focused:) |> shown
}

fn selected(note: String, anchor: Position, head: Position) -> Buffer {
  buffer.from_text(note) |> buffer.select(anchor:, head:)
}

pub fn an_empty_item_under_its_parents_words_goes_when_the_caret_leaves_it_test() {
  assert leave("- a\n- b\n  - |", to: "- |a\n- b\n  - ", focused: True)
    == "- |a\n- b"
  assert leave("- a\n- b\n  - |", to: "- a\n- b|\n  - ", focused: True)
    == "- a\n- b|"
  assert leave(
      "- a\n- b\n  - |\n- c",
      to: "- a\n- b\n  - \n- c|",
      focused: True,
    )
    == "- a\n- b\n- c|"
  assert leave("- b\n  - |\n  - c", to: "- |b\n  - \n  - c", focused: True)
    == "- |b\n  - c"
}

pub fn the_other_markers_and_a_quote_go_too_test() {
  assert leave("1. b\n   1. |", to: "1. |b\n   1. ", focused: True) == "1. |b"
  assert leave("- b\n  * |", to: "- |b\n  * ", focused: True) == "- |b"
  assert leave("- b\n  + |", to: "- |b\n  + ", focused: True) == "- |b"
  assert leave("> - b\n>   - |", to: "> - |b\n>   - ", focused: True)
    == "> - |b"
  assert leave("- a\n  - b\n    - |", to: "|- a\n  - b\n    - ", focused: True)
    == "|- a\n  - b"
}

pub fn the_caret_below_it_moves_up_with_the_rows_test() {
  assert leave(
      "- a\n- b\n  - |\n\nnext\n\nlast",
      to: "- a\n- b\n  - \n\nne|xt\n\nlast",
      focused: True,
    )
    == "- a\n- b\n\nne|xt\n\nlast"
}

pub fn it_stays_while_the_caret_is_on_it_and_the_field_has_the_focus_test() {
  assert leave("- b\n  - |", to: "- b\n  - |", focused: True) == "- b\n  - |"
  assert leave("- b\n  - |", to: "- b\n  |- ", focused: True) == "- b\n  |- "
  assert leave("- b\n  - |", to: "- b\n  - x|", focused: True) == "- b\n  - x|"
}

pub fn it_goes_when_the_field_loses_the_focus_with_the_caret_still_on_it_test() {
  assert leave("- b\n  - |", to: "- b\n  - |", focused: False) == "- b|"
  assert leave(
      "- a\n- b\n  - |\n\nnext",
      to: "- a\n- b\n  - |\n\nnext",
      focused: False,
    )
    == "- a\n- b|\n\nnext"
}

pub fn a_selection_with_an_end_on_it_keeps_it_test() {
  let note = "- a\n- b\n  - "
  let old = selected(note, Position(2, 4), Position(2, 4))
  let blocks = markdown.parse(note)
  let head_on_it = selected(note, Position(0, 1), Position(2, 4))
  let anchor_on_it = selected(note, Position(2, 4), Position(0, 1))
  assert list_keys.leave(from: old, blocks:, to: head_on_it, focused: True)
    == head_on_it
  assert list_keys.leave(from: old, blocks:, to: anchor_on_it, focused: True)
    == anchor_on_it
}

pub fn a_selection_over_it_with_both_ends_elsewhere_takes_it_out_test() {
  let note = "- a\n- b\n  - \n\nnext"
  let old = selected(note, Position(2, 4), Position(2, 4))
  let all = selected(note, Position(0, 0), Position(4, 4))
  let out =
    list_keys.leave(
      from: old,
      blocks: markdown.parse(note),
      to: all,
      focused: True,
    )
  assert buffer.text(out) == "- a\n- b\n\nnext"
  assert buffer.selection(out) == #(Position(0, 0), Position(3, 4))
}

pub fn a_selection_anchored_in_it_takes_it_out_once_it_is_dropped_test() {
  let note = "- a\n- b\n  - "
  let old = selected(note, Position(2, 4), Position(0, 1))
  let away = selected(note, Position(0, 1), Position(0, 1))
  let out =
    list_keys.leave(
      from: old,
      blocks: markdown.parse(note),
      to: away,
      focused: True,
    )
  assert buffer.text(out) == "- a\n- b"
  assert buffer.selection(out) == #(Position(0, 1), Position(0, 1))
}

pub fn an_item_the_parser_sees_stays_test() {
  assert leave("- b\n  - c\n  - |", to: "- |b\n  - c\n  - ", focused: True)
    == "- |b\n  - c\n  - "
  assert leave("- a\n- |", to: "- |a\n- ", focused: True) == "- |a\n- "
  assert leave("- a\n- |", to: "- a\n- |", focused: False) == "- a\n- |"
  assert leave("1. a\n2. |", to: "|1. a\n2. ", focused: True) == "|1. a\n2. "
  assert leave("1. b\n  - |", to: "|1. b\n  - ", focused: True) == "|1. b\n  - "
}

pub fn a_marker_under_words_with_no_item_over_it_stays_test() {
  assert leave("b\n- |", to: "|b\n- ", focused: True) == "|b\n- "
  assert leave("b\n  - |", to: "|b\n  - ", focused: True) == "|b\n  - "
}

pub fn an_empty_item_with_something_nested_under_it_stays_test() {
  assert leave(
      "- b\n  - |\n    1. f",
      to: "- |b\n  - \n    1. f",
      focused: True,
    )
    == "- |b\n  - \n    1. f"
  assert leave(
      "- b\n  10. |\n      - f",
      to: "- |b\n  10. \n      - f",
      focused: True,
    )
    == "- |b\n  10. \n      - f"
}

pub fn an_empty_item_in_code_stays_test() {
  assert leave(
      "- b\n\n  ```\n  - |\n  ```",
      to: "- |b\n\n  ```\n  - \n  ```",
      focused: True,
    )
    == "- |b\n\n  ```\n  - \n  ```"
}

pub fn it_stays_when_a_row_above_it_changed_test() {
  assert leave("- a\n- b\n  - |", to: "- ax|\n- b\n  - ", focused: True)
    == "- ax|\n- b\n  - "
}

pub fn a_new_row_takes_its_place_test() {
  assert leave("- a\n- b\n  - |", to: "- a\n- b\n  - \n|", focused: True)
    == "- a\n- b\n|"
}

pub fn only_the_empty_item_the_selection_was_on_goes_test() {
  assert leave("- a\n  - |\n  - ", to: "- |a\n  - \n  - ", focused: True)
    == "- |a\n  - "
}
