//// Imported by: `editor`, `surface`, tests. Imports: `markdown`, `buffer`.

import gleam/dict.{type Dict}
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
/// `from` to row `to`: those rows, widened to every leaf they touch. A leaf
/// is a block that holds no blocks, at any depth: a heading, a paragraph, a
/// code block, a table or a rule. A row in no leaf, such as a blank row or
/// a quote's empty row, stands alone.
pub fn reveal(blocks: List(Block), from from: Int, to to: Int) -> Region {
  let #(from, to) = #(int.min(from, to), int.max(from, to))
  use region, Placed(leaf:, ..) <- list.fold(
    placed(blocks, []),
    Region(from, to),
  )
  case leaf.last_row < from || leaf.first_row > to {
    True -> region
    False ->
      Region(
        first_row: int.min(region.first_row, leaf.first_row),
        last_row: int.max(region.last_row, leaf.last_row),
      )
  }
}

/// A leaf, and the quotes and items around it, the innermost first.
type Placed {
  Placed(leaf: Block, around: List(Around))
}

type Around {
  InQuote
  InItem(Item)
}

fn placed(blocks: List(Block), around: List(Around)) -> List(Placed) {
  use block <- list.flat_map(blocks)
  case block.content {
    Quote(blocks:) -> placed(blocks, [InQuote, ..around])
    BulletList(items:, ..) | OrderedList(items:, ..) ->
      list.flat_map(items, fn(item) {
        placed(item.blocks, [InItem(item), ..around])
      })
    Heading(..) | Paragraph(..) | CodeBlock(..) | Rule | Table(..) -> [
      Placed(block, around),
    ]
  }
}

fn items_in(blocks: List(Block)) -> List(Item) {
  use block <- list.flat_map(blocks)
  case block.content {
    Quote(blocks:) -> items_in(blocks)
    BulletList(items:, ..) | OrderedList(items:, ..) ->
      list.flat_map(items, fn(item) { [item, ..items_in(item.blocks)] })
    Heading(..) | Paragraph(..) | CodeBlock(..) | Rule | Table(..) -> []
  }
}

/// The last row of every item at any depth, by the row and column it starts
/// at: what `cut` keeps of an item may end before the item does.
pub fn item_ends(blocks: List(Block)) -> Dict(#(Int, Int), Int) {
  items_in(blocks)
  |> list.map(fn(item) { #(#(item.row, item.content_col), item_last_row(item)) })
  |> dict.from_list
}

fn item_last_row(item: Item) -> Int {
  use last, block <- list.fold(item.blocks, item.row)
  int.max(last, block.last_row)
}

/// What the page draws of `blocks` for the rows `from` up to `to`, beside
/// the field that holds the rows `field`: every block wholly inside the run,
/// the leaves the field holds, and every quote, list and item that runs past
/// the run or holds the field, with only those of its blocks and items. An
/// ordered list keeps the number of the first item it keeps.
pub fn cut(
  blocks: List(Block),
  from from: Int,
  to to: Int,
  field field: Option(Region),
) -> List(Block) {
  let within = fn(first_row, last_row) {
    first_row >= from
    && last_row < to
    || case field {
      Some(Region(held_first, held_last)) ->
        first_row >= held_first && last_row <= held_last
      None -> False
    }
  }
  let touches = fn(first_row, last_row) {
    first_row < to
    && last_row >= from
    || case field {
      Some(Region(held_first, held_last)) ->
        first_row <= held_last && last_row >= held_first
      None -> False
    }
  }
  prune(blocks, within, touches)
}

fn prune(
  blocks: List(Block),
  within: fn(Int, Int) -> Bool,
  touches: fn(Int, Int) -> Bool,
) -> List(Block) {
  use block <- list.filter_map(blocks)
  let items = fn(items: List(Item)) {
    let kept =
      list.map(items, fn(item) {
        let last_row = item_last_row(item)
        case within(item.row, last_row), touches(item.row, last_row) {
          True, _ -> Ok(item)
          False, True ->
            Ok(Item(..item, blocks: prune(item.blocks, within, touches)))
          False, False -> Error(Nil)
        }
      })
    let skipped = list.length(list.take_while(kept, result.is_error))
    #(skipped, result.values(kept))
  }
  case
    within(block.first_row, block.last_row),
    touches(block.first_row, block.last_row),
    block.content
  {
    True, _, _ -> Ok(block)
    False, False, _ -> Error(Nil)
    False, True, Quote(blocks:) ->
      Ok(Block(..block, content: Quote(prune(blocks, within, touches))))
    False, True, BulletList(spacing:, items: listed) ->
      Ok(Block(..block, content: BulletList(spacing:, items: items(listed).1)))
    False, True, OrderedList(start:, spacing:, items: listed) -> {
      let #(skipped, kept) = items(listed)
      Ok(Block(..block, content: OrderedList(start + skipped, spacing, kept)))
    }
    False, True, Heading(..)
    | False, True, Paragraph(..)
    | False, True, CodeBlock(..)
    | False, True, Rule
    | False, True, Table(..)
    -> Error(Nil)
  }
}

/// `drawn`, with the rows `rows` laid out as `typed` lays them out: the
/// blocks `typed` has wholly inside them, in the quote or item of `drawn`
/// that holds them. `drawn` stays as it is where `typed` runs a block or a
/// different quote or list across the edge of those rows.
pub fn lay(
  drawn: List(Block),
  typed typed: List(Block),
  rows rows: Region,
) -> List(Block) {
  result.unwrap(lay_in(drawn, typed, rows), drawn)
}

fn lay_in(
  drawn: List(Block),
  typed: List(Block),
  rows: Region,
) -> Result(List(Block), Nil) {
  let inside = fn(block: Block) {
    block.first_row >= rows.first_row && block.last_row <= rows.last_row
  }
  let crosses = fn(block: Block) {
    !inside(block)
    && block.first_row <= rows.last_row
    && block.last_row >= rows.first_row
  }
  case list.find(drawn, crosses), list.find(typed, crosses) {
    Error(Nil), Error(Nil) -> {
      let #(before, rest) =
        list.split_while(drawn, fn(block) { block.last_row < rows.first_row })
      let after = list.filter(rest, fn(block) { !inside(block) })
      Ok(list.flatten([before, list.filter(typed, inside), after]))
    }
    Ok(outer), Ok(typed_outer) -> {
      use content <- result.map(lay_content(outer, typed_outer, rows))
      list.map(drawn, fn(block) {
        case block == outer {
          True -> Block(..block, content:)
          False -> block
        }
      })
    }
    Ok(_), Error(Nil) | Error(Nil), Ok(_) -> Error(Nil)
  }
}

fn lay_content(
  drawn: Block,
  typed: Block,
  rows: Region,
) -> Result(markdown.Content, Nil) {
  let holds = fn(item: Item) {
    item.row <= rows.first_row && item_last_row(item) >= rows.last_row
  }
  let lay_items = fn(items: List(Item), typed_items: List(Item)) {
    case list.find(items, holds), list.find(typed_items, holds) {
      Ok(item), Ok(typed_item) -> {
        use blocks <- result.map(lay_in(item.blocks, typed_item.blocks, rows))
        list.map(items, fn(each) {
          case each == item {
            True -> Item(..item, blocks:)
            False -> each
          }
        })
      }
      _, _ -> Error(Nil)
    }
  }
  case drawn.content, typed.content {
    Quote(blocks), Quote(typed_blocks) ->
      result.map(lay_in(blocks, typed_blocks, rows), Quote)
    BulletList(spacing, items), BulletList(_, typed_items) ->
      result.map(lay_items(items, typed_items), BulletList(spacing, _))
    OrderedList(start, spacing, items), OrderedList(_, _, typed_items) ->
      result.map(lay_items(items, typed_items), OrderedList(start, spacing, _))
    Quote(..), _
    | BulletList(..), _
    | OrderedList(..), _
    | Heading(..), _
    | Paragraph(..), _
    | CodeBlock(..), _
    | Rule, _
    | Table(..), _
    -> Error(Nil)
  }
}

pub type Kind {
  Body
  Title(Level)
  Mono
  ListItem(marker: String)
  ItemTitle(Level, marker: String)
}

/// Whether a row of this kind is drawn at a heading's size.
pub fn is_title(kind: Kind) -> Bool {
  case kind {
    Title(_) | ItemTitle(..) -> True
    Body | Mono | ListItem(..) -> False
  }
}

/// How the field is set while it holds the rows `field`: like the one leaf
/// it holds. A leaf on the row of the item it starts, at any depth, is set
/// as that item's line, with that item's marker, unless it is fenced code
/// or a table. A field with leaves of one
/// list is set like the first, and one with other leaves as body text. A
/// field with no leaf is body text, or the line of the item whose row it is.
pub fn kind(
  blocks: List(Block),
  field field: Region,
  lines lines: List(String),
) -> Kind {
  let held = fn(first_row, last_row) {
    first_row <= field.last_row && last_row >= field.first_row
  }
  let leaves =
    list.filter(placed(blocks, []), fn(placed) {
      held(placed.leaf.first_row, placed.leaf.last_row)
    })
  let tops =
    list.filter(blocks, fn(block) { held(block.first_row, block.last_row) })
  case leaves, tops {
    [one], _ -> leaf_kind(one, lines)
    [first, _, ..], [Block(content: BulletList(..), ..)]
    | [first, _, ..], [Block(content: OrderedList(..), ..)]
    -> leaf_kind(first, lines)
    [_, _, ..], _ -> Body
    [], _ ->
      case
        field.first_row == field.last_row,
        list.filter(items_in(blocks), fn(item) { item.row == field.first_row })
        |> list.last
      {
        True, Ok(item) -> item_kind(item, lines)
        True, Error(Nil) | False, _ -> Body
      }
  }
}

fn leaf_kind(placed: Placed, lines: List(String)) -> Kind {
  let Placed(leaf:, around:) = placed
  let own = case around {
    [InItem(item), ..] if item.row == leaf.first_row -> Ok(item)
    [InItem(_), ..] | [InQuote, ..] | [] -> Error(Nil)
  }
  case leaf.content, own {
    Heading(level:, text: [_, ..]), Ok(item) ->
      ItemTitle(level, marker: marker(lines, item))
    Heading(level:, text: [_, ..]), Error(Nil) -> Title(level)
    CodeBlock(code_row:, ..), Ok(item) if code_row == leaf.first_row ->
      item_kind(item, lines)
    CodeBlock(..), _ | Table(..), _ -> Mono
    Heading(..), Ok(item)
    | Paragraph(..), Ok(item)
    | Rule, Ok(item)
    | BulletList(..), Ok(item)
    | OrderedList(..), Ok(item)
    | Quote(..), Ok(item)
    -> item_kind(item, lines)
    Heading(..), Error(Nil)
    | Paragraph(..), Error(Nil)
    | Rule, Error(Nil)
    | BulletList(..), Error(Nil)
    | OrderedList(..), Error(Nil)
    | Quote(..), Error(Nil)
    -> Body
  }
}

fn item_kind(item: Item, lines: List(String)) -> Kind {
  ListItem(marker: marker(lines, item))
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

/// Whether the page hides the character before `at`, which is then drawn at
/// the start of the drawn text after it, such as the start of a table cell,
/// rather than the end of the text before it. `row` and `visible` are as
/// for `drawn`.
pub fn follows_hidden(
  lines: List(String),
  row row: Int,
  visible visible: String,
  at at: Position,
) -> Bool {
  let line = lines |> list.drop(at.row) |> list.first
  let here = case at.row >= row && at.col > 0 {
    True -> string.split(visible, "\n") |> list.drop(at.row - row) |> list.first
    False -> Error(Nil)
  }
  case line, here {
    Ok(line), Ok(here) ->
      shown(string.to_graphemes(line), string.to_graphemes(here), [])
      |> list.drop(at.col - 1)
      |> list.first
      == Ok(False)
    _, _ -> False
  }
}

/// Where `at` lands when it is among or beside marks the page hides between
/// two drawn characters, which all draw at one place: the place among them
/// nearest `at` where the line, cut there and at `other` when it is on the
/// same row, draws what it draws whole. A selection between the two then
/// holds both marks of a pair or neither, as the parser pairs them. With no
/// such place, `at` stays. `row` and `visible` are as for `drawn`.
pub fn settle(
  lines: List(String),
  row row: Int,
  visible visible: String,
  at at: Position,
  other other: Position,
) -> Position {
  let line = lines |> list.drop(at.row) |> list.first
  let here = case at.row >= row {
    True -> string.split(visible, "\n") |> list.drop(at.row - row) |> list.first
    False -> Error(Nil)
  }
  case line, here {
    Ok(line), Ok(here) -> {
      let typed = string.to_graphemes(line)
      let #(before, after) =
        shown(typed, string.to_graphemes(here), []) |> list.split(at.col)
      let start = at.col - hidden_run(list.reverse(before), 0)
      let end = at.col + hidden_run(after, 0)
      let whole = markdown.inline_text(line)
      let cuts = case other.row == at.row {
        True -> [other.col]
        False -> []
      }
      let whole_at = fn(col) {
        split_at(typed, list.sort([col, ..cuts], int.compare), 0, [])
        |> list.map(markdown.inline_text)
        |> string.concat
        == whole
      }
      case start < end {
        True -> Position(..at, col: nearest(at.col, 0, start, end, whole_at))
        False -> at
      }
    }
    _, _ -> at
  }
}

/// The pieces of `typed` between the columns `at`, in order.
fn split_at(
  typed: List(String),
  at: List(Int),
  col: Int,
  pieces: List(String),
) -> List(String) {
  case at {
    [] -> list.reverse([string.concat(typed), ..pieces])
    [next, ..rest] -> {
      let #(piece, typed) = list.split(typed, int.max(next - col, 0))
      split_at(typed, rest, int.max(next, col), [string.concat(piece), ..pieces])
    }
  }
}

/// The column from `start` to `end` nearest `from` that is `fine`, the one
/// before it first, or `from` when none is.
fn nearest(
  from: Int,
  away: Int,
  start: Int,
  end: Int,
  fine: fn(Int) -> Bool,
) -> Int {
  let before = from - away
  let after = from + away
  case before < start && after > end {
    True -> from
    False ->
      case before >= start && fine(before), after <= end && fine(after) {
        True, _ -> before
        False, True -> after
        False, False -> nearest(from, away + 1, start, end, fine)
      }
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
