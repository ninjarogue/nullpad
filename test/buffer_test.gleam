import nullpad/buffer.{Position}

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

pub fn select_clamps_test() {
  let far = Position(row: 9, col: 9)
  let before = Position(row: -1, col: -1)
  let moved =
    buffer.from_text("one\ntwo!") |> buffer.select(anchor: before, head: far)

  assert buffer.selection(moved)
    == #(Position(row: 0, col: 0), Position(row: 1, col: 4))
}

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

pub fn replace_with_several_lines_test() {
  let at = Position(row: 0, col: 2)
  let pasted =
    buffer.from_text("abcd\nlast")
    |> buffer.replace(from: at, to: at, with: "1\n2")

  assert buffer.text(pasted) == "ab1\n2cd\nlast"
  assert buffer.cursor(pasted) == Position(row: 1, col: 1)
}

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

pub fn a_word_is_a_run_of_letters_spaces_or_marks_test() {
  let note = buffer.from_text("say **hi**, you\n")
  let word = fn(col) { buffer.word_at(note, Position(row: 0, col:)) }

  assert word(1) == #(Position(0, 0), Position(0, 3))
  assert word(3) == #(Position(0, 0), Position(0, 3))
  assert word(4) == #(Position(0, 4), Position(0, 6))
  assert word(6) == #(Position(0, 6), Position(0, 8))
  assert word(8) == #(Position(0, 6), Position(0, 8))
  assert word(11) == #(Position(0, 11), Position(0, 12))
  assert word(13) == #(Position(0, 12), Position(0, 15))
  assert buffer.word_at(note, Position(row: 1, col: 0))
    == #(Position(1, 0), Position(1, 0))
}

pub fn moving_the_selection_takes_it_to_a_place_and_selects_it_there_test() {
  let note =
    buffer.from_text("alpha beta\ngamma delta")
    |> buffer.select(anchor: Position(0, 6), head: Position(0, 10))
  let moved = fn(to) {
    let moved = buffer.move_selection(note, to:)
    #(buffer.text(moved), buffer.selection(moved))
  }

  assert moved(Position(1, 6))
    == #("alpha \ngamma betadelta", #(Position(1, 6), Position(1, 10)))
  assert moved(Position(0, 0))
    == #("betaalpha \ngamma delta", #(Position(0, 0), Position(0, 4)))
  assert moved(Position(0, 8)) == #(buffer.text(note), buffer.selection(note))

  let word =
    buffer.from_text("alpha beta gamma")
    |> buffer.select(anchor: Position(0, 0), head: Position(0, 5))
    |> buffer.move_selection(to: Position(0, 11))
  assert buffer.text(word) == " beta alphagamma"
  assert buffer.selection(word) == #(Position(0, 6), Position(0, 11))

  let across =
    buffer.from_text("ab\ncd\nef")
    |> buffer.select(anchor: Position(1, 1), head: Position(0, 1))
    |> buffer.move_selection(to: Position(2, 1))
  assert buffer.text(across) == "ad\neb\ncf"
  assert buffer.selection(across) == #(Position(1, 1), Position(2, 1))
}
