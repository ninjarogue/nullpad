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
    )
    == Position(row: 3, col: 19)
  assert live.position(lines, row: 0, visible: "Tr", at_end: False)
    == Position(row: 0, col: 4)
}

pub fn a_click_beside_a_block_lands_at_the_end_of_its_last_row_test() {
  let lines = ["one **two**", "three"]
  assert live.position(lines, row: 0, visible: "one two\nthree", at_end: True)
    == Position(row: 1, col: 5)
}

pub fn a_click_past_the_last_row_lands_at_the_end_of_the_note_test() {
  assert live.position(["one", "two"], row: 5, visible: "", at_end: False)
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
  let at = live.position(lines, row: 0, visible: place, at_end: False)
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
  assert at(13) == "Packing "
  assert at(15) == "Packing "
  assert at(16) == "Packing l"
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
