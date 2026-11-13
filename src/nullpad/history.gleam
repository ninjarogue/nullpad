//// The note's undo history: the note before each step that can be undone,
//// and after each step undone. Pure.
////
//// A step is one change, except that a run of typed characters, or of
//// characters erased one at a time, is one step until the caret moves some
//// other way. A space typed after a word starts a new step, so undo takes
//// back about a word at a time.
////
//// Imported by: `editor`. Imports: `buffer`.

import gleam/list
import gleam/string
import nullpad/buffer.{type Buffer, type Position, Position}

const most_steps = 1000

/// `present` is the note as last recorded, with its selection. `past` holds
/// the steps that can be undone, newest first, and `future` the steps undone,
/// next first. The text of `present` is the text after the newest step in
/// `past`.
pub opaque type History {
  History(past: List(Step), present: Buffer, future: List(Step), run: Run)
}

/// The note before and after one step, each with the selection it had then,
/// so undo puts the caret where the step began and redo where it ended.
type Step {
  Step(before: Buffer, after: Buffer)
}

/// What the newest step is doing, so that the next change can join it.
type Run {
  Closed
  Typing(last: String)
  Erasing(direction: Direction)
}

type Direction {
  Back
  Forward
}

type Change {
  Typed(String)
  Erased(Direction)
  Replaced
}

pub fn new(buffer: Buffer) -> History {
  History(past: [], present: buffer, future: [], run: Closed)
}

/// The note as it is now. A change to its text clears what can be redone.
/// A change to its selection alone ends a run of typing.
pub fn record(history: History, buffer: Buffer, at at: Int) -> History {
  let History(past:, present:, run:, ..) = history
  let _ = at
  let same_text = buffer.lines(buffer) == buffer.lines(present)
  let same_selection = buffer.selection(buffer) == buffer.selection(present)
  case same_text, same_selection {
    True, True -> history
    True, False -> History(..history, present: buffer, run: Closed)
    False, _ -> {
      let change = change(present, buffer)
      let past = case joins(run, change), past {
        True, [Step(before:, ..), ..past] -> [
          Step(before:, after: buffer),
          ..past
        ]
        True, [] | False, _ ->
          list.take([Step(before: present, after: buffer), ..past], most_steps)
      }
      History(past:, present: buffer, future: [], run: run_of(change))
    }
  }
}

pub fn undo(history: History) -> Result(History, Nil) {
  case history.past {
    [] -> Error(Nil)
    [step, ..past] ->
      Ok(History(
        past:,
        present: step.before,
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
        present: step.after,
        future:,
        run: Closed,
      ))
  }
}

pub fn present(history: History) -> Buffer {
  history.present
}

fn joins(run: Run, change: Change) -> Bool {
  case run, change {
    Typing(last:), Typed(typed) -> !{ is_space(typed) && !is_space(last) }
    Erasing(direction:), Erased(erased) -> direction == erased
    Closed, Typed(_)
    | Closed, Erased(_)
    | Closed, Replaced
    | Typing(_), Erased(_)
    | Typing(_), Replaced
    | Erasing(_), Typed(_)
    | Erasing(_), Replaced
    -> False
  }
}

fn run_of(change: Change) -> Run {
  case change {
    Typed(typed) -> Typing(last: typed)
    Erased(direction) -> Erasing(direction:)
    Replaced -> Closed
  }
}

fn is_space(grapheme: String) -> Bool {
  grapheme == " " || grapheme == "\t"
}

/// One grapheme typed or erased at a caret with nothing selected, on one
/// row, is a `Typed` or an `Erased`. Anything else is `Replaced`.
fn change(before: Buffer, after: Buffer) -> Change {
  let #(anchor, from) = buffer.selection(before)
  let #(after_anchor, to) = buffer.selection(after)
  case anchor == from && after_anchor == to && from.row == to.row {
    False -> Replaced
    True ->
      case row_changed(buffer.lines(before), buffer.lines(after), 0, from.row) {
        Ok(#(old, new)) -> on_row(old, new, from, to)
        Error(Nil) -> Replaced
      }
  }
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

/// The row `row` of each, when every other row is the same in both.
fn row_changed(
  before: List(String),
  after: List(String),
  index: Int,
  row: Int,
) -> Result(#(String, String), Nil) {
  case before, after {
    [old, ..before], [new, ..after] if index == row ->
      case before == after {
        True -> Ok(#(old, new))
        False -> Error(Nil)
      }
    [old, ..before], [new, ..after] if old == new ->
      row_changed(before, after, index + 1, row)
    _, _ -> Error(Nil)
  }
}
