//// Imported by: the app shell. Imports: `markdown`.

import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import lustre/attribute
import lustre/element.{type Element}
import lustre/element/html
import lustre/event
import nullpad/live
import nullpad/markdown.{
  type Alignment, type Block, type Cell, type Column, type Content, type Inline,
  type Item, type Level, type Spacing, type Task, Block, BulletList, Center,
  Code, CodeBlock, Emphasis, H1, H2, H3, H4, H5, H6, Heading, Left, Link,
  OrderedList, Paragraph, Quote, Right, Rule, Strike, Strong, Table, Text, Tight,
  Unaligned,
}

/// Safe by construction: all text goes through `element.text` (escaped) and
/// this module never uses `element.unsafe_raw_html`. A link is clickable only
/// for http, https, mailto and relative paths.
pub fn view(
  blocks: List(Block),
  on_task: fn(Task, Bool) -> msg,
) -> Element(msg) {
  html.div(
    [attribute.class("preview"), attribute.data("test-id", "preview")],
    list.map(blocks, block(_, Unmarked, on_task)),
  )
}

/// A list the run cuts shows the items inside the run, spaced and numbered
/// as in the whole list. Any other block the run cuts is left out and its
/// rows are blank.
///
/// A row outside every block is blank, and is drawn as one empty line
/// (`div.blank`), so every row of the note has a place on the page.
pub fn part(
  blocks: List(Block),
  rows rows: Int,
  first_row first_row: Int,
  test_id test_id: String,
  on_task on_task: fn(Task, Bool) -> msg,
) -> Element(msg) {
  let to = first_row + rows
  html.div(
    [attribute.class("preview part"), attribute.data("test-id", test_id)],
    inside(blocks, from: first_row, to:)
      |> spaced(from: first_row, to:, rows: Marked, draw: fn(shown) {
        [block(shown, Marked, on_task)]
      }),
  )
}

/// The blocks that `part` draws for the rows `from` up to `to`: the blocks
/// wholly inside, and the items of a list inside.
pub fn inside(blocks: List(Block), from from: Int, to to: Int) -> List(Block) {
  let within = fn(first_row, last_row) { first_row >= from && last_row < to }
  use shown <- list.filter_map(blocks)
  let cut = fn(items: List(Item), content: fn(Int, List(Item)) -> Content) {
    let is_inside = fn(item: Item) { within(item.row, last_row(item)) }
    let #(before, rest) = list.split_while(items, fn(item) { !is_inside(item) })
    case list.take_while(rest, is_inside) {
      [] -> Error(Nil)
      [first, ..] as kept -> {
        let last = list.last(kept) |> result.unwrap(first)
        let content = content(list.length(before), kept)
        Ok(Block(first_row: first.row, last_row: last_row(last), content:))
      }
    }
  }
  case within(shown.first_row, shown.last_row), shown.content {
    True, _ -> Ok(shown)
    False, BulletList(spacing, items) ->
      cut(items, fn(_, kept) { BulletList(spacing, kept) })
    False, OrderedList(start, spacing, items) ->
      cut(items, fn(skipped, kept) {
        OrderedList(start + skipped, spacing, kept)
      })
    False, Heading(..)
    | False, Paragraph(..)
    | False, Quote(..)
    | False, CodeBlock(..)
    | False, Rule
    | False, Table(..)
    -> Error(Nil)
  }
}

fn last_row(item: Item) -> Int {
  case list.last(item.blocks) {
    Ok(child) -> child.last_row
    Error(Nil) -> item.row
  }
}

fn spaced(
  blocks: List(Block),
  from from: Int,
  to to: Int,
  rows rows: Rows,
  draw draw: fn(Block) -> List(Element(msg)),
) -> List(Element(msg)) {
  let #(next, drawn) = {
    use next, shown <- list.map_fold(blocks, from)
    let before = blanks(html.div, rows, from: next, to: shown.first_row)
    #(shown.last_row + 1, list.append(before, draw(shown)))
  }
  list.flatten(drawn)
  |> list.append(blanks(html.div, rows, from: next, to:))
}

fn blanks(
  tag: fn(List(attribute.Attribute(msg)), List(Element(msg))) -> Element(msg),
  rows: Rows,
  from from: Int,
  to to: Int,
) -> List(Element(msg)) {
  case rows {
    Unmarked -> []
    Marked -> blank_rows(tag, from:, row: to - 1, drawn: [])
  }
}

fn blank_rows(
  tag: fn(List(attribute.Attribute(msg)), List(Element(msg))) -> Element(msg),
  from from: Int,
  row row: Int,
  drawn drawn: List(Element(msg)),
) -> List(Element(msg)) {
  case row < from {
    True -> drawn
    False -> {
      let blank = tag([attribute.class("blank"), ..at(Marked, row)], [])
      blank_rows(tag, from:, row: row - 1, drawn: [blank, ..drawn])
    }
  }
}

type Rows {
  Unmarked
  Marked
}

fn at(rows: Rows, row: Int) -> List(attribute.Attribute(msg)) {
  case rows {
    Unmarked -> []
    Marked -> [attribute.data(live.row_mark, int.to_string(row))]
  }
}

fn block(
  shown: Block,
  rows: Rows,
  on_task: fn(Task, Bool) -> msg,
) -> Element(msg) {
  let here = at(rows, shown.first_row)
  let list_items = fn(listed: List(Item), spacing) {
    items(listed, spacing, shown.last_row + 1, rows, on_task)
  }
  case shown.content {
    Heading(level, text) -> heading(level, here, inlines(text))
    Paragraph(text) -> html.p(here, inlines(text))
    Rule -> html.hr(here)
    Quote(blocks) ->
      html.blockquote(
        here,
        spaced(
          blocks,
          from: shown.first_row,
          to: shown.last_row + 1,
          rows:,
          draw: fn(child) { [block(child, rows, on_task)] },
        ),
      )
    BulletList(spacing, items) -> html.ul(here, list_items(items, spacing))
    OrderedList(1, spacing, items) -> html.ol(here, list_items(items, spacing))
    OrderedList(start, spacing, items) ->
      html.ol(
        [attribute.attribute("start", int.to_string(start)), ..here],
        list_items(items, spacing),
      )
    CodeBlock(language, code, code_row) -> {
      let class = case language {
        Some(word) -> [attribute.class("language-" <> word)]
        None -> []
      }
      html.pre(at(rows, code_row), [html.code(class, [element.text(code)])])
    }
    Table(columns, table_rows) ->
      table(shown.first_row, rows, columns, table_rows)
  }
}

/// A scrolled box cannot be scrolled from the keyboard unless it can be focused.
fn table(
  first_row: Int,
  marks: Rows,
  columns: List(Column),
  rows: List(List(Cell)),
) -> Element(msg) {
  let heading = fn(column: Column) {
    aligned(html.th, column.alignment, [attribute.scope("col")], column.heading)
  }
  let body = case rows {
    [] -> []
    _ -> [
      html.tbody(
        [],
        // The header is the table's first row and the delimiter its second.
        list.index_map(rows, fn(cells, index) {
          row(at(marks, first_row + 2 + index), columns, cells)
        }),
      ),
    ]
  }
  html.div(
    [
      attribute.class("table-scroll"),
      attribute.role("region"),
      attribute.aria_label("Table"),
      attribute.tabindex(0),
    ],
    [
      html.table([], [
        html.thead([], [
          html.tr(at(marks, first_row), list.map(columns, heading)),
        ]),
        ..body
      ]),
    ],
  )
}

fn row(
  here: List(attribute.Attribute(msg)),
  columns: List(Column),
  cells: List(Cell),
) -> Element(msg) {
  html.tr(
    here,
    list.zip(columns, cells)
      |> list.map(fn(pair) {
        aligned(html.td, { pair.0 }.alignment, [], pair.1)
      }),
  )
}

fn aligned(
  tag: fn(List(attribute.Attribute(msg)), List(Element(msg))) -> Element(msg),
  alignment: Alignment,
  attributes: List(attribute.Attribute(msg)),
  cell: Cell,
) -> Element(msg) {
  let attributes = case alignment {
    Unaligned -> attributes
    Left -> [attribute.attribute("align", "left"), ..attributes]
    Center -> [attribute.attribute("align", "center"), ..attributes]
    Right -> [attribute.attribute("align", "right"), ..attributes]
  }
  tag(attributes, inlines(cell))
}

fn items(
  listed: List(Item),
  spacing: Spacing,
  end: Int,
  rows: Rows,
  on_task: fn(Task, Bool) -> msg,
) -> List(Element(msg)) {
  let nexts =
    list.map(listed, fn(next: Item) { next.row })
    |> list.drop(1)
    |> list.append([end])
  use #(shown, next) <- list.flat_map(list.zip(listed, nexts))
  let last = last_row(shown) + 1
  let gap =
    blanks(
      fn(attributes, children) {
        html.li([attribute.aria_hidden(True), ..attributes], children)
      },
      rows,
      from: last,
      to: next,
    )
  [item(shown, spacing, last, rows, on_task), ..gap]
}

fn item(
  shown: Item,
  spacing: Spacing,
  end: Int,
  rows: Rows,
  on_task: fn(Task, Bool) -> msg,
) -> Element(msg) {
  let here = at(rows, shown.row)
  let children =
    spaced(shown.blocks, from: shown.row, to: end, rows:, draw: fn(child) {
      case child.content, spacing {
        Paragraph(text), Tight -> inlines(text)
        _, _ -> [block(child, rows, on_task)]
      }
    })
  case shown.task {
    None -> html.li(here, children)
    Some(task) ->
      html.li([attribute.class("task"), ..here], [
        html.input([
          attribute.type_("checkbox"),
          attribute.checked(task.checked),
          attribute.aria_label(task_label(shown.blocks)),
          event.on_check(on_task(task, _)),
        ]),
        ..children
      ])
  }
}

fn task_label(blocks: List(Block)) -> String {
  let first_paragraph =
    list.find_map(blocks, fn(child) {
      case child.content {
        Paragraph(text) -> Ok(markdown.plain_text(text))
        _ -> Error(Nil)
      }
    })
  case first_paragraph {
    Ok("") | Error(Nil) -> "Task"
    Ok(words) -> words
  }
}

fn heading(
  level: Level,
  here: List(attribute.Attribute(msg)),
  children: List(Element(msg)),
) -> Element(msg) {
  case level {
    H1 -> html.h1(here, children)
    H2 -> html.h2(here, children)
    H3 -> html.h3(here, children)
    H4 -> html.h4(here, children)
    H5 -> html.h5(here, children)
    H6 -> html.h6(here, children)
  }
}

fn inlines(text: List(Inline)) -> List(Element(msg)) {
  list.flat_map(text, inline)
}

fn inline(inline: Inline) -> List(Element(msg)) {
  case inline {
    Text(text) -> [element.text(text)]
    Strong(text) -> [html.strong([], inlines(text))]
    Emphasis(text) -> [html.em([], inlines(text))]
    Code(code) -> [html.code([], [element.text(code)])]
    Link(label, url, title) -> link(label, url, title)
    Strike(text) -> [html.del([], inlines(text))]
  }
}

fn link(
  label: List(Inline),
  url: String,
  title: Option(String),
) -> List(Element(msg)) {
  case markdown.is_safe_url(url), title {
    True, Some(title) -> [anchor(label, url, [attribute.title(title)])]
    True, None -> [anchor(label, url, [])]
    False, Some(title) -> typed(label, "](" <> url <> " \"" <> title <> "\")")
    False, None -> typed(label, "](" <> url <> ")")
  }
}

fn anchor(
  label: List(Inline),
  url: String,
  title: List(attribute.Attribute(msg)),
) -> Element(msg) {
  html.a(
    [
      attribute.href(url),
      attribute.target("_blank"),
      attribute.rel("noopener noreferrer"),
      ..title
    ],
    inlines(label),
  )
}

fn typed(label: List(Inline), tail: String) -> List(Element(msg)) {
  [element.text("["), ..inlines(label)] |> list.append([element.text(tail)])
}
