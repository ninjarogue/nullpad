//// Imported by: `editor`, `surface`, tests. Imports: `markdown`, `buffer`.

import gleam/int
import gleam/list
import gleam/option.{None}
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
  ItemTitle(Level, marker: String)
  QuoteTitle(Level, in_item: Bool)
}

/// Whether a row of this kind is drawn at a heading's size.
pub fn is_title(kind: Kind) -> Bool {
  case kind {
    Title(_) | ItemTitle(..) | QuoteTitle(..) -> True
    Body | Mono | ListItem(..) -> False
  }
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
          case first.task, heading_in(first.blocks, field, False) {
            None, Ok(#(level, _)) ->
              ItemTitle(level, marker: marker(lines, first))
            _, _ ->
              ListItem(
                task: option.is_some(first.task),
                marker: marker(lines, first),
              )
          }
        Error(Nil) -> Body
      }
    [Block(content: Quote(blocks:), ..)] ->
      case heading_in(blocks, field, False) {
        Ok(#(level, in_item)) -> QuoteTitle(level, in_item:)
        Error(Nil) -> Body
      }
    _ -> Body
  }
}

/// The level of the heading that fills the field, inside a quote or an item,
/// and whether an item holds it. A field of several rows is set as one block,
/// so a heading must hold them all.
fn heading_in(
  blocks: List(Block),
  field: Region,
  in_item: Bool,
) -> Result(#(Level, Bool), Nil) {
  let held = fn(first_row, last_row) {
    first_row <= field.last_row && last_row >= field.first_row
  }
  case
    list.filter(blocks, fn(block) { held(block.first_row, block.last_row) })
  {
    [Block(content: Heading(level:, ..), first_row:, last_row:)]
      if first_row <= field.first_row && last_row >= field.last_row
    -> Ok(#(level, in_item))
    [Block(content: Quote(blocks:), ..)] -> heading_in(blocks, field, in_item)
    [Block(content: BulletList(items:, ..), ..)]
    | [Block(content: OrderedList(items:, ..), ..)] ->
      case list.find(items, fn(item) { held(item.row, item_last_row(item)) }) {
        Ok(item) -> heading_in(item.blocks, field, True)
        Error(Nil) -> Error(Nil)
      }
    _ -> Error(Nil)
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
/// is the drawn character after the click, or "" when there is none: the
/// marks the page hides before it go with it when they hold the `|` that
/// starts its table cell.
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
      Position(row:, col: col + cell_start(string.drop_start(line, col), next))
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
