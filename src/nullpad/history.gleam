//// The note's undo history: what each step that can be undone changed, and
//// each step undone. Pure.
////
//// A step is one change, except that a run of typed characters, or of
//// characters erased one at a time, is one step until the caret moves some
//// other way. A character typed over selected text starts a run of typing. A space typed after a word starts a new step, so undo takes
//// back about a word at a time. A pause of more than `pause` milliseconds
//// since the last character typed or erased also starts a new step.
////
//// Imported by: `editor`. Imports: `buffer`.

import gleam/int
import gleam/list
import gleam/order
import gleam/result
import gleam/string
import nullpad/buffer.{type Buffer, type Position, Position}

const most_steps = 1000

/// Longer than the gaps inside a burst of typing, which are a fraction of a
/// second even for a slow typist, and shorter than the time it takes to stop
/// and think. CodeMirror and ProseMirror split at 500 ms, Lexical at 300 ms
/// and Quill at 1000 ms. Half a second splits the words of a slow typist, so
/// this takes Quill's.
pub const pause = 1000

/// `present` is the note as last recorded, with its selection. `past` holds
/// the steps that can be undone, newest first, and `future` the steps undone,
/// next first. The text of `present` is the text after the newest step in
/// `past`.
pub opaque type History {
  History(past: List(Step), present: Buffer, future: List(Step), run: Run)
}

/// What one step changed, with the selection before and after it, so undo
/// puts the caret where the step began and redo where it ended. A step keeps
/// only the rows it changed, so a long note costs no more per step than a
/// short one.
type Step {
  Step(rows: Rows, before: #(Position, Position), after: #(Position, Position))
}

/// The rows from `row` that `removed` had before a change and `inserted`
/// has after it. Neither is empty, so a change of whole rows takes a row
/// beside them with it.
type Rows {
  Rows(row: Int, removed: List(String), inserted: List(String))
}

/// What the newest step is doing, so that the next change can join it.
type Run {
  Closed
  Typing(last: String, at: Int)
  Erasing(direction: Direction, at: Int)
}

type Direction {
  Back
  Forward
}

type Change {
  Typed(String)
  /// One grapheme typed over selected text: it starts a step that the
  /// typing after it joins.
  TypedOver(String)
  Erased(Direction)
  Replaced
}

pub fn new(buffer: Buffer) -> History {
  History(past: [], present: buffer, future: [], run: Closed)
}

/// The note as it is now. A change to its text clears what can be redone.
/// A change to its selection alone ends a run of typing. `at` is when the
/// change was made, in milliseconds on any clock that only goes forward: a
/// run of typing is cut where two of its characters are more than `pause`
/// apart.
pub fn record(history: History, buffer: Buffer, at at: Int) -> History {
  let History(past:, present:, run:, ..) = history
  let selection = buffer.selection(buffer)
  case rows_between(buffer.lines(present), buffer.lines(buffer)) {
    Error(Nil) ->
      case selection == buffer.selection(present) {
        True -> history
        False -> History(..history, present: buffer, run: Closed)
      }
    Ok(rows) -> {
      let change = change(present, buffer, rows)
      let past = case joins(run, change, at), past {
        True, [first, ..past] -> {
          let rows = joined(first.rows, buffer.lines(buffer))
          [Step(..first, rows:, after: selection), ..past]
        }
        True, [] | False, _ -> {
          let step =
            Step(rows:, before: buffer.selection(present), after: selection)
          list.take([step, ..past], most_steps)
        }
      }
      History(past:, present: buffer, future: [], run: run_of(change, at))
    }
  }
}

pub fn undo(history: History) -> Result(History, Nil) {
  case history.past {
    [] -> Error(Nil)
    [step, ..past] ->
      Ok(History(
        past:,
        present: swap(
          history.present,
          step.rows.row,
          out: step.rows.inserted,
          put: step.rows.removed,
          select: step.before,
        ),
        future: [step, ..history.future],
        run: Closed,
      ))
  }
}

pub fn redo(history: History) -> Result(History, Nil) {
  case history.future {
    [] -> Error(Nil)
    [step, ..future] ->
      Ok(History(
        past: [step, ..history.past],
        present: swap(
          history.present,
          step.rows.row,
          out: step.rows.removed,
          put: step.rows.inserted,
          select: step.after,
        ),
        future:,
        run: Closed,
      ))
  }
}

pub fn present(history: History) -> Buffer {
  history.present
}

fn joins(run: Run, change: Change, now: Int) -> Bool {
  case run, change {
    Typing(last:, at:), Typed(typed) ->
      now - at <= pause && !{ is_space(typed) && !is_space(last) }
    Erasing(direction:, at:), Erased(erased) ->
      now - at <= pause && direction == erased
    Closed, TypedOver(_)
    | Typing(..), TypedOver(_)
    | Erasing(..), TypedOver(_)
    | Closed, Typed(_)
    | Closed, Erased(_)
    | Closed, Replaced
    | Typing(..), Erased(_)
    | Typing(..), Replaced
    | Erasing(..), Typed(_)
    | Erasing(..), Replaced
    -> False
  }
}

fn run_of(change: Change, at: Int) -> Run {
  case change {
    Typed(typed) | TypedOver(typed) -> Typing(last: typed, at:)
    Erased(direction) -> Erasing(direction:, at:)
    Replaced -> Closed
  }
}

fn is_space(grapheme: String) -> Bool {
  grapheme == " " || grapheme == "\t"
}

/// The rows of `present` from `row` that are `out` take `put` in their
/// place, with the selection given.
fn swap(
  present: Buffer,
  row: Int,
  out out: List(String),
  put put: List(String),
  select selection: #(Position, Position),
) -> Buffer {
  let last = list.last(out) |> result.unwrap("")
  let to = Position(row: row + list.length(out) - 1, col: string.length(last))
  buffer.replace(
    present,
    from: Position(row:, col: 0),
    to:,
    with: string.join(put, "\n"),
  )
  |> buffer.select(anchor: selection.0, head: selection.1)
}

/// The rows that differ between two notes, or `Error(Nil)` when they are
/// the same.
fn rows_between(
  before: List(String),
  after: List(String),
) -> Result(Rows, Nil) {
  let before_count = list.length(before)
  let after_count = list.length(after)
  let fewest = int.min(before_count, after_count)
  let row = same_count(before, after, 0, fewest - 1)
  let before = list.drop(before, row)
  let after = list.drop(after, row)
  let tail =
    same_count(list.reverse(before), list.reverse(after), 0, fewest - row - 1)
  let removed = list.take(before, before_count - row - tail)
  let inserted = list.take(after, after_count - row - tail)
  case removed == inserted {
    True -> Error(Nil)
    False -> Ok(Rows(row:, removed: kept(removed), inserted: kept(inserted)))
  }
}

/// A JavaScript engine can keep a row cut from the field's text as a view
/// of that whole text, so a step that held it would hold the whole note.
/// The rows a step keeps are copied out of it.
fn kept(rows: List(String)) -> List(String) {
  use row <- list.map(rows)
  string.to_utf_codepoints(row) |> string.from_utf_codepoints
}

/// How many of the first lines of both are the same, up to `limit`.
fn same_count(
  lines: List(String),
  others: List(String),
  count: Int,
  limit: Int,
) -> Int {
  case lines, others {
    [line, ..lines], [other, ..others] if line == other && count < limit ->
      same_count(lines, others, count + 1, limit)
    _, _ -> count
  }
}

/// The step's rows after one more typed or erased grapheme. That grapheme
/// is on the row the caret is on, which is the step's first row, so the
/// step keeps its rows removed and takes its inserted rows from `after`.
fn joined(first: Rows, after: List(String)) -> Rows {
  let inserted = slice(after, first.row, list.length(first.inserted)) |> kept
  Rows(..first, inserted:)
}

fn slice(lines: List(String), from: Int, count: Int) -> List(String) {
  lines |> list.drop(from) |> list.take(count)
}

/// One grapheme typed or erased at a caret with nothing selected, on one
/// row, is a `Typed` or an `Erased`. One grapheme typed over selected text
/// is a `TypedOver`. Anything else is `Replaced`.
fn change(before: Buffer, after: Buffer, rows: Rows) -> Change {
  let #(anchor, from) = buffer.selection(before)
  let #(after_anchor, to) = buffer.selection(after)
  case anchor == from, after_anchor == to, rows {
    True, True, Rows(row:, removed: [old], inserted: [new])
      if row == from.row && row == to.row
    -> on_row(old, new, from, to)
    False, True, _ -> typed_over(before, after, rows)
    True, True, _ | True, False, _ | False, False, _ -> Replaced
  }
}

fn typed_over(before: Buffer, after: Buffer, rows: Rows) -> Change {
  let #(anchor, head) = buffer.selection(before)
  let #(start, end) = case buffer.compare(anchor, head) {
    order.Gt -> #(head, anchor)
    order.Lt | order.Eq -> #(anchor, head)
  }
  let left = string.slice(row_of(buffer.lines(before), start.row), 0, start.col)
  let right = string.drop_start(row_of(buffer.lines(before), end.row), end.col)
  let new = row_of(buffer.lines(after), start.row)
  let typed = string.slice(new, start.col, 1)
  let rows_taken =
    list.length(rows.removed) - list.length(rows.inserted)
    == end.row - start.row
  let inside =
    rows.row >= start.row && rows.row + list.length(rows.removed) - 1 <= end.row
  case
    rows_taken
    && inside
    && typed != ""
    && new == left <> typed <> right
    && buffer.cursor(after) == Position(start.row, start.col + 1)
  {
    True -> TypedOver(typed)
    False -> Replaced
  }
}

fn row_of(lines: List(String), row: Int) -> String {
  lines |> list.drop(row) |> list.first |> result.unwrap("")
}

fn on_row(old: String, new: String, from: Position, to: Position) -> Change {
  let left = string.slice(old, 0, from.col)
  let right = string.drop_start(old, from.col)
  let typed = string.slice(new, from.col, 1)
  case to.col - from.col {
    1 if new == left <> typed <> right && typed != "" -> Typed(typed)
    -1 -> erased(new, string.drop_end(left, 1) <> right, Back)
    0 -> erased(new, left <> string.drop_start(right, 1), Forward)
    _ -> Replaced
  }
}

fn erased(new: String, expected: String, direction: Direction) -> Change {
  case new == expected {
    True -> Erased(direction)
    False -> Replaced
  }
}
