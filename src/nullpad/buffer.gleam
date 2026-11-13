//// The note being edited: lines of text plus one selection. Pure Gleam.
//// This is the single source of truth that the preview, storage and vim read.
//// The text field on screen only mirrors it (see `nullpad/surface`).
//// Imported by: any module. Imports: gleam_stdlib only.

import gleam/int
import gleam/list
import gleam/order
import gleam/result
import gleam/string

/// A place *between* two graphemes, both numbers counted from 0. `col` counts
/// graphemes (what a person calls a character), never bytes or UTF-16 units.
/// Browser offsets are converted in `surface` and nowhere else.
pub type Position {
  Position(row: Int, col: Int)
}

/// Invariants, kept by every function here so callers never check:
/// - `lines` is never empty (an empty note is `[""]`) and no line holds "\n".
/// - `anchor` and `head` are inside the text.
/// - `head` is the cursor. `anchor == head` means nothing is selected.
/// A list of lines is enough for notes of a few pages. The type is opaque, so
/// a faster structure can replace it later without touching a caller.
pub opaque type Buffer {
  Buffer(lines: List(String), anchor: Position, head: Position)
}

/// Split on "\n" (after turning "\r\n" into "\n"). Cursor at the start.
pub fn from_text(text: String) -> Buffer {
  let start = Position(row: 0, col: 0)
  Buffer(lines: to_lines(text), anchor: start, head: start)
}

/// The lines joined with "\n". Law: `text(from_text(t)) == t` (no "\r" in t).
pub fn text(buffer: Buffer) -> String {
  string.join(buffer.lines, "\n")
}

pub fn lines(buffer: Buffer) -> List(String) {
  buffer.lines
}

/// Where typing would happen.
pub fn cursor(buffer: Buffer) -> Position {
  buffer.head
}

/// `#(anchor, head)`. The anchor stays put while the head moves, which is
/// what vim's visual mode needs later.
pub fn selection(buffer: Buffer) -> #(Position, Position) {
  #(buffer.anchor, buffer.head)
}

/// Move the selection. Total: positions outside the text are clamped, so this
/// cannot fail or break the invariants.
pub fn select(
  buffer: Buffer,
  anchor anchor: Position,
  head head: Position,
) -> Buffer {
  Buffer(
    ..buffer,
    anchor: clamp(buffer.lines, anchor),
    head: clamp(buffer.lines, head),
  )
}

/// Put the cursor at `position` with nothing selected.
pub fn move_to(buffer: Buffer, position: Position) -> Buffer {
  select(buffer, anchor: position, head: position)
}

/// The one editing primitive: replace what lies between `from` and `to` with
/// `new` (which may contain "\n"). The cursor lands just after it.
/// Typing "x" is `replace(c, c, "x")`. Vim `dd` on row r is
/// `replace(Position(r, 0), Position(r + 1, 0), "")`.
pub fn replace(
  buffer: Buffer,
  from from: Position,
  to to: Position,
  with new: String,
) -> Buffer {
  let #(from, to) = in_order(clamp(buffer.lines, from), clamp(buffer.lines, to))
  let before = string.slice(line(buffer.lines, from.row), 0, from.col)
  let after = string.drop_start(line(buffer.lines, to.row), to.col)
  let inserted_end = end_of(before <> new)
  let end = Position(row: from.row + inserted_end.row, col: inserted_end.col)
  let lines =
    list.flatten([
      list.take(buffer.lines, from.row),
      to_lines(before <> new <> after),
      list.drop(buffer.lines, to.row + 1),
    ])
  Buffer(lines:, anchor: end, head: end)
}

pub fn end_of(text: String) -> Position {
  let lines = to_lines(text)
  Position(
    row: list.length(lines) - 1,
    col: list.last(lines) |> result.unwrap("") |> string.length,
  )
}

fn to_lines(text: String) -> List(String) {
  text |> string.replace("\r\n", "\n") |> string.split("\n")
}

fn line(lines: List(String), row: Int) -> String {
  lines |> list.drop(row) |> list.first |> result.unwrap("")
}

fn clamp(lines: List(String), position: Position) -> Position {
  let row = int.clamp(position.row, min: 0, max: list.length(lines) - 1)
  let width = string.length(line(lines, row))
  Position(row:, col: int.clamp(position.col, min: 0, max: width))
}

fn in_order(a: Position, b: Position) -> #(Position, Position) {
  let by_row = int.compare(a.row, b.row)
  case order.break_tie(by_row, int.compare(a.col, b.col)) {
    order.Gt -> #(b, a)
    order.Lt | order.Eq -> #(a, b)
  }
}

pub fn compare(a: Position, b: Position) -> order.Order {
  order.break_tie(int.compare(a.row, b.row), int.compare(a.col, b.col))
}

/// The word around a place, from its start to its end, as a double click
/// selects it: a run of letters, of spaces, or of marks. A place just after
/// a word is in that word.
pub fn word_at(buffer: Buffer, position: Position) -> #(Position, Position) {
  let Position(row:, col:) = clamp(buffer.lines, position)
  let #(before, after) =
    string.to_graphemes(line(buffer.lines, row)) |> list.split(col)
  let before = list.reverse(before)
  let run = case
    list.first(before) |> result.map(run_of),
    list.first(after) |> result.map(run_of)
  {
    Ok(Letters), _ -> Letters
    Ok(Spaces), Ok(run) | Ok(Marks), Ok(run) | Error(Nil), Ok(run) -> run
    Ok(run), Error(Nil) -> run
    Error(Nil), Error(Nil) -> Spaces
  }
  #(
    Position(row:, col: col - run_length(before, run, 0)),
    Position(row:, col: col + run_length(after, run, 0)),
  )
}

type Run {
  Letters
  Spaces
  Marks
}

fn run_of(grapheme: String) -> Run {
  case grapheme {
    " " | "\t" -> Spaces
    _ ->
      case string.contains(marks, grapheme) {
        True -> Marks
        False -> Letters
      }
  }
}

const marks = "!\"#$%&'()*+,-./:;<=>?@[\\]^`{|}~"

fn run_length(graphemes: List(String), run: Run, count: Int) -> Int {
  case graphemes {
    [grapheme, ..rest] ->
      case run_of(grapheme) == run {
        True -> run_length(rest, run, count + 1)
        False -> count
      }
    [] -> count
  }
}
