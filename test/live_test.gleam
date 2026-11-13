//// Examples for live view's pure rules: which rows the text field holds, and
//// where a click on the drawn page lands in the source.

import gleam/int
import gleam/list
import gleam/string
import nullpad/buffer.{Position}
import nullpad/live.{Region}
import nullpad/markdown

const note =
  "# Trip

Flights are **booked**
and the hotel is *not*.

- [ ] Passport
- Shoes
  and socks

1. one
2. two

```
code
```"

fn reveal(from: Int, to: Int) -> live.Region {
  markdown.parse(note) |> live.reveal(from:, to:)
}

pub fn a_cursor_reveals_its_whole_block_test() {
  assert reveal(0, 0) == Region(0, 0)
  assert reveal(3, 3) == Region(2, 3)
  assert reveal(13, 13) == Region(12, 14)
}

pub fn a_blank_row_between_blocks_stands_alone_test() {
  assert reveal(1, 1) == Region(1, 1)
  assert reveal(4, 4) == Region(4, 4)
}

pub fn a_list_reveals_one_item_at_a_time_test() {
  assert reveal(5, 5) == Region(5, 5)
  assert reveal(7, 7) == Region(6, 7)
  assert reveal(10, 10) == Region(10, 10)
}

pub fn a_selection_reveals_every_block_it_touches_test() {
  assert reveal(3, 6) == Region(2, 7)
  assert reveal(6, 3) == Region(2, 7)
}

pub fn a_row_past_the_note_is_kept_as_asked_test() {
  assert live.reveal([], from: 0, to: 0) == Region(0, 0)
}

/// How the field is set while it holds all of `text`.
fn kind_of(text: String) -> live.Kind {
  let lines = string.split(text, "\n")
  let field = Region(0, list.length(lines) - 1)
  live.kind(markdown.parse(text), field:, lines:)
}

pub fn the_field_is_set_like_the_block_it_holds_test() {
  assert kind_of("## Packing") == live.Title(markdown.H2)
  assert kind_of("Title\n===") == live.Title(markdown.H1)
  assert kind_of("- Shoes\n  and socks")
    == live.ListItem(task: False, marker: "- ")
  assert kind_of("2. two") == live.ListItem(task: False, marker: "2. ")
  assert kind_of("- [ ] pack") == live.ListItem(task: True, marker: "- [ ] ")
  assert kind_of("```\ncode\n```") == live.Mono
  assert kind_of("| a |\n|---|") == live.Mono
  assert kind_of("plain words") == live.Body
  assert kind_of("") == live.Body
  assert kind_of("one\n\ntwo") == live.Body
}

/// How the field is set while it holds rows `first_row` to `last_row` of
/// `note`.
fn field_kind(first_row: Int, last_row: Int) -> live.Kind {
  let field = Region(first_row, last_row)
  live.kind(markdown.parse(note), field:, lines: string.split(note, "\n"))
}

pub fn the_field_is_set_like_the_blocks_of_the_note_it_holds_test() {
  assert field_kind(0, 0) == live.Title(markdown.H1)
  assert field_kind(1, 1) == live.Body
  assert field_kind(2, 3) == live.Body
  assert field_kind(5, 5) == live.ListItem(task: True, marker: "- [ ] ")
  assert field_kind(6, 7) == live.ListItem(task: False, marker: "- ")
  assert field_kind(10, 10) == live.ListItem(task: False, marker: "2. ")
  assert field_kind(12, 14) == live.Mono
}

pub fn a_field_with_a_blank_row_beside_its_block_is_set_like_the_block_test() {
  assert field_kind(0, 1) == live.Title(markdown.H1)
  assert field_kind(4, 7) == live.ListItem(task: True, marker: "- [ ] ")
  assert field_kind(8, 10) == live.ListItem(task: False, marker: "1. ")
  assert field_kind(11, 14) == live.Mono
}

pub fn a_field_that_holds_two_blocks_is_set_as_body_text_test() {
  assert field_kind(0, 3) == live.Body
  assert field_kind(6, 10) == live.Body
  assert field_kind(10, 14) == live.Body
}

pub fn a_blank_row_between_two_items_is_set_as_body_text_test() {
  let lines = ["- a", "", "- b"]
  let blocks = markdown.parse("- a\n\n- b")

  assert live.kind(blocks, field: Region(1, 1), lines:) == live.Body
  assert live.kind(blocks, field: Region(1, 2), lines:)
    == live.ListItem(task: False, marker: "- ")
}

fn marker(field_text: String) -> String {
  case kind_of(field_text) {
    live.ListItem(marker:, ..) -> marker
    live.Body | live.Mono | live.Title(_) -> "not an item"
  }
}

pub fn an_item_in_the_field_has_the_marker_it_was_typed_with_test() {
  assert marker("- a") == "- "
  assert marker("* a") == "* "
  assert marker("+ a") == "+ "
  assert marker("12. a") == "12. "
  assert marker("3) a") == "3) "
}

pub fn a_task_box_and_the_spaces_after_it_are_part_of_the_marker_test() {
  assert marker("- [ ] a") == "- [ ] "
  assert marker("- [x] a") == "- [x] "
  assert marker("1. [ ] a") == "1. [ ] "
  assert marker("- [ ]   a") == "- [ ]   "
  assert marker("-\t[ ] a") == "-\t[ ] "
}

pub fn the_spaces_around_a_marker_are_part_of_it_test() {
  assert marker("  - a") == "  - "
  assert marker("   1. a") == "   1. "
  assert marker("-  a") == "-  "
  assert marker("-   a") == "-   "
}

pub fn only_the_first_line_of_an_item_has_a_marker_test() {
  assert marker("- a\n  - b") == "- "
  assert marker("1. a\n   1. [ ] b") == "1. "
  assert marker("- a\n  more") == "- "
  assert marker("\n- a") == "- "
}

pub fn an_item_with_nothing_after_its_marker_has_that_marker_test() {
  assert marker("-") == "-"
  assert marker("- ") == "- "
  assert marker("-   ") == "-   "
  assert marker("1.") == "1."
  assert marker("- [ ]") == "- [ ]"
  assert marker("- [ ] ") == "- [ ] "
}

pub fn the_marker_stops_where_code_in_the_item_begins_test() {
  assert marker("-     a") == "- "
}

pub fn a_click_steps_over_the_marks_before_it_test() {
  let line = "Flights are **booked** and *not*."
  assert live.column(line, after: "") == 0
  assert live.column(line, after: "Flights are ") == 12
  assert live.column(line, after: "Flights are boo") == 17
  assert live.column(line, after: "Flights are booked and n") == 29
}

pub fn a_click_steps_over_a_list_marker_test() {
  assert live.column("- [ ] Passport", after: "Pass") == 10
  assert live.column("> quoted", after: "quo") == 5
}

pub fn drawn_text_that_is_not_in_the_line_lands_at_its_end_test() {
  assert live.column("abc", after: "xyz") == 3
}

pub fn each_drawn_line_break_is_one_row_down_test() {
  let lines = [
    "# Trip",
    "",
    "Flights are **booked**",
    "and the hotel is *not*.",
  ]
  assert live.position(
      lines,
      row: 2,
      visible: "Flights are booked\nand the hotel is n",
      at_end: False,
      next: "",
    )
    == Position(row: 3, col: 19)
  assert live.position(lines, row: 0, visible: "Tr", at_end: False, next: "")
    == Position(row: 0, col: 4)
}

/// A place before the first drawn letter of a row is past the marks the row
/// starts with, unless the browser named no letter after it, as in the
/// gutter of a list item, where its marker is drawn.
pub fn the_start_of_a_rows_text_is_past_the_marks_it_starts_with_test() {
  let lines = ["# Trip", "", "- [ ] Passport", "- Shoes"]
  assert live.position(lines, row: 0, visible: "", at_end: False, next: "T")
    == Position(row: 0, col: 2)
  assert live.position(lines, row: 2, visible: "", at_end: False, next: "P")
    == Position(row: 2, col: 6)
  assert live.position(
      lines,
      row: 2,
      visible: "Passport\n",
      at_end: False,
      next: "S",
    )
    == Position(row: 3, col: 2)
  assert live.position(lines, row: 3, visible: "", at_end: False, next: "")
    == Position(row: 3, col: 0)
}

/// Between two drawn letters a place is past the marks that close what the
/// letter before it is in, and before the marks that open what follows.
pub fn a_place_between_letters_takes_closing_marks_with_the_letter_before_test() {
  let lines = ["Flights are **booked** and *not*."]
  let place = fn(visible, next) {
    live.position(lines, row: 0, visible:, at_end: False, next:)
  }
  assert place("Flights are booked", " ") == Position(0, 22)
  assert place("Flights are ", "b") == Position(0, 12)
  assert place("Flights are booked and not", ".") == Position(0, 32)
  assert place("Flights are booked and not.", "\n") == Position(0, 33)
  assert place("Flights are boo", "k") == Position(0, 17)
}

pub fn a_click_beside_a_block_lands_at_the_end_of_its_last_row_test() {
  let lines = ["one **two**", "three"]
  assert live.position(
      lines,
      row: 0,
      visible: "one two\nthree",
      at_end: True,
      next: "",
    )
    == Position(row: 1, col: 5)
}

pub fn a_click_past_the_last_row_lands_at_the_end_of_the_note_test() {
  assert live.position(
      ["one", "two"],
      row: 5,
      visible: "",
      at_end: False,
      next: "",
    )
    == Position(row: 1, col: 3)
}

/// An element drawn on the page: the rows of the note it is drawn from,
/// numbered from 0, and the text it draws, as the browser reads it.
type Drawn {
  Drawn(lines: List(String), visible: String)
}

/// One of each mark. Each element starts at row 0 of its lines.
const corpus = [
  Drawn(["# Heading **one**"], "Heading one"),
  Drawn(["## Packing"], "Packing"),
  Drawn(["Setext", "======"], "Setext"),
  Drawn(
    [
      "A **bold** _it_ *em* ~~gone~~ `co*de` [link](http://x.y \"t\") \\*esc\\* &amp; tail",
      "soft wrapped second row",
    ],
    "A bold it em gone co*de link *esc* & tail\nsoft wrapped second row",
  ),
  Drawn(["***both*** and __strong__"], "both and strong"),
  Drawn(["- [ ] task box"], "task box"),
  Drawn(["- [x] done **b**"], "done b"),
  Drawn(["  - nested *i*"], "nested i"),
  Drawn(["12. twelve"], "twelve"),
  Drawn(["> quoted **q**", "> more"], "quoted q\nmore"),
  Drawn(["| A | **B** |", "| - | ----- |"], "AB"),
  Drawn(["| `x` | y |"], "xy"),
  Drawn(["let a = 1", "```"], "let a = 1\n"),
]

/// 0 to `last`, both included.
fn through(last: Int) -> List(Int) {
  int.range(from: last, to: -1, with: [], run: list.prepend)
}

/// Every place in the drawn text, taken to the note by `position` and drawn
/// again, is the same place.
fn round_trip(drawn: Drawn) -> List(String) {
  let Drawn(lines:, visible:) = drawn
  let drawn_rows = string.split(visible, "\n")
  use #(segment, index) <- list.flat_map(
    list.index_map(drawn_rows, fn(segment, index) { #(segment, index) }),
  )
  let above = list.take(drawn_rows, index)
  use length <- list.filter_map(through(string.length(segment)))
  let place =
    string.join(list.append(above, [string.slice(segment, 0, length)]), "\n")
  let at = live.position(lines, row: 0, visible: place, at_end: False, next: "")
  case live.drawn(lines, row: 0, visible:, at:) {
    back if back == place -> Error(Nil)
    back -> Ok(place <> " -> " <> back)
  }
}

pub fn every_drawn_place_survives_the_trip_to_the_note_and_back_test() {
  assert list.flat_map(corpus, round_trip) == []
}

pub fn a_place_further_along_a_row_is_never_drawn_earlier_test() {
  let backwards = {
    use Drawn(lines:, visible:) <- list.flat_map(corpus)
    use #(line, row) <- list.flat_map(
      list.index_map(lines, fn(line, row) { #(line, row) }),
    )
    let lengths =
      list.map(through(string.length(line)), fn(col) {
        string.length(live.drawn(
          lines,
          row: 0,
          visible:,
          at: Position(row:, col:),
        ))
      })
    let pairs = list.zip(lengths, list.drop(lengths, 1))
    case list.any(pairs, fn(pair) { pair.1 < pair.0 }) {
      True -> [line]
      False -> []
    }
  }
  assert backwards == []
}

pub fn the_marks_before_a_place_are_not_drawn_test() {
  let lines = ["## Packing **light**"]
  let visible = "Packing light"
  let at = fn(col) {
    live.drawn(lines, row: 0, visible:, at: Position(row: 0, col:))
  }
  assert at(0) == ""
  assert at(3) == ""
  assert at(4) == "P"
  assert at(11) == "Packing "
  assert at(13) == "Packing "
  assert at(14) == "Packing l"
  assert at(20) == "Packing light"
}

pub fn a_row_the_element_does_not_draw_is_drawn_at_its_end_test() {
  let lines = ["| A | B |", "| - | - |"]
  assert live.drawn(lines, row: 0, visible: "AB", at: Position(row: 1, col: 4))
    == "AB"
  assert live.drawn(
      ["Setext", "==="],
      row: 0,
      visible: "Setext",
      at: Position(1, 0),
    )
    == "Setext"
}

pub fn a_row_in_an_element_further_down_is_drawn_from_its_own_start_test() {
  let lines = ["- one", "  more **b**"]
  assert live.drawn(lines, row: 0, visible: "one\nmore b", at: Position(1, 10))
    == "one\nmore b"
  assert live.drawn(lines, row: 0, visible: "one\nmore b", at: Position(1, 2))
    == "one\n"
}

fn nudge(
  lines: List(String),
  visible: String,
  row: Int,
  col: Int,
  forward: Bool,
) {
  live.nudge(lines, row: 0, visible:, at: Position(row:, col:), forward:)
}

pub fn a_nudge_crosses_the_marks_the_page_does_not_draw_test() {
  let lines = ["Flights are **booked** and"]
  let visible = "Flights are booked and"
  assert nudge(lines, visible, 0, 12, True) == Position(0, 15)
  assert nudge(lines, visible, 0, 19, True) == Position(0, 22)
  assert nudge(lines, visible, 0, 20, True) == Position(0, 23)
  assert nudge(lines, visible, 0, 23, False) == Position(0, 22)
  assert nudge(lines, visible, 0, 22, False) == Position(0, 19)
  assert nudge(lines, visible, 0, 15, False) == Position(0, 12)
  assert nudge(lines, visible, 0, 14, False) == Position(0, 11)
}

/// Between two drawn letters, marks that close what the letter before
/// opened go with it, and marks that open what follows go with the letter
/// after, so that a selection ending there holds both marks of a pair or
/// neither.
pub fn a_nudge_takes_closing_marks_with_the_letter_before_them_test() {
  let lines = ["**bold** and *it*. ok"]
  let visible = "bold and it. ok"
  assert nudge(lines, visible, 0, 5, True) == Position(0, 8)
  assert nudge(lines, visible, 0, 15, True) == Position(0, 17)
  assert nudge(lines, visible, 0, 12, True) == Position(0, 13)
  assert nudge(lines, visible, 0, 15, False) == Position(0, 13)
  assert nudge(lines, visible, 0, 3, False) == Position(0, 2)
}

/// A nudge that stays on its row draws one character more or less, or
/// reaches the end of the row it was on when nothing more is drawn there.
pub fn every_nudge_draws_one_character_more_or_less_test() {
  let wrong = {
    use Drawn(lines:, visible:) <- list.flat_map(corpus)
    use #(line, row) <- list.flat_map(
      list.index_map(lines, fn(line, row) { #(line, row) }),
    )
    let drawn_here = list.length(string.split(visible, "\n")) > row
    let end = string.length(line)
    let last = list.length(lines) - 1
    let length = fn(col) {
      string.length(live.drawn(
        lines,
        row: 0,
        visible:,
        at: Position(row:, col:),
      ))
    }
    use col <- list.filter_map(through(end))
    let at = Position(row:, col:)
    let forward = live.nudge(lines, row: 0, visible:, at:, forward: True)
    let back = live.nudge(lines, row: 0, visible:, at:, forward: False)
    let forward_ok = case forward.row == row {
      False -> col == end
      True ->
        forward == at
        && col == end
        && row == last
        || forward.col > col
        && {
          length(forward.col) - length(col) == 1
          || length(forward.col) == length(col)
          && forward.col == end
        }
    }
    let back_ok = case back.row == row {
      False -> col == 0
      True ->
        back == at
        && col == 0
        && row == 0
        || back.col < col
        && {
          length(col) - length(back.col) == 1
          || length(back.col) == length(col)
          && back.col == 0
        }
    }
    case drawn_here && !{ forward_ok && back_ok } {
      True -> Ok(line <> " at " <> int.to_string(col))
      False -> Error(Nil)
    }
  }
  assert wrong == []
}

pub fn a_nudge_skips_the_marks_that_start_a_row_test() {
  let lines = ["- [ ] task box"]
  assert nudge(lines, "task box", 0, 0, True) == Position(0, 7)
  assert nudge(lines, "task box", 0, 6, False) == Position(0, 0)
  assert nudge(["**bold**"], "bold", 0, 6, True) == Position(0, 8)
}

pub fn a_nudge_past_the_end_of_a_row_goes_to_the_next_row_test() {
  let lines = ["> quoted **q**", "> more", ""]
  let visible = "quoted q\nmore"
  assert nudge(lines, visible, 0, 14, True) == Position(1, 0)
  assert nudge(lines, visible, 1, 0, True) == Position(1, 3)
  assert nudge(lines, visible, 1, 0, False) == Position(0, 14)
  assert nudge(lines, visible, 1, 6, True) == Position(2, 0)
  assert nudge(lines, visible, 2, 0, True) == Position(2, 0)
  assert nudge(lines, visible, 0, 0, False) == Position(0, 0)
}

pub fn a_place_at_the_start_of_a_table_cell_lands_past_the_marks_that_start_it_test() {
  let at = fn(line, visible, next) {
    live.position([line], row: 0, visible:, at_end: False, next:).col
  }
  assert at("| 1 | 2 |", "", "1") == 2
  assert at("| 1 | 2 |", "1", "2") == 6
  assert at("| 1 | 2 |", "1", "") == 3
  assert at("1 | 2", "", "1") == 0
  assert at("a **b**", "a ", "b") == 2
  assert at("a \\| b", "a ", "|") == 2
}

fn settle(lines: List(String), visible: String, row: Int, col: Int) -> Int {
  live.settle(lines, row: 0, visible:, at: Position(row:, col:)).col
}

/// A place between two marks the page hides goes beside the drawn letter
/// they go with: after marks that open what follows, before marks that close
/// what came before. A place beside the marks stays.
pub fn a_place_between_hidden_marks_settles_beside_the_letter_they_go_with_test() {
  let lines = ["Flights are **booked** and *not*."]
  let visible = "Flights are booked and not."
  assert list.map([12, 13, 14], settle(lines, visible, 0, _)) == [12, 14, 14]
  assert list.map([20, 21, 22], settle(lines, visible, 0, _)) == [20, 20, 22]
  assert list.map([27, 28, 31, 32], settle(lines, visible, 0, _))
    == [27, 28, 31, 32]
  assert settle(lines, visible, 0, 16) == 16
}

pub fn the_marks_a_row_starts_with_keep_every_place_among_them_test() {
  assert list.map([0, 1, 2], settle(["# Trip"], "Trip", 0, _)) == [0, 1, 2]
  assert list.map([0, 3, 6], settle(["- [ ] Passport"], "Passport", 0, _))
    == [0, 3, 6]
}

pub fn a_place_between_the_marks_of_two_cells_settles_in_the_next_test() {
  let lines = ["| a | b |", "|---|---|"]
  assert list.map([3, 4, 5, 6], settle(lines, "ab", 0, _)) == [3, 6, 6, 6]
  assert list.map([7, 8, 9], settle(lines, "ab", 0, _)) == [7, 7, 9]
  assert settle(lines, "ab", 1, 2) == 2
}

/// Settling never changes where a place is drawn, and a settled place stays.
pub fn a_settled_place_is_drawn_where_it_was_and_settles_no_further_test() {
  let wrong = {
    use Drawn(lines:, visible:) <- list.flat_map(corpus)
    use #(line, row) <- list.flat_map(
      list.index_map(lines, fn(line, row) { #(line, row) }),
    )
    use col <- list.filter_map(through(string.length(line)))
    let at = Position(row:, col:)
    let settled = live.settle(lines, row: 0, visible:, at:)
    let drawn = fn(at) { live.drawn(lines, row: 0, visible:, at:) }
    case
      settled.row == row
      && drawn(settled) == drawn(at)
      && live.settle(lines, row: 0, visible:, at: settled) == settled
    {
      True -> Error(Nil)
      False -> Ok(line <> " at " <> int.to_string(col))
    }
  }
  assert wrong == []
}
