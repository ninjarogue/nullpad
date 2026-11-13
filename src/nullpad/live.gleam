//// Imported by: `editor`, `surface`, tests. Imports: `markdown`, `buffer`.

import gleam/int
import gleam/list
import gleam/option
import gleam/result
import gleam/string
import nullpad/buffer.{type Position, Position}
import nullpad/markdown.{
  type Block, type Item, type Level, Block, BulletList, CodeBlock, Heading,
  OrderedList, Table,
}

pub const row_mark = "row"

/// Rows of the note, both ends included, numbered like `Position.row`.
pub type Region {
  Region(first_row: Int, last_row: Int)
}

/// The rows to put in the text field for a selection that runs from row
/// `from` to row `to`: those rows, widened to every unit they touch. A unit
/// is a top-level block, or one item of a top-level list. A row outside every
/// unit (a blank line between blocks) stands alone.
pub fn reveal(blocks: List(Block), from from: Int, to to: Int) -> Region {
  let #(from, to) = #(int.min(from, to), int.max(from, to))
  use region, unit <- list.fold(units(blocks), Region(from, to))
  case unit.last_row < from || unit.first_row > to {
    True -> region
    False ->
      Region(
        first_row: int.min(region.first_row, unit.first_row),
        last_row: int.max(region.last_row, unit.last_row),
      )
  }
}

fn units(blocks: List(Block)) -> List(Region) {
  use block <- list.flat_map(blocks)
  case block.content {
    BulletList(items:, ..) | OrderedList(items:, ..) ->
      list.map(items, fn(item) { Region(item.row, item_last_row(item)) })
    _ -> [Region(block.first_row, block.last_row)]
  }
}

fn item_last_row(item: Item) -> Int {
  use last, block <- list.fold(item.blocks, item.row)
  int.max(last, block.last_row)
}

pub type Kind {
  Body
  Title(Level)
  Mono
  ListItem(task: Bool, marker: String)
}

pub fn kind(
  blocks: List(Block),
  field field: Region,
  lines lines: List(String),
) -> Kind {
  let held = fn(first_row, last_row) {
    first_row <= field.last_row && last_row >= field.first_row
  }
  case
    list.filter(blocks, fn(block) { held(block.first_row, block.last_row) })
  {
    [Block(content: Heading(level:, ..), ..)] -> Title(level)
    [Block(content: CodeBlock(..), ..)] | [Block(content: Table(..), ..)] ->
      Mono
    [Block(content: BulletList(items:, ..), ..)]
    | [Block(content: OrderedList(items:, ..), ..)] ->
      case list.find(items, fn(item) { held(item.row, item_last_row(item)) }) {
        Ok(first) ->
          ListItem(
            task: option.is_some(first.task),
            marker: marker(lines, first),
          )
        Error(Nil) -> Body
      }
    _ -> Body
  }
}

fn marker(lines: List(String), item: Item) -> String {
  lines
  |> list.drop(item.row)
  |> list.first
  |> result.unwrap("")
  |> string.to_utf_codepoints
  |> list.take(item.content_col)
  |> string.from_utf_codepoints
}

/// Where a click on the drawn page lands in the source. `row` is the first
/// source row of the element that was hit, and `visible` is the drawn text
/// from the start of that element to the click. Each "\n" in it is one
/// source row further down. `at_end` asks for the end of that row.
pub fn position(
  lines: List(String),
  row row: Int,
  visible visible: String,
  at_end at_end: Bool,
) -> Position {
  let drawn_rows = string.split(visible, "\n")
  let row = row + list.length(drawn_rows) - 1
  let line = lines |> list.drop(int.max(row, 0)) |> list.first
  case line, at_end {
    Error(Nil), _ -> buffer.end_of(string.join(lines, "\n"))
    Ok(line), True -> Position(row:, col: string.length(line))
    Ok(line), False -> {
      let drawn = list.last(drawn_rows) |> result.unwrap("")
      Position(row:, col: column(line, after: drawn))
    }
  }
}

/// An approximation: a mark that equals the next drawn character is taken for it.
pub fn column(line: String, after visible: String) -> Int {
  match(string.to_graphemes(line), string.to_graphemes(visible), 0)
}

fn match(line: List(String), visible: List(String), col: Int) -> Int {
  case line, visible {
    _, [] | [], _ -> col
    [typed, ..line], [drawn, ..visible] if typed == drawn ->
      match(line, visible, col + 1)
    [_, ..line], _ -> match(line, visible, col + 1)
  }
}

/// The inverse of `position`: the drawn text from the start of the element
/// whose first row is `row`, and whose drawn text is `visible`, to where `at`
/// is drawn. A row past the element's drawn rows is drawn at its end.
pub fn drawn(
  lines: List(String),
  row row: Int,
  visible visible: String,
  at at: Position,
) -> String {
  let drawn_rows = string.split(visible, "\n")
  let index = at.row - row
  case list.drop(drawn_rows, index), index < 0 {
    _, True -> ""
    [], False -> visible
    [here, ..], False -> {
      let line = lines |> list.drop(at.row) |> list.first |> result.unwrap("")
      let typed = string.to_graphemes(line)
      let before =
        unmatch(typed, string.to_graphemes(here), at.col, [])
        |> list.reverse
        |> string.concat
      string.join(list.append(list.take(drawn_rows, index), [before]), "\n")
    }
  }
}

fn unmatch(
  line: List(String),
  visible: List(String),
  left: Int,
  taken: List(String),
) -> List(String) {
  case line, visible {
    _, _ if left <= 0 -> taken
    _, [] | [], _ -> taken
    [typed, ..line], [drawn, ..visible] if typed == drawn ->
      unmatch(line, visible, left - 1, [drawn, ..taken])
    [_, ..line], _ -> unmatch(line, visible, left - 1, taken)
  }
}

/// One character drawn on the page from `at`, along its row, past the marks
/// the page does not draw: forward to just after the next drawn character,
/// back to just after the drawn character before the last. Past the end or
/// the start of the row, to the row beyond. `row` and `visible` are as for
/// `drawn`, for the element `at` is drawn in.
pub fn nudge(
  lines: List(String),
  row row: Int,
  visible visible: String,
  at at: Position,
  forward forward: Bool,
) -> Position {
  let line = fn(at_row) {
    case at_row >= 0 {
      True -> lines |> list.drop(at_row) |> list.first
      False -> Error(Nil)
    }
  }
  let index = at.row - row
  let here = case index >= 0 {
    True -> string.split(visible, "\n") |> list.drop(index) |> list.first
    False -> Error(Nil)
  }
  let typed = line(at.row) |> result.unwrap("") |> string.to_graphemes
  let length = list.length(typed)
  let drawn = here |> result.unwrap("") |> string.to_graphemes
  case forward, line(at.row + 1), line(at.row - 1) {
    True, Ok(_), _ if at.col >= length -> Position(row: at.row + 1, col: 0)
    False, _, Ok(above) if at.col <= 0 ->
      Position(row: at.row - 1, col: string.length(above))
    True, _, _ -> {
      let #(typed, drawn, _) = walk(typed, drawn, 0, at.col, 0)
      Position(..at, col: next_drawn(typed, drawn, int.max(at.col, 0)))
    }
    False, _, _ -> {
      let #(_, _, last) = walk(typed, drawn, 0, at.col, 0)
      Position(..at, col: last)
    }
  }
}

/// Matches `typed` against `drawn` the way `column` does, up to column
/// `until`: what is left of each, and the column of the last character
/// matched, or 0.
fn walk(
  typed: List(String),
  drawn: List(String),
  col: Int,
  until: Int,
  last: Int,
) -> #(List(String), List(String), Int) {
  case typed, drawn {
    _, _ if col >= until -> #(typed, drawn, last)
    [], _ -> #(typed, drawn, last)
    [one, ..typed], [next, ..rest] if one == next ->
      walk(typed, rest, col + 1, until, col)
    [_, ..typed], _ -> walk(typed, drawn, col + 1, until, last)
  }
}

/// The column just after the next character of `drawn` in `typed`, or the
/// end of `typed` when nothing more of it is drawn.
fn next_drawn(typed: List(String), drawn: List(String), col: Int) -> Int {
  case typed, drawn {
    [one, ..], [next, ..] if one == next -> col + 1
    [_, ..typed], [_, ..] -> next_drawn(typed, drawn, col + 1)
    [], _ -> col
    _, [] -> col + list.length(typed)
  }
}
