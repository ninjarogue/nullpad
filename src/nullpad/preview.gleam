//// Imported by: the app shell. Imports: `markdown`.

import gleam/dict.{type Dict}
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

/// The rows `first_row` up to `first_row + rows`, beside the field that holds
/// the rows `field`, as `live.cut` gives them. A quote, list or item the run
/// cuts has no margin, padding or marker where it is cut (`cut above` when
/// it goes on below the run, `cut below` when it began above), and an item
/// whose own line the run does not draw has no marker and no box (`bare`).
/// A leaf the field holds is drawn empty (`held`), for the margins it keeps
/// on the run's side of the field.
///
/// A row outside every block, or between the blocks of an item or a quote,
/// is blank, and is drawn as one empty line (`div.blank`), so every row of
/// the note has a place on the page.
pub fn part(
  blocks: List(Block),
  rows rows: Int,
  first_row first_row: Int,
  field field: Option(live.Region),
  test_id test_id: String,
  on_task on_task: fn(Task, Bool) -> msg,
) -> Element(msg) {
  let to = first_row + rows
  let ends = case field {
    Some(_) -> live.item_ends(blocks)
    None -> dict.new()
  }
  let run = Marked(from: first_row, to:, field:, ends:)
  html.div(
    [attribute.class("preview part"), attribute.data("test-id", test_id)],
    live.cut(blocks, from: first_row, to:, field:)
      |> spaced(from: first_row, to:, rows: run, draw: fn(shown) {
        [block(shown, run, on_task)]
      }),
  )
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
    Marked(from: first, to: end, ..) ->
      blank_rows(
        tag,
        rows,
        from: int.max(from, first),
        row: int.min(to, end) - 1,
        drawn: [],
      )
  }
}

fn blank_rows(
  tag: fn(List(attribute.Attribute(msg)), List(Element(msg))) -> Element(msg),
  rows: Rows,
  from from: Int,
  row row: Int,
  drawn drawn: List(Element(msg)),
) -> List(Element(msg)) {
  case row < from {
    True -> drawn
    False -> {
      let blank = tag([attribute.class("blank"), ..at(rows, row)], [])
      blank_rows(tag, rows, from:, row: row - 1, drawn: [blank, ..drawn])
    }
  }
}

/// `Marked`: the rows `from` up to `to` of the note, beside the field that
/// holds the rows `field`, each element marked with its first row. `ends`
/// holds the last row of each item the run may cut.
type Rows {
  Unmarked
  Marked(
    from: Int,
    to: Int,
    field: Option(live.Region),
    ends: Dict(#(Int, Int), Int),
  )
}

/// The field sets a heading over several rows a line to a row, at its size,
/// and the page is told how many rows.
fn rows_of(shown: Block, rows: Rows) -> List(attribute.Attribute(msg)) {
  case rows, shown.last_row - shown.first_row + 1 {
    Unmarked, _ | Marked(..), 1 -> []
    Marked(..), count -> [attribute.style("--rows", int.to_string(count))]
  }
}

fn at(rows: Rows, row: Int) -> List(attribute.Attribute(msg)) {
  case rows {
    Unmarked -> []
    Marked(..) -> [attribute.data(live.row_mark, int.to_string(row))]
  }
}

/// Whether the field holds these rows, and on which side of it the run is.
fn held(rows: Rows, first_row: Int, last_row: Int) -> Option(String) {
  case rows {
    Marked(to:, field: Some(live.Region(held_first, held_last)), ..)
      if first_row >= held_first && last_row <= held_last
    ->
      case to <= held_first {
        True -> Some("held above")
        False -> Some("held below")
      }
    Marked(..) | Unmarked -> None
  }
}

/// The class and row mark of a quote, list or item from `first_row` to
/// `last_row`, which the run may cut, and which draws its rows up to
/// `drawn_to`. A cut one is marked with the first row it draws, and one that
/// draws none of the run's rows is not marked.
fn cut(
  rows: Rows,
  first_row: Int,
  last_row: Int,
  drawn_to: Int,
) -> List(attribute.Attribute(msg)) {
  case rows {
    Unmarked -> []
    Marked(from:, to:, ..) -> {
      let drawn_from = int.max(first_row, from)
      let mark = case drawn_from <= int.min(drawn_to, to - 1) {
        True -> at(rows, drawn_from)
        False -> []
      }
      case first_row < from, last_row >= to {
        False, False -> mark
        True, _ -> [attribute.class("cut below"), ..mark]
        False, True -> [attribute.class("cut above"), ..mark]
      }
    }
  }
}

fn block(
  shown: Block,
  rows: Rows,
  on_task: fn(Task, Bool) -> msg,
) -> Element(msg) {
  let here = at(rows, shown.first_row)
  let list_items = fn(listed: List(Item), spacing) {
    items(listed, spacing, shown.first_row, shown.last_row + 1, rows, on_task)
  }
  let around = cut(rows, shown.first_row, shown.last_row, shown.last_row)
  case held(rows, shown.first_row, shown.last_row), shown.content {
    Some(side), Heading(_, []) -> html.div([attribute.class(side)], [])
    Some(side), Heading(level, _) -> heading(level, [attribute.class(side)], [])
    Some(side), Paragraph(_) -> html.p([attribute.class(side)], [])
    Some(side), Rule -> html.hr([attribute.class(side)])
    Some(side), CodeBlock(..) -> html.pre([attribute.class(side)], [])
    Some(side), Table(..) ->
      html.div([attribute.class("table-scroll " <> side)], [])
    _, Heading(level, text) ->
      heading(level, list.append(here, rows_of(shown, rows)), inlines(text))
    _, Paragraph(text) -> html.p(here, inlines(text))
    _, Rule -> html.hr(here)
    _, Quote(blocks) ->
      html.blockquote(
        around,
        spaced(
          blocks,
          from: shown.first_row,
          to: shown.last_row + 1,
          rows:,
          draw: fn(child) { [block(child, rows, on_task)] },
        ),
      )
    _, BulletList(spacing, items) -> html.ul(around, list_items(items, spacing))
    _, OrderedList(1, spacing, items) ->
      html.ol(around, list_items(items, spacing))
    _, OrderedList(start, spacing, items) ->
      html.ol(
        [attribute.attribute("start", int.to_string(start)), ..around],
        list_items(items, spacing),
      )
    _, CodeBlock(language, code, code_row) -> {
      let class = case language {
        Some(word) -> [attribute.class("language-" <> word)]
        None -> []
      }
      html.pre(at(rows, code_row), [html.code(class, [element.text(code)])])
    }
    _, Table(columns, table_rows) ->
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
  start: Int,
  end: Int,
  rows: Rows,
  on_task: fn(Task, Bool) -> msg,
) -> List(Element(msg)) {
  let gap = fn(from, to) {
    blanks(
      fn(attributes, children) {
        html.li([attribute.aria_hidden(True), ..attributes], children)
      },
      rows,
      from:,
      to:,
    )
  }
  let nexts =
    list.map(listed, fn(next: Item) { next.row })
    |> list.drop(1)
    |> list.append([end])
  let lead = case listed {
    [first, ..] -> gap(start, first.row)
    [] -> gap(start, end)
  }
  list.append(
    lead,
    list.flat_map(list.zip(listed, nexts), fn(pair) {
      let #(shown, next) = pair
      let last = last_row(shown) + 1
      [item(shown, spacing, last, rows, on_task), ..gap(last, next)]
    }),
  )
}

fn item(
  shown: Item,
  spacing: Spacing,
  end: Int,
  rows: Rows,
  on_task: fn(Task, Bool) -> msg,
) -> Element(msg) {
  let #(bare, last) = case rows {
    Marked(from:, to:, ends:, ..) -> #(
      shown.row < from || shown.row >= to,
      dict.get(ends, #(shown.row, shown.content_col))
        |> result.unwrap(last_row(shown)),
    )
    Unmarked -> #(False, last_row(shown))
  }
  let around = cut(rows, shown.row, last, last_row(shown))
  let around = case bare {
    True -> [attribute.class("bare"), ..around]
    False -> around
  }
  let children =
    spaced(shown.blocks, from: shown.row, to: end, rows:, draw: fn(child) {
      case held(rows, child.first_row, child.last_row), child.content, spacing {
        Some(_), Paragraph(_), Tight -> []
        None, Paragraph(text), Tight -> inlines(text)
        _, _, _ -> [block(child, rows, on_task)]
      }
    })
  case shown.task, bare {
    None, _ -> html.li(around, children)
    Some(_), True -> html.li([attribute.class("task"), ..around], children)
    Some(task), False ->
      html.li([attribute.class("task"), ..around], [
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
