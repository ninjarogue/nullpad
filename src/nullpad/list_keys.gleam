//// Enter, Tab and Shift+Tab in a list item, as editors that write markdown
//// have them. Enter starts the next item. On an empty item it ends the list,
//// or moves a nested item out a level. Tab nests an item under the one above
//// it, and Shift+Tab moves it back out. Numbered items after the change are
//// numbered again, so the markdown reads as the page does.
////
//// Imported by: `editor`. Imports: `buffer`, `markdown`.

import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/string
import nullpad/buffer.{type Buffer, type Position, Position}
import nullpad/markdown.{
  type Block, type Item, type ItemMarks, type Mark, Block, BulletList,
  BulletMark, CodeBlock, Heading, ItemMarks, NumberMark, OrderedList, Paragraph,
  Quote, Rule, Table,
}

pub type Key {
  NewItem
  Indent
  Outdent
}

/// `buffer` after `key`, with `blocks` parsed from it. `Error` when the key
/// has nothing to do in a list there, so it does what it does elsewhere.
/// A selection on one row is typed over by Enter, and moves with its item on
/// Tab and Shift+Tab.
pub fn press(
  buffer: Buffer,
  blocks: List(Block),
  key: Key,
) -> Result(Buffer, Nil) {
  let #(anchor, head) = buffer.selection(buffer)
  let lines = buffer.lines(buffer)
  case anchor.row == head.row, holding(blocks, head.row, []) {
    True, Held(chain: [here, ..parents], in_code: False) ->
      case key {
        NewItem -> {
          let from = Position(..head, col: int.min(anchor.col, head.col))
          let to = Position(..head, col: int.max(anchor.col, head.col))
          new_item(lines, from, to, here, parents)
        }
        Indent -> indent(lines, #(anchor, head), here)
        Outdent -> outdent(lines, #(anchor, head), here, parents)
      }
    _, _ -> Error(Nil)
  }
}

/// An item that holds the caret's row, and the items around it in its list.
type Level {
  Level(item: Item, previous: Option(Item), following: List(Item))
}

type Held {
  /// The items that hold the row, the innermost first.
  Held(chain: List(Level), in_code: Bool)
}

fn holding(blocks: List(Block), row: Int, chain: List(Level)) -> Held {
  let found =
    list.find(blocks, fn(block) {
      block.first_row <= row && row <= block.last_row
    })
  case found {
    Ok(Block(content: BulletList(items:, ..), ..))
    | Ok(Block(content: OrderedList(items:, ..), ..)) ->
      case item_holding(items, row, None) {
        Ok(level) -> holding(level.item.blocks, row, [level, ..chain])
        Error(Nil) -> Held(chain, False)
      }
    Ok(Block(content: Quote(blocks:), ..)) -> holding(blocks, row, chain)
    Ok(Block(content: CodeBlock(..), ..)) | Ok(Block(content: Table(..), ..)) ->
      Held(chain, True)
    Ok(Block(content: Heading(..), ..))
    | Ok(Block(content: Paragraph(..), ..))
    | Ok(Block(content: Rule, ..))
    | Error(Nil) -> Held(chain, False)
  }
}

fn item_holding(
  items: List(Item),
  row: Int,
  previous: Option(Item),
) -> Result(Level, Nil) {
  case items {
    [] -> Error(Nil)
    [item, ..rest] ->
      case item.row <= row && row <= last_row(item) {
        True -> Ok(Level(item, previous, rest))
        False -> item_holding(rest, row, Some(item))
      }
  }
}

fn last_row(item: Item) -> Int {
  use last, block <- list.fold(item.blocks, item.row)
  int.max(last, block.last_row)
}

fn marks_of(lines: List(String), item: Item) -> Result(ItemMarks, Nil) {
  markdown.item_marks(line(lines, item.row), item)
}

fn new_item(
  lines: List(String),
  from: Position,
  to: Position,
  here: Level,
  parents: List(Level),
) -> Result(Buffer, Nil) {
  let item = here.item
  use marks <- result.try(marks_of(lines, item))
  let on_item_row = from.row == item.row
  let empty = item.blocks == [] && on_item_row
  case on_item_row && from.col == 0, empty, parents {
    True, _, _ -> Error(Nil)
    False, True, [parent, ..] -> {
      use outer <- result.map(marks_of(lines, parent.item))
      let mark = next(outer.mark)
      let row = markdown.carry(outer.lead) <> marker(outer, mark, parent.item)
      lines
      |> renumber(parent.following, after: mark)
      |> set_rows(from.row, [row])
    }
    False, True, [] -> {
      let carried = markdown.carry(marks.lead)
      Ok(set_rows(lines, from.row, [string.trim_end(carried), carried]))
    }
    False, False, _ -> {
      let words = case on_item_row {
        True -> item.content_col
        False -> 0
      }
      let from = Position(..from, col: int.max(from.col, words))
      let to = Position(..to, col: int.max(to.col, words))
      let row = line(lines, from.row)
      let kept_before =
        string.slice(row, 0, from.col)
        |> string.trim_end
        |> string.length
        |> int.max(words)
      let rest = string.drop_start(row, to.col)
      let kept_after =
        string.length(rest) - string.length(string.trim_start(rest))
      let mark = next(marks.mark)
      let prefix = markdown.carry(marks.lead) <> marker(marks, mark, item)
      lines
      |> renumber(here.following, after: mark)
      |> widen(from.row + 1, last_row(item), marks, mark)
      |> string.join("\n")
      |> buffer.from_text
      |> buffer.replace(
        from: Position(..from, col: kept_before),
        to: Position(..to, col: to.col + kept_after),
        with: "\n" <> prefix,
      )
      |> Ok
    }
  }
}

fn next(mark: Mark) -> Mark {
  case mark {
    BulletMark(_) -> mark
    NumberMark(number:, delimiter:) -> NumberMark(number + 1, delimiter)
  }
}

/// `mark` with the spaces after it, and an unticked box when `item` is a
/// task.
fn marker(marks: ItemMarks, mark: Mark, item: Item) -> String {
  let box = case item.task {
    Some(_) -> "[ ] "
    None -> ""
  }
  markdown.mark_text(mark) <> string.repeat(" ", int.max(marks.gap, 1)) <> box
}

/// Numbers `items` on from the number after `mark`, when they are numbered.
fn renumber(
  lines: List(String),
  items: List(Item),
  after mark: Mark,
) -> List(String) {
  case mark {
    BulletMark(_) -> lines
    NumberMark(number:, ..) -> {
      let numbered =
        list.index_map(items, fn(item, index) { #(item, number + 1 + index) })
      use lines, #(item, number) <- list.fold(numbered, lines)
      case marks_of(lines, item) {
        Ok(marks) -> {
          let mark = case marks.mark {
            NumberMark(delimiter:, ..) -> NumberMark(number, delimiter)
            BulletMark(_) -> marks.mark
          }
          let row = remark(line(lines, item.row), marks, mark)
          replace_row(lines, item.row, row)
          |> widen(item.row + 1, last_row(item), marks, mark)
        }
        Error(Nil) -> lines
      }
    }
  }
}

/// Rows `first` to `last` move as far as an item's words do when its marker
/// becomes `mark`, so what is nested in the item stays nested.
fn widen(
  lines: List(String),
  first: Int,
  last: Int,
  marks: ItemMarks,
  mark: Mark,
) -> List(String) {
  let by =
    string.length(markdown.mark_text(mark))
    - string.length(markdown.mark_text(marks.mark))
  let at = string.length(marks.lead)
  use text, row <- list.index_map(lines)
  case by == 0 || row < first || row > last || string.trim(text) == "" {
    True -> text
    False -> {
      let after = string.drop_start(text, at)
      let after = case by > 0 {
        True -> string.repeat(" ", by) <> after
        False -> drop_spaces(after, -by)
      }
      string.slice(text, 0, at) <> after
    }
  }
}

fn remark(row: String, marks: ItemMarks, mark: Mark) -> String {
  let at = string.length(marks.lead)
  let old = string.length(markdown.mark_text(marks.mark))
  string.slice(row, 0, at)
  <> markdown.mark_text(mark)
  <> string.drop_start(row, at + old)
}

fn indent(
  lines: List(String),
  selection: #(Position, Position),
  here: Level,
) -> Result(Buffer, Nil) {
  use previous <- result.try(option.to_result(here.previous, Nil))
  use marks <- result.try(marks_of(lines, here.item))
  use above <- result.try(marks_of(lines, previous))
  let at = string.length(marks.lead)
  let by = words_col(above) - at
  case by > 0 {
    False -> Error(Nil)
    True -> {
      let mark = case marks.mark, last_number(previous) {
        BulletMark(_), _ -> marks.mark
        NumberMark(delimiter:, ..), Some(last) ->
          NumberMark(last + 1, delimiter)
        NumberMark(delimiter:, ..), None -> NumberMark(1, delimiter)
      }
      let before = case marks.mark {
        NumberMark(number:, delimiter:) -> NumberMark(number - 1, delimiter)
        BulletMark(_) -> marks.mark
      }
      lines
      |> renumber(here.following, after: before)
      |> shift(selection, here.item, marks, at, by, mark)
      |> Ok
    }
  }
}

fn outdent(
  lines: List(String),
  selection: #(Position, Position),
  here: Level,
  parents: List(Level),
) -> Result(Buffer, Nil) {
  use parent <- result.try(list.first(parents))
  use marks <- result.try(marks_of(lines, here.item))
  use outer <- result.try(marks_of(lines, parent.item))
  let at = string.length(outer.lead)
  let by = string.length(marks.lead) - at
  let blank = string.slice(marks.lead, at, by) |> string.trim == ""
  case by > 0 && blank {
    False -> Error(Nil)
    True -> {
      let mark = case marks.mark, outer.mark {
        NumberMark(delimiter:, ..), NumberMark(number:, ..) ->
          NumberMark(number + 1, delimiter)
        NumberMark(..), BulletMark(_) | BulletMark(_), _ -> marks.mark
      }
      let first = case marks.mark {
        NumberMark(delimiter:, ..) -> NumberMark(0, delimiter)
        BulletMark(_) -> marks.mark
      }
      lines
      |> renumber(here.following, after: first)
      |> renumber(parent.following, after: mark)
      |> shift(selection, here.item, marks, at, -by, mark)
      |> Ok
    }
  }
}

/// The column of the words of an item whose row starts with `marks`.
fn words_col(marks: ItemMarks) -> Int {
  string.length(marks.lead)
  + string.length(markdown.mark_text(marks.mark))
  + int.max(marks.gap, 1)
}

/// The last number of the numbered list that ends `item`, when one does.
fn last_number(item: Item) -> Option(Int) {
  case list.last(item.blocks) {
    Ok(Block(content: OrderedList(start:, items:, ..), ..)) ->
      Some(start + list.length(items) - 1)
    Ok(_) | Error(Nil) -> None
  }
}

/// Moves the rows of `item` right by `by` columns at column `at`, or left
/// when `by` is below 0, and gives its marker `mark`. The selection moves
/// with the text.
fn shift(
  lines: List(String),
  selection: #(Position, Position),
  item: Item,
  marks: ItemMarks,
  at: Int,
  by: Int,
  mark: Mark,
) -> Buffer {
  let last = last_row(item)
  let moved = fn(row, text) {
    case row < item.row || row > last || string.trim(text) == "" {
      True -> text
      False -> {
        let after = string.drop_start(text, at)
        let after = case by >= 0 {
          True -> string.repeat(" ", by) <> after
          False -> drop_spaces(after, -by)
        }
        let text = string.slice(text, 0, at) <> after
        case row == item.row {
          True ->
            remark(
              text,
              ItemMarks(..marks, lead: marks.lead |> resize(by)),
              mark,
            )
          False -> text
        }
      }
    }
  }
  let new_lines = list.index_map(lines, fn(text, row) { moved(row, text) })
  let follow = fn(place: Position) {
    let old_row = line(lines, place.row)
    let new_row = line(new_lines, place.row)
    let change = string.length(new_row) - string.length(old_row)
    case place.col >= at {
      True -> Position(..place, col: int.max(at, place.col + change))
      False -> place
    }
  }
  let #(anchor, head) = selection
  buffer.from_text(string.join(new_lines, "\n"))
  |> buffer.select(anchor: follow(anchor), head: follow(head))
}

fn resize(lead: String, by: Int) -> String {
  string.repeat(" ", int.max(0, string.length(lead) + by))
}

fn drop_spaces(text: String, count: Int) -> String {
  case count, text {
    0, _ -> text
    _, " " <> rest -> drop_spaces(rest, count - 1)
    _, _ -> text
  }
}

fn replace_row(lines: List(String), row: Int, text: String) -> List(String) {
  list.flatten([list.take(lines, row), [text], list.drop(lines, row + 1)])
}

fn set_rows(lines: List(String), row: Int, rows: List(String)) -> Buffer {
  let new_lines =
    list.flatten([list.take(lines, row), rows, list.drop(lines, row + 1)])
  let last = row + list.length(rows) - 1
  buffer.from_text(string.join(new_lines, "\n"))
  |> buffer.move_to(Position(
    row: last,
    col: string.length(line(new_lines, last)),
  ))
}

fn line(lines: List(String), row: Int) -> String {
  list.drop(lines, row) |> list.first |> result.unwrap("")
}
