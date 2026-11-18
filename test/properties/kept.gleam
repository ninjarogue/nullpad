//// What the parser drops on purpose is only marks: white space, ASCII
//// punctuation and digits, which hold a block's syntax, and the `x` of a
//// ticked box. Every other character of the source, in order, is text,
//// code, a link's address or title, or a code block's language, and the
//// parsed blocks hold it. The one drop that is not a mark is a fence's info
//// string past its first word.

import gleam/int
import gleam/list
import gleam/option.{Some}
import gleam/string
import nullpad/markdown.{
  type Block, type Inline, BulletList, CodeBlock, Emphasis, Heading, Link,
  OrderedList, Paragraph, Quote, Rule, Strike, Strong, Table, Task, Text,
}

pub fn every_letter(text: String) -> Bool {
  let blocks = markdown.parse(text)
  parsed(blocks) == source(text, blocks)
}

fn is_text(codepoint: Int) -> Bool {
  codepoint > 127
  || { codepoint >= 65 && codepoint <= 90 }
  || { codepoint >= 97 && codepoint <= 122 }
}

fn text_of(text: String) -> List(Int) {
  string.to_utf_codepoints(text)
  |> list.map(string.utf_codepoint_to_int)
  |> list.filter(is_text)
}

fn parsed(blocks: List(Block)) -> List(Int) {
  use block <- list.flat_map(blocks)
  case block.content {
    Heading(text:, ..) | Paragraph(text:) -> inlines(text)
    BulletList(items:, ..) | OrderedList(items:, ..) ->
      list.flat_map(items, fn(item) { parsed(item.blocks) })
    Quote(blocks:) -> parsed(blocks)
    CodeBlock(language:, code:, ..) ->
      list.append(text_of(option.unwrap(language, "")), text_of(code))
    Rule -> []
    Table(columns:, rows:) ->
      list.map(columns, fn(column) { column.heading })
      |> list.append(list.flatten(rows))
      |> list.flat_map(inlines)
  }
}

fn inlines(parts: List(Inline)) -> List(Int) {
  use inline <- list.flat_map(parts)
  case inline {
    Text(text) | markdown.Code(text) -> text_of(text)
    Strong(children) | Emphasis(children) | Strike(children) ->
      inlines(children)
    Link(label:, url:, title:) ->
      list.flatten([
        inlines(label),
        text_of(url),
        text_of(option.unwrap(title, "")),
      ])
  }
}

fn source(text: String, blocks: List(Block)) -> List(Int) {
  let boxes = ticked_boxes(blocks)
  let fences = fences(blocks)
  let rows = string.split(string.replace(text, "\r\n", "\n"), "\n")
  use #(line, row) <- list.flat_map(
    list.index_map(rows, fn(line, row) { #(line, row) }),
  )
  let line = case list.contains(fences, row) {
    True -> up_to_first_info_word(line)
    False -> line
  }
  string.to_utf_codepoints(line)
  |> list.map(string.utf_codepoint_to_int)
  |> list.index_map(fn(codepoint, col) { #(codepoint, col) })
  |> list.filter(fn(pair) {
    is_text(pair.0) && !list.contains(boxes, #(row, pair.1))
  })
  |> list.map(fn(pair) { pair.0 })
}

fn ticked_boxes(blocks: List(Block)) -> List(#(Int, Int)) {
  use block <- list.flat_map(blocks)
  case block.content {
    Quote(blocks:) -> ticked_boxes(blocks)
    BulletList(items:, ..) | OrderedList(items:, ..) ->
      list.flat_map(items, fn(item) {
        let own = case item.task {
          Some(Task(checked: True, row:, col:)) -> [#(row, col)]
          Some(Task(checked: False, ..)) | option.None -> []
        }
        list.append(own, ticked_boxes(item.blocks))
      })
    Heading(..) | Paragraph(..) | CodeBlock(..) | Rule | Table(..) -> []
  }
}

/// The rows of the opening fences of fenced code. Indented code has its
/// first row as its code row, and code with lines has its code below its
/// fence.
fn fences(blocks: List(Block)) -> List(Int) {
  use block <- list.flat_map(blocks)
  case block.content {
    Quote(blocks:) -> fences(blocks)
    BulletList(items:, ..) | OrderedList(items:, ..) ->
      list.flat_map(items, fn(item) { fences(item.blocks) })
    CodeBlock(code:, code_row:, ..)
      if code_row != block.first_row || code == ""
    -> [block.first_row]
    CodeBlock(..) | Heading(..) | Paragraph(..) | Rule | Table(..) -> []
  }
}

fn up_to_first_info_word(line: String) -> String {
  let letters = string.to_utf_codepoints(line)
  let is_one_of = fn(marks: List(Int)) {
    fn(letter) { list.contains(marks, string.utf_codepoint_to_int(letter)) }
  }
  let fence = is_one_of([96, 126])
  let blank = is_one_of([32, 9])
  let info =
    list.drop_while(letters, fn(letter) { !fence(letter) })
    |> list.drop_while(fence)
    |> list.drop_while(blank)
  let word = list.take_while(info, fn(letter) { !blank(letter) })
  let kept = list.length(letters) - list.length(info) + list.length(word)
  string.from_utf_codepoints(list.take(letters, int.max(kept, 0)))
}
