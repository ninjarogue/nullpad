//// Every row of a note belongs to one block or to none. A row that belongs
//// to none is blank: the page draws it as an empty line. Blocks inside a
//// quote or a list item stay within it, in order, without sharing a row.

import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/string
import nullpad/markdown.{
  type Block, BulletList, CodeBlock, Heading, OrderedList, Paragraph, Quote,
  Rule, Table,
}

pub fn check(text: String) -> Result(Nil, String) {
  let rows = string.split(string.replace(text, "\r\n", "\n"), "\n")
  let blocks = markdown.parse(text)
  use _ <- result.try(in_order(blocks, 0, list.length(rows) - 1))
  list.index_map(rows, fn(line, row) { claimed(blocks, line, row) })
  |> result.all
  |> result.replace(Nil)
}

fn claimed(blocks: List(Block), line: String, row: Int) -> Result(Nil, String) {
  let claims =
    list.filter(blocks, fn(block) {
      block.first_row <= row && row <= block.last_row
    })
  case claims, is_blank(line) {
    [_], _ | [], True -> Ok(Nil)
    [], False -> Error("row " <> int.to_string(row) <> " has text and no block")
    _, _ -> Error("row " <> int.to_string(row) <> " belongs to several blocks")
  }
}

fn is_blank(line: String) -> Bool {
  list.all(string.to_graphemes(line), fn(letter) {
    letter == " " || letter == "\t"
  })
}

fn in_order(blocks: List(Block), low: Int, high: Int) -> Result(Nil, String) {
  case blocks {
    [] -> Ok(Nil)
    [block, ..rest] -> {
      let fits =
        block.first_row >= low
        && block.first_row <= block.last_row
        && block.last_row <= high
      case fits {
        False ->
          Error(
            "the block of rows "
            <> int.to_string(block.first_row)
            <> " to "
            <> int.to_string(block.last_row)
            <> " is not within rows "
            <> int.to_string(low)
            <> " to "
            <> int.to_string(high),
          )
        True -> {
          use _ <- result.try(inside(block))
          in_order(rest, block.last_row + 1, high)
        }
      }
    }
  }
}

fn inside(block: Block) -> Result(Nil, String) {
  case block.content {
    Quote(blocks:) -> in_order(blocks, block.first_row, block.last_row)
    BulletList(items:, ..) | OrderedList(items:, ..) -> {
      let next_rows =
        list.drop(items, 1)
        |> list.map(fn(item) { Some(item.row) })
        |> list.append([None])
      list.zip(items, next_rows)
      |> list.try_each(fn(pair) {
        item_within(pair.0.row, pair.0.blocks, pair.1, block)
      })
    }
    Heading(..) | Paragraph(..) | CodeBlock(..) | Rule | Table(..) -> Ok(Nil)
  }
}

fn item_within(
  row: Int,
  blocks: List(Block),
  next: Option(Int),
  list_block: Block,
) -> Result(Nil, String) {
  let high = case next {
    Some(next) -> next - 1
    None -> list_block.last_row
  }
  case row >= list_block.first_row && row <= high {
    True -> in_order(blocks, row, high)
    False ->
      Error("the item at row " <> int.to_string(row) <> " is outside its list")
  }
}
