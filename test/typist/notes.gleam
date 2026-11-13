//// Random markdown notes, as rows of source. Every block kind the parser
//// knows, nested in quotes and lists, with blank rows between blocks and
//// sometimes a fence left open at the end.
////
//// Used by the robot typist for the note it types into (`Small`), and by
//// "every line belongs somewhere" for whole documents (`Large`).

import gleam/int
import gleam/list
import gleam/string
import typist/gen.{type Gen}

pub type Size {
  /// A few short blocks, one level deep: short enough that no row of the
  /// note wraps in a text field.
  Small
  /// Many blocks, nested three deep, rows of any length.
  Large
}

/// The kinds of block a generated note can hold, for the coverage line.
pub const block_kinds = [
  "paragraph", "heading", "setext heading", "bullet list", "ordered list",
  "task list", "quote", "fenced code", "open fence", "indented code", "rule",
  "table", "blank row", "junk row",
]

pub fn document(size: Size) -> Gen(List(String)) {
  use count <- gen.then(case size {
    Small -> gen.between(1, 4)
    Large -> gen.between(1, 9)
  })
  use blocks <- gen.then(gen.repeat(count, block(size, depth(size))))
  use tail <- gen.then(open_fence_tail(size))
  use gaps <- gen.then(gen.repeat(count + 1, gap()))
  use junk <- gen.then(
    gen.chance(case size {
      Small -> 5
      Large -> 15
    }),
  )
  let rows =
    list.zip(gaps, list.append(blocks, [tail]))
    |> list.flat_map(fn(pair) { list.append(pair.0, pair.1) })
  let rows = case junk {
    True -> list.append(rows, ["- ", "> ", "|", "```", "    ", "1."])
    False -> rows
  }
  use final_newline <- gen.then(gen.chance(15))
  gen.constant(case final_newline {
    True -> list.append(rows, [""])
    False -> rows
  })
}

fn depth(size: Size) -> Int {
  case size {
    Small -> 1
    Large -> 3
  }
}

/// Blank rows between two blocks: none, one, or a few, some with spaces.
fn gap() -> Gen(List(String)) {
  gen.weighted([
    #(60, [""]),
    #(12, []),
    #(10, ["", ""]),
    #(8, ["  "]),
    #(5, ["", "\t", ""]),
    #(5, ["   ", ""]),
  ])
}

fn open_fence_tail(size: Size) -> Gen(List(String)) {
  use open <- gen.then(
    gen.chance(case size {
      Small -> 12
      Large -> 20
    }),
  )
  case open {
    False -> gen.constant([])
    True -> {
      use mark <- gen.then(gen.one_of(["```", "~~~", "````"]))
      use code <- gen.then(gen.list_of(gen.between(0, 2), word_row()))
      use blank_last <- gen.then(gen.chance(40))
      let rows = [mark, ..code]
      gen.constant(case blank_last {
        True -> list.append(rows, [""])
        False -> rows
      })
    }
  }
}

fn block(size: Size, depth: Int) -> Gen(List(String)) {
  let leaves = [
    #(14, paragraph()),
    #(9, heading()),
    #(4, setext()),
    #(5, fenced()),
    #(3, indented_code()),
    #(3, rule()),
    #(5, table()),
  ]
  let containers = case depth > 0 {
    True -> [
      #(9, bullet_list(size, depth - 1)),
      #(5, ordered_list(size, depth - 1)),
      #(4, task_list(size, depth - 1)),
      #(7, quote(size, depth - 1)),
    ]
    False -> [
      #(5, bullet_list(size, 0)),
      #(2, ordered_list(size, 0)),
      #(2, task_list(size, 0)),
    ]
  }
  gen.weighted_gen(list.append(leaves, containers))
}

fn words() -> Gen(String) {
  use count <- gen.then(gen.between(1, 3))
  use words <- gen.then(gen.repeat(
    count,
    gen.one_of(["one", "two", "go", "ab", "cd", "hi", "é"]),
  ))
  gen.constant(string.join(words, " "))
}

fn inline_words() -> Gen(String) {
  gen.weighted_gen([
    #(10, words()),
    #(2, gen.map(words(), fn(w) { "**" <> w <> "**" })),
    #(2, gen.map(words(), fn(w) { "*" <> w <> "*" })),
    #(1, gen.map(words(), fn(w) { "`" <> w <> "`" })),
    #(1, gen.map(words(), fn(w) { "~~" <> w <> "~~" })),
    #(1, gen.map(words(), fn(w) { "[" <> w <> "](u)" })),
  ])
}

fn word_row() -> Gen(String) {
  words()
}

fn paragraph() -> Gen(List(String)) {
  gen.list_of(gen.between(1, 3), inline_words())
}

fn heading() -> Gen(List(String)) {
  use level <- gen.then(gen.between(1, 6))
  use text <- gen.then(
    gen.weighted_gen([#(9, words()), #(1, gen.constant(""))]),
  )
  use closed <- gen.then(gen.chance(15))
  let marks = string.repeat("#", level)
  gen.constant([
    case closed {
      True -> marks <> " " <> text <> " " <> marks
      False -> string.trim_end(marks <> " " <> text)
    },
  ])
}

fn setext() -> Gen(List(String)) {
  use lines <- gen.then(gen.list_of(gen.between(1, 2), words()))
  use mark <- gen.then(gen.one_of(["===", "---", "=", "--------"]))
  gen.constant(list.append(lines, [mark]))
}

fn fenced() -> Gen(List(String)) {
  use mark <- gen.then(gen.one_of(["```", "~~~", "````"]))
  use info <- gen.then(gen.one_of(["", "", "js", "gleam x"]))
  use code <- gen.then(gen.list_of(gen.between(0, 3), words()))
  use blanks <- gen.then(gen.chance(20))
  let code = case blanks {
    True -> list.flatten([["  "], code, [""]])
    False -> code
  }
  gen.constant(list.flatten([[mark <> info], code, [mark]]))
}

fn indented_code() -> Gen(List(String)) {
  use lines <- gen.then(gen.list_of(gen.between(1, 2), words()))
  gen.constant(list.map(lines, fn(line) { "    " <> line }))
}

fn rule() -> Gen(List(String)) {
  use mark <- gen.then(gen.one_of(["---", "***", "___", "- - -", "-----"]))
  gen.constant([mark])
}

fn table() -> Gen(List(String)) {
  use columns <- gen.then(gen.between(1, 3))
  use heading_row <- gen.then(table_row(columns))
  use aligns <- gen.then(gen.repeat(
    columns,
    gen.one_of(["---", ":--", "--:", ":-:"]),
  ))
  use body_count <- gen.then(gen.between(0, 3))
  use ragged <- gen.then(gen.chance(25))
  use body <- gen.then(gen.repeat(
    body_count,
    table_row(case ragged {
      True -> columns + 1
      False -> columns
    }),
  ))
  let delimiter = "|" <> string.join(aligns, "|") <> "|"
  gen.constant([heading_row, delimiter, ..body])
}

fn table_row(columns: Int) -> Gen(String) {
  use cells <- gen.then(gen.repeat(
    columns,
    gen.one_of(["a", "bc", "", "é", "`x`"]),
  ))
  gen.constant("| " <> string.join(cells, " | ") <> " |")
}

fn bullet_list(size: Size, depth: Int) -> Gen(List(String)) {
  use marker <- gen.then(gen.one_of(["-", "*", "+"]))
  list_of_items(size, depth, fn(_) { marker })
}

fn ordered_list(size: Size, depth: Int) -> Gen(List(String)) {
  use start <- gen.then(gen.one_of([1, 1, 3, 10]))
  use paren <- gen.then(gen.chance(20))
  list_of_items(size, depth, fn(index) {
    int.to_string(start + index)
    <> case paren {
      True -> ")"
      False -> "."
    }
  })
}

fn task_list(size: Size, depth: Int) -> Gen(List(String)) {
  use box <- gen.then(gen.one_of(["[ ]", "[x]", "[X]"]))
  list_of_items(size, depth, fn(_) { "- " <> box })
}

fn list_of_items(
  size: Size,
  depth: Int,
  marker: fn(Int) -> String,
) -> Gen(List(String)) {
  use count <- gen.then(gen.between(1, 3))
  use loose <- gen.then(gen.chance(25))
  use items <- gen.then(gen.repeat(count, item(size, depth, loose)))
  gen.constant(
    list.index_map(items, fn(item_rows, index) {
      let padding = string.repeat(" ", string.length(marker(index)) + 1)
      let #(first, rest) = case item_rows {
        [first, ..rest] -> #(first, rest)
        [] -> #("", [])
      }
      let first = string.trim_end(marker(index) <> " " <> first)
      let rest =
        list.map(rest, fn(row) {
          case string.trim(row) {
            "" -> row
            _ -> padding <> row
          }
        })
      case loose && index > 0 {
        True -> [first, ..rest] |> list.prepend("")
        False -> [first, ..rest]
      }
    })
    |> list.flatten,
  )
}

fn item(size: Size, depth: Int, loose: Bool) -> Gen(List(String)) {
  use first <- gen.then(inline_words())
  use nested <- gen.then(
    gen.chance(case depth > 0 {
      True -> 35
      False -> 12
    }),
  )
  use more <- gen.then(case nested {
    False -> gen.constant([])
    True -> nested_block(size, depth)
  })
  use second_line <- gen.then(gen.chance(20))
  use extra <- gen.then(case second_line {
    True -> gen.map(words(), fn(w) { [w] })
    False -> gen.constant([])
  })
  let blank = case loose && more != [] {
    True -> [""]
    False -> []
  }
  gen.constant(list.flatten([[first], extra, blank, more]))
}

fn nested_block(size: Size, depth: Int) -> Gen(List(String)) {
  case depth > 0 {
    True -> block(size, depth)
    False ->
      gen.weighted_gen([
        #(4, paragraph()),
        #(2, fenced()),
        #(2, bullet_list(size, 0)),
      ])
  }
}

fn quote(size: Size, depth: Int) -> Gen(List(String)) {
  use count <- gen.then(gen.between(1, 2))
  use blocks <- gen.then(gen.repeat(count, block(size, depth)))
  use lazy <- gen.then(gen.chance(15))
  let rows =
    blocks
    |> list.intersperse([">"])
    |> list.flatten
    |> list.map(fn(row) {
      case row {
        "" -> ">"
        _ -> "> " <> row
      }
    })
  gen.constant(case lazy {
    True -> list.append(rows, ["lazy"])
    False -> rows
  })
}
