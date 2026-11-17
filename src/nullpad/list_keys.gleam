//// Enter, Tab and Shift+Tab in a list item, as editors that write markdown
//// have them. Enter starts the next item. On an empty item it ends the list,
//// or moves a nested item out a level. Tab nests an item under the one above
//// it, and Shift+Tab moves it back out.
////
//// Imported by: `editor`. Imports: `buffer`, `markdown`.

import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/string
import nullpad/buffer.{type Buffer, type Position, Position}
import nullpad/markdown.{
  type Block, type Item, type ItemMarks, Block, BulletList, BulletMark,
  CodeBlock, Heading, NumberMark, OrderedList, Paragraph, Quote, Rule, Table,
}

pub type Key {
  NewItem
  Indent
  Outdent
}

/// `buffer` after `key`, with `blocks` parsed from it. `Error` when the key
/// has nothing to do in a list there, so it does what it does elsewhere.
pub fn press(
  buffer: Buffer,
  blocks: List(Block),
  key: Key,
) -> Result(Buffer, Nil) {
  let #(anchor, head) = buffer.selection(buffer)
  let lines = buffer.lines(buffer)
  case anchor == head, holding(blocks, head.row, []) {
    True, Held(chain: [here, ..parents], in_code: False) ->
      case key {
        NewItem -> new_item(lines, head, here, parents)
        Indent -> indent(lines, head, here)
        Outdent -> outdent(lines, head, here, parents)
      }
    _, _ -> Error(Nil)
  }
}

/// An item that holds the caret's row, and the item before it in its list.
type Level {
  Level(item: Item, previous: Option(Item))
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
        True -> Ok(Level(item, previous))
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
  head: Position,
  here: Level,
  parents: List(Level),
) -> Result(Buffer, Nil) {
  let item = here.item
  use marks <- result.try(marks_of(lines, item))
  let on_marker = head.row == item.row && head.col < item.content_col
  let empty = item.blocks == [] && head.row == item.row
  case on_marker, empty, parents {
    True, _, _ -> Error(Nil)
    False, True, [parent, ..] -> {
      use outer <- result.map(marks_of(lines, parent.item))
      let row = markdown.carry(outer.lead) <> next(outer, parent.item)
      set_rows(lines, head.row, [row])
    }
    False, True, [] -> {
      let carried = markdown.carry(marks.lead)
      Ok(set_rows(lines, head.row, [string.trim_end(carried), carried]))
    }
    False, False, _ -> {
      let row = line(lines, head.row)
      let rest = string.drop_start(row, head.col)
      let kept = string.length(rest) - string.length(string.trim_start(rest))
      let prefix = markdown.carry(marks.lead) <> next(marks, item)
      Ok(
        buffer.from_text(string.join(lines, "\n"))
        |> buffer.replace(
          from: head,
          to: Position(..head, col: head.col + kept),
          with: "\n" <> prefix,
        ),
      )
    }
  }
}

/// The marker of the item after `item`: one more for a number, and an
/// unticked box after a task.
fn next(marks: ItemMarks, item: Item) -> String {
  let mark = case marks.mark {
    BulletMark(_) -> marks.mark
    NumberMark(number:, delimiter:) -> NumberMark(number + 1, delimiter)
  }
  let box = case item.task {
    Some(_) -> "[ ] "
    None -> ""
  }
  markdown.mark_text(mark) <> string.repeat(" ", int.max(marks.gap, 1)) <> box
}

fn indent(
  lines: List(String),
  head: Position,
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
      let mark = case marks.mark, last_list(previous) {
        BulletMark(_), _ -> marks.mark
        NumberMark(delimiter:, ..), Some(count) ->
          NumberMark(count + 1, delimiter)
        NumberMark(delimiter:, ..), None -> NumberMark(1, delimiter)
      }
      Ok(shift(lines, head, here.item, marks, at, by, mark))
    }
  }
}

fn outdent(
  lines: List(String),
  head: Position,
  here: Level,
  parents: List(Level),
) -> Result(Buffer, Nil) {
  use parent <- result.try(list.first(parents) |> result.map(fn(l) { l.item }))
  use marks <- result.try(marks_of(lines, here.item))
  use outer <- result.try(marks_of(lines, parent))
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
      Ok(shift(lines, head, here.item, marks, at, -by, mark))
    }
  }
}

/// The column of the words of an item whose row starts with `marks`.
fn words_col(marks: ItemMarks) -> Int {
  string.length(marks.lead)
  + string.length(markdown.mark_text(marks.mark))
  + int.max(marks.gap, 1)
}

/// How many items the list that ends `item`, when one does, has. Its last
/// number when it is numbered.
fn last_list(item: Item) -> Option(Int) {
  case list.last(item.blocks) {
    Ok(Block(content: OrderedList(start:, items:, ..), ..)) ->
      Some(start + list.length(items) - 1)
    Ok(_) | Error(Nil) -> None
  }
}

/// Moves the rows of `item` right by `by` columns at column `at`, or left
/// when `by` is below 0, and gives its marker `mark`.
fn shift(
  lines: List(String),
  head: Position,
  item: Item,
  marks: ItemMarks,
  at: Int,
  by: Int,
  mark: markdown.Mark,
) -> Buffer {
  let last = last_row(item)
  let moved = fn(row, text) {
    case row < item.row || row > last || string.trim(text) == "" {
      True -> text
      False -> {
        let before = string.slice(text, 0, at)
        let after = string.drop_start(text, at)
        let after = case by >= 0 {
          True -> string.repeat(" ", by) <> after
          False -> drop_spaces(after, -by)
        }
        case row == item.row {
          True -> {
            let old = markdown.mark_text(marks.mark)
            let indent =
              string.length(after) - string.length(string.trim_start(after))
            before
            <> string.slice(after, 0, indent)
            <> markdown.mark_text(mark)
            <> string.drop_start(after, indent + string.length(old))
          }
          False -> before <> after
        }
      }
    }
  }
  let new_lines = list.index_map(lines, fn(text, row) { moved(row, text) })
  let old_row = line(lines, head.row)
  let new_row = line(new_lines, head.row)
  let col = case head.col >= at {
    True ->
      int.max(at, head.col + string.length(new_row) - string.length(old_row))
    False -> head.col
  }
  buffer.from_text(string.join(new_lines, "\n"))
  |> buffer.move_to(Position(..head, col:))
}

fn drop_spaces(text: String, count: Int) -> String {
  case count, text {
    0, _ -> text
    _, " " <> rest -> drop_spaces(rest, count - 1)
    _, _ -> text
  }
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
