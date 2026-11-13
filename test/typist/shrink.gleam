//// Makes a failing script short. Tries to drop keys, rows of the note, and
//// the start, and keeps each cut that still fails the same way.

import gleam/int
import gleam/list
import gleam/string
import typist/gen
import typist/script.{type Script, Script, Start}
import typist/textbox.{type Key}

/// `still_fails` says whether a smaller script goes wrong the same way.
pub fn shrink(script: Script, still_fails: fn(Script) -> Bool) -> Script {
  case list.find(candidates(script), still_fails) {
    Ok(smaller) -> shrink(smaller, still_fails)
    Error(Nil) -> script
  }
}

fn candidates(script: Script) -> List(Script) {
  list.flatten([
    fewer_keys(script),
    fewer_rows(script),
    shorter_rows(script),
    simpler_start(script),
    simpler_keys(script),
  ])
}

fn fewer_keys(script: Script) -> List(Script) {
  let count = list.length(script.keys)
  let sizes = chunk_sizes(count, [])
  list.flat_map(sizes, fn(size) {
    gen.indexes(count)
    |> list.filter(fn(at) { at % size == 0 })
    |> list.map(fn(at) {
      let keys =
        list.append(
          list.take(script.keys, at),
          list.drop(script.keys, at + size),
        )
      Script(..script, keys:)
    })
  })
}

/// Half the keys, then a quarter, down to one at a time.
fn chunk_sizes(count: Int, found: List(Int)) -> List(Int) {
  case count < 1 {
    True -> list.reverse(found)
    False -> {
      let size = int.max(count / 2, 1)
      case size == 1 {
        True -> list.reverse([1, ..found])
        False -> chunk_sizes(size, [size, ..found])
      }
    }
  }
}

fn rows(script: Script) -> List(String) {
  string.split(script.note, "\n")
}

fn fewer_rows(script: Script) -> List(Script) {
  let rows = rows(script)
  case rows {
    [_] -> []
    _ ->
      list.index_map(rows, fn(_, at) {
        let kept = list.append(list.take(rows, at), list.drop(rows, at + 1))
        let row = case at < script.start.row {
          True -> script.start.row - 1
          False -> int.min(script.start.row, list.length(kept) - 1)
        }
        fitted(script, kept, Start(..script.start, row:))
      })
  }
}

fn shorter_rows(script: Script) -> List(Script) {
  let rows = rows(script)
  list.index_map(rows, fn(row, at) {
    [string.slice(row, 0, string.length(row) / 2), string.slice(row, 0, 1), ""]
    |> list.filter(fn(shorter) { shorter != row })
    |> list.map(fn(shorter) {
      let kept =
        list.flatten([list.take(rows, at), [shorter], list.drop(rows, at + 1)])
      fitted(script, kept, script.start)
    })
  })
  |> list.flatten
}

fn simpler_start(script: Script) -> List(Script) {
  let start = script.start
  [
    Start(..start, width: 0),
    Start(..start, col: 0, width: 0),
    Start(row: 0, col: 0, width: 0),
    Start(..start, row: 0),
    Start(..start, col: 0),
  ]
  |> list.filter(fn(simpler) { simpler != start })
  |> list.map(fn(start) { fitted(script, rows(script), start) })
}

/// The script with this note, and a start that is inside it.
fn fitted(script: Script, rows: List(String), start: script.Start) -> Script {
  let row = int.clamp(start.row, 0, list.length(rows) - 1)
  let length = case list.drop(rows, row) {
    [line, ..] -> string.length(line)
    [] -> 0
  }
  let col = int.clamp(start.col, 0, length)
  let width = int.clamp(start.width, 0, length - col)
  Script(
    ..script,
    note: string.join(rows, "\n"),
    start: Start(row:, col:, width:),
  )
}

fn simpler_keys(script: Script) -> List(Script) {
  list.index_map(script.keys, fn(key, at) {
    simpler(key)
    |> list.map(fn(replacement) {
      let keys =
        list.flatten([
          list.take(script.keys, at),
          [replacement],
          list.drop(script.keys, at + 1),
        ])
      Script(..script, keys:)
    })
  })
  |> list.flatten
}

fn simpler(key: Key) -> List(Key) {
  case key {
    textbox.Char(char) if char != "a" -> [textbox.Char("a")]
    textbox.Paste(text) if text != "x" -> [textbox.Paste("x")]
    textbox.Redo(textbox.CtrlY) -> [textbox.Redo(textbox.CtrlShiftZ)]
    _ -> []
  }
}
