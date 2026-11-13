//// A key script: a starting note, where the caret starts in it, and the
//// keys a person presses. Generated from a seed, so a run is repeatable.

import gleam/int
import gleam/list
import gleam/string
import typist/gen.{type Gen}
import typist/notes
import typist/textbox.{type Key}

/// Where the caret starts, and how many graphemes after it are selected, on
/// one row. In the page that is a click, or a shift click.
pub type Start {
  Start(row: Int, col: Int, width: Int)
}

pub type Script {
  Script(note: String, start: Start, keys: List(Key))
}

pub type Config {
  Config(
    /// Undo and redo keys. The editor has no undo of its own yet, so a run
    /// with them is expected to find mismatches.
    undo: Bool,
    max_keys: Int,
    size: notes.Size,
  )
}

pub fn script(config: Config) -> Gen(Script) {
  use rows <- gen.then(notes.document(config.size))
  let note = string.join(rows, "\n")
  use start <- gen.then(start(rows))
  use keys <- gen.then(keys(config))
  gen.constant(Script(note:, start:, keys:))
}

fn start(rows: List(String)) -> Gen(Start) {
  use row <- gen.then(gen.below(list.length(rows)))
  let line = case list.drop(rows, row) {
    [line, ..] -> line
    [] -> ""
  }
  let width = string.length(line)
  use col <- gen.then(gen.between(0, width))
  use selected <- gen.then(gen.chance(35))
  use count <- gen.then(gen.between(1, 4))
  gen.constant(
    Start(row:, col:, width: case selected {
      True -> int.min(count, width - col)
      False -> 0
    }),
  )
}

fn keys(config: Config) -> Gen(List(Key)) {
  use count <- gen.then(gen.between(1, config.max_keys))
  use groups <- gen.then(gen.repeat(count, action(config.undo)))
  gen.constant(list.flatten(groups))
}

/// What the typist does next: usually one key, sometimes a short burst of
/// letters.
fn action(undo: Bool) -> Gen(List(Key)) {
  let one = fn(weight, key) { #(weight, gen.map(key, fn(key) { [key] })) }
  let go = fn(weight, move, extend) {
    one(weight, gen.constant(textbox.Go(move, extend:)))
  }
  let word = textbox.Word
  let letter = textbox.Grapheme
  let undoing = case undo {
    True -> [
      one(3, gen.constant(textbox.Undo)),
      one(
        2,
        gen.one_of([
          textbox.Redo(textbox.CtrlShiftZ),
          textbox.Redo(textbox.CtrlY),
        ]),
      ),
    ]
    False -> []
  }
  let table =
    list.flatten([
      [
        #(22, burst()),
        one(5, gen.constant(textbox.Enter)),
        one(6, gen.constant(textbox.Backspace(letter))),
        one(3, gen.constant(textbox.Delete(letter))),
        one(2, gen.constant(textbox.Backspace(word))),
        one(2, gen.constant(textbox.Delete(word))),
        go(9, textbox.Left(letter), False),
        go(9, textbox.Right(letter), False),
        go(7, textbox.Left(letter), True),
        go(7, textbox.Right(letter), True),
        go(4, textbox.LineStart, False),
        go(4, textbox.LineEnd, False),
        go(2, textbox.LineStart, True),
        go(2, textbox.LineEnd, True),
        go(2, textbox.DocStart, False),
        go(2, textbox.DocEnd, False),
        go(2, textbox.DocStart, True),
        go(2, textbox.DocEnd, True),
        go(3, textbox.Left(word), False),
        go(3, textbox.Right(word), False),
        go(3, textbox.Left(word), True),
        go(3, textbox.Right(word), True),
        one(2, gen.constant(textbox.SelectAll)),
        #(2, paste()),
      ],
      undoing,
    ])
  gen.weighted_gen(table)
}

const letters = ["a", "b", "c", "x", "y", "z"]

const marks = ["#", "-", ">", "|", "*", "~", "`"]

const wide = ["é", "👋"]

fn char() -> Gen(Key) {
  gen.weighted_gen([
    #(60, gen.one_of(letters)),
    #(24, gen.one_of(marks)),
    #(12, gen.constant(" ")),
    #(4, gen.one_of(wide)),
  ])
  |> gen.map(textbox.Char)
}

fn burst() -> Gen(List(Key)) {
  let length =
    gen.weighted_gen([#(5, gen.constant(1)), #(2, gen.between(2, 4))])
  gen.list_of(length, char())
}

fn paste() -> Gen(List(Key)) {
  gen.map(
    gen.one_of([
      "x\ny",
      "a\n\nb",
      "\nx",
      "x\n",
      "ab cd\nef",
      "- x\n- y",
      "```\nx",
    ]),
    fn(text) { [textbox.Paste(text)] },
  )
}
