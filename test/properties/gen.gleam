//// Generators for the property tests. Notes and typed text carry what real
//// notes carry: accents, CJK, emoji with their joiners and flags, combining
//// marks, odd white space, CRLF, tabs, long runs of spaces and every kind of
//// markdown block, so a property meets text where counting bytes, UTF-16
//// units or code points goes wrong. Every choice shrinks toward the first
//// option listed.

import gleam/int
import gleam/list
import gleam/result
import gleam/string
import gleam/yielder
import qcheck.{type Generator}
import qcheck/tree.{type Tree, Tree}

pub fn element(first: a, rest: List(a)) -> Generator(a) {
  let all = [first, ..rest]
  use index <- qcheck.map(qcheck.bounded_int(0, list.length(rest)))
  nth(all, index, first)
}

fn nth(items: List(a), index: Int, default: a) -> a {
  case list.drop(items, index) {
    [item, ..] -> item
    [] -> default
  }
}

pub fn weighted(
  first: #(Int, Generator(a)),
  rest: List(#(Int, Generator(a))),
) -> Generator(a) {
  let all = [first, ..rest]
  let total = list.fold(all, 0, fn(sum, option) { sum + option.0 })
  use roll <- qcheck.bind(qcheck.bounded_int(0, total - 1))
  chosen(all, roll, first.1)
}

fn chosen(
  options: List(#(Int, Generator(a))),
  roll: Int,
  default: Generator(a),
) -> Generator(a) {
  case options {
    [] -> default
    [#(weight, option), ..rest] ->
      case roll < weight {
        True -> option
        False -> chosen(rest, roll - weight, default)
      }
  }
}

/// A list of `low` to `high` things. It shrinks by taking out runs of
/// things, longest first, before it shrinks any one of them, so a failing
/// list ends up holding only what the failure needs.
pub fn few(
  of element: Generator(a),
  from low: Int,
  to high: Int,
) -> Generator(List(a)) {
  use seed <- qcheck.Generator
  let #(lengths, seed) = qcheck.generate(qcheck.bounded_int(low, high), 1, seed)
  let length = list.first(lengths) |> result.unwrap(low)
  let #(trees, seed) = trees_of(element, length, seed, [])
  #(listing(trees, low), seed)
}

fn trees_of(
  element: Generator(a),
  count: Int,
  seed: qcheck.Seed,
  made: List(Tree(a)),
) -> #(List(Tree(a)), qcheck.Seed) {
  case count <= 0 {
    True -> #(list.reverse(made), seed)
    False -> {
      let #(tree, seed) = qcheck.generate_tree(element, seed)
      trees_of(element, count - 1, seed, [tree, ..made])
    }
  }
}

fn listing(trees: List(Tree(a)), low: Int) -> Tree(List(a)) {
  let values = list.map(trees, root)
  let without =
    runs_out(trees, low)
    |> yielder.from_list
    |> yielder.map(listing(_, low))
  let smaller =
    list.index_map(trees, fn(tree, index) {
      let Tree(_, shrinks) = tree
      yielder.map(shrinks, fn(shrunk) {
        listing(replace_at(trees, index, shrunk), low)
      })
    })
    |> yielder.from_list
    |> yielder.flatten
  Tree(values, yielder.append(without, smaller))
}

fn root(tree: Tree(a)) -> a {
  let Tree(value, _) = tree
  value
}

fn replace_at(
  trees: List(Tree(a)),
  index: Int,
  with: Tree(a),
) -> List(Tree(a)) {
  list.flatten([list.take(trees, index), [with], list.drop(trees, index + 1)])
}

fn runs_out(trees: List(a), low: Int) -> List(List(a)) {
  let count = list.length(trees)
  use size <- list.flat_map(sizes(count / 2, []))
  use start <- list.filter_map(starts(0, size, count, []))
  case count - int.min(size, count - start) >= low {
    True ->
      Ok(list.append(list.take(trees, start), list.drop(trees, start + size)))
    False -> Error(Nil)
  }
}

fn starts(start: Int, size: Int, count: Int, found: List(Int)) -> List(Int) {
  case start >= count {
    True -> list.reverse(found)
    False -> starts(start + size, size, count, [start, ..found])
  }
}

fn sizes(size: Int, found: List(Int)) -> List(Int) {
  case size <= 0 {
    True -> list.reverse(found)
    False -> sizes(size / 2, [size, ..found])
  }
}

fn constants(first: String, rest: List(String)) -> Generator(String) {
  element(first, rest)
}

fn ascii_words() -> Generator(String) {
  constants("a", [
    "b", "x", "I", "foo", "alpha beta", "snake_case", "2024", "3.14", "e.g.",
  ])
}

fn accents() -> Generator(String) {
  constants("é", [
    "café", "naïve", "Ångström", "ñandú", "e\u{301}", "Zürich", "ß", "Ç",
  ])
}

fn cjk() -> Generator(String) {
  constants("日本語", ["漢字", "你好", "한국어", "ひらがな", "。", "「」", "！", "ｶﾀｶﾅ", "〜"])
}

fn emoji() -> Generator(String) {
  constants("😀", [
    "🎉", "❤\u{FE0F}", "👍🏽", "👨\u{200D}👩\u{200D}👧\u{200D}👦", "🏳\u{FE0F}\u{200D}🌈",
    "👩🏽\u{200D}💻", "🇯🇵", "🇺🇸🇬🇧", "1\u{FE0F}\u{20E3}",
  ])
}

fn marks() -> Generator(String) {
  constants("a\u{300}\u{323}", [
    "o\u{308}", "n\u{303}", "z\u{351}\u{328}\u{316}", "\u{301}",
    "\u{1100}\u{1161}\u{11A8}", "नमस्ते", "สวัสดี",
  ])
}

fn right_to_left() -> Generator(String) {
  constants("שלום", ["مرحبا"])
}

fn odd_space() -> Generator(String) {
  constants("\u{A0}", [
    "\u{200B}", "\u{200D}", "\u{FEFF}", "\u{2028}", "\u{3000}", "\u{200E}",
  ])
}

fn inline_markup(tame: Bool) -> Generator(String) {
  let plain = [
    "*em*", "**strong**", "_em_", "`code`", "~~gone~~", "[link](http://x.y)",
    "[l](http://x.y \"t\")", "![img](x.png)", "<b>bold</b>", "&amp;", "\\*",
    "\\", "http://x.y", "*", "_", "`", "[", "]", "(", ")", "[ ]",
  ]
  case tame {
    True -> constants("*em*", plain)
    False -> constants("*em*", ["|", "a|b", ..plain])
  }
}

fn word(tame: Bool) -> Generator(String) {
  weighted(#(8, ascii_words()), [
    #(2, accents()),
    #(2, cjk()),
    #(2, emoji()),
    #(2, marks()),
    #(1, right_to_left()),
    #(1, odd_space()),
    #(3, inline_markup(tame)),
  ])
}

fn gap() -> Generator(String) {
  weighted(#(10, constants(" ", [])), [
    #(1, constants("", [])),
    #(1, constants("\t", ["  ", "   "])),
    #(1, qcheck.bounded_int(4, 200) |> qcheck.map(string.repeat(" ", _))),
  ])
}

fn words(tame: Bool, low: Int, high: Int) -> Generator(String) {
  use gap <- qcheck.bind(gap())
  use some <- qcheck.map(few(word(tame), low, high))
  string.join(some, gap)
}

/// What a person types after `at`, and what a note's lines are made of.
pub fn typed() -> Generator(String) {
  weighted(#(10, constants("a", [" ", "b", "e", "x", "1"])), [
    #(3, constants("\n", ["\r\n", "\t", "\n\n", "  "])),
    #(4, word(False)),
    #(
      2,
      constants("- ", ["# ", "> ", "```", "1. ", "- [ ] ", "|", "---", "==="]),
    ),
    #(1, qcheck.bounded_int(4, 80) |> qcheck.map(string.repeat(" ", _))),
  ])
}

type Piece =
  List(String)

fn piece(tame: Bool) -> Generator(Piece) {
  weighted(#(5, paragraph(tame)), [
    #(3, heading(tame)),
    #(2, setext(tame)),
    #(1, rule()),
    #(4, list_items(tame, 2)),
    #(2, quote(tame)),
    #(2, fence(tame)),
    #(1, indented(tame)),
    #(2, table(tame)),
    #(1, blank()),
    #(1, soup(tame)),
  ])
}

fn paragraph(tame: Bool) -> Generator(Piece) {
  few(words(tame, 1, 5), 1, 3)
}

fn heading(tame: Bool) -> Generator(Piece) {
  use mark <- qcheck.bind(
    constants("#", ["##", "###", "######", "#######", " #", "  ##", "\t#"]),
  )
  use text <- qcheck.bind(words(tame, 0, 4))
  use close <- qcheck.map(constants("", [" ##", " #", "#"]))
  [mark <> " " <> text <> close]
}

fn setext(tame: Bool) -> Generator(Piece) {
  use text <- qcheck.bind(few(words(tame, 1, 3), 1, 2))
  use under <- qcheck.map(
    constants("===", ["---", "-", "=", "  ---", "= =", "------", "===  "]),
  )
  list.append(text, [under])
}

fn rule() -> Generator(Piece) {
  use line <- qcheck.map(
    constants("***", ["---", "___", "- - -", "* * *", "  ***", "----  "]),
  )
  [line]
}

fn marker() -> Generator(String) {
  constants("- ", ["* ", "+ ", "1. ", "2) ", "- [ ] ", "- [x] ", "10. ", "-"])
}

fn list_items(tame: Bool, depth: Int) -> Generator(Piece) {
  use items <- qcheck.map(few(item(tame, depth), 1, 3))
  list.flatten(items)
}

fn item(tame: Bool, depth: Int) -> Generator(Piece) {
  use indent <- qcheck.bind(constants("", ["  ", "   ", "    "]))
  use mark <- qcheck.bind(marker())
  use text <- qcheck.bind(words(tame, 0, 4))
  use more <- qcheck.bind(
    element([], [["  more"], ["lazy"], ["", "  after"], [""]]),
  )
  use nested <- qcheck.map(case depth > 0 {
    False -> qcheck.return([])
    True ->
      weighted(#(3, qcheck.return([])), [
        #(1, {
          use pad <- qcheck.bind(constants("  ", ["    ", "   "]))
          use inner <- qcheck.map(list_items(tame, depth - 1))
          list.map(inner, string.append(pad, _))
        }),
      ])
  })
  list.flatten([[indent <> mark <> text], more, nested])
}

fn quote(tame: Bool) -> Generator(Piece) {
  use quoted <- qcheck.bind(few(
    {
      use mark <- qcheck.bind(
        constants("> ", [">", "> > ", "> - ", ">>", "> # ", "> ```", "> 1. "]),
      )
      use text <- qcheck.map(words(tame, 0, 3))
      mark <> text
    },
    1,
    3,
  ))
  use lazy <- qcheck.map(element([], [["lazy text"], [""]]))
  list.append(quoted, lazy)
}

fn fence(tame: Bool) -> Generator(Piece) {
  use open <- qcheck.bind(
    constants("```", ["~~~", "```gleam", "````", "  ```"]),
  )
  use inside <- qcheck.bind(few(
    weighted(#(3, words(tame, 0, 3)), [
      #(1, constants("", ["  indented", "# not heading", "---", "```", "~~~"])),
    ]),
    0,
    3,
  ))
  use closed <- qcheck.map(element(True, [False]))
  case closed {
    True -> list.flatten([[open], inside, ["```"]])
    False -> [open, ..inside]
  }
}

fn indented(tame: Bool) -> Generator(Piece) {
  few(
    {
      use margin <- qcheck.bind(constants("    ", ["\t", "      ", "     "]))
      use text <- qcheck.map(words(tame, 0, 3))
      margin <> text
    },
    1,
    3,
  )
}

fn table(tame: Bool) -> Generator(Piece) {
  use columns <- qcheck.bind(qcheck.bounded_int(2, 3))
  use head <- qcheck.bind(cells(tame, columns))
  use delimiter <- qcheck.bind(
    constants("|---|---|---|", [
      "| :-: | --: | :-- |",
      "---|---|---",
      "|:--|--:|:-:|",
    ]),
  )
  use rows <- qcheck.map(few(row(tame, columns), 0, 3))
  [head, delimiter, ..rows]
}

fn row(tame: Bool, columns: Int) -> Generator(String) {
  case tame {
    True -> cells(tame, columns)
    False -> {
      use count <- qcheck.bind(qcheck.bounded_int(1, columns + 1))
      cells(tame, count)
    }
  }
}

fn cells(tame: Bool, count: Int) -> Generator(String) {
  use texts <- qcheck.map(qcheck.fixed_length_list_from(
    words(tame, 0, 2) |> no_pipes,
    count,
  ))
  "| " <> string.join(texts, " | ") <> " |"
}

fn no_pipes(gen: Generator(String)) -> Generator(String) {
  qcheck.map(gen, string.replace(_, "|", "/"))
}

fn blank() -> Generator(Piece) {
  use line <- qcheck.map(constants("", ["  ", "\t", "\u{A0}"]))
  [line]
}

fn soup(tame: Bool) -> Generator(Piece) {
  few(
    weighted(#(3, words(tame, 0, 3)), [
      #(
        2,
        constants("", [
          "---", "===", "- a", "> a", "```", "    c", "# h", "|---|", "1. a",
          "  - b", "* * *", "- [ ] t", "  more", "~~~", "<div>", "[a]: http://x",
        ]),
      ),
    ]),
    1,
    8,
  )
}

type Ending {
  Lf
  Crlf
  Mixed(mask: Int)
}

pub type Flavor {
  Anything
  Tame
}

/// A note's text. `Tame` keeps what a parser may drop on purpose out of it: a
/// table row longer than its header, which GFM cuts to the header's width.
pub fn note(flavor: Flavor) -> Generator(String) {
  let tame = flavor == Tame
  use pieces <- qcheck.bind(few(piece(tame), 0, 6))
  use gap <- qcheck.bind(
    weighted(#(6, qcheck.return([])), [
      #(2, qcheck.return([""])),
      #(1, qcheck.return(["", ""])),
      #(1, qcheck.return(["  "])),
    ]),
  )
  use ending <- qcheck.bind(
    weighted(#(6, qcheck.return(Lf)), [
      #(2, qcheck.return(Crlf)),
      #(1, qcheck.bounded_int(1, 1_000_000) |> qcheck.map(Mixed)),
    ]),
  )
  use newline <- qcheck.map(element(False, [True]))
  let rows = list.flat_map(pieces, fn(piece) { list.append(gap, piece) })
  join_rows(rows, ending, 0, "")
  <> case newline {
    True -> end_of(ending, list.length(rows))
    False -> ""
  }
}

fn join_rows(
  rows: List(String),
  ending: Ending,
  index: Int,
  done: String,
) -> String {
  case rows {
    [] -> done
    [row] -> done <> row
    [row, ..rest] ->
      join_rows(rest, ending, index + 1, done <> row <> end_of(ending, index))
  }
}

fn end_of(ending: Ending, index: Int) -> String {
  case ending {
    Lf -> "\n"
    Crlf -> "\r\n"
    Mixed(mask:) ->
      case int.bitwise_and(int.bitwise_shift_right(mask, index % 20), 1) {
        1 -> "\r\n"
        _ -> "\n"
      }
  }
}
