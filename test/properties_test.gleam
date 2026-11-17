//// Properties of the pure core, over generated notes and generated things a
//// person does. Each runs a fixed number of cases from a fixed seed, so a
//// run repeats exactly, and a failing case is shrunk before it is shown.
//// `properties/gen` makes the text, `properties/script` the actions, and
//// `rows` and `kept` hold what a property is checked against.

import gleam/int
import gleam/list
import gleam/option
import gleam/string
import nullpad/buffer.{Position}
import nullpad/surface
import properties/gen.{Anything, Tame}
import properties/kept
import properties/rows
import properties/script
import qcheck.{type Generator}

fn check(
  count: Int,
  seed: Int,
  gen: Generator(a),
  property: fn(a) -> Nil,
) -> Nil {
  let config =
    qcheck.config(test_count: count, max_retries: 1, seed: qcheck.seed(seed))
  qcheck.run(config, gen, property)
}

fn rows_of(text: String) -> List(String) {
  string.split(script.normalized(text), "\n")
}

fn sample(gen: Generator(a), count: Int) -> List(a) {
  qcheck.generate(gen, count, qcheck.seed(1)).0
}

// 1. Offsets

fn utf16_length(text: String) -> Int {
  string.to_utf_codepoints(text)
  |> list.fold(0, fn(sum, codepoint) {
    case string.utf_codepoint_to_int(codepoint) > 0xFFFF {
      True -> sum + 2
      False -> sum + 1
    }
  })
}

pub fn an_offset_and_its_line_and_column_round_trip_test() {
  let cases =
    qcheck.tuple3(
      gen.note(Anything),
      qcheck.tuple2(qcheck.bounded_int(0, 200), qcheck.bounded_int(0, 400)),
      qcheck.bounded_int(0, 4000),
    )
  use #(raw, #(row, col), pick) <- check(500, 101, cases)
  let text = script.normalized(raw)
  let lines = rows_of(text)
  let row = row % list.length(lines)
  let line = list.drop(lines, row) |> list.first |> option.from_result
  let col = col % { string.length(option.unwrap(line, "")) + 1 }
  let place = Position(row:, col:)
  let offset = surface.offset(lines, place)
  assert surface.position(text, offset) == place
    as {
      "line and column " <> string.inspect(place) <> " came back as another"
    }

  let boundary =
    utf16_length(string.slice(text, 0, pick % { string.length(text) + 1 }))
  let found = surface.position(text, boundary)
  assert surface.offset(lines, found) == boundary
    as { "offset " <> int.to_string(boundary) <> " came back as another" }
}

// 2. Rows

pub fn every_row_belongs_to_exactly_one_block_test() {
  use text <- check(2000, 102, gen.note(Anything))
  case rows.check(text) {
    Ok(Nil) -> Nil
    Error(reason) -> panic as reason
  }
}

// 3. Text kept

pub fn parsing_keeps_every_character_of_the_text_test() {
  use text <- check(1500, 103, gen.note(Tame))
  assert kept.every_letter(text) as "the parsed blocks lost or changed text"
}

pub fn the_generated_notes_hold_every_kind_of_text_test() {
  let notes = sample(gen.note(Anything), 600)
  let text = string.join(notes, "\u{0}")
  let kinds = [
    "é",
    "日本語",
    "😀",
    "\u{200D}",
    "🇯🇵",
    "a\u{300}\u{323}",
    "\r\n",
    "\t",
    string.repeat(" ", 40),
    "\n# ",
    "\n===",
    "\n- ",
    "\n> ",
    "\n```",
    "|---|",
    "- [x] ",
    "1. ",
    "\n    ",
    "~~~",
    "\n***",
  ]
  list.each(kinds, fn(kind) {
    assert string.contains(text, kind)
      as { "no note holds " <> string.inspect(kind) }
  })
  assert list.any(notes, fn(note) { string.ends_with(note, "\n") })
  assert list.contains(notes, "")
}
