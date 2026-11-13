//// What a plain browser text box does with a key: a `<textarea>` in Chromium
//// on Linux, with its lines not wrapped. Pure Gleam, no editor code.
////
//// Not modelled, because the answer depends on layout, on the mouse or on an
//// IME: ArrowUp and ArrowDown, PageUp and PageDown, Home and End on a line
//// that wraps, the mouse, composition.
////
//// Everything is counted in graphemes, the same unit the editor counts in.
//// `typist/export` converts to UTF-16 for the browser.
////
//// Every rule here was checked against a real `<textarea>` in Chromium by
//// `e2e/tests/typist.e2e.ts`. When the browser and this file disagree, this
//// file is the one that is wrong.

import gleam/int
import gleam/list
import gleam/string

pub type Unit {
  Grapheme
  Word
}

pub type Move {
  Left(Unit)
  Right(Unit)
  LineStart
  LineEnd
  DocStart
  DocEnd
}

pub type Redo {
  CtrlShiftZ
  CtrlY
}

pub type Key {
  /// One typed grapheme: a letter, a mark, a space.
  Char(String)
  Enter
  Backspace(Unit)
  Delete(Unit)
  /// A key that moves the caret, or with Shift moves only the head.
  Go(Move, extend: Bool)
  SelectAll
  /// Text from the clipboard, over any selection.
  Paste(String)
  Undo
  Redo(Redo)
}

/// What a person can see of the box: its text and its selection, as offsets
/// between graphemes. The head is the end that moves with Shift.
pub type State {
  State(text: String, anchor: Int, head: Int)
}

pub opaque type Box {
  Box(chars: List(String), anchor: Int, head: Int, history: History)
}

/// The box's own undo list. `open` is true while the last thing done was
/// typing, which the next typing joins into the same step.
type History {
  History(past: List(Snapshot), future: List(Snapshot), open: Bool)
}

type Snapshot {
  Snapshot(chars: List(String), anchor: Int, head: Int)
}

/// The key as Playwright names it, with `Char` and `Paste` named for what
/// they do. The editor never sees this: it is for reports and the browser.
pub fn label(key: Key) -> String {
  let go = fn(name, extend) {
    case extend {
      True -> "Shift+" <> name
      False -> name
    }
  }
  let ctrl_go = fn(name, extend) {
    case extend {
      True -> "Control+Shift+" <> name
      False -> "Control+" <> name
    }
  }
  case key {
    Char(_) -> "Char"
    Enter -> "Enter"
    Backspace(Grapheme) -> "Backspace"
    Backspace(Word) -> "Control+Backspace"
    Delete(Grapheme) -> "Delete"
    Delete(Word) -> "Control+Delete"
    Go(Left(Grapheme), extend:) -> go("ArrowLeft", extend)
    Go(Right(Grapheme), extend:) -> go("ArrowRight", extend)
    Go(Left(Word), extend:) -> ctrl_go("ArrowLeft", extend)
    Go(Right(Word), extend:) -> ctrl_go("ArrowRight", extend)
    Go(LineStart, extend:) -> go("Home", extend)
    Go(LineEnd, extend:) -> go("End", extend)
    Go(DocStart, extend:) -> ctrl_go("Home", extend)
    Go(DocEnd, extend:) -> ctrl_go("End", extend)
    SelectAll -> "Control+a"
    Paste(_) -> "Paste"
    Undo -> "Control+z"
    Redo(CtrlShiftZ) -> "Control+Shift+z"
    Redo(CtrlY) -> "Control+y"
  }
}

pub fn new(text text: String, anchor anchor: Int, head head: Int) -> Box {
  let chars = string.to_graphemes(text)
  let end = list.length(chars)
  Box(
    chars:,
    anchor: int.clamp(anchor, 0, end),
    head: int.clamp(head, 0, end),
    history: History(past: [], future: [], open: False),
  )
}

pub fn state(box: Box) -> State {
  State(text: string.concat(box.chars), anchor: box.anchor, head: box.head)
}

/// Another writer sets the box's text and selection, as a script does with
/// `control.value = ...`: the box forgets its undo list when the text changes.
pub fn write(box: Box, to state: State) -> Box {
  let chars = string.to_graphemes(state.text)
  let end = list.length(chars)
  let anchor = int.clamp(state.anchor, 0, end)
  let head = int.clamp(state.head, 0, end)
  case chars == box.chars {
    True -> Box(..box, anchor:, head:)
    False ->
      Box(
        chars:,
        anchor:,
        head:,
        history: History(past: [], future: [], open: False),
      )
  }
}

pub fn press(box: Box, key: Key) -> Box {
  let #(low, high) = bounds(box)
  let collapsed = box.anchor == box.head
  case key {
    Char(char) -> typing(box, low, high, [char])
    Enter -> typing(box, low, high, ["\n"])
    Backspace(unit) ->
      case collapsed, unit {
        False, _ -> typing(box, low, high, [])
        True, Grapheme -> typing(box, int.max(box.head - 1, 0), box.head, [])
        True, Word ->
          typing(box, word_erased(box.chars, box.head), box.head, [])
      }
    Delete(unit) ->
      case collapsed, unit {
        False, _ -> typing(box, low, high, [])
        True, Grapheme ->
          typing(box, box.head, int.min(box.head + 1, length(box)), [])
        True, Word -> typing(box, box.head, word_after(box.chars, box.head), [])
      }
    Go(move, extend:) -> go(box, move, extend)
    SelectAll -> closed(Box(..box, anchor: 0, head: length(box)))
    Paste(text) -> replaced(box, low, high, string.to_graphemes(text), False)
    Undo -> undo(box)
    Redo(_) -> redo(box)
  }
}

pub fn length(box: Box) -> Int {
  list.length(box.chars)
}

fn bounds(box: Box) -> #(Int, Int) {
  #(int.min(box.anchor, box.head), int.max(box.anchor, box.head))
}

fn typing(box: Box, from: Int, to: Int, with: List(String)) -> Box {
  case from == to && with == [] {
    True -> box
    False -> replaced(box, from, to, with, True)
  }
}

/// `join` is true for a key typed: it goes into the open step if there is
/// one. A paste is a step of its own.
fn replaced(
  box: Box,
  from: Int,
  to: Int,
  with: List(String),
  join: Bool,
) -> Box {
  let History(past:, open:, ..) = box.history
  let before = Snapshot(box.chars, box.anchor, box.head)
  let past = case join && open {
    True -> past
    False -> [before, ..past]
  }
  let chars =
    list.flatten([list.take(box.chars, from), with, list.drop(box.chars, to)])
  let caret = from + list.length(with)
  Box(
    chars:,
    anchor: caret,
    head: caret,
    history: History(past:, future: [], open: join),
  )
}

fn closed(box: Box) -> Box {
  Box(..box, history: History(..box.history, open: False))
}

fn undo(box: Box) -> Box {
  case box.history.past {
    [] -> closed(box)
    [step, ..past] -> {
      let now = Snapshot(box.chars, box.anchor, box.head)
      let future = [now, ..box.history.future]
      restored(step, History(past:, future:, open: False))
    }
  }
}

fn redo(box: Box) -> Box {
  case box.history.future {
    [] -> closed(box)
    [step, ..future] -> {
      let now = Snapshot(box.chars, box.anchor, box.head)
      let past = [now, ..box.history.past]
      restored(step, History(past:, future:, open: False))
    }
  }
}

fn restored(step: Snapshot, history: History) -> Box {
  Box(chars: step.chars, anchor: step.anchor, head: step.head, history:)
}

fn go(box: Box, move: Move, extend: Bool) -> Box {
  let #(low, high) = bounds(box)
  let collapsed = box.anchor == box.head
  let end = length(box)
  let head = case extend, collapsed, move {
    False, False, Left(Grapheme) -> low
    False, False, Right(Grapheme) -> high
    _, _, Left(Grapheme) -> int.max(box.head - 1, 0)
    _, _, Right(Grapheme) -> int.min(box.head + 1, end)
    _, _, Left(Word) -> word_before(box.chars, box.head)
    _, _, Right(Word) -> word_after(box.chars, box.head)
    _, _, LineStart -> line_start(box.chars, box.head)
    _, _, LineEnd -> line_end(box.chars, box.head)
    _, _, DocStart -> 0
    _, _, DocEnd -> end
  }
  case extend {
    True -> closed(Box(..box, head:))
    False -> closed(Box(..box, anchor: head, head:))
  }
}

fn line_start(chars: List(String), at: Int) -> Int {
  case list.take(chars, at) |> list.reverse |> index_of("\n", 0) {
    Ok(distance) -> at - distance
    Error(Nil) -> 0
  }
}

fn line_end(chars: List(String), at: Int) -> Int {
  case list.drop(chars, at) |> index_of("\n", 0) {
    Ok(distance) -> at + distance
    Error(Nil) -> list.length(chars)
  }
}

fn index_of(
  chars: List(String),
  wanted: String,
  found: Int,
) -> Result(Int, Nil) {
  case chars {
    [] -> Error(Nil)
    [char, ..] if char == wanted -> Ok(found)
    [_, ..rest] -> index_of(rest, wanted, found + 1)
  }
}

// Words, as the probe in `e2e/tests/typist.e2e.ts` found them. A word is a
// run of letters and digits, or a run of anything else but space, so `- [x]`
// is three words and `a-b` is three. A move first skips spaces. It never
// walks over a line break, except one step at a time: from the end of a row
// to the start of the next, and from the start of an empty row to the end of
// the row above. A row that starts with a line break and then spaces carries
// on over the spaces to the end of the next word. `_` is not modelled and is
// never typed.

type Class {
  Alnum
  Other
}

fn class(char: String) -> Class {
  case is_alnum(char) {
    True -> Alnum
    False -> Other
  }
}

fn is_alnum(char: String) -> Bool {
  string.lowercase(char) != string.uppercase(char) || is_digit(char)
}

fn is_digit(char: String) -> Bool {
  list.contains(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"], char)
}

fn is_space(char: String) -> Bool {
  char == " " || char == "\t"
}

/// How many of these graphemes are one word: the same class, no space.
fn word_length(chars: List(String), wanted: Class) -> Int {
  list.take_while(chars, fn(char) {
    !is_space(char) && char != "\n" && class(char) == wanted
  })
  |> list.length
}

fn word_after(chars: List(String), at: Int) -> Int {
  forward(list.drop(chars, at), at)
}

fn forward(rest: List(String), at: Int) -> Int {
  case rest {
    [] -> at
    ["\n", ..after] ->
      case after {
        [next, ..] -> {
          case is_space(next) {
            True -> forward(after, at + 1)
            False -> at + 1
          }
        }
        [] -> at + 1
      }
    _ -> {
      let #(spaces, after) = list.split_while(rest, is_space)
      let start = at + list.length(spaces)
      case after {
        [] | ["\n", ..] -> start
        [first, ..] -> start + word_length(after, class(first))
      }
    }
  }
}

/// Ctrl+Backspace at the start of a row takes the line break, where a move
/// of the caret would stay.
fn word_erased(chars: List(String), at: Int) -> Int {
  case list.drop(chars, at - 1) {
    ["\n", ..] if at > 0 -> at - 1
    _ -> word_before(chars, at)
  }
}

fn word_before(chars: List(String), at: Int) -> Int {
  let before = list.take(chars, at) |> list.reverse
  let after = list.drop(chars, at)
  backward(before, after, at)
}

fn backward(before: List(String), after: List(String), at: Int) -> Int {
  case before {
    [] -> 0
    ["\n", ..] ->
      case after {
        [] | ["\n", ..] -> at - 1
        _ -> at
      }
    _ -> {
      let #(spaces, rest) = list.split_while(before, is_space)
      let start = at - list.length(spaces)
      case rest {
        [] | ["\n", ..] -> start
        [first, ..] -> start - word_length(rest, class(first))
      }
    }
  }
}
