import scribbl/buffer.{Position}

pub fn text_round_trips_test() {
  let text = "one\n\nthree\n"

  assert buffer.text(buffer.from_text(text)) == text
  assert buffer.lines(buffer.from_text(text)) == ["one", "", "three", ""]
}

pub fn an_empty_note_is_one_empty_line_test() {
  let empty = buffer.from_text("")

  assert buffer.lines(empty) == [""]
  assert buffer.cursor(empty) == Position(row: 0, col: 0)
}

pub fn windows_line_ends_become_plain_ones_test() {
  assert buffer.text(buffer.from_text("one\r\ntwo")) == "one\ntwo"
}

/// A position outside the text lands on the nearest one inside it.
pub fn select_clamps_test() {
  let far = Position(row: 9, col: 9)
  let before = Position(row: -1, col: -1)
  let moved =
    buffer.from_text("one\ntwo!") |> buffer.select(anchor: before, head: far)

  assert buffer.selection(moved)
    == #(Position(row: 0, col: 0), Position(row: 1, col: 4))
}

/// Columns count what a person calls a character, so an emoji is one.
pub fn columns_count_graphemes_test() {
  let after_wave = Position(row: 0, col: 1)
  let typed =
    buffer.from_text("👋")
    |> buffer.replace(from: after_wave, to: after_wave, with: "!")

  assert buffer.text(typed) == "👋!"
}

pub fn replace_is_the_one_edit_test() {
  let start = Position(row: 0, col: 0)
  let next_row = Position(row: 1, col: 0)
  let deleted =
    buffer.from_text("one\ntwo")
    |> buffer.replace(from: start, to: next_row, with: "")

  assert buffer.text(deleted) == "two"
  assert buffer.cursor(deleted) == start
}

/// Pasting two lines into the middle of a line: the cursor ends up just
/// after what was pasted.
pub fn replace_with_several_lines_test() {
  let at = Position(row: 0, col: 2)
  let pasted =
    buffer.from_text("abcd\nlast")
    |> buffer.replace(from: at, to: at, with: "1\n2")

  assert buffer.text(pasted) == "ab1\n2cd\nlast"
  assert buffer.cursor(pasted) == Position(row: 1, col: 1)
}

/// `from` and `to` may come in either order.
pub fn replace_backwards_test() {
  let replaced =
    buffer.from_text("hello world")
    |> buffer.replace(
      from: Position(row: 0, col: 11),
      to: Position(row: 0, col: 6),
      with: "there",
    )

  assert buffer.text(replaced) == "hello there"
}
