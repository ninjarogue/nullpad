//// Imported by: `editor`, `surface`, tests. Imports: `markdown`, `buffer`.

import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/string
import nullpad/buffer.{type Position, Position}
import nullpad/markdown.{
  type Block, type Item, type Level, type Task, Block, BulletList, CodeBlock,
  Heading, Item, OrderedList, Paragraph, Quote, Rule, Table, Task,
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
/// source row further down. `at_end` asks for the end of that row. `next`
/// is the drawn character after the click, "\n" at the end of its row, or
/// "" when the browser named none, as beside the text in the gutter where a
/// list item's marker is drawn: the marks the page hides there go with the
/// characters around them as for `nudge`, and with none they stay after the
/// click. The marks before it that hold the `|` starting its table cell go
/// with it too.
pub fn position(
  lines: List(String),
  row row: Int,
  visible visible: String,
  at_end at_end: Bool,
  next next: String,
) -> Position {
  let drawn_rows = string.split(visible, "\n")
  let row = row + list.length(drawn_rows) - 1
  let line = lines |> list.drop(int.max(row, 0)) |> list.first
  case line, at_end {
    Error(Nil), _ -> buffer.end_of(string.join(lines, "\n"))
    Ok(line), True -> Position(row:, col: string.length(line))
    Ok(line), False -> {
      let drawn = list.last(drawn_rows) |> result.unwrap("")
      let col = column(line, after: drawn)
      let before = string.last(drawn) |> option.from_result
      let rest = string.to_graphemes(line) |> list.drop(col)
      let col = case next {
        "" -> col
        "\n" -> col + list.length(rest)
        _ ->
          case closes(before, next) {
            True -> skip_to(rest, next, col)
            False -> col + cell_start(string.drop_start(line, col), next)
          }
      }
      Position(row:, col:)
    }
  }
}

/// How far into `rest` the cell that the drawn character `next` starts
/// begins, when the marks before `next` hold a cell's `|`.
fn cell_start(rest: String, next: String) -> Int {
  case next, string.split_once(rest, next) {
    "", _ | _, Error(Nil) -> 0
    _, Ok(#(marks, _)) ->
      case string.contains(marks, "|") {
        True -> string.length(marks)
        False -> 0
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

/// Where `at` lands when it is among marks the page hides between two drawn
/// characters, or before the end of its row: where `position` puts a click
/// on the place they are drawn at, so that a selection painted there holds
/// what it shows. The marks a row starts with keep every place among them.
/// `row` and `visible` are as for `drawn`.
pub fn settle(
  lines: List(String),
  row row: Int,
  visible visible: String,
  at at: Position,
) -> Position {
  let line = lines |> list.drop(at.row) |> list.first
  let here = case at.row >= row {
    True -> string.split(visible, "\n") |> list.drop(at.row - row) |> list.first
    False -> Error(Nil)
  }
  case line, here {
    Ok(line), Ok(here) -> {
      let shown =
        shown(string.to_graphemes(line), string.to_graphemes(here), [])
      let #(before, after) = list.split(shown, at.col)
      let start = at.col - hidden_run(list.reverse(before), 0)
      let end = at.col + hidden_run(after, 0)
      case start > 0 && start < end {
        True -> {
          let typed = string.to_graphemes(line)
          let next =
            typed |> list.drop(end) |> list.first |> result.unwrap("\n")
          let place = drawn(lines, row:, visible:, at: Position(at.row, start))
          position(lines, row:, visible: place, at_end: False, next:)
        }
        False -> at
      }
    }
    _, _ -> at
  }
}

/// Whether each character of `line` is drawn, matched as `drawn` matches.
fn shown(
  line: List(String),
  visible: List(String),
  taken: List(Bool),
) -> List(Bool) {
  case line, visible {
    [], _ -> list.reverse(taken)
    [typed, ..line], [drawn, ..rest] if typed == drawn ->
      shown(line, rest, [True, ..taken])
    [_, ..line], _ -> shown(line, visible, [False, ..taken])
  }
}

fn hidden_run(shown: List(Bool), count: Int) -> Int {
  case shown {
    [False, ..shown] -> hidden_run(shown, count + 1)
    _ -> count
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
/// back to just before the last. Marks between two drawn characters go with
/// the one before them when they close what it is in, and with the one after
/// them when they open what it is in, so a selection that ends there holds
/// both marks of a pair or neither. Past the end or the start of the row, to
/// the row beyond. `row` and `visible` are as for `drawn`, for the element
/// `at` is drawn in.
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
      let #(typed, drawn) = walk(typed, drawn, 0, at.col)
      Position(..at, col: next_drawn(typed, drawn, int.max(at.col, 0)))
    }
    False, _, _ ->
      Position(..at, col: last_drawn(typed, drawn, 0, at.col, None, None))
  }
}

fn walk(
  typed: List(String),
  drawn: List(String),
  col: Int,
  until: Int,
) -> #(List(String), List(String)) {
  case typed, drawn {
    _, _ if col >= until -> #(typed, drawn)
    [], _ -> #(typed, drawn)
    [one, ..typed], [next, ..rest] if one == next ->
      walk(typed, rest, col + 1, until)
    [_, ..typed], _ -> walk(typed, drawn, col + 1, until)
  }
}

fn next_drawn(typed: List(String), drawn: List(String), col: Int) -> Int {
  case typed, drawn {
    [one, ..typed], [next, ..drawn] if one == next ->
      case drawn {
        [] -> col + 1 + list.length(typed)
        [after, ..] ->
          case closes(Some(one), after) {
            True -> skip_to(typed, after, col + 1)
            False -> col + 1
          }
      }
    [_, ..typed], [_, ..] -> next_drawn(typed, drawn, col + 1)
    [], _ -> col
    _, [] -> col + list.length(typed)
  }
}

/// The column of the next `drawn` in `typed`, or `col` when there is none.
fn skip_to(typed: List(String), drawn: String, col: Int) -> Int {
  skip(typed, drawn, col, col)
}

fn skip(typed: List(String), drawn: String, col: Int, from: Int) -> Int {
  case typed {
    [one, ..] if one == drawn -> col
    [_, ..typed] -> skip(typed, drawn, col + 1, from)
    [] -> from
  }
}

/// `last` and `before` are the last two drawn characters passed, with their
/// columns.
fn last_drawn(
  typed: List(String),
  drawn: List(String),
  col: Int,
  until: Int,
  last: Option(#(Int, String)),
  before: Option(#(Int, String)),
) -> Int {
  case typed, drawn {
    [one, ..typed], [next, ..drawn] if one == next && col < until ->
      last_drawn(typed, drawn, col + 1, until, Some(#(col, one)), last)
    [_, ..typed], _ if col < until ->
      last_drawn(typed, drawn, col + 1, until, last, before)
    _, _ ->
      case last, before {
        None, _ -> 0
        Some(#(at, _)), None -> at
        Some(#(at, one)), Some(#(left, previous)) ->
          case closes(Some(previous), one) {
            True -> at
            False -> left + 1
          }
      }
  }
}

/// Whether the marks between two drawn characters close what the first is
/// in, judged the way CommonMark tells a closing run from an opening one: a
/// run before a space or a punctuation mark closes, a run after a space
/// opens. At the start of a row the marks before the first character go
/// with it.
fn closes(before: Option(String), after: String) -> Bool {
  case before {
    _ if after == " " || after == "\t" -> True
    None -> True
    Some(" ") | Some("\t") -> False
    Some(_) -> string.contains(punctuation, after)
  }
}

const punctuation = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"

/// The blocks as drawn, after the rows `from` became the rows `to`, which
/// start at the same row: the rows below move with them, and the rows that
/// went are taken to the last row of `to`.
pub fn shift(
  blocks: List(Block),
  from from: Region,
  to to: Region,
) -> List(Block) {
  let move = fn(row) {
    case row > from.last_row {
      True -> row + to.last_row - from.last_row
      False -> int.min(row, to.last_row)
    }
  }
  list.map(blocks, shift_block(_, move))
}

fn shift_block(block: Block, move: fn(Int) -> Int) -> Block {
  let content = case block.content {
    BulletList(spacing:, items:) ->
      BulletList(spacing:, items: list.map(items, shift_item(_, move)))
    OrderedList(start:, spacing:, items:) ->
      OrderedList(start:, spacing:, items: list.map(items, shift_item(_, move)))
    Quote(blocks:) -> Quote(list.map(blocks, shift_block(_, move)))
    CodeBlock(language:, code:, code_row:) ->
      CodeBlock(language:, code:, code_row: move(code_row))
    Heading(..) | Paragraph(..) | Rule | Table(..) -> block.content
  }
  Block(
    first_row: move(block.first_row),
    last_row: move(block.last_row),
    content:,
  )
}

fn shift_item(item: Item, move: fn(Int) -> Int) -> Item {
  Item(
    ..item,
    row: move(item.row),
    task: option.map(item.task, fn(task) { Task(..task, row: move(task.row)) }),
    blocks: list.map(item.blocks, shift_block(_, move)),
  )
}

/// The blocks with the box at the row and column of `task` ticked or not.
pub fn tick(blocks: List(Block), task: Task, checked: Bool) -> List(Block) {
  list.map(blocks, tick_block(_, task, checked))
}

fn tick_block(block: Block, task: Task, checked: Bool) -> Block {
  let content = case block.content {
    BulletList(spacing:, items:) ->
      BulletList(spacing:, items: list.map(items, tick_item(_, task, checked)))
    OrderedList(start:, spacing:, items:) ->
      OrderedList(
        start:,
        spacing:,
        items: list.map(items, tick_item(_, task, checked)),
      )
    Quote(blocks:) -> Quote(tick(blocks, task, checked))
    CodeBlock(..) | Heading(..) | Paragraph(..) | Rule | Table(..) ->
      block.content
  }
  Block(..block, content:)
}

fn tick_item(item: Item, task: Task, checked: Bool) -> Item {
  let box = case item.task {
    option.Some(Task(row:, col:, ..)) if row == task.row && col == task.col ->
      option.Some(Task(row:, col:, checked:))
    box -> box
  }
  Item(..item, task: box, blocks: tick(item.blocks, task, checked))
}
