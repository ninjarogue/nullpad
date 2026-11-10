//// Hand-written markdown parser. Pure Gleam: text in, tree out. Not
//// CommonMark-complete on purpose.
////
//// The rule that keeps it small: inline markup never spans a line break.
//// Two private layers, shared by `parse` and `highlight` so there is one
//// grammar and the editor and the rendered page cannot disagree:
////   classify(line) -> LineKind   Blank | HeadingLine(level, text) |
////     FenceLine(language) | QuoteLine(rest) | ItemLine(indent, marker, rest)
////     | RuleLine | TextLine(text). One line only, no context.
////   tokenize(text) -> List(Token)   Word(text) | Delimiter(marks) |
////     OpenBracket | CloseLink(url). Lossless: the tokens' source text
////     concatenated gives the input back.
//// Imported by: `preview`, `surface` (M6), the shell, tests. Imports: stdlib.

import gleam/option.{type Option}

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
  // Number the lines from 0. Loop: classify(first line) picks a block reader.
  // The reader eats the lines that belong to it and returns #(Block, rest).
  // Quote / list item: strip the marker or indent, recurse on the inside.
  // Leaf text: tokenize each line, then pair up marks with a stack of open
  // ones. A mark that never closes becomes `Text`.
  let _ = source
  todo as "not implemented"
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
