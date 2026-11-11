import gleam/bit_array
import gleam/int
import gleam/list
import gleam/option.{None, Some}
import gleam/string
import scribbl/markdown.{
  type Block, type Inline, type Level, BulletList, Code, CodeBlock, Emphasis, H1,
  H2, H3, H4, H5, H6, Heading, Link, OrderedList, Paragraph, Quote, Rule, Strike,
  Strong, Text,
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
    BulletList(..) | OrderedList(..) | Quote(..) | CodeBlock(..) | Rule ->
      panic as "the parser does not build this block yet"
  }
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
    Strike(_) -> panic as "the parser does not build strikethrough yet"
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
