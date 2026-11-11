//// Hand-written markdown parser. Pure Gleam: text in, tree out. Not
//// CommonMark-complete on purpose.
////
//// The rule that keeps it small: inline markup never spans a line break.
//// Two private layers, shared by `parse` and `highlight` so there is one
//// grammar and the editor and the rendered page cannot disagree:
////   classify(line) -> LineKind   Blank | HeadingLine(level, text) |
////     TextLine(text), and in M3 FenceLine(language) | QuoteLine(rest) |
////     ItemLine(indent, marker, rest) | RuleLine. One line only, no context.
////   tokenize(text) -> List(Token)   Word | Escaped | CodeSpan | Delimiter |
////     OpenBracket | CloseLink. Lossless: the tokens' source text
////     concatenated gives the input back.
//// Imported by: `preview`, `surface` (M6), the shell, tests. Imports: stdlib.

import gleam/dict.{type Dict}
import gleam/int
import gleam/list
import gleam/option.{type Option}
import gleam/result
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
  case trim(line) {
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
    "" | " " <> _ -> Ok(#(level, trim(after_marks)))
    _ -> Error(Nil)
  }
}

/// What `string.trim` does, without its quadratic end: its regex retries from
/// every space of a long run of spaces inside the text.
fn trim(text: String) -> String {
  text
  |> string.trim_start
  |> string.to_utf_codepoints
  |> list.reverse
  |> list.drop_while(fn(codepoint) {
    case string.utf_codepoint_to_int(codepoint) {
      9 | 10 | 11 | 12 | 13 | 32 | 0x85 | 0x2028 | 0x2029 -> True
      _ -> False
    }
  })
  |> list.reverse
  |> string.from_utf_codepoints
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

// Inline parsing, one line at a time. `tokenize` cuts the text into tokens
// without looking back. `pair` matches each closer with its opener and leaves
// what finds no partner as text.

type Token {
  Word(text: String)
  Escaped(char: String)
  /// `content` is the text between the backticks, untouched.
  CodeSpan(ticks: Int, content: String)
  Delimiter(symbol: Symbol, weight: Weight, opens: Bool, closes: Bool)
  OpenBracket
  CloseLink(url: String)
}

type Symbol {
  Star
  Underscore
}

type Weight {
  Single
  Double
  Triple
}

fn inlines(text: String) -> List(Inline) {
  text |> string.to_graphemes |> tokenize("", []) |> pair
}

/// `previous` is the grapheme just before `graphemes`, or "" at the start.
fn tokenize(
  graphemes: List(String),
  previous: String,
  done: List(Token),
) -> List(Token) {
  case graphemes {
    [] -> list.reverse(done)
    [_, ..] -> {
      let #(token, rest) = read_token(graphemes, previous)
      tokenize(rest, last_grapheme(token), [token, ..done])
    }
  }
}

fn read_token(
  graphemes: List(String),
  previous: String,
) -> #(Token, List(String)) {
  case graphemes {
    ["\\", ..] -> read_escape(graphemes)
    ["`", ..] -> read_code(graphemes)
    ["*", ..] -> read_delimiter(Star, graphemes, previous)
    ["_", ..] -> read_delimiter(Underscore, graphemes, previous)
    ["[", ..rest] -> #(OpenBracket, rest)
    ["]", ..] -> read_link_end(graphemes)
    _ -> read_word(graphemes)
  }
}

/// The last grapheme of a token's source. A `Word` is one grapheme or a run of
/// one mark, and `previous` is only ever asked whether it is a space or a
/// letter, which a run answers like its mark.
fn last_grapheme(token: Token) -> String {
  case token {
    Word(text) -> text
    Escaped(char) -> char
    CodeSpan(..) -> "`"
    Delimiter(symbol, ..) -> delimiter_source(symbol, Single)
    OpenBracket -> "["
    CloseLink(_) -> ")"
  }
}

/// Every token remembers enough to print its source again, so nothing the
/// user typed is ever lost.
fn source(token: Token) -> String {
  case token {
    Word(text) -> text
    Escaped(char) -> "\\" <> char
    CodeSpan(ticks, content) -> {
      let fence = string.repeat("`", ticks)
      fence <> content <> fence
    }
    Delimiter(symbol, weight, ..) -> delimiter_source(symbol, weight)
    OpenBracket -> "["
    CloseLink(url) -> "](" <> url <> ")"
  }
}

fn delimiter_source(symbol: Symbol, weight: Weight) -> String {
  let char = case symbol {
    Star -> "*"
    Underscore -> "_"
  }
  case weight {
    Single -> char
    Double -> char <> char
    Triple -> char <> char <> char
  }
}

fn count_run(
  graphemes: List(String),
  grapheme: String,
) -> #(Int, List(String)) {
  let #(run, after) = list.split_while(graphemes, fn(next) { next == grapheme })
  #(list.length(run), after)
}

fn read_code(graphemes: List(String)) -> #(Token, List(String)) {
  let #(ticks, after) = count_run(graphemes, "`")
  case find_fence(after, ticks, 0) {
    Ok(#(length, rest)) -> {
      let content = after |> list.take(length) |> string.concat
      #(CodeSpan(ticks, content), rest)
    }
    Error(Nil) -> #(Word(string.repeat("`", ticks)), after)
  }
}

fn find_fence(
  graphemes: List(String),
  ticks: Int,
  length: Int,
) -> Result(#(Int, List(String)), Nil) {
  case graphemes {
    [] -> Error(Nil)
    ["`", ..] -> {
      let #(run, rest) = count_run(graphemes, "`")
      case run == ticks {
        True -> Ok(#(length, rest))
        False -> find_fence(rest, ticks, length + run)
      }
    }
    [_, ..rest] -> find_fence(rest, ticks, length + 1)
  }
}

fn read_delimiter(
  symbol: Symbol,
  graphemes: List(String),
  previous: String,
) -> #(Token, List(String)) {
  let char = delimiter_source(symbol, Single)
  let #(count, after) = count_run(graphemes, char)
  let next = case after {
    [first, ..] -> first
    [] -> ""
  }
  let opens =
    !is_space(next)
    && case symbol {
      Star -> True
      Underscore -> !is_word_character(previous)
    }
  let closes =
    !is_space(previous)
    && case symbol {
      Star -> True
      Underscore -> !is_word_character(next)
    }
  case count {
    1 -> #(Delimiter(symbol, Single, opens, closes), after)
    2 -> #(Delimiter(symbol, Double, opens, closes), after)
    3 -> #(Delimiter(symbol, Triple, opens, closes), after)
    _ -> #(Word(string.repeat(char, count)), after)
  }
}

fn read_link_end(graphemes: List(String)) -> #(Token, List(String)) {
  case graphemes {
    ["]", "(", ..after] ->
      case find_url_end(after, 0, 0) {
        Ok(#(length, rest)) -> {
          let url = after |> list.take(length) |> string.concat
          #(CloseLink(url), rest)
        }
        Error(Nil) -> read_word(graphemes)
      }
    _ -> read_word(graphemes)
  }
}

/// A `(` in a url that never closes raises the depth of every earlier scan
/// still reading it, so no character is read by more than this many failing
/// scans, plus one.
const max_nesting = 32

fn find_url_end(
  graphemes: List(String),
  length: Int,
  depth: Int,
) -> Result(#(Int, List(String)), Nil) {
  case graphemes {
    [")", ..rest] ->
      case depth {
        0 -> Ok(#(length, rest))
        _ -> find_url_end(rest, length + 1, depth - 1)
      }
    ["(", ..rest] ->
      case depth < max_nesting {
        True -> find_url_end(rest, length + 1, depth + 1)
        False -> Error(Nil)
      }
    [grapheme, ..rest] ->
      case is_space(grapheme) {
        True -> Error(Nil)
        False -> find_url_end(rest, length + 1, depth)
      }
    [] -> Error(Nil)
  }
}

fn read_escape(graphemes: List(String)) -> #(Token, List(String)) {
  case graphemes {
    ["\\", char, ..rest] ->
      case is_punctuation(char) {
        True -> #(Escaped(char), rest)
        False -> read_word(graphemes)
      }
    _ -> read_word(graphemes)
  }
}

fn read_word(graphemes: List(String)) -> #(Token, List(String)) {
  case graphemes {
    [] -> #(Word(""), [])
    [grapheme, ..rest] -> #(Word(grapheme), rest)
  }
}

fn is_space(grapheme: String) -> Bool {
  grapheme == "" || grapheme == " " || grapheme == "\t"
}

const digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]

fn is_word_character(grapheme: String) -> Bool {
  string.lowercase(grapheme) != string.uppercase(grapheme)
  || list.contains(digits, grapheme)
}

fn is_punctuation(grapheme: String) -> Bool {
  grapheme != ""
  && string.contains("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~", grapheme)
}

/// What `pair` holds while it walks the tokens: the inlines read so far at the
/// innermost level (newest first), one frame per opener still waiting for its
/// closer (innermost first), and how many frames of each kind can still be
/// closed. A closer whose kind has none fails without looking at the frames.
///
///   after "a **b [c"   inside: [Text("c")]
///                      enclosing: [Frame(OpenLabel, [Text("b")]),
///                                  Frame(OpenDelimiter(Star, Double), [Text("a ")])]
type Pairing {
  Pairing(
    inside: List(Inline),
    depth: Int,
    enclosing: List(Frame),
    waiting: Dict(Opener, Int),
  )
}

/// An opener, and the inlines that came before it at its own level (newest
/// first), with how deeply those nest.
type Frame {
  Frame(opener: Opener, before: List(Inline), depth: Int)
}

type Opener {
  OpenDelimiter(symbol: Symbol, weight: Weight)
  OpenLabel
}

type Closed {
  Closed(children: List(Inline), depth: Int, outer: Pairing)
}

/// A pair that would nest deeper than this stays text. Everything that walks
/// the tree (the page, Lustre's diff, `==`) recurses once per level, so a
/// tree as deep as the line is long overflows the stack.
const max_depth = 32

fn pair(tokens: List(Token)) -> List(Inline) {
  tokens |> list.fold(Pairing([], 0, [], dict.new()), step) |> finish
}

fn step(pairing: Pairing, token: Token) -> Pairing {
  case token {
    Word(text) -> add(pairing, Text(text))
    CodeSpan(_, content) -> add(pairing, Code(trim_code(content)))
    Delimiter(symbol, weight, opens:, closes:) -> {
      let opener = OpenDelimiter(symbol, weight)
      let closed = case closes {
        True -> close(pairing, opener)
        False -> Error(Nil)
      }
      case closed {
        Ok(closed) ->
          wrap(closed, levels(weight), emphasis(weight, _), opener, token)
        Error(Nil) ->
          case opens {
            True -> open(pairing, opener)
            False -> add(pairing, Text(source(token)))
          }
      }
    }
    OpenBracket -> open(pairing, OpenLabel)
    CloseLink(url) ->
      case close(pairing, OpenLabel) {
        Ok(closed) ->
          Closed(..closed, outer: forget_labels(closed.outer))
          |> wrap(1, Link(_, url), OpenLabel, token)
        Error(Nil) -> add(pairing, Text(source(token)))
      }
    Escaped(char) -> add(pairing, Text(char))
  }
}

fn wrap(
  closed: Closed,
  levels: Int,
  build: fn(List(Inline)) -> Inline,
  opener: Opener,
  closer: Token,
) -> Pairing {
  let Closed(children, depth, outer) = closed
  case depth + levels <= max_depth {
    True -> add_nested(outer, build(children), depth + levels)
    False ->
      [Text(opener_source(opener)), ..children]
      |> list.fold(outer, add)
      |> add_nested(Text(source(closer)), depth)
  }
}

fn close(pairing: Pairing, opener: Opener) -> Result(Closed, Nil) {
  case waiting_for(pairing.waiting, opener) {
    0 -> Error(Nil)
    _ ->
      close_loop(
        pairing.enclosing,
        pairing.waiting,
        opener,
        [list.reverse(pairing.inside)],
        pairing.depth,
      )
  }
}

fn close_loop(
  enclosing: List(Frame),
  waiting: Dict(Opener, Int),
  opener: Opener,
  read: List(List(Inline)),
  depth: Int,
) -> Result(Closed, Nil) {
  case enclosing {
    [] -> Error(Nil)
    [Frame(found, before, before_depth), ..outer] if found == opener ->
      Ok(Closed(
        read |> list.flatten |> normalize,
        depth,
        Pairing(before, before_depth, outer, count_frame(waiting, found, -1)),
      ))
    [Frame(skipped, ..) as frame, ..outer] ->
      close_loop(
        outer,
        count_frame(waiting, skipped, -1),
        opener,
        give_up(read, frame),
        int.max(depth, frame.depth),
      )
  }
}

fn give_up(read: List(List(Inline)), frame: Frame) -> List(List(Inline)) {
  [list.reverse(frame.before), [Text(opener_source(frame.opener))], ..read]
}

fn add(pairing: Pairing, inline: Inline) -> Pairing {
  Pairing(..pairing, inside: [inline, ..pairing.inside])
}

fn add_nested(pairing: Pairing, inline: Inline, depth: Int) -> Pairing {
  Pairing(
    ..pairing,
    inside: [inline, ..pairing.inside],
    depth: int.max(pairing.depth, depth),
  )
}

fn open(pairing: Pairing, opener: Opener) -> Pairing {
  Pairing(
    [],
    0,
    [Frame(opener, pairing.inside, pairing.depth), ..pairing.enclosing],
    count_frame(pairing.waiting, opener, 1),
  )
}

/// Links do not nest: once a link closes, every `[` still waiting around it
/// can no longer close. They stay in `enclosing` and become text when a later
/// walk passes them. New labels open on top of them, so the live ones are the
/// innermost `waiting` says there are.
fn forget_labels(pairing: Pairing) -> Pairing {
  Pairing(..pairing, waiting: dict.insert(pairing.waiting, OpenLabel, 0))
}

fn waiting_for(waiting: Dict(Opener, Int), opener: Opener) -> Int {
  dict.get(waiting, opener) |> result.unwrap(0)
}

fn count_frame(
  waiting: Dict(Opener, Int),
  opener: Opener,
  change: Int,
) -> Dict(Opener, Int) {
  let count = int.max(0, waiting_for(waiting, opener) + change)
  dict.insert(waiting, opener, count)
}

fn finish(pairing: Pairing) -> List(Inline) {
  pairing.enclosing
  |> list.fold([list.reverse(pairing.inside)], give_up)
  |> list.flatten
  |> normalize
}

fn levels(weight: Weight) -> Int {
  case weight {
    Single | Double -> 1
    Triple -> 2
  }
}

fn opener_source(opener: Opener) -> String {
  case opener {
    OpenDelimiter(symbol, weight) -> delimiter_source(symbol, weight)
    OpenLabel -> "["
  }
}

fn emphasis(weight: Weight, children: List(Inline)) -> Inline {
  case weight {
    Single -> Emphasis(children)
    Double -> Strong(children)
    Triple -> Emphasis([Strong(children)])
  }
}

/// "` a `" shows as "a", so a span can start or end with a backtick. A span
/// of only spaces is kept as it is.
fn trim_code(content: String) -> String {
  let padded =
    string.starts_with(content, " ")
    && string.ends_with(content, " ")
    && string.trim_start(content) != ""
  case padded {
    True -> content |> string.drop_start(1) |> string.drop_end(1)
    False -> content
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
