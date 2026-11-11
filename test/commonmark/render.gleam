import gleam/bit_array
import gleam/int
import gleam/list
import gleam/option.{None, Some}
import gleam/string
import nullpad/markdown.{
  type Alignment, type Block, type Cell, type Column, type Inline, type Item,
  type Level, type Spacing, BulletList, Center, Code, CodeBlock, Emphasis, H1,
  H2, H3, H4, H5, H6, Heading, Left, Link, OrderedList, Paragraph, Quote, Right,
  Rule, Strike, Strong, Table, Task, Text, Tight, Unaligned,
}

pub fn html(blocks: List(Block)) -> String {
  blocks |> list.map(block) |> string.concat
}

fn block(block: Block) -> String {
  case block.content {
    Heading(level:, text:) -> {
      let name = heading_tag(level)
      element(name, [], inlines(text)) <> "\n"
    }
    Paragraph(text:) -> element("p", [], inlines(text)) <> "\n"
    Rule -> "<hr />\n"
    Quote(blocks:) -> "<blockquote>\n" <> html(blocks) <> "</blockquote>\n"
    BulletList(spacing:, items:) ->
      "<ul>\n" <> list_items(spacing, items) <> "</ul>\n"
    OrderedList(start: 1, spacing:, items:) ->
      "<ol>\n" <> list_items(spacing, items) <> "</ol>\n"
    OrderedList(start:, spacing:, items:) ->
      "<ol start=\""
      <> int.to_string(start)
      <> "\">\n"
      <> list_items(spacing, items)
      <> "</ol>\n"
    CodeBlock(language: Some(word), code:) ->
      "<pre><code class=\"language-"
      <> escape(word)
      <> "\">"
      <> escape(code)
      <> "</code></pre>\n"
    CodeBlock(language: None, code:) ->
      "<pre><code>" <> escape(code) <> "</code></pre>\n"
    Table(columns:, rows:) -> {
      let body = case rows {
        [] -> ""
        _ ->
          "<tbody>\n"
          <> string.concat(list.map(rows, row(columns, _)))
          <> "</tbody>\n"
      }
      "<table>\n<thead>\n<tr>\n"
      <> string.concat(
        list.map(columns, fn(column) {
          cell("th", column.alignment, column.heading)
        }),
      )
      <> "</tr>\n</thead>\n"
      <> body
      <> "</table>\n"
    }
  }
}

fn row(columns: List(Column), cells: List(Cell)) -> String {
  let cells =
    list.map2(columns, cells, fn(column, content) {
      cell("td", column.alignment, content)
    })
  "<tr>\n" <> string.concat(cells) <> "</tr>\n"
}

fn cell(name: String, alignment: Alignment, content: Cell) -> String {
  let attributes = case alignment {
    Unaligned -> []
    Left -> [#("align", "left")]
    Center -> [#("align", "center")]
    Right -> [#("align", "right")]
  }
  element(name, attributes, inlines(content)) <> "\n"
}

fn list_items(spacing: Spacing, items: List(Item)) -> String {
  items |> list.map(list_item(spacing, _)) |> string.concat
}

/// A task's box is cmark-gfm's.
fn list_item(spacing: Spacing, item: Item) -> String {
  let start = case item.task {
    Some(Task(checked: True, ..)) ->
      "<li><input type=\"checkbox\" checked=\"\" disabled=\"\" /> "
    Some(Task(checked: False, ..)) ->
      "<li><input type=\"checkbox\" disabled=\"\" /> "
    None -> "<li>"
  }
  list.fold(item.blocks, start, fn(done, child) {
    case child.content, spacing, string.ends_with(done, "\n") {
      Paragraph(text:), Tight, _ -> done <> inlines(text)
      _, _, True -> done <> block(child)
      _, _, False -> done <> "\n" <> block(child)
    }
  })
  <> "</li>\n"
}

fn heading_tag(level: Level) -> String {
  case level {
    H1 -> "h1"
    H2 -> "h2"
    H3 -> "h3"
    H4 -> "h4"
    H5 -> "h5"
    H6 -> "h6"
  }
}

fn inlines(inlines: List(Inline)) -> String {
  inlines |> list.map(inline) |> string.concat
}

fn inline(inline: Inline) -> String {
  case inline {
    Text(text) -> escape(text)
    Code(code) -> element("code", [], escape(code))
    Emphasis(inner) -> element("em", [], inlines(inner))
    Strong(inner) -> element("strong", [], inlines(inner))
    Link(label:, url:, title:) -> {
      let title = case title {
        Some(title) -> [#("title", title)]
        None -> []
      }
      element("a", [#("href", percent_encode(url)), ..title], inlines(label))
    }
    Strike(inner) -> element("del", [], inlines(inner))
  }
}

fn element(
  name: String,
  attributes: List(#(String, String)),
  content: String,
) -> String {
  let attributes =
    list.map(attributes, fn(attribute) {
      " " <> attribute.0 <> "=\"" <> escape(attribute.1) <> "\""
    })
  "<"
  <> name
  <> string.concat(attributes)
  <> ">"
  <> content
  <> "</"
  <> name
  <> ">"
}

fn escape(text: String) -> String {
  text
  |> string.replace("&", "&amp;")
  |> string.replace("<", "&lt;")
  |> string.replace(">", "&gt;")
  |> string.replace("\"", "&quot;")
}

fn percent_encode(url: String) -> String {
  url
  |> string.to_utf_codepoints
  |> list.map(string.utf_codepoint_to_int)
  |> encode_codepoints("")
}

fn encode_codepoints(codepoints: List(Int), done: String) -> String {
  case codepoints {
    [] -> done
    [0x25, high, low, ..rest] ->
      case is_hex(high) && is_hex(low) {
        True ->
          encode_codepoints(
            rest,
            done <> "%" <> from_code(high) <> from_code(low),
          )
        False -> encode_codepoints([high, low, ..rest], done <> "%25")
      }
    [code, ..rest] -> {
      let text = from_code(code)
      case is_url_safe(code) {
        True -> encode_codepoints(rest, done <> text)
        False -> encode_codepoints(rest, done <> utf8_percent(text))
      }
    }
  }
}

fn from_code(code: Int) -> String {
  let assert Ok(codepoint) = string.utf_codepoint(code)
  string.from_utf_codepoints([codepoint])
}

fn is_hex(code: Int) -> Bool {
  { code >= 0x30 && code <= 0x39 }
  || { code >= 0x41 && code <= 0x46 }
  || { code >= 0x61 && code <= 0x66 }
}

fn is_url_safe(code: Int) -> Bool {
  { code >= 0x30 && code <= 0x39 }
  || { code >= 0x41 && code <= 0x5A }
  || { code >= 0x61 && code <= 0x7A }
  || string.contains(";/?:@&=+$,-_.!~*'()#", from_code(code))
}

fn utf8_percent(text: String) -> String {
  bit_array.from_string(text) |> bytes_to_percent("")
}

fn bytes_to_percent(bytes: BitArray, done: String) -> String {
  case bytes {
    <<byte, rest:bytes>> ->
      bytes_to_percent(
        rest,
        done <> "%" <> string.pad_start(int.to_base16(byte), 2, "0"),
      )
    _ -> done
  }
}
