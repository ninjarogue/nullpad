//// Hand-written markdown parser. Pure Gleam: text in, tree out. It follows
//// CommonMark 0.31.2 for what nullpad supports (headings, paragraphs, block
//// quotes, lists, code blocks, thematic breaks, code spans, emphasis, inline
//// links, backslash escapes), and GFM for strikethrough, task items and tables.
//// Everything else stays text as typed. Two rules are nullpad's own: a link to
//// an address it will not follow (`is_safe_url`) stays text, and a box with
//// nothing after it is a task.
////
//// Imported by: `preview`, `storage`, `surface` (M6), the shell, tests.
//// Imports: stdlib, and `markdown.ffi.mjs` for two Unicode classes.

import gleam/dict.{type Dict}
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/order
import gleam/result
import gleam/string

/// A block plus the source rows it came from (inclusive, numbered like
/// `buffer.Position.row`).
pub type Block {
  Block(first_row: Int, last_row: Int, content: Content)
}

pub type Content {
  // M2
  Heading(level: Level, text: List(Inline))
  /// A line break between source lines stays in the text as "\n" (a soft
  /// break). The page shows it as a line break.
  Paragraph(text: List(Inline))
  // M3
  BulletList(spacing: Spacing, items: List(Item))
  /// `start` is the first item's number. Later numbers are not kept.
  OrderedList(start: Int, spacing: Spacing, items: List(Item))
  Quote(blocks: List(Block))
  CodeBlock(language: Option(String), code: String)
  Rule
  /// A GFM pipe table. Every row has one cell for each column: the parser
  /// pads a short row with empty cells and drops the cells past the last
  /// column, so nothing that reads a table checks a length. A table with no
  /// rows is a header alone.
  Table(columns: List(Column), rows: List(List(Cell)))
}

/// A column holds its alignment and its heading together, so a header row and
/// a delimiter row that disagree on the number of columns cannot exist.
pub type Column {
  Column(alignment: Alignment, heading: Cell)
}

pub type Alignment {
  Unaligned
  Left
  Center
  Right
}

/// What sits between two pipes: inlines only, on one line.
pub type Cell =
  List(Inline)

/// A tight list shows each item's own paragraphs as bare text. A list is
/// loose when two of its items, or two blocks directly inside one item, have
/// a blank line between them.
pub type Spacing {
  Tight
  Loose
}

/// An item is a list of blocks, so a nested list is just a list block inside
/// an item: nesting falls out of the recursion. `row` is the item's first
/// line, the one that holds its marker.
pub type Item {
  Item(row: Int, task: Option(Task), blocks: List(Block))
}

/// The box of a task item: `[ ]`, or `[x]` when `checked`, at the start of
/// the item's first paragraph. `row` and `col` place the character between
/// the brackets, `col` counted in code points from the start of the line.
pub type Task {
  Task(checked: Bool, row: Int, col: Int)
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
  Link(label: List(Inline), url: String, title: Option(String))
  // M3
  Strike(List(Inline))
}

/// Parse a whole note. Total: any text is a valid document (unknown or
/// unclosed syntax becomes plain `Text`, and raw HTML is just text), so there
/// is no error type.
pub fn parse(source: String) -> List(Block) {
  let lines = source_lines(source)
  lines
  |> list.index_fold(Open([], [], 0, NoLeaf), fn(open, chars, row) {
    step(open, new_line(row, chars))
  })
  |> finish(list.length(lines))
}

fn source_lines(source: String) -> List(List(String)) {
  source |> string.replace("\u{0}", "\u{FFFD}") |> code_point_lines
}

fn code_point_lines(source: String) -> List(List(String)) {
  let backwards =
    source
    |> string.to_utf_codepoints
    |> list.fold([], fn(backwards, codepoint) {
      [string.from_utf_codepoints([codepoint]), ..backwards]
    })
  case backwards {
    ["\n", "\r", ..rest] | ["\n", ..rest] | ["\r", ..rest] ->
      split_lines(rest, [], [])
    _ -> split_lines(backwards, [], [])
  }
}

fn split_lines(
  backwards: List(String),
  line: List(String),
  lines: List(List(String)),
) -> List(List(String)) {
  case backwards {
    [] -> [line, ..lines]
    ["\n", "\r", ..rest] | ["\n", ..rest] | ["\r", ..rest] ->
      split_lines(rest, [], [line, ..lines])
    [char, ..rest] -> split_lines(rest, [char, ..line], lines)
  }
}

type Line {
  Line(
    row: Int,
    offset: Int,
    /// Columns eaten so far. A tab reaches the next multiple of 4.
    column: Int,
    tab_remainder: Int,
    margin: List(String),
    indent: Int,
    text: List(String),
  )
}

fn new_line(row: Int, chars: List(String)) -> Line {
  measure(Line(row, 0, 0, 0, [], 0, []), chars)
}

fn measure(line: Line, chars: List(String)) -> Line {
  let #(margin, text) = list.split_while(chars, is_space_or_tab)
  let end =
    list.fold(margin, line.column, fn(column, char) {
      case char {
        "\t" -> column + 4 - column % 4
        _ -> column + 1
      }
    })
  Line(..line, tab_remainder: 0, margin:, indent: end - line.column, text:)
}

fn skip_margin(line: Line) -> Line {
  Line(
    ..line,
    offset: line.offset + list.length(line.margin),
    column: line.column + line.indent,
    tab_remainder: 0,
    margin: [],
    indent: 0,
  )
}

fn eat_columns(line: Line, count: Int) -> Line {
  case line.margin {
    _ if count <= 0 -> line
    _ if line.tab_remainder > 0 -> {
      let eaten = int.min(count, line.tab_remainder)
      eat_columns(
        Line(
          ..line,
          column: line.column + eaten,
          tab_remainder: line.tab_remainder - eaten,
          indent: line.indent - eaten,
        ),
        count - eaten,
      )
    }
    [" ", ..margin] ->
      eat_columns(
        Line(
          ..line,
          offset: line.offset + 1,
          column: line.column + 1,
          margin:,
          indent: line.indent - 1,
        ),
        count - 1,
      )
    ["\t", ..margin] -> {
      let width = 4 - line.column % 4
      let eaten = int.min(count, width)
      eat_columns(
        Line(
          ..line,
          offset: line.offset + 1,
          column: line.column + eaten,
          tab_remainder: width - eaten,
          margin:,
          indent: line.indent - eaten,
        ),
        count - eaten,
      )
    }
    _ -> line
  }
}

fn eat_text(line: Line, count: Int) -> Line {
  let line = skip_margin(line)
  measure(
    Line(..line, offset: line.offset + count, column: line.column + count),
    list.drop(line.text, count),
  )
}

fn verbatim(line: Line) -> List(String) {
  list.append(
    list.repeat(" ", line.tab_remainder),
    list.append(line.margin, line.text),
  )
}

fn after_quote_mark(line: Line) -> Line {
  eat_columns(eat_text(line, 1), 1)
}

/// Like `max_depth`: the JavaScript stack limits how deep a tree walk can
/// recurse.
const max_block_depth = 32

type Open {
  Open(blocks: List(Block), frames: List(Frame), depth: Int, leaf: Leaf)
}

type Frame {
  Frame(container: Container, blocks: List(Block))
}

type Container {
  InQuote(first_row: Int)
  InList(of: OpenList, item: Option(OpenItem))
}

type OpenList {
  OpenList(
    first_row: Int,
    last_row: Int,
    marker: Marker,
    start: Int,
    items: List(Item),
    spacing: Spacing,
  )
}

type OpenItem {
  OpenItem(row: Int, width: Int, task: Option(Task))
}

type Marker {
  Bullet(String)
  Ordered(delimiter: String)
}

type Leaf {
  NoLeaf
  ParagraphLeaf(first_row: Int, last_row: Int, lines: List(List(String)))
  FencedLeaf(
    first_row: Int,
    fence: String,
    length: Int,
    fence_indent: Int,
    language: Option(String),
    lines: List(List(String)),
  )
  IndentedLeaf(
    first_row: Int,
    last_row: Int,
    lines: List(List(String)),
    blanks: List(List(String)),
  )
}

type Start {
  Blank
  TextLine
  QuoteStart(rest: Line)
  NextItem(width: Int, rest: Line)
  ListStart(marker: Marker, number: Int, width: Int, rest: Line)
  HeadingStart(level: Level, text: List(String))
  RuleStart
  FenceStart(fence: String, length: Int, indent: Int, language: Option(String))
  CodeStart(rest: Line)
}

fn step(open: Open, line: Line) -> Open {
  let #(matched, line) = continue_frames(list.reverse(open.frames), 0, line)
  case matched == open.depth {
    True -> continue_leaf(open, line)
    False -> start_blocks(open, matched, line)
  }
}

fn continue_frames(
  frames: List(Frame),
  matched: Int,
  line: Line,
) -> #(Int, Line) {
  case frames {
    [] -> #(matched, line)
    [frame, ..inner] ->
      case continue_frame(frame.container, line) {
        Ok(line) -> continue_frames(inner, matched + 1, line)
        Error(Nil) -> #(matched, line)
      }
  }
}

fn continue_frame(container: Container, line: Line) -> Result(Line, Nil) {
  case container, line.text {
    InQuote(_), [">", ..] if line.indent < 4 -> Ok(after_quote_mark(line))
    InQuote(_), _ -> Error(Nil)
    InList(..), [] -> Ok(skip_margin(line))
    InList(item: Some(item), ..), _ if line.indent >= item.width ->
      Ok(eat_columns(line, item.width))
    InList(..), _ -> Error(Nil)
  }
}

fn continue_leaf(open: Open, line: Line) -> Open {
  case open.leaf, line.text {
    NoLeaf, _ -> start_blocks(open, open.depth, line)
    ParagraphLeaf(..), [] -> close_leaf(open, line.row)
    ParagraphLeaf(first_row:, lines:, ..), text if line.indent < 4 ->
      case setext_level(text) {
        Ok(level) -> {
          let heading = Heading(level, inlines(paragraph_text(lines)))
          Open(..open, leaf: NoLeaf)
          |> push_block(Block(first_row, line.row, heading))
        }
        Error(Nil) -> start_blocks(open, open.depth, line)
      }
    ParagraphLeaf(..), _ -> start_blocks(open, open.depth, line)
    FencedLeaf(fence:, length:, fence_indent:, lines:, ..) as leaf, text ->
      case line.indent < 4 && closes_fence(text, fence, length) {
        True -> close_leaf(open, line.row)
        False -> {
          let code =
            verbatim(eat_columns(line, int.min(fence_indent, line.indent)))
          Open(..open, leaf: FencedLeaf(..leaf, lines: [code, ..lines]))
        }
      }
    IndentedLeaf(lines:, blanks:, ..) as leaf, text ->
      case line.indent >= 4, text {
        True, [] -> {
          let blank = verbatim(eat_columns(line, 4))
          Open(..open, leaf: IndentedLeaf(..leaf, blanks: [blank, ..blanks]))
        }
        False, [] ->
          Open(..open, leaf: IndentedLeaf(..leaf, blanks: [[], ..blanks]))
        True, _ -> {
          let lines = [
            verbatim(eat_columns(line, 4)),
            ..list.append(blanks, lines)
          ]
          Open(
            ..open,
            leaf: IndentedLeaf(..leaf, last_row: line.row, lines:, blanks: []),
          )
        }
        False, _ -> start_blocks(open, open.depth, line)
      }
  }
}

fn start_blocks(open: Open, matched: Int, line: Line) -> Open {
  let row = line.row
  case start(open, matched, line), open.leaf {
    TextLine, ParagraphLeaf(first_row:, lines:, ..) ->
      Open(..open, leaf: ParagraphLeaf(first_row, row, [line.text, ..lines]))
    TextLine, _ -> open_paragraph(close_to(open, matched, row), line)
    Blank, _ -> close_to(open, matched, row) |> end_empty_item(row)
    QuoteStart(rest), _ ->
      close_to(open, matched, row)
      |> push_frame(InQuote(row))
      |> start_blocks(matched + 1, rest)
    NextItem(width:, rest:), _ ->
      close_to(open, matched + 1, row)
      |> next_item(row, width)
      |> start_blocks(matched + 1, rest)
    ListStart(marker:, number:, width:, rest:), _ -> {
      let of = OpenList(row, row, marker, number, [], Tight)
      close_to(open, matched, row)
      |> push_frame(InList(of, Some(OpenItem(row, width, None))))
      |> start_blocks(matched + 1, rest)
    }
    HeadingStart(level, text), _ ->
      close_to(open, matched, row)
      |> push_block(Block(row, row, Heading(level, inlines(text))))
    RuleStart, _ ->
      close_to(open, matched, row) |> push_block(Block(row, row, Rule))
    FenceStart(fence, length, indent, language), _ ->
      Open(
        ..close_to(open, matched, row),
        leaf: FencedLeaf(row, fence, length, indent, language, []),
      )
    CodeStart(rest), _ ->
      Open(
        ..close_to(open, matched, row),
        leaf: IndentedLeaf(row, row, [verbatim(rest)], []),
      )
  }
}

/// Indented code cannot interrupt a paragraph.
fn start(open: Open, matched: Int, line: Line) -> Start {
  case line.text, open.leaf {
    [], _ -> Blank
    _, ParagraphLeaf(..) if line.indent >= 4 -> TextLine
    _, _ if line.indent >= 4 -> CodeStart(eat_columns(line, 4))
    _, _ -> start_text(open, matched, line)
  }
}

fn start_text(open: Open, matched: Int, line: Line) -> Start {
  case line.text {
    [">", ..] if matched < max_block_depth -> QuoteStart(after_quote_mark(line))
    ["#", ..] as text ->
      case heading(text) {
        Ok(#(level, text)) -> HeadingStart(level, text)
        Error(Nil) -> TextLine
      }
    ["`", ..] as text | ["~", ..] as text ->
      case fence_start(text, line.indent) {
        Ok(start) -> start
        Error(Nil) -> TextLine
      }
    ["*", ..] as text | ["-", ..] as text | ["_", ..] as text ->
      case is_rule(text) {
        True -> RuleStart
        False -> item_start(open, matched, line)
      }
    _ -> item_start(open, matched, line)
  }
}

/// An item that interrupts a paragraph must not be empty, and an ordered one
/// must start at 1.
fn item_start(open: Open, matched: Int, line: Line) -> Start {
  case list_marker(line.text) {
    Error(Nil) -> TextLine
    Ok(#(marker, number, length)) -> {
      let after = eat_text(line, length)
      let blank = after.text == []
      let interrupts = case open.leaf {
        ParagraphLeaf(..) -> matched == open.depth
        _ -> False
      }
      let sibling = is_sibling(open, matched, marker)
      let item = fn(width, rest) {
        case sibling {
          True -> NextItem(width, rest)
          False -> ListStart(marker, number, width, rest)
        }
      }
      case after.indent {
        0 if !blank -> TextLine
        _ if interrupts && { blank || number != 1 } -> TextLine
        _ if !sibling && matched >= max_block_depth -> TextLine
        // Spec: an item that begins blank, or with indented code, is one
        // column wider than its marker.
        spaces if blank || spaces >= 5 ->
          item(line.indent + length + 1, eat_columns(after, 1))
        spaces -> item(line.indent + length + spaces, skip_margin(after))
      }
    }
  }
}

fn is_sibling(open: Open, matched: Int, marker: Marker) -> Bool {
  case list.drop(open.frames, open.depth - matched - 1) {
    [Frame(InList(of:, ..), _), ..] if matched < open.depth ->
      of.marker == marker
    _ -> False
  }
}

fn list_marker(text: List(String)) -> Result(#(Marker, Int, Int), Nil) {
  case text {
    ["-" as bullet, ..] | ["+" as bullet, ..] | ["*" as bullet, ..] ->
      Ok(#(Bullet(bullet), 1, 1))
    _ -> ordered_marker(text, 0, 0)
  }
}

fn ordered_marker(
  text: List(String),
  number: Int,
  digits: Int,
) -> Result(#(Marker, Int, Int), Nil) {
  case text {
    ["." as delimiter, ..] | [")" as delimiter, ..] if digits > 0 ->
      Ok(#(Ordered(delimiter), number, digits + 1))
    [char, ..rest] if digits < 9 ->
      case int.parse(char) {
        Ok(digit) -> ordered_marker(rest, number * 10 + digit, digits + 1)
        Error(Nil) -> Error(Nil)
      }
    _ -> Error(Nil)
  }
}

fn is_rule(text: List(String)) -> Bool {
  case text {
    [mark, ..] ->
      list.fold_until(text, 0, fn(marks, char) {
        case char == mark, is_space_or_tab(char) {
          True, _ -> list.Continue(marks + 1)
          False, True -> list.Continue(marks)
          False, False -> list.Stop(0)
        }
      })
      >= 3
    [] -> False
  }
}

/// The info string of a backtick fence may not hold a backtick, so "``` a ` b"
/// stays a code span.
fn fence_start(text: List(String), indent: Int) -> Result(Start, Nil) {
  case text {
    [fence, ..] -> {
      let #(length, info) = count_run(text, fence, 0)
      case length >= 3 && !{ fence == "`" && list.contains(info, "`") } {
        True -> Ok(FenceStart(fence, length, indent, language(info)))
        False -> Error(Nil)
      }
    }
    [] -> Error(Nil)
  }
}

fn language(info: List(String)) -> Option(String) {
  let word =
    info
    |> drop_spaces
    |> list.take_while(fn(char) { !is_space_or_tab(char) })
    |> unescape("")
  case word {
    "" -> None
    _ -> Some(word)
  }
}

fn unescape(chars: List(String), done: String) -> String {
  case chars {
    [] -> done
    ["\\", char, ..rest] ->
      case is_ascii_punctuation(char) {
        True -> unescape(rest, done <> char)
        False -> unescape([char, ..rest], done <> "\\")
      }
    [char, ..rest] -> unescape(rest, done <> char)
  }
}

fn closes_fence(text: List(String), fence: String, length: Int) -> Bool {
  let #(run, after) = count_run(text, fence, 0)
  run >= length && drop_spaces(after) == []
}

fn setext_level(text: List(String)) -> Result(Level, Nil) {
  let underline = fn(mark, level) {
    case drop_spaces(list.drop_while(text, fn(char) { char == mark })) {
      [] -> Ok(level)
      _ -> Error(Nil)
    }
  }
  case text {
    ["=", ..] -> underline("=", H1)
    ["-", ..] -> underline("-", H2)
    _ -> Error(Nil)
  }
}

fn open_paragraph(open: Open, line: Line) -> Open {
  let line = skip_margin(line)
  let paragraph = fn(open: Open, text) {
    Open(..open, leaf: ParagraphLeaf(line.row, line.row, [text]))
  }
  case open.frames, task_box(line) {
    [Frame(InList(of, Some(OpenItem(task: None, ..) as item)), []), ..outer],
      Ok(#(task, rest))
    -> {
      let item = OpenItem(..item, task: Some(task))
      let open =
        Open(..open, frames: [Frame(InList(of, Some(item)), []), ..outer])
      case rest {
        [] -> open
        text -> paragraph(open, text)
      }
    }
    _, _ -> paragraph(open, line.text)
  }
}

fn task_box(line: Line) -> Result(#(Task, List(String)), Nil) {
  case line.text {
    ["[", mark, "]", ..after] if mark == " " || mark == "x" || mark == "X" ->
      case after {
        [] | [" ", ..] | ["\t", ..] ->
          Ok(#(Task(mark != " ", line.row, line.offset + 1), drop_spaces(after)))
        _ -> Error(Nil)
      }
    _ -> Error(Nil)
  }
}

fn push_frame(open: Open, container: Container) -> Open {
  Open(
    ..open,
    frames: [Frame(container, []), ..open.frames],
    depth: open.depth + 1,
  )
}

fn close_to(open: Open, depth: Int, row: Int) -> Open {
  let open = close_leaf(open, row - 1)
  case open.frames {
    [frame, ..outer] if open.depth > depth ->
      Open(..open, frames: outer, depth: open.depth - 1)
      |> push_block(close_frame(frame, row - 1))
      |> close_to(depth, row)
    _ -> open
  }
}

fn close_frame(frame: Frame, last_row: Int) -> Block {
  case frame.container {
    InQuote(first_row) ->
      Block(first_row, last_row, Quote(list.reverse(frame.blocks)))
    InList(of, item) -> {
      let of = end_open_item(of, item, frame.blocks)
      let items = list.reverse(of.items)
      let content = case of.marker {
        Bullet(_) -> BulletList(of.spacing, items)
        Ordered(_) -> OrderedList(of.start, of.spacing, items)
      }
      Block(of.first_row, of.last_row, content)
    }
  }
}

fn end_open_item(
  of: OpenList,
  item: Option(OpenItem),
  blocks: List(Block),
) -> OpenList {
  case item {
    Some(item) -> end_item(of, item, blocks)
    None -> of
  }
}

fn end_item(of: OpenList, item: OpenItem, blocks: List(Block)) -> OpenList {
  let last_row = case blocks {
    [last, ..] -> last.last_row
    [] -> item.row
  }
  OpenList(
    ..of,
    last_row:,
    items: [Item(item.row, item.task, list.reverse(blocks)), ..of.items],
    spacing: loosen(of.spacing, has_gap(blocks)),
  )
}

fn next_item(open: Open, row: Int, width: Int) -> Open {
  case open.frames {
    [Frame(InList(of, item), blocks), ..outer] -> {
      let of = end_open_item(of, item, blocks)
      let of =
        OpenList(..of, spacing: loosen(of.spacing, row > of.last_row + 1))
      let frame = Frame(InList(of, Some(OpenItem(row, width, None))), [])
      Open(..open, frames: [frame, ..outer])
    }
    _ -> open
  }
}

fn end_empty_item(open: Open, row: Int) -> Open {
  case open.frames, open.leaf {
    [Frame(InList(of, Some(OpenItem(task: None, ..) as item)), []), ..outer],
      NoLeaf
      if item.row < row
    -> {
      let frame = Frame(InList(end_item(of, item, []), None), [])
      Open(..open, frames: [frame, ..outer])
    }
    _, _ -> open
  }
}

fn loosen(spacing: Spacing, gap: Bool) -> Spacing {
  case gap {
    True -> Loose
    False -> spacing
  }
}

fn has_gap(blocks: List(Block)) -> Bool {
  case blocks {
    [later, earlier, ..rest] ->
      case later.first_row > earlier.last_row + 1 {
        True -> True
        False -> has_gap([earlier, ..rest])
      }
    _ -> False
  }
}

fn close_leaf(open: Open, fence_end: Int) -> Open {
  let closed = Open(..open, leaf: NoLeaf)
  case open.leaf {
    NoLeaf -> open
    ParagraphLeaf(first_row, last_row, lines) ->
      push_block(
        closed,
        Block(first_row, last_row, Paragraph(inlines(paragraph_text(lines)))),
      )
    FencedLeaf(first_row:, language:, lines:, ..) ->
      push_block(
        closed,
        Block(first_row, fence_end, CodeBlock(language, code_text(lines))),
      )
    IndentedLeaf(first_row:, last_row:, lines:, ..) ->
      push_block(
        closed,
        Block(first_row, last_row, CodeBlock(None, code_text(lines))),
      )
  }
}

fn push_block(open: Open, block: Block) -> Open {
  case open.frames {
    [] -> Open(..open, blocks: [block, ..open.blocks])
    [frame, ..outer] ->
      Open(..open, frames: [
        Frame(..frame, blocks: [block, ..frame.blocks]),
        ..outer
      ])
  }
}

fn finish(open: Open, rows: Int) -> List(Block) {
  list.reverse(close_to(open, 0, rows).blocks)
}

fn code_text(backwards: List(List(String))) -> String {
  list.fold(backwards, [], fn(code, line) {
    [string.concat(line), "\n", ..code]
  })
  |> string.concat
}

fn paragraph_text(backwards: List(List(String))) -> List(String) {
  case backwards {
    [last, ..before] ->
      list.fold(before, drop_spaces_end(last), fn(text, line) {
        list.append(line, ["\n", ..text])
      })
    [] -> []
  }
}

fn heading(line: List(String)) -> Result(#(Level, List(String)), Nil) {
  let #(marks, after_marks) = list.split_while(line, fn(char) { char == "#" })
  let level = case list.length(marks) {
    1 -> Ok(H1)
    2 -> Ok(H2)
    3 -> Ok(H3)
    4 -> Ok(H4)
    5 -> Ok(H5)
    6 -> Ok(H6)
    _ -> Error(Nil)
  }
  case level, after_marks {
    Ok(level), [] | Ok(level), [" ", ..] | Ok(level), ["\t", ..] ->
      Ok(#(level, heading_content(after_marks)))
    _, _ -> Error(Nil)
  }
}

/// The optional closing run of `#` goes when a space or tab comes before it,
/// or when it is all there is: `# foo #` is "foo", `# foo#` is "foo#".
fn heading_content(after_marks: List(String)) -> List(String) {
  let backwards = after_marks |> drop_spaces |> list.reverse |> drop_spaces
  case list.drop_while(backwards, fn(char) { char == "#" }) {
    [] -> []
    [" ", ..] as before | ["\t", ..] as before ->
      before |> drop_spaces |> list.reverse
    _ -> list.reverse(backwards)
  }
}

fn drop_spaces(chars: List(String)) -> List(String) {
  list.drop_while(chars, fn(char) { char == " " || char == "\t" })
}

fn drop_spaces_end(chars: List(String)) -> List(String) {
  chars |> list.reverse |> drop_spaces |> list.reverse
}

// Links settle before emphasis: link text binds tighter, so `*[a*](u)` is a
// link with a `*` inside.

type Piece {
  /// Finished: text, a code span, a link. `depth` is how deeply it nests.
  Done(inline: Inline, depth: Int)
  DelimiterRun(symbol: Symbol, length: Int, opens: Bool, closes: Bool)
  /// A `[` in place. Text, unless a later `]` makes a link of it.
  Bracket(id: Int)
}

type Symbol {
  Star
  Underscore
  Tilde
}

/// One flat list of pieces for the whole text, so a `]` that makes no link
/// costs one step, and a link pays only for its own text, which it consumes.
type Scan {
  Scan(
    /// Newest first.
    pieces: List(Piece),
    /// The `[` that may still start a link, innermost first.
    brackets: List(Int),
    next_id: Int,
  )
}

/// A pair of marks, or a link, that would nest deeper than this is not built:
/// its marks stay text around its content. Everything that walks the tree
/// (the page, Lustre's diff, `==`) recurses once per level, so a tree as deep
/// as the text is long overflows the stack.
const max_depth = 32

const safe_schemes = ["http", "https", "mailto"]

/// Whether nullpad follows a link to `url`: only http, https, mailto and
/// relative paths. The parser leaves any other link as the text that was
/// typed, so the page, the note list and a later export all agree and
/// nothing the user wrote goes missing.
pub fn is_safe_url(url: String) -> Bool {
  case string.split_once(url, ":") {
    Error(Nil) -> True
    Ok(#(before_colon, _)) ->
      list.contains(safe_schemes, string.lowercase(before_colon))
      || !may_be_scheme(before_colon)
  }
}

/// A scheme holds only ASCII letters, digits, `+`, `-` and `.`, so text with
/// anything else before the first colon is a relative path. Spaces and
/// control characters are the exception: browsers drop some of them before
/// they read the scheme, so they do not make a URL relative here.
fn may_be_scheme(before_colon: String) -> Bool {
  before_colon
  |> string.to_utf_codepoints
  |> list.all(fn(codepoint) {
    case string.utf_codepoint_to_int(codepoint) {
      code if code <= 0x20 -> True
      0x2B | 0x2D | 0x2E -> True
      code if code >= 0x30 && code <= 0x39 -> True
      code if code >= 0x41 && code <= 0x5A -> True
      code if code >= 0x61 && code <= 0x7A -> True
      _ -> False
    }
  })
}

fn inlines(chars: List(String)) -> List(Inline) {
  let Scan(pieces:, ..) = scan(chars, "", "", Scan([], [], 0))
  let #(inlines, _) = emphasize(list.reverse(pieces))
  inlines
}

/// `previous` is the source character just before `chars`, "" at the start.
/// `text` is plain text read since the last piece.
fn scan(
  chars: List(String),
  previous: String,
  text: String,
  state: Scan,
) -> Scan {
  case chars {
    [] -> add_text(state, text)
    ["\\", char, ..rest] ->
      case is_ascii_punctuation(char) {
        True -> scan(rest, char, text <> char, state)
        False -> scan([char, ..rest], "\\", text <> "\\", state)
      }
    ["`", ..] -> {
      let #(ticks, after) = count_run(chars, "`", 0)
      case code_span(after, ticks, []) {
        Ok(#(code, rest)) ->
          scan(rest, "`", "", add(add_text(state, text), Done(Code(code), 0)))
        Error(Nil) -> scan(after, "`", text <> string.repeat("`", ticks), state)
      }
    }
    ["*" as mark, ..] | ["_" as mark, ..] -> {
      let #(length, after) = count_run(chars, mark, 0)
      let next = case after {
        [next, ..] -> next
        [] -> ""
      }
      let run = delimiter_run(mark, length, previous, next)
      scan(after, mark, "", add(add_text(state, text), run))
    }
    ["~", ..] -> {
      let #(length, after) = count_run(chars, "~", 0)
      let next = case after {
        [next, ..] -> next
        [] -> ""
      }
      // GFM: only a run of one or two tildes can strike through.
      case length > 2 {
        True -> scan(after, "~", text <> string.repeat("~", length), state)
        False -> {
          let run = delimiter_run("~", length, previous, next)
          scan(after, "~", "", add(add_text(state, text), run))
        }
      }
    }
    ["[", ..rest] -> {
      let Scan(pieces, brackets, id) = add_text(state, text)
      scan(
        rest,
        "[",
        "",
        Scan([Bracket(id), ..pieces], [id, ..brackets], id + 1),
      )
    }
    ["]", ..rest] ->
      case state.brackets {
        [] -> scan(rest, "]", text <> "]", state)
        [id, ..outer] ->
          case link_tail(rest) {
            Error(Nil) ->
              scan(rest, "]", text <> "]", Scan(..state, brackets: outer))
            Ok(tail) ->
              scan(
                tail.rest,
                ")",
                "",
                close_link(add_text(state, text), id, tail),
              )
          }
      }
    [" " as space, ..] | ["\t" as space, ..] -> {
      let #(spaces, after) = list.split_while(chars, is_space_or_tab)
      case after {
        ["\n", ..] -> scan(after, space, text, state)
        _ -> scan(after, space, text <> string.concat(spaces), state)
      }
    }
    [char, ..rest] -> scan(rest, char, text <> char, state)
  }
}

fn add(scan: Scan, piece: Piece) -> Scan {
  Scan(..scan, pieces: [piece, ..scan.pieces])
}

fn add_text(scan: Scan, text: String) -> Scan {
  case text {
    "" -> scan
    _ -> add(scan, Done(Text(text), 0))
  }
}

fn count_run(
  chars: List(String),
  mark: String,
  count: Int,
) -> #(Int, List(String)) {
  case chars {
    [char, ..rest] if char == mark -> count_run(rest, mark, count + 1)
    _ -> #(count, chars)
  }
}

/// Reads up to the next run of exactly `ticks` backticks. `content` is what
/// it read so far, last first, with each line ending already a space.
fn code_span(
  chars: List(String),
  ticks: Int,
  content: List(String),
) -> Result(#(String, List(String)), Nil) {
  case chars {
    [] -> Error(Nil)
    ["`", ..] ->
      case count_run(chars, "`", 0) {
        #(run, rest) if run == ticks -> Ok(#(code_content(content), rest))
        #(run, rest) ->
          code_span(rest, ticks, [string.repeat("`", run), ..content])
      }
    ["\n", ..rest] -> code_span(rest, ticks, [" ", ..content])
    [char, ..rest] -> code_span(rest, ticks, [char, ..content])
  }
}

/// One space comes off each end when both ends have one and the code is not
/// all spaces, so "`` `a` ``" is "`a`".
fn code_content(backwards: List(String)) -> String {
  let chars = list.reverse(backwards)
  case chars, backwards {
    [" ", ..], [" ", ..] ->
      case list.all(chars, fn(char) { char == " " }) {
        True -> string.concat(chars)
        False ->
          backwards
          |> list.drop(1)
          |> list.reverse
          |> list.drop(1)
          |> string.concat
      }
    _, _ -> string.concat(chars)
  }
}

/// The flanking rules, 1 to 8 of "Emphasis and strong emphasis". The start
/// and the end of the text count as whitespace.
fn delimiter_run(
  mark: String,
  length: Int,
  before: String,
  after: String,
) -> Piece {
  let space_before = is_whitespace(before)
  let space_after = is_whitespace(after)
  let punctuation_before = is_punctuation(before)
  let punctuation_after = is_punctuation(after)
  let left =
    !space_after && { !punctuation_after || space_before || punctuation_before }
  let right =
    !space_before && { !punctuation_before || space_after || punctuation_after }
  case mark {
    "_" ->
      DelimiterRun(
        Underscore,
        length,
        opens: left && { !right || punctuation_before },
        closes: right && { !left || punctuation_after },
      )
    "~" -> DelimiterRun(Tilde, length, opens: left, closes: right)
    _ -> DelimiterRun(Star, length, opens: left, closes: right)
  }
}

fn is_whitespace(char: String) -> Bool {
  char == "" || is_unicode_whitespace(char)
}

fn is_punctuation(char: String) -> Bool {
  char != "" && is_unicode_punctuation(char)
}

@external(javascript, "./markdown.ffi.mjs", "isUnicodeWhitespace")
fn is_unicode_whitespace(char: String) -> Bool

@external(javascript, "./markdown.ffi.mjs", "isUnicodePunctuation")
fn is_unicode_punctuation(char: String) -> Bool

fn is_ascii_punctuation(char: String) -> Bool {
  char != "" && string.contains("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~", char)
}

fn is_space_or_tab(char: String) -> Bool {
  char == " " || char == "\t"
}

/// U+0000 to U+001F and U+007F. A one-code-point string sorts below " "
/// exactly when it is one of the first 32.
fn is_ascii_control(char: String) -> Bool {
  string.compare(char, " ") == order.Lt || char == "\u{7F}"
}

/// Links do not nest, so once a link forms no `[` to its left may start one.
/// A link that is too deep or not safe to follow stays as typed, and still
/// uses up the brackets, so its text is never paired twice.
fn close_link(scan: Scan, id: Int, tail: Tail) -> Scan {
  let #(text, outside) = split_at_bracket(scan.pieces, id, [])
  let #(children, depth) = emphasize(text)
  let pieces = case depth < max_depth && is_safe_url(tail.url) {
    True -> [Done(Link(children, tail.url, tail.title), depth + 1), ..outside]
    False -> {
      let opened = [Done(Text("["), 0), ..outside]
      let label =
        list.fold(children, opened, fn(pieces, child) {
          [Done(child, depth), ..pieces]
        })
      [Done(Text(tail.source), 0), ..label]
    }
  }
  Scan(..scan, pieces:, brackets: [])
}

/// The pieces after `Bracket(id)`, oldest first, and the ones before it.
fn split_at_bracket(
  pieces: List(Piece),
  id: Int,
  text: List(Piece),
) -> #(List(Piece), List(Piece)) {
  case pieces {
    [] -> #(text, [])
    [Bracket(found), ..outside] if found == id -> #(text, outside)
    [piece, ..rest] -> split_at_bracket(rest, id, [piece, ..text])
  }
}

/// What an inline link has after its `]`: `(`, a destination, a title, `)`.
/// `source` is all of it as typed, for a link the depth cap refuses.
type Tail {
  Tail(url: String, title: Option(String), rest: List(String), source: String)
}

/// Characters not read yet, and the source text read so far.
type Reader {
  Reader(rest: List(String), read: String)
}

fn link_tail(chars: List(String)) -> Result(Tail, Nil) {
  case chars {
    ["(", ..rest] -> {
      let #(_, reader) = whitespace(Reader(rest, "]("), False, False)
      use #(url, reader) <- result.try(destination(reader))
      use #(title, reader) <- result.try(title(reader))
      case reader.rest {
        [")", ..rest] -> Ok(Tail(url, title, rest, reader.read <> ")"))
        _ -> Error(Nil)
      }
    }
    _ -> Error(Nil)
  }
}

/// Spaces, tabs and at most one line ending. `skipped` says whether there
/// were any.
fn whitespace(
  reader: Reader,
  line_ended: Bool,
  skipped: Bool,
) -> #(Bool, Reader) {
  case reader.rest {
    [" " as char, ..rest] | ["\t" as char, ..rest] ->
      whitespace(Reader(rest, reader.read <> char), line_ended, True)
    ["\n", ..rest] if !line_ended ->
      whitespace(Reader(rest, reader.read <> "\n"), True, True)
    _ -> #(skipped, reader)
  }
}

fn destination(reader: Reader) -> Result(#(String, Reader), Nil) {
  case reader.rest {
    ["<", ..rest] -> pointy_destination(rest, "", reader.read <> "<")
    _ -> plain_destination(reader.rest, "", reader.read, 0)
  }
}

fn pointy_destination(
  chars: List(String),
  url: String,
  read: String,
) -> Result(#(String, Reader), Nil) {
  case chars {
    [">", ..rest] -> Ok(#(url, Reader(rest, read <> ">")))
    [] | ["\n", ..] | ["<", ..] -> Error(Nil)
    ["\\", char, ..rest] ->
      case is_ascii_punctuation(char) {
        True -> pointy_destination(rest, url <> char, read <> "\\" <> char)
        False -> pointy_destination([char, ..rest], url <> "\\", read <> "\\")
      }
    [char, ..rest] -> pointy_destination(rest, url <> char, read <> char)
  }
}

/// A `(` in a url that never closes raises the depth of every earlier scan
/// still reading it, so no character is read by more than this many failing
/// scans, plus one.
const max_nesting = 32

/// Ends before a space, a control character or a `)` that closes nothing,
/// and only where its parentheses balance.
fn plain_destination(
  chars: List(String),
  url: String,
  read: String,
  depth: Int,
) -> Result(#(String, Reader), Nil) {
  case chars {
    ["\\", char, ..rest] ->
      case is_ascii_punctuation(char) {
        True ->
          plain_destination(rest, url <> char, read <> "\\" <> char, depth)
        False ->
          plain_destination([char, ..rest], url <> "\\", read <> "\\", depth)
      }
    ["(", ..rest] if depth < max_nesting ->
      plain_destination(rest, url <> "(", read <> "(", depth + 1)
    [")", ..rest] if depth > 0 ->
      plain_destination(rest, url <> ")", read <> ")", depth - 1)
    [char, ..rest] ->
      case char == "(" || char == ")" || char == " " || is_ascii_control(char) {
        False -> plain_destination(rest, url <> char, read <> char, depth)
        True if depth == 0 -> Ok(#(url, Reader(chars, read)))
        True -> Error(Nil)
      }
    [] if depth == 0 -> Ok(#(url, Reader(chars, read)))
    [] -> Error(Nil)
  }
}

/// The optional title, which must be set off from the destination by
/// whitespace, and the whitespace before the `)`.
fn title(reader: Reader) -> Result(#(Option(String), Reader), Nil) {
  case whitespace(reader, False, False) {
    #(True, Reader(["\"" as open, ..rest], read))
    | #(True, Reader(["'" as open, ..rest], read))
    | #(True, Reader(["(" as open, ..rest], read)) -> {
      let close = case open {
        "(" -> ")"
        _ -> open
      }
      use #(title, after) <- result.map(title_text(
        rest,
        close,
        "",
        read <> open,
      ))
      #(Some(title), whitespace(after, False, False).1)
    }
    #(_, spaced) -> Ok(#(None, spaced))
  }
}

/// `close` ends the title. A `(…)` title may not hold an unescaped `(`.
fn title_text(
  chars: List(String),
  close: String,
  title: String,
  read: String,
) -> Result(#(String, Reader), Nil) {
  case chars {
    [] -> Error(Nil)
    ["\\", char, ..rest] ->
      case is_ascii_punctuation(char) {
        True -> title_text(rest, close, title <> char, read <> "\\" <> char)
        False -> title_text([char, ..rest], close, title <> "\\", read <> "\\")
      }
    [char, ..rest] if char == close -> Ok(#(title, Reader(rest, read <> char)))
    ["(", ..] if close == ")" -> Error(Nil)
    [char, ..rest] -> title_text(rest, close, title <> char, read <> char)
  }
}

/// What `emphasize` holds while it folds the pieces: the inlines at the
/// innermost open level and how deeply they nest, the openers still waiting
/// for a closer (innermost first) and how many there are, and the floors.
///
/// A floor is the spec's `openers_bottom`: for each kind of closer, the
/// height below which no opener can pair with it. A search stops there, so
/// a closer that finds nothing never makes the next one look again.
type Pairing {
  Pairing(
    inside: Rope,
    depth: Int,
    openers: List(Opener),
    height: Int,
    floors: Dict(#(Symbol, Bool, Int), Int),
  )
}

/// `length` is the run's length as typed, for rules 9 and 10. `left` is how
/// many of its characters no pair has used yet. `before` is what came before
/// it at its own level.
type Opener {
  Opener(
    symbol: Symbol,
    length: Int,
    left: Int,
    closes: Bool,
    before: Rope,
    before_depth: Int,
  )
}

/// Inlines in source order that join in one step. A pair the depth cap
/// refuses hands its content back to the level around it, and an outer
/// refused pair hands it back again: with a list that copies the content
/// once per level, and ten thousand levels of it is quadratic.
type Rope {
  Empty
  Leaf(Inline)
  Join(older: Rope, newer: Rope)
}

fn emphasize(pieces: List(Piece)) -> #(List(Inline), Int) {
  let pairing =
    list.fold(pieces, Pairing(Empty, 0, [], 0, dict.new()), pair_piece)
  let #(content, depth) =
    give_up(pairing.openers, pairing.inside, pairing.depth)
  #(flatten([content], []), depth)
}

fn pair_piece(pairing: Pairing, piece: Piece) -> Pairing {
  case piece {
    Done(inline, depth) -> add_inline(pairing, Leaf(inline), depth)
    Bracket(_) -> add_inline(pairing, Leaf(Text("[")), 0)
    DelimiterRun(symbol, length, opens:, closes: True) ->
      close(pairing, symbol, length, length, opens)
    DelimiterRun(symbol, length, opens: True, closes: False) ->
      push(pairing, symbol, length, length, False)
    DelimiterRun(symbol, length, opens: False, closes: False) ->
      add_inline(pairing, marks(symbol, length), 0)
  }
}

fn add_inline(pairing: Pairing, rope: Rope, depth: Int) -> Pairing {
  Pairing(
    ..pairing,
    inside: Join(pairing.inside, rope),
    depth: int.max(pairing.depth, depth),
  )
}

fn push(
  pairing: Pairing,
  symbol: Symbol,
  length: Int,
  left: Int,
  closes: Bool,
) -> Pairing {
  let opener =
    Opener(symbol, length, left, closes, pairing.inside, pairing.depth)
  Pairing(
    ..pairing,
    inside: Empty,
    depth: 0,
    openers: [opener, ..pairing.openers],
    height: pairing.height + 1,
  )
}

/// A run that can close, with `left` of its `length` characters not used.
fn close(
  pairing: Pairing,
  symbol: Symbol,
  length: Int,
  left: Int,
  opens: Bool,
) -> Pairing {
  let kind = #(symbol, opens, length % 3)
  let floor = dict.get(pairing.floors, kind) |> result.unwrap(0)
  let search = pairing.height - floor
  case find_opener(pairing.openers, search, symbol, length, opens, []) {
    Error(Nil) -> {
      let floors = dict.insert(pairing.floors, kind, pairing.height)
      let pairing = Pairing(..pairing, floors:)
      case opens {
        True -> push(pairing, symbol, length, left, True)
        False -> add_inline(pairing, marks(symbol, left), 0)
      }
    }
    // GFM, as cmark-gfm does it: tildes strike only with a run of the same
    // length. Both runs, and the runs between them, stay text.
    Ok(#(passed, opener, below)) if symbol == Tilde && opener.left != left -> {
      let #(content, depth) =
        give_up(list.append(passed, [opener]), pairing.inside, pairing.depth)
      Pairing(
        ..pairing,
        inside: Join(content, marks(symbol, left)),
        depth:,
        openers: below,
        height: pairing.height - list.length(passed) - 1,
      )
      |> lower_floors
    }
    Ok(#(passed, opener, below)) -> {
      let used = case symbol, left >= 2 && opener.left >= 2 {
        Tilde, _ -> left
        _, True -> 2
        _, False -> 1
      }
      let #(content, depth) = give_up(passed, pairing.inside, pairing.depth)
      let #(node, depth) = case depth < max_depth {
        True -> #(
          Leaf(emphasis(symbol, used, flatten([content], []))),
          depth + 1,
        )
        False -> {
          let used_marks = marks(symbol, used)
          #(Join(Join(used_marks, content), used_marks), depth)
        }
      }
      let height = pairing.height - list.length(passed)
      let pairing = case opener.left - used {
        0 ->
          Pairing(
            ..pairing,
            inside: Join(opener.before, node),
            depth: int.max(opener.before_depth, depth),
            openers: below,
            height: height - 1,
          )
        unused ->
          Pairing(
            ..pairing,
            inside: node,
            depth:,
            openers: [Opener(..opener, left: unused), ..below],
            height:,
          )
      }
      let pairing = lower_floors(pairing)
      case left - used {
        0 -> pairing
        unused -> close(pairing, symbol, length, unused, opens)
      }
    }
  }
}

fn lower_floors(pairing: Pairing) -> Pairing {
  let floors =
    dict.map_values(pairing.floors, fn(_, floor) {
      int.min(floor, pairing.height)
    })
  Pairing(..pairing, floors:)
}

/// The nearest of the top `search` openers that the closer can pair with,
/// the openers above it (innermost first), and the ones below it.
fn find_opener(
  openers: List(Opener),
  search: Int,
  symbol: Symbol,
  length: Int,
  opens: Bool,
  passed: List(Opener),
) -> Result(#(List(Opener), Opener, List(Opener)), Nil) {
  case openers {
    [opener, ..below] if search > 0 ->
      case can_pair(opener, symbol, length, opens) {
        True -> Ok(#(list.reverse(passed), opener, below))
        False ->
          find_opener(below, search - 1, symbol, length, opens, [
            opener,
            ..passed
          ])
      }
    _ -> Error(Nil)
  }
}

/// Rules 9 and 10: when either run can both open and close, the two lengths
/// as typed may not sum to a multiple of 3, unless both are multiples of 3.
fn can_pair(opener: Opener, symbol: Symbol, length: Int, opens: Bool) -> Bool {
  opener.symbol == symbol
  && {
    !{ opens || opener.closes }
    || { opener.length + length } % 3 != 0
    || { opener.length % 3 == 0 && length % 3 == 0 }
  }
}

/// Openers that never closed are text: each one's unused characters, after
/// what came before it and before the content after it.
fn give_up(openers: List(Opener), inside: Rope, depth: Int) -> #(Rope, Int) {
  list.fold(openers, #(inside, depth), fn(content, opener) {
    let #(after, depth) = content
    let unused = marks(opener.symbol, opener.left)
    #(
      Join(Join(opener.before, unused), after),
      int.max(depth, opener.before_depth),
    )
  })
}

fn marks(symbol: Symbol, count: Int) -> Rope {
  case symbol {
    Star -> Leaf(Text(string.repeat("*", count)))
    Underscore -> Leaf(Text(string.repeat("_", count)))
    Tilde -> Leaf(Text(string.repeat("~", count)))
  }
}

fn emphasis(symbol: Symbol, used: Int, children: List(Inline)) -> Inline {
  case symbol, used {
    Tilde, _ -> Strike(children)
    _, 2 -> Strong(children)
    _, _ -> Emphasis(children)
  }
}

/// Takes the newest inline first, so `done` comes out in source order, and
/// joins neighbouring text.
fn flatten(ropes: List(Rope), done: List(Inline)) -> List(Inline) {
  case ropes, done {
    [], _ -> done
    [Empty, ..rest], _ | [Leaf(Text("")), ..rest], _ -> flatten(rest, done)
    [Join(older, newer), ..rest], _ -> flatten([newer, older, ..rest], done)
    [Leaf(Text(text)), ..rest], [Text(after), ..later] ->
      flatten(rest, [Text(text <> after), ..later])
    [Leaf(inline), ..rest], _ -> flatten(rest, [inline, ..done])
  }
}

/// The words a reader sees: markup dropped, text and code kept, a line break
/// as one space.
pub fn plain_text(inlines: List(Inline)) -> String {
  inlines |> words |> string.replace("\n", " ")
}

fn words(inlines: List(Inline)) -> String {
  inlines
  |> list.map(fn(inline) {
    case inline {
      Text(text) | Code(text) -> text
      Strong(children)
      | Emphasis(children)
      | Strike(children)
      | Link(label: children, ..) -> words(children)
    }
  })
  |> string.concat
}

/// The first line of text the rendered page shows, with the markup dropped
/// and the white space around it trimmed, or "" when it shows none.
pub fn first_text(source: String) -> String {
  first_text_within(source, 16)
}

fn first_text_within(source: String, lines: Int) -> String {
  let #(start, more) = take_lines(source, lines, "")
  case shown(parse(start)), more {
    "", True -> first_text_within(source, lines * 4)
    text, _ -> text
  }
}

fn take_lines(source: String, count: Int, taken: String) -> #(String, Bool) {
  case count, string.split_once(source, "\n") {
    0, _ -> #(taken, source != "")
    _, Error(Nil) -> #(taken <> source, False)
    _, Ok(#(line, rest)) -> take_lines(rest, count - 1, taken <> line <> "\n")
  }
}

fn shown(blocks: List(Block)) -> String {
  use block <- first_shown(blocks)
  case block.content {
    Heading(text:, ..) | Paragraph(text:) -> first_line(words(text))
    CodeBlock(code:, ..) -> first_line(code)
    Quote(blocks:) -> shown(blocks)
    BulletList(items:, ..) | OrderedList(items:, ..) -> {
      use item <- first_shown(items)
      shown(item.blocks)
    }
    Table(columns:, rows:) -> {
      let headings = list.map(columns, fn(column) { column.heading })
      use cell <- first_shown(list.append(headings, list.flatten(rows)))
      first_line(words(cell))
    }
    Rule -> ""
  }
}

fn first_line(text: String) -> String {
  text
  |> string.to_graphemes
  |> list.drop_while(is_unicode_whitespace)
  |> list.take_while(fn(char) { char != "\n" })
  |> list.reverse
  |> list.drop_while(is_unicode_whitespace)
  |> list.reverse
  |> string.concat
}

fn first_shown(things: List(a), show: fn(a) -> String) -> String {
  case things {
    [] -> ""
    [thing, ..rest] ->
      case show(thing) {
        "" -> first_shown(rest, show)
        text -> text
      }
  }
}

/// Line `task.row` of `source` with the task's box set to `checked`: the
/// whole line, to put in place of the old one. `Error` when no task has its box
/// at that place any more, for example after the line became code.
pub fn set_task(
  source: String,
  task: Task,
  checked: Bool,
) -> Result(String, Nil) {
  use found <- result.try(find_task(parse(source), task.row, task.col))
  case list.drop(code_point_lines(source), task.row) {
    [line, ..] if found.checked == checked -> Ok(string.concat(line))
    [line, ..] -> {
      let mark = case checked {
        True -> "x"
        False -> " "
      }
      [list.take(line, task.col), [mark], list.drop(line, task.col + 1)]
      |> list.flatten
      |> string.concat
      |> Ok
    }
    [] -> Error(Nil)
  }
}

fn find_task(blocks: List(Block), row: Int, col: Int) -> Result(Task, Nil) {
  use block <- list.find_map(blocks)
  case block.content {
    Quote(blocks) -> find_task(blocks, row, col)
    BulletList(items:, ..) | OrderedList(items:, ..) -> {
      use item <- list.find_map(items)
      case item.task {
        Some(found) if found.row == row && found.col == col -> Ok(found)
        _ -> find_task(item.blocks, row, col)
      }
    }
    Heading(..) | Paragraph(..) | CodeBlock(..) | Table(..) | Rule -> Error(Nil)
  }
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

/// M6. One list of runs per source row. Lossless, which is what keeps the
/// mirror's glyphs under the text field's caret: for every row, the runs'
/// `text` concatenated is exactly that line.
pub fn highlight(source: String) -> List(List(Run)) {
  let _ = source
  todo as "not implemented"
}
