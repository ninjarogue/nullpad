//// Every line of a note belongs to exactly one block, and the page draws each
//// row once. Notes are generated from realistic pieces by a seeded generator,
//// so a failure repeats, and a failing case is shrunk before it is shown.
////
//// The rule: a row is claimed by the span of one top-level block, or it lies
//// outside every block and the page draws it as one empty line (`div.blank`),
//// and then its text must be blank. A row the page draws by two blocks, or
//// as an empty line while it holds text, would jump or vanish.

import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import lustre/element
import nullpad/buffer.{Position}
import nullpad/editor
import nullpad/live.{type Region, Region}
import nullpad/markdown.{
  type Block, type Item, Block, BulletList, OrderedList, Quote,
}
import nullpad/preview

// A generator takes a seed and gives a value and the next seed.

type Gen(a) =
  fn(Int) -> #(a, Int)

fn step(seed: Int) -> Int {
  seed * 48_271 % 2_147_483_647
}

fn below(limit: Int) -> Gen(Int) {
  fn(seed) {
    let seed = step(seed)
    #(seed / 64 % limit, seed)
  }
}

fn then(gen: Gen(a), next: fn(a) -> Gen(b)) -> Gen(b) {
  fn(seed) {
    let #(value, seed) = gen(seed)
    next(value)(seed)
  }
}

fn map(gen: Gen(a), with: fn(a) -> b) -> Gen(b) {
  use value <- then(gen)
  constant(with(value))
}

fn constant(value: a) -> Gen(a) {
  fn(seed) { #(value, seed) }
}

fn pick(options: List(a)) -> Gen(a) {
  let assert [first, ..] = options
  use index <- then(below(list.length(options)))
  case list.drop(options, index) {
    [value, ..] -> constant(value)
    [] -> constant(first)
  }
}

fn one_of(gens: List(Gen(a))) -> Gen(a) {
  use gen <- then(pick(gens))
  gen
}

fn between(low: Int, high: Int) -> Gen(Int) {
  map(below(high - low + 1), int.add(_, low))
}

fn many(gen: Gen(a), count: Int) -> Gen(List(a)) {
  fn(seed) { collect(gen, count, seed, []) }
}

fn collect(
  gen: Gen(a),
  count: Int,
  seed: Int,
  taken: List(a),
) -> #(List(a), Int) {
  case count <= 0 {
    True -> #(list.reverse(taken), seed)
    False -> {
      let #(value, seed) = gen(seed)
      collect(gen, count - 1, seed, [value, ..taken])
    }
  }
}

fn some(gen: Gen(a), low: Int, high: Int) -> Gen(List(a)) {
  use count <- then(between(low, high))
  many(gen, count)
}

fn chance(one_in: Int) -> Gen(Bool) {
  map(below(one_in), fn(roll) { roll == 0 })
}

fn lines(gen: Gen(String)) -> Gen(List(String)) {
  map(gen, fn(line) { [line] })
}

// The pieces of a note.

fn words() -> Gen(String) {
  pick([
    "alpha", "beta", "gamma delta", "*em*", "**strong**", "`code`",
    "[link](http://x)", "~~s~~", "a|b", "x", "1.", "-", "#", "> q", "<b>",
  ])
}

fn phrase() -> Gen(String) {
  use parts <- then(some(words(), 1, 3))
  constant(string.join(parts, " "))
}

fn tail() -> Gen(String) {
  pick(["", "", "", "", "", "  ", "   ", "\\"])
}

fn paragraph() -> Gen(List(String)) {
  some(
    {
      use text <- then(phrase())
      use end <- then(tail())
      constant(text <> end)
    },
    1,
    3,
  )
}

fn heading() -> Gen(List(String)) {
  use mark <- then(
    pick(["#", "##", "###", "######", "#######", " #", "  ##", "#"]),
  )
  use text <- then(phrase())
  use close <- then(pick(["", "", " ##", " #"]))
  use end <- then(tail())
  constant([mark <> " " <> text <> close <> end])
}

fn setext() -> Gen(List(String)) {
  use text <- then(some(phrase(), 1, 2))
  use under <- then(
    pick(["===", "---", "-", "=", "  ---", "= =", "------", "===  ", "--- -"]),
  )
  constant(list.append(text, [under]))
}

fn rule() -> Gen(List(String)) {
  lines(pick(["***", "---", "___", "- - -", "* * *", "  ***", "----  "]))
}

fn marker() -> Gen(String) {
  pick(["- ", "* ", "+ ", "1. ", "2) ", "- [ ] ", "- [x] ", "10. ", "-", "- "])
}

fn item(depth: Int) -> Gen(List(String)) {
  use indent <- then(pick(["", "", "  ", "   ", "    "]))
  use mark <- then(marker())
  use text <- then(phrase())
  use more <- then(pick([[], [], ["  more text"], ["lazy"], ["", "  after"]]))
  use nested <- then(case depth > 0 {
    False -> constant([])
    True -> {
      use deeper <- then(chance(3))
      case deeper {
        False -> constant([])
        True -> {
          use pad <- then(pick(["  ", "    ", "   "]))
          use inner <- then(some(item(depth - 1), 1, 2))
          constant(list.map(list.flatten(inner), string.append(pad, _)))
        }
      }
    }
  })
  constant(list.flatten([[indent <> mark <> text], more, nested]))
}

fn list_block() -> Gen(List(String)) {
  use items <- then(some(
    {
      use one <- then(item(2))
      use gap <- then(chance(4))
      constant(case gap {
        True -> list.append(one, [""])
        False -> one
      })
    },
    1,
    4,
  ))
  constant(list.flatten(items))
}

fn quote() -> Gen(List(String)) {
  use quoted <- then(some(
    {
      use mark <- then(pick(["> ", ">", "> > ", "> - ", ">>", "> # ", "> ```"]))
      use text <- then(phrase())
      constant(mark <> text)
    },
    1,
    3,
  ))
  use lazy <- then(pick([[], [], ["lazy text"], [""]]))
  constant(list.append(quoted, lazy))
}

fn fence() -> Gen(List(String)) {
  use open <- then(pick(["```", "~~~", "```gleam", "````", "  ```"]))
  use inside <- then(some(
    pick(["code", "", "  indented", "# not heading", "---", "```"]),
    0,
    3,
  ))
  use closed <- then(pick([True, True, True, False]))
  constant(case closed {
    True -> list.flatten([[open], inside, ["```"]])
    False -> [open, ..inside]
  })
}

fn indented() -> Gen(List(String)) {
  some(
    {
      use text <- then(
        pick(["    code", "    more", "", "      deep", "\tcode"]),
      )
      constant(text)
    },
    1,
    4,
  )
}

fn table() -> Gen(List(String)) {
  use head <- then(pick(["| a | b |", "a | b", "| a |", "|a|b|"]))
  use delimiter <- then(
    pick(["|---|---|", "| :-: | --: |", "---|---", "|---|", "|:--|"]),
  )
  use rows <- then(some(
    pick(["| x | y |", "x | y", "| only |", "| 1 | 2 | 3 |", "|"]),
    0,
    3,
  ))
  constant([head, delimiter, ..rows])
}

fn blank() -> Gen(List(String)) {
  lines(pick(["", "", "  ", "\t"]))
}

fn soup() -> Gen(List(String)) {
  some(
    one_of([
      phrase(),
      pick(["", "---", "===", "- a", "> a", "```", "    c", "# h", "| a |"]),
      pick(["|---|", "1. a", "  - b", "* * *", "- [ ] t", "  more", "~~~"]),
    ]),
    1,
    12,
  )
}

fn piece() -> Gen(List(String)) {
  one_of([
    paragraph(),
    paragraph(),
    heading(),
    heading(),
    setext(),
    setext(),
    rule(),
    list_block(),
    list_block(),
    quote(),
    fence(),
    indented(),
    table(),
    blank(),
    soup(),
  ])
}

fn note() -> Gen(List(String)) {
  use shape <- then(below(20))
  case shape {
    0 -> constant([])
    1 | 2 -> soup()
    _ -> {
      use pieces <- then(some(piece(), 1, 7))
      let gap = pick([[], [], [""], ["", ""], ["  "]])
      use gapped <- then(join_with(pieces, gap, []))
      constant(gapped)
    }
  }
}

fn join_with(
  pieces: List(List(String)),
  gap: Gen(List(String)),
  done: List(String),
) -> Gen(List(String)) {
  case pieces {
    [] -> constant(done)
    [piece, ..rest] -> {
      use between <- then(gap)
      join_with(rest, gap, list.flatten([done, between, piece]))
    }
  }
}

fn text_of(rows: List(String), final_newline: Bool) -> String {
  let text = string.join(rows, "\n")
  case final_newline {
    True -> text <> "\n"
    False -> text
  }
}

// What the page draws.

fn row_range(first: Int, last: Int) -> List(Int) {
  case first > last {
    True -> []
    False ->
      int.range(from: first, to: last + 1, with: [], run: list.prepend)
      |> list.reverse
  }
}

/// The rows of the `div.blank` the page draws, each with how deep it sits:
/// 1 for a child of the part itself, more for one a block draws inside.
fn blank_rows(blocks: List(Block), from: Int, to: Int) -> List(#(Int, Int)) {
  let html =
    preview.part(
      blocks,
      rows: to - from,
      first_row: from,
      test_id: "part",
      on_task: fn(_, _) { Nil },
    )
    |> element.to_string
  let #(_, found) =
    list.fold(string.split(html, "<"), #(0, []), fn(state, tag) {
      let #(depth, found) = state
      case string.starts_with(tag, "/") {
        True -> #(depth - 1, found)
        False -> {
          let name = case string.split_once(tag, " ") {
            Ok(#(name, _)) -> name
            Error(Nil) -> tag
          }
          let name = case string.split_once(name, ">") {
            Ok(#(name, _)) -> name
            Error(Nil) -> name
          }
          let found = case
            string.starts_with(tag, "div class=\"blank\" data-row=\"")
          {
            True ->
              case string.split(tag, "\"") {
                [_, _, _, row, ..] ->
                  case int.parse(row) {
                    Ok(row) -> [#(row, depth), ..found]
                    Error(Nil) -> found
                  }
                _ -> found
              }
            False -> found
          }
          case name {
            "" | "input" | "hr" | "br" | "img" -> #(depth, found)
            _ -> #(depth + 1, found)
          }
        }
      }
    })
  found
}

type Claims {
  Claims(by_blocks: List(Int), as_blank: List(Int), inner_blank: List(Int))
}

fn part_claims(blocks: List(Block), from: Int, to: Int) -> Claims {
  let shown = preview.inside(blocks, from:, to:)
  let drawn = blank_rows(blocks, from, to)
  Claims(
    by_blocks: list.flat_map(shown, fn(block) {
      row_range(block.first_row, block.last_row)
    }),
    as_blank: list.filter_map(drawn, fn(blank) {
      case blank.1 {
        1 -> Ok(blank.0)
        _ -> Error(Nil)
      }
    }),
    inner_blank: list.filter_map(drawn, fn(blank) {
      case blank.1 {
        1 -> Error(Nil)
        _ -> Ok(blank.0)
      }
    }),
  )
}

/// Rows 0 to n - 1 as the app draws them: the part above the field, the field,
/// the part below. With no field the whole note is one part.
fn check_page(
  blocks: List(Block),
  field: Option(Region),
  rows: List(String),
) -> Result(Nil, String) {
  let count = list.length(rows)
  let #(above, held, under) = case field {
    None -> #(part_claims(blocks, 0, count), [], Claims([], [], []))
    Some(Region(first_row:, last_row:)) -> #(
      part_claims(blocks, 0, first_row),
      row_range(first_row, last_row),
      part_claims(blocks, last_row + 1, count),
    )
  }
  let inner_kept =
    list.all(above.inner_blank, list.contains(above.by_blocks, _))
    && list.all(under.inner_blank, list.contains(under.by_blocks, _))
  let blanks = list.append(above.as_blank, under.as_blank)
  let claimed =
    list.flatten([above.by_blocks, held, under.by_blocks, blanks])
    |> list.sort(int.compare)
  let wanted = row_range(0, count - 1)
  let texts_blank =
    list.all(blanks, fn(row) {
      case list.drop(rows, row) {
        [text, ..] -> string.trim(text) == ""
        [] -> False
      }
    })
  case claimed == wanted && inner_kept, texts_blank {
    True, True -> Ok(Nil)
    False, _ ->
      Error(
        "rows drawn "
        <> string.inspect(claimed)
        <> " but the note has "
        <> string.inspect(wanted)
        <> ", field "
        <> string.inspect(field)
        <> ", blocks "
        <> string.inspect(list.map(blocks, spans)),
      )
    True, False ->
      Error(
        "a row with text is drawn as an empty line, blank rows "
        <> string.inspect(list.sort(blanks, int.compare))
        <> ", blocks "
        <> string.inspect(list.map(blocks, spans)),
      )
  }
}

fn spans(block: Block) -> #(Int, Int) {
  #(block.first_row, block.last_row)
}

/// A block's children claim rows inside it, in order, none twice.
fn check_tree(blocks: List(Block), low: Int, high: Int) -> Result(Nil, String) {
  case blocks {
    [] -> Ok(Nil)
    [Block(first_row:, last_row:, content:), ..rest] ->
      case first_row < low || last_row < first_row || last_row > high {
        True ->
          Error(
            "block rows "
            <> string.inspect(#(first_row, last_row))
            <> " fall outside "
            <> string.inspect(#(low, high)),
          )
        False -> {
          let inside = case content {
            Quote(blocks:) -> check_tree(blocks, first_row, last_row)
            BulletList(items:, ..) | OrderedList(items:, ..) ->
              check_items(items, first_row, last_row)
            _ -> Ok(Nil)
          }
          case inside {
            Ok(Nil) -> check_tree(rest, last_row + 1, high)
            Error(_) as failed -> failed
          }
        }
      }
  }
}

fn check_items(items: List(Item), low: Int, high: Int) -> Result(Nil, String) {
  case items {
    [] -> Ok(Nil)
    [item, ..rest] -> {
      let last = case list.last(item.blocks) {
        Ok(block) -> block.last_row
        Error(Nil) -> item.row
      }
      case item.row < low || last > high {
        True ->
          Error(
            "item rows "
            <> string.inspect(#(item.row, last))
            <> " fall outside "
            <> string.inspect(#(low, high)),
          )
        False ->
          case check_tree(item.blocks, item.row, last) {
            Ok(Nil) -> check_items(rest, last + 1, high)
            Error(_) as failed -> failed
          }
      }
    }
  }
}

// Properties.

type Whole {
  Whole(rows: List(String), final_newline: Bool)
}

fn whole() -> Gen(Whole) {
  use rows <- then(note())
  use newline <- then(chance(3))
  constant(Whole(rows:, final_newline: newline))
}

fn buffer_rows(whole: Whole) -> List(String) {
  buffer.lines(buffer.from_text(text_of(whole.rows, whole.final_newline)))
}

fn check_whole(whole: Whole) -> Result(Nil, String) {
  let text = text_of(whole.rows, whole.final_newline)
  let blocks = markdown.parse(text)
  let rows = buffer_rows(whole)
  let count = list.length(rows)
  case check_tree(blocks, 0, count - 1) {
    Error(_) as failed -> failed
    Ok(Nil) -> {
      use _ <- result_then(check_page(blocks, None, rows))
      let at = [count / 2]
      list.try_each(at, fn(row) {
        let field = live.reveal(blocks, from: row, to: row)
        check_page(blocks, Some(field), rows)
      })
    }
  }
}

fn result_then(
  result: Result(Nil, String),
  next: fn(Nil) -> Result(Nil, String),
) -> Result(Nil, String) {
  case result {
    Ok(Nil) -> next(Nil)
    Error(_) as failed -> failed
  }
}

type Typing {
  Type(String)
  Backspace
  Enter
  JoinUp
  JoinDown
}

type Typed {
  Typed(whole: Whole, cursor: Int, edits: List(Typing))
}

fn typing() -> Gen(Typing) {
  one_of([
    map(
      pick([
        "a", " ", "-", "=", "#", "`", ">", "*", "1", ".", "|", "\t", "  ", "[ ]",
        "- ", "==", "```", "---", "# ",
      ]),
      Type,
    ),
    map(pick(["a", "-", "=", " ", "#"]), Type),
    constant(Backspace),
    constant(Backspace),
    constant(Enter),
    constant(JoinUp),
    constant(JoinDown),
  ])
}

fn typed() -> Gen(Typed) {
  use whole <- then(whole())
  use cursor <- then(below(1000))
  use edits <- then(some(typing(), 1, 5))
  constant(Typed(whole:, cursor:, edits:))
}

fn apply(edited: editor.Editor, edit: Typing) -> editor.Editor {
  let field = editor.field_buffer(edited)
  let at = buffer.cursor(field)
  let shown = case edit {
    Type(text) -> buffer.replace(field, from: at, to: at, with: text)
    Enter -> buffer.replace(field, from: at, to: at, with: "\n")
    Backspace ->
      case at.col > 0 {
        True ->
          buffer.replace(
            field,
            from: Position(..at, col: at.col - 1),
            to: at,
            with: "",
          )
        False -> field
      }
    JoinUp | JoinDown -> field
  }
  let event = case edit {
    JoinUp -> editor.EdgePressed(editor.JoinBefore, x: 0.0, shown:)
    JoinDown -> editor.EdgePressed(editor.JoinAfter, x: 0.0, shown:)
    Type(_) | Enter | Backspace -> editor.ControlChanged(shown:)
  }
  editor.update(edited, event).editor
}

/// The snapshot path: the page stays as drawn while the caret stays on its
/// row, and the rows it draws must still be the rows of the current note.
fn check_typed(case_: Typed) -> Result(Nil, String) {
  let text = text_of(case_.whole.rows, case_.whole.final_newline)
  let opened =
    editor.new(vim: False, live: True, paint: True)
    |> editor.open(text)
    |> fn(o) { o.editor }
  let count = editor.row_count(opened)
  let row = case_.cursor % count
  let pointed =
    editor.update(
      opened,
      editor.Pointed(row:, visible: "", at_end: True, next: "", x: 0.0, y: 0.0),
    ).editor
  check_edits(pointed, case_.edits, [])
}

fn check_edits(
  edited: editor.Editor,
  edits: List(Typing),
  done: List(Typing),
) -> Result(Nil, String) {
  let rows = buffer.lines(editor.buffer(edited))
  let checked = check_page(editor.blocks(edited), editor.region(edited), rows)
  case checked, edits {
    Error(reason), _ ->
      Error(
        reason
        <> ", after "
        <> string.inspect(list.reverse(done))
        <> ", rows "
        <> string.inspect(rows),
      )
    Ok(Nil), [] -> Ok(Nil)
    Ok(Nil), [edit, ..rest] ->
      check_edits(apply(edited, edit), rest, [edit, ..done])
  }
}

// Shrinking: drop what can go while the case still fails.

fn shrink(case_: a, fails: fn(a) -> Bool, smaller: fn(a) -> List(a)) -> a {
  case list.find(smaller(case_), fails) {
    Ok(next) -> shrink(next, fails, smaller)
    Error(Nil) -> case_
  }
}

fn without(items: List(a)) -> List(List(a)) {
  list.index_map(items, fn(_, index) {
    list.flatten([list.take(items, index), list.drop(items, index + 1)])
  })
}

fn smaller_whole(whole: Whole) -> List(Whole) {
  let newline = case whole.final_newline {
    True -> [Whole(..whole, final_newline: False)]
    False -> []
  }
  list.append(
    list.map(without(whole.rows), fn(rows) { Whole(..whole, rows:) }),
    newline,
  )
}

fn smaller_typed(case_: Typed) -> List(Typed) {
  list.append(
    list.map(without(case_.edits), fn(edits) { Typed(..case_, edits:) }),
    list.map(smaller_whole(case_.whole), fn(whole) { Typed(..case_, whole:) }),
  )
}

fn run(
  name: String,
  cases: Int,
  seed: Int,
  gen: Gen(a),
  check: fn(a) -> Result(Nil, String),
  smaller: fn(a) -> List(a),
  show: fn(a) -> String,
) -> Nil {
  run_from(name, cases, seed, gen, check, smaller, show)
}

fn run_from(
  name: String,
  left: Int,
  seed: Int,
  gen: Gen(a),
  check: fn(a) -> Result(Nil, String),
  smaller: fn(a) -> List(a),
  show: fn(a) -> String,
) -> Nil {
  case left <= 0 {
    True -> Nil
    False -> {
      let #(case_, seed) = gen(seed)
      case check(case_) {
        Ok(Nil) -> run_from(name, left - 1, seed, gen, check, smaller, show)
        Error(_) -> {
          let fails = fn(candidate) {
            case check(candidate) {
              Ok(Nil) -> False
              Error(_) -> True
            }
          }
          let least = shrink(case_, fails, smaller)
          let assert Error(reason) = check(least)
          panic as { name <> " failed on " <> show(least) <> "\n" <> reason }
        }
      }
    }
  }
}

fn show_whole(whole: Whole) -> String {
  string.inspect(text_of(whole.rows, whole.final_newline))
}

fn show_typed(case_: Typed) -> String {
  show_whole(case_.whole)
  <> " cursor "
  <> int.to_string(case_.cursor)
  <> " edits "
  <> string.inspect(case_.edits)
}

/// Rule: a row is claimed by one top-level block's span, or lies outside
/// every block and is drawn as one empty line, and then holds no text.
pub fn every_row_of_a_note_is_drawn_once_by_one_block_or_as_a_blank_test() {
  run(
    "every row drawn once",
    3000,
    20_241_113,
    whole(),
    check_whole,
    smaller_whole,
    show_whole,
  )
}

/// The page kept while the caret stays on its row, shifted as the app does,
/// still draws every row of the current note once.
pub fn the_page_kept_through_typing_on_a_row_draws_every_row_once_test() {
  run(
    "page kept through typing",
    2000,
    7_654_321,
    typed(),
    check_typed,
    smaller_typed,
    show_typed,
  )
}

pub fn the_generator_makes_every_kind_of_piece_test() {
  let #(sample, _) = many(whole(), 400)(1)
  let text = string.join(list.map(sample, show_whole), "\n")
  assert string.contains(text, "```")
  assert string.contains(text, "===")
  assert string.contains(text, "- [x]")
  assert string.contains(text, "|---|")
  assert string.contains(text, "> ")
  assert list.any(sample, fn(whole) { whole.rows == [] })
  assert list.any(sample, fn(whole) { whole.final_newline })
}

pub fn the_check_rejects_a_row_two_blocks_draw_test() {
  let blocks = [
    Block(0, 1, markdown.Paragraph([])),
    Block(1, 2, markdown.Paragraph([])),
  ]
  assert check_page(blocks, None, ["a", "b", "c"]) != Ok(Nil)
}

pub fn the_check_rejects_a_row_with_text_drawn_as_a_blank_test() {
  let blocks = [Block(0, 0, markdown.Paragraph([]))]
  assert check_page(blocks, None, ["a", "b"]) != Ok(Nil)
  assert check_page(blocks, None, ["a", " "]) == Ok(Nil)
}

pub fn the_check_rejects_a_block_that_runs_past_its_parent_test() {
  let inner = Block(0, 3, markdown.Paragraph([]))
  assert check_tree([Block(0, 2, Quote([inner]))], 0, 2) != Ok(Nil)
}
