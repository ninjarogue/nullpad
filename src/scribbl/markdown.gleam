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

// Inline parsing: one line of text in, inlines out.
//
//   "a **b** `c`"  --tokenize-->  Word Word Delimiter Word Delimiter Word CodeSpan
//                  --pair------>  [Text("a "), Strong([Text("b")]), Text(" "), Code("c")]
//
// `tokenize` reads left to right and never looks back. `pair` matches each
// closing token with its opener and turns whatever stays unmatched into text.
// The `read_*` functions, `count_run`, `close` and the arms of `step` are
// yours to fill in, in the order of the pending tests. Until then each one
// treats its markup as plain text.

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
  let read = fn(read: #(Token, List(String))) {
    let #(token, rest) = read
    let previous = token |> source |> string.last |> result.unwrap("")
    tokenize(rest, previous, [token, ..done])
  }
  case graphemes {
    [] -> list.reverse(done)
    ["\\", ..] -> read(read_escape(graphemes))
    ["`", ..] -> read(read_code(graphemes))
    ["*", ..] -> read(read_delimiter(Star, graphemes, previous))
    ["_", ..] -> read(read_delimiter(Underscore, graphemes, previous))
    ["[", ..rest] -> read(#(OpenBracket, rest))
    ["]", ..] -> read(read_link_end(graphemes))
    [grapheme, ..rest] -> read(#(Word(grapheme), rest))
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
  case graphemes {
    [first, ..rest] if first == grapheme -> {
      let #(count, after) = count_run(rest, grapheme)
      #(count + 1, after)
    }
    _ -> #(0, graphemes)
  }
}

fn read_code(graphemes: List(String)) -> #(Token, List(String)) {
  let #(ticks, after) = count_run(graphemes, "`")
  case find_fence(after, ticks, "") {
    Ok(#(content, rest)) -> #(CodeSpan(ticks, content), rest)
    Error(Nil) -> #(Word(string.repeat("`", ticks)), after)
  }
}

fn find_fence(
  graphemes: List(String),
  ticks: Int,
  collected: String,
) -> Result(#(String, List(String)), Nil) {
  case graphemes {
    [] -> Error(Nil)
    ["`", ..] -> {
      let #(run, rest) = count_run(graphemes, "`")
      case run == ticks {
        True -> Ok(#(collected, rest))
        False -> find_fence(rest, ticks, collected <> string.repeat("`", run))
      }
    }
    [grapheme, ..rest] -> find_fence(rest, ticks, collected <> grapheme)
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
    ["]", "(", ..after] -> {
      let #(url, rest) =
        list.split_while(after, fn(grapheme) {
          grapheme != ")" && !is_space(grapheme)
        })
      case rest {
        [")", ..rest] -> #(CloseLink(string.concat(url)), rest)
        _ -> read_word(graphemes)
      }
    }
    _ -> read_word(graphemes)
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

fn is_word_character(grapheme: String) -> Bool {
  string.lowercase(grapheme) != string.uppercase(grapheme)
  || list.contains(string.to_graphemes("0123456789"), grapheme)
}

fn is_punctuation(grapheme: String) -> Bool {
  grapheme != ""
  && string.contains("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~", grapheme)
}

/// What `pair` holds while it walks the tokens: the inlines read so far at the
/// innermost level (newest first), and one frame per opener still waiting for
/// its closer (innermost first).
///
///   after "a **b [c"   inside: [Text("c")]
///                      enclosing: [Frame(OpenLabel, [Text("b")]),
///                                  Frame(OpenDelimiter(Star, Double), [Text("a ")])]
type Pairing {
  Pairing(inside: List(Inline), enclosing: List(Frame))
}

/// An opener, and the inlines that came before it at its own level (newest
/// first).
type Frame {
  Frame(opener: Opener, before: List(Inline))
}

type Opener {
  OpenDelimiter(symbol: Symbol, weight: Weight)
  OpenLabel
}

fn pair(tokens: List(Token)) -> List(Inline) {
  tokens |> list.fold(Pairing([], []), step) |> finish
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
        Ok(#(children, outer)) -> add(outer, emphasis(weight, children))
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
        Ok(#(children, outer)) ->
          add(abandon_labels(outer), Link(children, url))
        Error(Nil) -> add(pairing, Text(source(token)))
      }
    Escaped(char) -> add(pairing, Text(char))
  }
}

fn close(
  pairing: Pairing,
  opener: Opener,
) -> Result(#(List(Inline), Pairing), Nil) {
  case pairing.enclosing {
    [] -> Error(Nil)
    [Frame(found, before), ..enclosing] if found == opener -> {
      let children = pairing.inside |> list.reverse |> normalize
      Ok(#(children, Pairing(before, enclosing)))
    }
    [_, ..] -> close(abandon(pairing), opener)
  }
}

fn add(pairing: Pairing, inline: Inline) -> Pairing {
  Pairing(..pairing, inside: [inline, ..pairing.inside])
}

fn open(pairing: Pairing, opener: Opener) -> Pairing {
  Pairing([], [Frame(opener, pairing.inside), ..pairing.enclosing])
}

/// Gives up on the innermost opener: it becomes text in front of what it
/// held.
fn abandon(pairing: Pairing) -> Pairing {
  case pairing.enclosing {
    [] -> pairing
    [Frame(opener, before), ..enclosing] ->
      Pairing(
        list.append(pairing.inside, [Text(opener_source(opener)), ..before]),
        enclosing,
      )
  }
}

/// Links do not nest: once a link closes, every `[` still waiting around it
/// becomes text.
fn abandon_labels(pairing: Pairing) -> Pairing {
  let #(inside, enclosing) = drop_labels(pairing.inside, pairing.enclosing)
  Pairing(inside, enclosing)
}

fn drop_labels(
  inside: List(Inline),
  enclosing: List(Frame),
) -> #(List(Inline), List(Frame)) {
  case enclosing {
    [] -> #(inside, [])
    [Frame(OpenLabel, before), ..rest] ->
      drop_labels(list.append(inside, [Text("["), ..before]), rest)
    [Frame(OpenDelimiter(..) as opener, before), ..rest] -> {
      let #(before, rest) = drop_labels(before, rest)
      #(inside, [Frame(opener, before), ..rest])
    }
  }
}

fn finish(pairing: Pairing) -> List(Inline) {
  case pairing.enclosing {
    [] -> pairing.inside |> list.reverse |> normalize
    [_, ..] -> finish(abandon(pairing))
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
    && string.trim(content) != ""
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
