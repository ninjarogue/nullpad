//// Hand-written markdown parser. Pure Gleam: text in, tree out. Not
//// CommonMark-complete on purpose.
////
//// The rule that keeps it small: inline markup never spans a line break.
//// Two private layers, shared by `parse` and `highlight` so there is one
//// grammar and the editor and the rendered page cannot disagree:
////   classify(line) -> LineKind   Blank | HeadingLine(level, text) |
////     TextLine(text), and in M3 FenceLine(language) | QuoteLine(rest) |
////     ItemLine(indent, marker, rest) | RuleLine. One line only, no context.
////   tokenize(text) -> List(Token)   Word(text) | Delimiter(marks) |
////     OpenBracket | CloseLink(url). Lossless: the tokens' source text
////     concatenated gives the input back.
//// Imported by: `preview`, `surface` (M6), the shell, tests. Imports: stdlib.

import gleam/list
import gleam/option.{type Option}
import gleam/string

/// A block plus the source rows it came from (inclusive, numbered like
/// `buffer.Position.row`). Rows cost one counter in the block parser. They
/// let a ticked task find its line, and later let the rendered page scroll to
/// the cursor.
pub type Block {
  Block(first_row: Int, last_row: Int, content: Content)
}

pub type Content {
  // M2
  Heading(level: Level, text: List(Inline))
  /// Source lines are joined with one space.
  Paragraph(text: List(Inline))
  // M3
  BulletList(items: List(Item))
  OrderedList(start: Int, items: List(Item))
  Quote(blocks: List(Block))
  CodeBlock(language: Option(String), code: String)
  Rule
  // After M3, in its own milestone: Table. Adding the variant makes the
  // compiler list every `case` that must handle it.
}

/// An item is a list of blocks, so a nested list is just a list block inside
/// an item: nesting falls out of the recursion. `row` is the item's first
/// line, the one that holds its `- [ ]` marker.
pub type Item {
  Item(row: Int, task: Task, blocks: List(Block))
}

pub type Task {
  NotATask
  Unchecked
  Checked
}

/// Six variants, not an Int: the renderer's `case` is exhaustive and a
/// "level 9" cannot exist.
pub type Level {
  H1
  H2
  H3
  H4
  H5
  H6
}

pub type Inline {
  // M2
  Text(String)
  Strong(List(Inline))
  Emphasis(List(Inline))
  Code(String)
  Link(label: List(Inline), url: String)
  // M3
  Strike(List(Inline))
}

/// Parse a whole note. Total: any text is a valid document (unknown or
/// unclosed syntax becomes plain `Text`, and raw HTML is just text), so there
/// is no error type.
pub fn parse(source: String) -> List(Block) {
  source
  |> string.replace("\r\n", "\n")
  |> string.split("\n")
  |> list.index_map(fn(line, row) { #(row, classify(line)) })
  |> read_blocks([])
}

type LineKind {
  Blank
  HeadingLine(level: Level, text: String)
  TextLine(text: String)
}

type Lines =
  List(#(Int, LineKind))

fn classify(line: String) -> LineKind {
  case string.trim(line) {
    "" -> Blank
    text ->
      case heading(line) {
        Ok(#(level, heading_text)) -> HeadingLine(level, heading_text)
        Error(Nil) -> TextLine(text)
      }
  }
}

fn heading(line: String) -> Result(#(Level, String), Nil) {
  case drop_indent(line, 3) {
    "######" <> rest -> heading_text(H6, rest)
    "#####" <> rest -> heading_text(H5, rest)
    "####" <> rest -> heading_text(H4, rest)
    "###" <> rest -> heading_text(H3, rest)
    "##" <> rest -> heading_text(H2, rest)
    "#" <> rest -> heading_text(H1, rest)
    _ -> Error(Nil)
  }
}

fn heading_text(
  level: Level,
  after_marks: String,
) -> Result(#(Level, String), Nil) {
  case after_marks {
    "" | " " <> _ -> Ok(#(level, string.trim(after_marks)))
    _ -> Error(Nil)
  }
}

fn drop_indent(line: String, allowed: Int) -> String {
  case line {
    " " <> rest if allowed > 0 -> drop_indent(rest, allowed - 1)
    _ -> line
  }
}

fn read_blocks(lines: Lines, done: List(Block)) -> List(Block) {
  case lines {
    [] -> list.reverse(done)
    [#(_, Blank), ..rest] -> read_blocks(rest, done)
    [#(row, HeadingLine(level, text)), ..rest] -> {
      let block = Block(row, row, Heading(level, inlines(text)))
      read_blocks(rest, [block, ..done])
    }
    [#(row, TextLine(text)), ..rest] -> {
      let #(block, rest) = read_paragraph(row, row, [inlines(text)], rest)
      read_blocks(rest, [block, ..done])
    }
  }
}

fn read_paragraph(
  first_row: Int,
  last_row: Int,
  read: List(List(Inline)),
  lines: Lines,
) -> #(Block, Lines) {
  case lines {
    [#(row, TextLine(text)), ..rest] ->
      read_paragraph(first_row, row, [inlines(text), ..read], rest)
    [] | [#(_, Blank), ..] | [#(_, HeadingLine(..)), ..] -> {
      let text =
        read
        |> list.reverse
        |> list.intersperse([Text(" ")])
        |> list.flatten
        |> normalize
      #(Block(first_row, last_row, Paragraph(text)), lines)
    }
  }
}

// Inline parsing. `inlines` is the only function that reads inside a line.
// It is a stub: no markup is recognised yet.
fn inlines(text: String) -> List(Inline) {
  case text {
    "" -> []
    _ -> [Text(text)]
  }
}

fn normalize(parts: List(Inline)) -> List(Inline) {
  parts |> list.fold([], push_inline) |> list.reverse
}

fn push_inline(done: List(Inline), next: Inline) -> List(Inline) {
  case next, done {
    Text(""), _ -> done
    Text(more), [Text(text), ..before] -> [Text(text <> more), ..before]
    Text(_), _
    | Strong(_), _
    | Emphasis(_), _
    | Code(_), _
    | Link(..), _
    | Strike(_), _
    -> [next, ..done]
  }
}

/// Flip the task marker on one source line: "- [ ] milk" <-> "- [x] milk".
/// A line that is not a task item comes back unchanged. Lives here so the
/// task syntax is known in one module only.
pub fn toggle_task(line: String) -> String {
  let _ = line
  todo as "not implemented"
}

/// One styled piece of *source* text, for the editor's mirror (M6).
pub type Run {
  Run(style: Style, text: String)
}

pub type Style {
  Plain
  /// The syntax characters themselves: # ** ` > -
  Mark
  HeadingText
  StrongText
  EmphasisText
  CodeText
  LinkText
  QuoteText
}

/// M6. One list of runs per source row, built from the same `classify` and
/// `tokenize` as `parse`. Lossless, which is what keeps the mirror's glyphs
/// under the text field's caret: for every row, the runs' `text`
/// concatenated is exactly that line.
pub fn highlight(source: String) -> List(List(Run)) {
  let _ = source
  todo as "not implemented"
}
