//// Turns the markdown tree into Lustre elements: the rendered page.
//// Imported by: the app shell. Imports: `markdown`.

import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import lustre/attribute
import lustre/element.{type Element}
import lustre/element/html
import lustre/event
import nullpad/markdown.{
  type Block, type Inline, type Item, type Level, type Spacing, type Task,
  BulletList, Code, CodeBlock, Emphasis, H1, H2, H3, H4, H5, H6, Heading, Link,
  OrderedList, Paragraph, Quote, Rule, Strike, Strong, Text, Tight,
}

/// Safe by construction: all text goes through `element.text` (escaped) and
/// this module never uses `element.unsafe_raw_html`. A link is clickable only
/// for http, https, mailto and relative paths.
///
/// A task item is `li.task` and starts with a checkbox. Ticking it sends
/// `on_task(task, checked)`, and the shell rewrites the task's line. The page
/// never edits text itself.
///
/// Wrapped in `data-test-id="preview"`. M6 HTML export is
/// `element.to_string(preview.view(blocks, ..))`.
pub fn view(
  blocks: List(Block),
  on_task: fn(Task, Bool) -> msg,
) -> Element(msg) {
  html.div(
    [attribute.class("preview"), attribute.data("test-id", "preview")],
    list.map(blocks, block(_, on_task)),
  )
}

fn block(shown: Block, on_task: fn(Task, Bool) -> msg) -> Element(msg) {
  let list_items = fn(items: List(Item), spacing) {
    list.map(items, item(_, spacing, on_task))
  }
  case shown.content {
    Heading(level, text) -> heading(level, inlines(text))
    Paragraph(text) -> html.p([], inlines(text))
    Rule -> html.hr([])
    Quote(blocks) -> html.blockquote([], list.map(blocks, block(_, on_task)))
    BulletList(spacing, items) -> html.ul([], list_items(items, spacing))
    OrderedList(1, spacing, items) -> html.ol([], list_items(items, spacing))
    OrderedList(start, spacing, items) ->
      html.ol(
        [attribute.attribute("start", int.to_string(start))],
        list_items(items, spacing),
      )
    CodeBlock(language, code) -> {
      let class = case language {
        Some(word) -> [attribute.class("language-" <> word)]
        None -> []
      }
      html.pre([], [html.code(class, [element.text(code)])])
    }
  }
}

fn item(
  shown: Item,
  spacing: Spacing,
  on_task: fn(Task, Bool) -> msg,
) -> Element(msg) {
  let children =
    list.flat_map(shown.blocks, fn(child) {
      case child.content, spacing {
        Paragraph(text), Tight -> inlines(text)
        _, _ -> [block(child, on_task)]
      }
    })
  case shown.task {
    None -> html.li([], children)
    Some(task) ->
      html.li([attribute.class("task")], [
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

fn heading(level: Level, children: List(Element(msg))) -> Element(msg) {
  case level {
    H1 -> html.h1([], children)
    H2 -> html.h2([], children)
    H3 -> html.h3([], children)
    H4 -> html.h4([], children)
    H5 -> html.h5([], children)
    H6 -> html.h6([], children)
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
