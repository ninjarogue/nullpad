//// Turns the markdown tree into Lustre elements: the rendered page.
//// Imported by: the app shell. Imports: `markdown`.

import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import lustre/attribute
import lustre/element.{type Element}
import lustre/element/html
import lustre/event
import nullpad/markdown.{
  type Alignment, type Block, type Cell, type Column, type Inline, type Item,
  type Level, type Spacing, type Task, BulletList, Center, Code, CodeBlock,
  Emphasis, H1, H2, H3, H4, H5, H6, Heading, Left, Link, OrderedList, Paragraph,
  Quote, Right, Rule, Strike, Strong, Table, Text, Tight, Unaligned,
}

/// Safe by construction: all text goes through `element.text` (escaped) and
/// this module never uses `element.unsafe_raw_html`. A link is clickable only
/// for http, https, mailto and relative paths.
///
/// A task item is `li.task` and starts with a checkbox. Ticking it sends
/// `on_task(task, checked)`, and the shell rewrites the task's line. The page
/// never edits text itself.
///
/// The whole note with no row marks, for the M6 HTML export:
/// `element.to_string(preview.view(blocks, ..))`. The app draws `part`.
pub fn view(
  blocks: List(Block),
  on_task: fn(Task, Bool) -> msg,
) -> Element(msg) {
  html.div(
    [attribute.class("preview"), attribute.data("test-id", "preview")],
    list.map(blocks, block(_, Unmarked, on_task)),
  )
}

/// A run of the note's rows drawn as a page, beside the text field. `first_row` is where the run starts in the note. Each element
/// carries the note row it starts on as `data-row`, which is how a click
/// finds its place in the source (`surface.on_point`), and a ticked task
/// names its row in the note, not in the run.
pub fn part(
  blocks: List(Block),
  first_row first_row: Int,
  test_id test_id: String,
  on_task on_task: fn(Task, Bool) -> msg,
) -> Element(msg) {
  let on_task = fn(task: Task, checked) {
    on_task(markdown.Task(..task, row: task.row + first_row), checked)
  }
  html.div(
    [attribute.class("preview part"), attribute.data("test-id", test_id)],
    list.map(blocks, block(_, Marked(first_row), on_task)),
  )
}

type Rows {
  Unmarked
  Marked(first_row: Int)
}

fn at(rows: Rows, row: Int) -> List(attribute.Attribute(msg)) {
  case rows {
    Unmarked -> []
    Marked(first_row:) -> [
      attribute.data("row", int.to_string(first_row + row)),
    ]
  }
}

fn block(
  shown: Block,
  rows: Rows,
  on_task: fn(Task, Bool) -> msg,
) -> Element(msg) {
  let here = at(rows, shown.first_row)
  let list_items = fn(items: List(Item), spacing) {
    list.map(items, item(_, spacing, rows, on_task))
  }
  case shown.content {
    Heading(level, text) -> heading(level, here, inlines(text))
    Paragraph(text) -> html.p(here, inlines(text))
    Rule -> html.hr(here)
    Quote(blocks) ->
      html.blockquote(here, list.map(blocks, block(_, rows, on_task)))
    BulletList(spacing, items) -> html.ul(here, list_items(items, spacing))
    OrderedList(1, spacing, items) -> html.ol(here, list_items(items, spacing))
    OrderedList(start, spacing, items) ->
      html.ol(
        [attribute.attribute("start", int.to_string(start)), ..here],
        list_items(items, spacing),
      )
    CodeBlock(language, code) -> {
      let class = case language {
        Some(word) -> [attribute.class("language-" <> word)]
        None -> []
      }
      // A fenced block has more rows than lines of code: its code starts
      // one row below the fence.
      let code_rows = list.length(string.split(code, "\n")) - 1
      let first_code_row = case
        shown.last_row - shown.first_row + 1 > code_rows
      {
        True -> shown.first_row + 1
        False -> shown.first_row
      }
      html.pre(at(rows, first_code_row), [
        html.code(class, [element.text(code)]),
      ])
    }
    Table(columns, table_rows) ->
      table(shown.first_row, rows, columns, table_rows)
  }
}

/// A table wider than the page scrolls inside its own box, so the page does
/// not. The box takes the keyboard, since a scrolled box nobody can focus
/// cannot be scrolled without a pointer.
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

fn item(
  shown: Item,
  spacing: Spacing,
  rows: Rows,
  on_task: fn(Task, Bool) -> msg,
) -> Element(msg) {
  let here = at(rows, shown.row)
  let children =
    list.flat_map(shown.blocks, fn(child) {
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

/// The parser never builds a link that is not safe to follow. A tree from
/// anywhere else is checked again here, where the address becomes an `href`.
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
