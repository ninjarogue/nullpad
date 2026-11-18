//// Random lists and random Enter, Tab and Shift+Tab presses. After every
//// press that does something, the note is parsed again and three promises
//// are checked: no words are lost or reordered, items the key did not move
//// keep their depth, and every numbered list counts up by one.

import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/string
import nullpad/buffer.{type Buffer, Position}
import nullpad/list_keys.{Indent, NewItem, Outdent}
import nullpad/markdown.{
  type Block, type Inline, type Item, Block, BulletList, Code, CodeBlock,
  Emphasis, Heading, Item, Link, NumberMark, OrderedList, Paragraph, Quote, Rule,
  Strike, Strong, Table, Text,
}
import qcheck

type Kind {
  Bullet(String)
  Numbered(start: Int, delimiter: String)
}

type Spec {
  Spec(depth: Int, task: Option(Bool), empty: Bool)
}

type Case {
  Case(
    kinds: List(Kind),
    items: List(Spec),
    quoted: Bool,
    loose: Bool,
    at: Int,
    keys: List(list_keys.Key),
  )
}

fn kind() -> qcheck.Generator(Kind) {
  qcheck.from_generators(
    qcheck.map(
      qcheck.from_generators(qcheck.return("-"), [
        qcheck.return("*"),
        qcheck.return("+"),
      ]),
      Bullet,
    ),
    [
      qcheck.map2(
        qcheck.bounded_int(1, 120),
        qcheck.from_generators(qcheck.return("."), [qcheck.return(")")]),
        Numbered,
      ),
      qcheck.map2(
        qcheck.from_generators(qcheck.return(8), [
          qcheck.return(9),
          qcheck.return(98),
          qcheck.return(99),
        ]),
        qcheck.return("."),
        Numbered,
      ),
    ],
  )
}

fn spec() -> qcheck.Generator(Spec) {
  qcheck.map3(
    qcheck.bounded_int(0, 2),
    qcheck.from_weighted_generators(#(4, qcheck.return(None)), [
      #(1, qcheck.map(qcheck.bool(), Some)),
    ]),
    qcheck.from_weighted_generators(#(3, qcheck.return(False)), [
      #(1, qcheck.return(True)),
    ]),
    Spec,
  )
}

fn key() -> qcheck.Generator(list_keys.Key) {
  qcheck.from_generators(qcheck.return(NewItem), [
    qcheck.return(Indent),
    qcheck.return(Outdent),
  ])
}

fn case_() -> qcheck.Generator(Case) {
  qcheck.map6(
    qcheck.fixed_length_list_from(kind(), 3),
    qcheck.generic_list(spec(), qcheck.bounded_int(1, 8)),
    qcheck.bool(),
    qcheck.bool(),
    qcheck.bounded_int(-4, 7),
    qcheck.generic_list(key(), qcheck.bounded_int(1, 6)),
    Case,
  )
}

/// One open list while a note is written: its depth, the number its next
/// item takes and the column its items' words start at.
type Open {
  Open(depth: Int, next: Int, words_col: Int)
}

/// The note `case_` describes, and the row of each item.
fn note(c: Case) -> #(List(String), List(Int)) {
  let prefix = case c.quoted {
    True -> "> "
    False -> ""
  }
  let #(_, _, rows, item_rows) =
    list.index_fold(settled(c.items), #([], -1, [], []), fn(state, spec, index) {
      let #(open, _, rows, item_rows) = state
      let depth = spec.depth
      let open = list.filter(open, fn(o: Open) { o.depth <= depth })
      let #(number, open) = case open {
        [Open(depth: d, next:, words_col:), ..rest] if d == depth -> #(next, [
          Open(depth, next + 1, words_col),
          ..rest
        ])
        _ -> {
          let start = case kind_at(c.kinds, depth) {
            Numbered(start:, ..) if depth == 0 -> start
            Numbered(..) | Bullet(_) -> 1
          }
          #(start, [Open(depth, start + 1, 0), ..open])
        }
      }
      let lead = case open {
        [_, Open(words_col:, ..), ..] -> words_col
        [_] | [] -> 0
      }
      let mark = case kind_at(c.kinds, depth) {
        Bullet(bullet) -> bullet
        Numbered(delimiter:, ..) -> int.to_string(number) <> delimiter
      }
      let words_col = lead + string.length(mark) + 1
      let open = case open {
        [top, ..rest] -> [Open(..top, words_col:), ..rest]
        [] -> []
      }
      let body = case spec.empty, spec.task {
        True, _ -> ""
        False, None -> " w" <> int.to_string(index)
        False, Some(True) -> " [x] w" <> int.to_string(index)
        False, Some(False) -> " [ ] w" <> int.to_string(index)
      }
      let line = prefix <> string.repeat(" ", lead) <> mark <> body
      let rows = case c.loose && rows != [] {
        True -> [string.trim_end(prefix), ..rows]
        False -> rows
      }
      #(open, depth, [line, ..rows], [list.length(rows), ..item_rows])
    })
  #(list.reverse(rows), list.reverse(item_rows))
}

/// Each item's depth at most one below the item above it. An item is left
/// empty only after an item of its own depth that has words, and only where
/// its list ends or, at the top, where the next item is a sibling: anywhere
/// else CommonMark reads an empty item as part of the words around it (a
/// `-` under words is a heading line, a `1.` under words is more words).
fn settled(items: List(Spec)) -> List(Spec) {
  let depths =
    list.fold(items, #(-1, []), fn(acc, spec) {
      let depth = int.min(spec.depth, acc.0 + 1)
      #(depth, [depth, ..acc.1])
    }).1
    |> list.reverse
  let specs = list.map2(items, depths, fn(spec, depth) { Spec(..spec, depth:) })
  let nexts = list.append(list.drop(depths, 1), [-1])
  list.map2(specs, nexts, fn(spec, next) { #(spec, next) })
  |> list.fold(#(None, []), fn(acc, pair) {
    let #(spec, next) = pair
    let #(above, done) = acc
    let after_words = case above {
      Some(Spec(depth:, empty: False, ..)) -> depth == spec.depth
      Some(Spec(empty: True, ..)) | None -> False
    }
    let ends = next < spec.depth || next == spec.depth && spec.depth == 0
    let spec = Spec(..spec, empty: spec.empty && after_words && ends)
    #(Some(spec), [spec, ..done])
  })
  |> fn(acc) { list.reverse(acc.1) }
}

fn kind_at(kinds: List(Kind), depth: Int) -> Kind {
  case list.drop(kinds, depth) {
    [kind, ..] -> kind
    [] -> Bullet("-")
  }
}

fn start(c: Case) -> Buffer {
  let #(lines, item_rows) = note(c)
  let line_at = fn(row) {
    case list.drop(lines, row) {
      [line, ..] -> line
      [] -> ""
    }
  }
  let picked = case
    list.drop(item_rows, int.absolute_value(c.at) % list.length(item_rows))
  {
    [row, ..] -> row
    [] -> 0
  }
  // A negative `at` puts the caret in the first empty item, when there is one.
  let row = case
    c.at < 0,
    list.find(item_rows, fn(row) { bare(line_at(row)) })
  {
    True, Ok(row) -> row
    True, Error(Nil) | False, _ -> picked
  }
  let line = line_at(row)
  let at = Position(row:, col: string.length(line))
  buffer.from_text(string.join(lines, "\n"))
  |> buffer.select(anchor: at, head: at)
}

/// Every word of the note in order, with the number of items it is in.
fn words(blocks: List(Block), depth: Int) -> List(#(String, Int)) {
  list.flat_map(blocks, fn(block) {
    case block.content {
      Heading(text:, ..) | Paragraph(text:) -> words_of(text, depth)
      BulletList(items:, ..) | OrderedList(items:, ..) ->
        list.flat_map(items, fn(item: Item) { words(item.blocks, depth + 1) })
      Quote(blocks:) -> words(blocks, depth)
      CodeBlock(code:, ..) -> split(code, depth)
      Rule -> []
      Table(..) -> [#("<table>", depth)]
    }
  })
}

fn words_of(text: List(Inline), depth: Int) -> List(#(String, Int)) {
  list.flat_map(text, fn(inline) {
    case inline {
      Text(text) | Code(text) -> split(text, depth)
      Strong(inner) | Emphasis(inner) | Strike(inner) -> words_of(inner, depth)
      Link(label:, ..) -> words_of(label, depth)
    }
  })
}

/// A marker with nothing after it, read as words, is not a word: CommonMark
/// reads an empty item under words as more words, and nothing the keys do
/// can change that.
fn split(text: String, depth: Int) -> List(#(String, Int)) {
  string.replace(text, "\n", " ")
  |> string.split(" ")
  |> list.filter(fn(word) { word != "" && !bare(word) })
  |> list.map(fn(word) { #(word, depth) })
}

/// The innermost item that holds `row`.
fn holder(blocks: List(Block), row: Int) -> Option(Item) {
  list.fold(blocks, None, fn(found, block) {
    case found, block.content {
      Some(_), _ -> found
      None, BulletList(items:, ..) | None, OrderedList(items:, ..) ->
        list.fold(items, None, fn(found, item) {
          case found, item.row <= row && row <= item_end(item) {
            Some(_), _ | None, False -> found
            None, True ->
              case holder(item.blocks, row) {
                Some(inner) -> Some(inner)
                None -> Some(item)
              }
          }
        })
      None, Quote(blocks:) -> holder(blocks, row)
      None, Heading(..)
      | None, Paragraph(..)
      | None, CodeBlock(..)
      | None, Rule
      | None, Table(..)
      -> None
    }
  })
}

fn item_end(item: Item) -> Int {
  list.fold(item.blocks, item.row, fn(end, block: Block) {
    int.max(end, block.last_row)
  })
}

/// Each numbered list's items, by the number typed in front of them.
fn numbers(blocks: List(Block), lines: List(String)) -> List(List(Int)) {
  list.flat_map(blocks, fn(block) {
    case block.content {
      OrderedList(items:, ..) -> [
        list.map(items, fn(item: Item) { number(item, lines) }),
        ..list.flat_map(items, fn(item: Item) { numbers(item.blocks, lines) })
      ]
      BulletList(items:, ..) ->
        list.flat_map(items, fn(item: Item) { numbers(item.blocks, lines) })
      Quote(blocks:) -> numbers(blocks, lines)
      Heading(..) | Paragraph(..) | CodeBlock(..) | Rule | Table(..) -> []
    }
  })
}

fn number(item: Item, lines: List(String)) -> Int {
  let line = case list.drop(lines, item.row) {
    [line, ..] -> line
    [] -> ""
  }
  case markdown.item_marks(line, item) {
    Ok(markdown.ItemMarks(mark: NumberMark(number:, ..), ..)) -> number
    Ok(markdown.ItemMarks(mark: markdown.BulletMark(_), ..)) | Error(Nil) -> -1
  }
}

fn counts_up(numbers: List(Int)) -> Bool {
  case numbers {
    [a, b, ..rest] -> b == a + 1 && counts_up([b, ..rest])
    [_] | [] -> True
  }
}

fn moved_by(key: list_keys.Key) -> Int {
  case key {
    NewItem -> 0
    Indent -> 1
    Outdent -> -1
  }
}

fn check(
  before: Buffer,
  key: list_keys.Key,
  after: Buffer,
  typed: String,
) -> Nil {
  let blocks = markdown.parse(buffer.text(before))
  let parsed = markdown.parse(buffer.text(after))
  let was = words(blocks, 0)
  let now = words(parsed, 0) |> list.filter(fn(w) { w.0 != typed })
  let story =
    string.inspect(key)
    <> " turned\n"
    <> shown(before)
    <> "\ninto\n"
    <> shown(after)
  assert list.map(now, fn(w) { w.0 }) == list.map(was, fn(w) { w.0 }) as story
  let moved = case holder(blocks, buffer.cursor(before).row) {
    Some(item) ->
      list.map(words([Block(item.row, item.row, Quote(item.blocks))], 0), fn(w) {
        w.0
      })
    None -> []
  }
  let expected =
    list.map(was, fn(w) {
      case list.contains(moved, w.0) {
        True -> #(w.0, w.1 + moved_by(key))
        False -> w
      }
    })
  assert now == expected as story
  assert list.all(numbers(parsed, buffer.lines(after)), counts_up) as story
}

/// Until something is typed in it, CommonMark reads an empty item by what
/// is around it: `- a` over `  -` is a heading, and an empty item over a
/// blank row ends there. So a word is typed into the item the caret is
/// left in, as a person would, before the note is read.
fn fill(buffer: Buffer, typed: String) -> Buffer {
  let head = buffer.cursor(buffer)
  let line = case list.drop(buffer.lines(buffer), head.row) {
    [line, ..] -> line
    [] -> ""
  }
  case head.col == string.length(line) && bare(line) {
    True -> {
      let space = case string.ends_with(line, " ") {
        True -> ""
        False -> " "
      }
      buffer.replace(buffer, from: head, to: head, with: space <> typed)
    }
    False -> buffer
  }
}

/// A row that holds an item's marker and nothing after it.
fn bare(line: String) -> Bool {
  let rest =
    string.to_graphemes(line)
    |> list.drop_while(fn(c) { c == " " || c == ">" })
    |> string.concat
    |> string.trim_end
  let rest = case string.ends_with(rest, "]") {
    True -> string.drop_end(rest, 3) |> string.trim_end
    False -> rest
  }
  case rest {
    "-" | "*" | "+" -> True
    _ ->
      case string.pop_grapheme(string.reverse(rest)) {
        Ok(#(".", digits)) | Ok(#(")", digits)) ->
          digits != "" && result.is_ok(int.parse(digits))
        Ok(_) | Error(Nil) -> False
      }
  }
}

/// The note with `|` at the caret.
fn shown(buffer: Buffer) -> String {
  let at = buffer.cursor(buffer)
  list.index_map(buffer.lines(buffer), fn(line, row) {
    case row == at.row {
      True ->
        string.slice(line, 0, at.col) <> "|" <> string.drop_start(line, at.col)
      False -> line
    }
  })
  |> string.join("\n")
}

fn run(buffer: Buffer, keys: List(list_keys.Key), step: Int) -> Nil {
  case keys {
    [] -> Nil
    [key, ..rest] -> {
      let blocks = markdown.parse(buffer.text(buffer))
      case list_keys.press(buffer, blocks, key) {
        Error(Nil) -> Nil
        Ok(after) -> {
          let typed = "typed" <> int.to_string(step)
          let after = fill(after, typed)
          check(buffer, key, after, typed)
          run(after, rest, step + 1)
        }
      }
    }
  }
}

pub fn list_keys_keep_words_depths_and_numbers_test() {
  let config = qcheck.default_config() |> qcheck.with_test_count(800)
  use c <- qcheck.run(config, case_())
  run(start(c), c.keys, 0)
}
