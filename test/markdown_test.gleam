//// Examples of how the parser is used. The two `pending_` functions are tests
//// that wait for M3: rename one so it ends in `_test` when you start on it
//// (`pending_toggle_task` -> `toggle_task_test`), watch it fail, then make it
//// pass.

import gleam/int
import gleam/list
import gleam/option.{None}
import gleam/string
import scribbl/markdown.{
  Block, BulletList, Checked, Code, Emphasis, H1, H2, H3, H4, H5, H6, Heading,
  Item, Link, Paragraph, Strong, Text, Unchecked,
}

pub fn empty_input_has_no_blocks_test() {
  assert markdown.parse("") == []
  assert markdown.parse("\n  \n\t\n") == []
}

pub fn headings_have_six_levels_test() {
  assert markdown.parse("# a\n## b\n### c\n#### d\n##### e\n###### f")
    == [
      Block(0, 0, Heading(H1, [Text("a")])),
      Block(1, 1, Heading(H2, [Text("b")])),
      Block(2, 2, Heading(H3, [Text("c")])),
      Block(3, 3, Heading(H4, [Text("d")])),
      Block(4, 4, Heading(H5, [Text("e")])),
      Block(5, 5, Heading(H6, [Text("f")])),
    ]
}

/// M3 turns four spaces of indent into a code block.
pub fn four_spaces_of_indent_are_not_a_heading_test() {
  assert markdown.parse("    # too far") == [para(0, "# too far")]
}

pub fn a_heading_ends_the_paragraph_before_it_test() {
  assert markdown.parse("one\ntwo\n# Title\nthree")
    == [
      Block(0, 1, Paragraph([Text("one\ntwo")])),
      Block(2, 2, Heading(H1, [Text("Title")])),
      para(3, "three"),
    ]
}

pub fn a_paragraph_keeps_its_line_breaks_in_the_text_test() {
  assert markdown.parse("  one\n\ttwo\nthree \t")
    == [Block(0, 2, Paragraph([Text("one\ntwo\nthree")]))]
}

pub fn blank_lines_separate_blocks_test() {
  assert markdown.parse("one\n\ntwo\n  \n\n three")
    == [para(0, "one"), para(2, "two"), para(5, "three")]
}

pub fn only_spaces_and_tabs_make_a_line_blank_test() {
  assert markdown.parse("one\n\u{A0}\ntwo")
    == [Block(0, 2, Paragraph([Text("one\n\u{A0}\ntwo")]))]
}

pub fn windows_line_ends_count_like_unix_ones_test() {
  assert markdown.parse("# Title\r\n\r\none\r\ntwo\r\n")
    == [
      Block(0, 0, Heading(H1, [Text("Title")])),
      Block(2, 3, Paragraph([Text("one\ntwo")])),
    ]
}

pub fn a_lone_carriage_return_ends_a_line_test() {
  assert markdown.parse("one\rtwo\r\rthree")
    == [Block(0, 1, Paragraph([Text("one\ntwo")])), para(3, "three")]
}

pub fn a_nul_character_becomes_the_replacement_character_test() {
  assert markdown.parse("a\u{0}b") == [para(0, "a\u{FFFD}b")]
  assert markdown.parse("# \u{0}")
    == [Block(0, 0, Heading(H1, [Text("\u{FFFD}")]))]
}

pub fn emoji_and_accents_are_kept_test() {
  assert markdown.parse("# héllo 👋\n\nbye 👋")
    == [Block(0, 0, Heading(H1, [Text("héllo 👋")])), para(2, "bye 👋")]
}

pub fn spaces_before_a_line_break_are_dropped_test() {
  assert markdown.parse("one  \ntwo\t\nthree")
    == [Block(0, 2, Paragraph([Text("one\ntwo\nthree")]))]
}

// Left as text by decision.

pub fn raw_html_is_text_test() {
  assert markdown.parse("<h1>hi</h1>\n<script>alert(1)</script>")
    == [
      Block(0, 1, Paragraph([Text("<h1>hi</h1>\n<script>alert(1)</script>")])),
    ]
}

pub fn entities_stay_as_typed_test() {
  assert markdown.parse("&amp; &copy; &#35;")
    == paragraph([Text("&amp; &copy; &#35;")])
}

pub fn an_image_is_a_bang_then_a_link_test() {
  assert markdown.parse("![moon](moon.jpg)")
    == paragraph([Text("!"), Link([Text("moon")], "moon.jpg", None)])
}

pub fn autolinks_are_text_test() {
  assert markdown.parse("<https://example.com>")
    == paragraph([Text("<https://example.com>")])
}

pub fn hard_line_breaks_stay_soft_test() {
  assert markdown.parse("a  \nb\\\nc")
    == [Block(0, 2, Paragraph([Text("a\nb\\\nc")]))]
}

pub fn unclosed_bold_is_text_test() {
  assert markdown.parse("**oops") == paragraph([Text("**oops")])
}

pub fn a_bracket_without_a_link_is_text_test() {
  assert markdown.parse("[not a link]") == paragraph([Text("[not a link]")])
  assert markdown.parse("[a](b") == paragraph([Text("[a](b")])
}

pub fn strong_around_emoji_test() {
  assert markdown.parse("**héllo 👋**") == paragraph([Strong([Text("héllo 👋")])])
}

/// The page decides what is safe to click. The parser only reads the syntax.
pub fn a_javascript_url_is_still_a_link_test() {
  assert markdown.parse("[x](javascript:alert(1))")
    == paragraph([Link([Text("x")], "javascript:alert(1)", None)])
}

pub fn parentheses_in_a_url_nest_32_deep_test() {
  let level_32 = string.repeat("(", 32) <> string.repeat(")", 32)
  assert markdown.parse("[a](" <> level_32 <> ")")
    == paragraph([Link([Text("a")], level_32, None)])

  let level_33 = string.repeat("(", 33) <> string.repeat(")", 33)
  let text = "[a](" <> level_33 <> ")"
  assert markdown.parse(text) == paragraph([Text(text)])
}

pub fn a_long_url_is_still_a_link_test() {
  let url = string.repeat("x", 20_000)
  assert markdown.parse("[a](" <> url <> ")")
    == paragraph([Link([Text("a")], url, None)])
}

pub fn a_closer_passes_the_label_a_link_gave_up_test() {
  assert markdown.parse("*a [b [c](d) e*")
    == paragraph([
      Emphasis([Text("a [b "), Link([Text("c")], "d", None), Text(" e")]),
    ])
}

pub fn a_label_opened_after_a_link_still_closes_test() {
  assert markdown.parse("[a [b](c) [d](e) f](g)")
    == paragraph([
      Text("[a "),
      Link([Text("b")], "c", None),
      Text(" "),
      Link([Text("d")], "e", None),
      Text(" f](g)"),
    ])
}

// The 32-level cap

pub fn nesting_stops_at_thirty_two_levels_test() {
  let line = string.repeat("*a ", 5000) <> "b" <> string.repeat(" a*", 5000)
  let assert [Block(0, 0, Paragraph(inlines))] = markdown.parse(line)

  assert depth(inlines) == 32
}

pub fn marks_too_deep_stay_text_in_place_test() {
  let line = string.repeat("*a ", 40) <> "b" <> string.repeat(" a*", 40)
  let assert [Block(0, 0, Paragraph([Text(before), deep, Text(after)]))] =
    markdown.parse(line)

  assert before == string.repeat("*a ", 8)
  assert depth([deep]) == 32
  assert after == string.repeat(" a*", 8)
}

pub fn a_link_too_deep_stays_text_around_its_label_test() {
  let label = string.repeat("*a ", 40) <> "b" <> string.repeat(" a*", 40)
  let assert [Block(0, 0, Paragraph([Text(before), deep, Text(after)]))] =
    markdown.parse("[" <> label <> "](u \"t\")")

  assert before == "[" <> string.repeat("*a ", 8)
  assert depth([deep]) == 32
  assert after == string.repeat(" a*", 8) <> "](u \"t\")"
}

pub fn a_link_counts_as_a_level_test() {
  let line = string.repeat("*a ", 40) <> "[b](u)" <> string.repeat(" a*", 40)
  let assert [Block(0, 0, Paragraph(inlines))] = markdown.parse(line)

  assert depth(inlines) == 32
}

pub fn code_kept_through_thousands_of_levels_test() {
  let line = string.repeat("*`c` ", 5000) <> "b" <> string.repeat(" `c`*", 5000)
  let assert [Block(0, 0, Paragraph(inlines))] = markdown.parse(line)

  assert depth(inlines) == 32
  assert list.take(inlines, 4) == [Text("*"), Code("c"), Text(" *"), Code("c")]
}

// Long and hostile lines

pub fn a_long_plain_line_is_one_text_test() {
  let line = string.repeat("word ", 4000) |> string.trim
  assert markdown.parse(line) == paragraph([Text(line)])
}

pub fn a_long_run_of_one_mark_is_one_text_test() {
  let stars = string.repeat("*", 20_000)
  let ticks = string.repeat("`", 20_000)
  assert markdown.parse(stars) == paragraph([Text(stars)])
  assert markdown.parse(ticks) == paragraph([Text(ticks)])
}

pub fn a_backtick_that_never_closes_stays_text_test() {
  let line = "`" <> string.repeat("code ", 4000) |> string.trim
  assert markdown.parse(line) == paragraph([Text(line)])
}

pub fn many_unclosed_stars_are_text_test() {
  let line = string.repeat("*a ", 7000) |> string.trim
  assert markdown.parse(line) == paragraph([Text(line)])
}

pub fn many_unclosed_bold_marks_are_text_test() {
  let line = string.repeat("**a ", 5000) |> string.trim
  assert markdown.parse(line) == paragraph([Text(line)])
}

pub fn many_unclosed_brackets_are_text_test() {
  let line = string.repeat("[", 20_000)
  assert markdown.parse(line) == paragraph([Text(line)])
  let mixed = string.repeat("**[a ", 4000) |> string.trim
  assert markdown.parse(mixed) == paragraph([Text(mixed)])
}

pub fn closers_that_find_no_opener_are_text_test() {
  let line = string.repeat("*a ", 3000) <> string.repeat("a_ ", 3000)
  let line = string.trim(line)
  assert markdown.parse(line) == paragraph([Text(line)])
}

pub fn lines_of_link_starts_that_never_close_are_text_test() {
  let starts = string.repeat("](", 20_000)
  assert markdown.parse(starts) == paragraph([Text(starts)])
  let opens = "[a](" <> string.repeat("(", 20_000)
  assert markdown.parse(opens) == paragraph([Text(opens)])
}

pub fn link_tails_that_never_close_are_text_test() {
  let titles = string.repeat("[a](u \"", 5000)
  assert markdown.parse(titles) == paragraph([Text(titles)])
  let pointy = string.repeat("[a](<b", 5000)
  assert markdown.parse(pointy) == paragraph([Text(pointy)])
}

pub fn a_closer_gives_up_every_opener_inside_it_test() {
  let inside = string.repeat("[a ", 5000) <> "b"
  assert markdown.parse("*" <> inside <> "*")
    == paragraph([Emphasis([Text(inside)])])
}

pub fn a_link_gives_up_every_opener_around_it_test() {
  let openers = string.repeat("[a ", 3000)
  assert markdown.parse(openers <> "[a](b)")
    == paragraph([Text(openers), Link([Text("a")], "b", None)])
}

pub fn a_long_run_of_spaces_inside_a_line_is_kept_test() {
  let line = "a" <> string.repeat(" ", 20_000) <> "b"
  assert markdown.parse(line) == paragraph([Text(line)])
}

pub fn trimming_keeps_a_lone_accent_in_place_test() {
  assert markdown.parse("\u{301} a ") == paragraph([Text("\u{301} a")])
}

pub fn thousands_of_bold_words_are_thousands_of_strongs_test() {
  let strong = Strong([Text("a")])
  let expected =
    list.repeat([strong, Text(" ")], 4999)
    |> list.flatten
    |> list.append([strong])
  assert markdown.parse(string.repeat("**a** ", 5000)) == paragraph(expected)
}

pub fn thousands_of_links_are_thousands_of_links_test() {
  let link = Link([Text("a")], "b", None)
  let expected =
    list.repeat([link, Text(" ")], 3999) |> list.flatten |> list.append([link])
  assert markdown.parse(string.repeat("[a](b) ", 4000)) == paragraph(expected)
}

// Plain text, for note titles

pub fn plain_text_keeps_the_words_and_drops_the_markup_test() {
  let assert [Block(content: Paragraph(text), ..)] =
    markdown.parse("a **b *c*** [d `e`](u \"t\") `f` **g")
  assert markdown.plain_text(text) == "a b c d e f **g"
}

pub fn plain_text_shows_a_line_break_as_a_space_test() {
  let assert [Block(content: Paragraph(text), ..)] =
    markdown.parse("one\n*two*\nthree")
  assert markdown.plain_text(text) == "one two three"
}

pub fn plain_text_keeps_struck_words_test() {
  assert markdown.plain_text([markdown.Strike([Text("gone")])]) == "gone"
}

fn depth(inlines: List(markdown.Inline)) -> Int {
  list.fold(inlines, 0, fn(deepest, inline) {
    case inline {
      Text(_) | Code(_) -> deepest
      Strong(children) | Emphasis(children) | Link(children, _, _) ->
        int.max(deepest, 1 + depth(children))
      markdown.Strike(children) -> int.max(deepest, 1 + depth(children))
    }
  })
}

/// M3: each item knows its source row and whether it is a task.
pub fn pending_task_list() {
  let milk = Item(row: 0, task: Unchecked, blocks: [para(0, "milk")])
  let eggs = Item(row: 1, task: Checked, blocks: [para(1, "eggs")])

  assert markdown.parse("- [ ] milk\n- [x] eggs")
    == [Block(0, 1, BulletList([milk, eggs]))]
}

/// M3
pub fn pending_toggle_task() {
  assert markdown.toggle_task("- [x] eggs") == "- [ ] eggs"
  assert markdown.toggle_task("  - [ ] milk") == "  - [x] milk"
  assert markdown.toggle_task("just text") == "just text"
}

fn para(row: Int, text: String) -> markdown.Block {
  Block(row, row, Paragraph([Text(text)]))
}

fn paragraph(inlines: List(markdown.Inline)) -> List(markdown.Block) {
  [Block(0, 0, Paragraph(inlines))]
}
