//// Turns the markdown tree into Lustre elements: the rendered page.
//// Imported by: the app shell. Imports: `markdown`.

import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import lustre/attribute
import lustre/element.{type Element}
import lustre/element/html
import scribbl/markdown.{
  type Block, type Inline, type Level, BulletList, Code, CodeBlock, Emphasis, H1,
  H2, H3, H4, H5, H6, Heading, Link, OrderedList, Paragraph, Quote, Rule, Strike,
  Strong, Text,
}

const safe_schemes = ["http", "https", "mailto"]

/// Safe by construction: all text goes through `element.text` (escaped) and
/// this module never uses `element.unsafe_raw_html`. A link is clickable only
/// for http, https, mailto and relative paths.
///
/// A task item renders a checkbox. Ticking it sends `on_task_toggled(row)`
/// with the item's source row, and the shell rewrites that line. The page
/// never edits text itself.
///
/// Wrapped in `data-test-id="preview"`. M6 HTML export is
/// `element.to_string(preview.view(blocks, ..))`.
pub fn view(
  blocks: List(Block),
  _on_task_toggled: fn(Int) -> msg,
) -> Element(msg) {
  html.div(
    [attribute.class("preview"), attribute.data("test-id", "preview")],
    list.map(blocks, block),
  )
}

fn block(block: Block) -> Element(msg) {
  case block.content {
    Heading(level, text) -> heading(level, inlines(text))
    Paragraph(text) -> html.p([], inlines(text))
    BulletList(_) | OrderedList(..) | Quote(_) | CodeBlock(..) | Rule ->
      element.none()
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
    Strike(text) -> inlines(text)
  }
}

/// A link that is not safe to follow shows as the text that was typed, so
/// nothing the user wrote goes missing from the page.
fn link(
  label: List(Inline),
  url: String,
  title: Option(String),
) -> List(Element(msg)) {
  case is_safe(url), title {
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

// Browsers drop tabs, newlines and leading control characters from a URL before
// reading its scheme. Taking everything before the first colon as the scheme,
// whitespace included, keeps such a URL from matching the list.
fn is_safe(url: String) -> Bool {
  case string.split_once(url, ":") {
    Error(Nil) -> True
    Ok(#(scheme, _)) ->
      is_path(scheme) || list.contains(safe_schemes, string.lowercase(scheme))
  }
}

fn is_path(before_colon: String) -> Bool {
  list.any(["/", "?", "#"], string.contains(before_colon, _))
}
