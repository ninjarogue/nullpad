//// Hand-written markdown parser. Pure Gleam: text in, tree out. It follows
//// CommonMark 0.31.2 for what scribbl supports (ATX headings, paragraphs,
//// code spans, emphasis, inline links, backslash escapes). Everything else
//// stays text as typed. `test/commonmark_test.gleam` measures it against the
//// spec's examples.
////
//// Blocks: `classify` looks at one line, no context: Blank | HeadingLine |
//// TextLine, and in M3 FenceLine | QuoteLine | ItemLine | RuleLine. Runs of
//// text lines are joined with "\n" into a paragraph.
//// Inlines, per heading or paragraph: `scan` settles escapes, code spans and
//// links in one pass, then `emphasize` pairs the `*` and `_` runs.
//// M6's `highlight` can reuse `classify`. Whether it reuses `scan` is
//// undecided, because `scan` keeps no source positions.
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
/// `buffer.Position.row`). Rows cost one counter in the block parser. They
/// let a ticked task find its line, and later let the rendered page scroll to
/// the cursor.
pub type Block {
  Block(first_row: Int, last_row: Int, content: Content)
}

pub type Content {
  // M2
  Heading(level: Level, text: List(Inline))
  /// A line break between source lines stays in the text as "\n" (a soft
  /// break). The page shows it as a space, because HTML collapses it.
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
  Link(label: List(Inline), url: String, title: Option(String))
  // M3
  Strike(List(Inline))
}

/// Parse a whole note. Total: any text is a valid document (unknown or
/// unclosed syntax becomes plain `Text`, and raw HTML is just text), so there
/// is no error type.
pub fn parse(source: String) -> List(Block) {
  source
  |> string.replace("\u{0}", "\u{FFFD}")
  |> string.to_utf_codepoints
  |> list.fold([], fn(backwards, codepoint) {
    [string.from_utf_codepoints([codepoint]), ..backwards]
  })
  |> split_lines([], [])
  |> list.index_map(fn(line, row) { #(row, classify(line)) })
  |> read_blocks([])
}

/// Takes the characters (one string per code point, the spec's
/// "character") from the last one back, so each line and the list of lines
/// come out in order with no reverse. A line ends at "\n", "\r\n" or "\r".
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

type LineKind {
  Blank
  HeadingLine(level: Level, text: List(String))
  /// Leading spaces and tabs already dropped.
  TextLine(text: List(String))
}

type Lines =
  List(#(Int, LineKind))

fn classify(line: List(String)) -> LineKind {
  case drop_spaces(line) {
    [] -> Blank
    text ->
      case heading(drop_indent(line, 3)) {
        Ok(#(level, heading_text)) -> HeadingLine(level, heading_text)
        Error(Nil) -> TextLine(text)
      }
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

fn drop_indent(line: List(String), allowed: Int) -> List(String) {
  case line {
    [" ", ..rest] if allowed > 0 -> drop_indent(rest, allowed - 1)
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
      let #(block, rest) = read_paragraph(row, row, [text], rest)
      read_blocks(rest, [block, ..done])
    }
  }
}

/// `read` holds the lines so far, last first.
fn read_paragraph(
  first_row: Int,
  last_row: Int,
  read: List(List(String)),
  lines: Lines,
) -> #(Block, Lines) {
  case lines {
    [#(row, TextLine(text)), ..rest] ->
      read_paragraph(first_row, row, [text, ..read], rest)
    [] | [#(_, Blank), ..] | [#(_, HeadingLine(..)), ..] -> {
      let raw = case read {
        [last, ..before] ->
          list.fold(before, drop_spaces_end(last), fn(raw, line) {
            list.append(line, ["\n", ..raw])
          })
        [] -> []
      }
      #(Block(first_row, last_row, Paragraph(inlines(raw))), lines)
    }
  }
}

// Inline parsing, in two stages. `scan` reads the text once, left to right.
// It settles escapes, code spans and links, and leaves each run of `*` or `_`
// and each `[` that may still start a link in place. `emphasize` then pairs
// the runs: the spec's "process emphasis". Links settle first because link
// text binds tighter than emphasis: `*[a*](u)` is a link with a `*` inside.

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

/// A pair of `*` or `_` marks, or a link, that would nest deeper than this is
/// not built: its marks stay text around its content. Everything that walks the tree (the
/// page, Lustre's diff, `==`) recurses once per level, so a tree as deep as
/// the text is long overflows the stack.
const max_depth = 32

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
fn close_link(scan: Scan, id: Int, tail: Tail) -> Scan {
  let #(text, outside) = split_at_bracket(scan.pieces, id, [])
  let #(children, depth) = emphasize(text)
  let pieces = case depth < max_depth {
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
    Ok(#(passed, opener, below)) -> {
      let used = case left >= 2 && opener.left >= 2 {
        True -> 2
        False -> 1
      }
      let #(content, depth) = give_up(passed, pairing.inside, pairing.depth)
      let #(node, depth) = case depth < max_depth {
        True -> #(Leaf(emphasis(used, flatten([content], []))), depth + 1)
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
      let floors =
        dict.map_values(pairing.floors, fn(_, floor) {
          int.min(floor, pairing.height)
        })
      let pairing = Pairing(..pairing, floors:)
      case left - used {
        0 -> pairing
        unused -> close(pairing, symbol, length, unused, opens)
      }
    }
  }
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
  }
}

fn emphasis(used: Int, children: List(Inline)) -> Inline {
  case used {
    2 -> Strong(children)
    _ -> Emphasis(children)
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

/// M6. One list of runs per source row. Lossless, which is what keeps the
/// mirror's glyphs under the text field's caret: for every row, the runs'
/// `text` concatenated is exactly that line.
pub fn highlight(source: String) -> List(List(Run)) {
  let _ = source
  todo as "not implemented"
}
