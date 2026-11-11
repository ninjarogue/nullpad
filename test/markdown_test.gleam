//// Examples of how the parser is used. The two `pending_` functions are tests
//// that wait for M3: rename one so it ends in `_test` when you start on it
//// (`pending_toggle_task` -> `toggle_task_test`), watch it fail, then make it
//// pass.

import gleam/int
import gleam/list
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

pub fn raw_html_is_text_test() {
  assert markdown.parse("<h1>hi</h1>\n<script>alert(1)</script>")
    == [
      Block(0, 1, Paragraph([Text("<h1>hi</h1>\n<script>alert(1)</script>")])),
    ]
}

/// M2: syntax that never closes is plain text, not an error.
pub fn unclosed_bold_is_text_test() {
  assert markdown.parse("**oops") == [Block(0, 0, Paragraph([Text("**oops")]))]
}

pub fn unclosed_code_is_text_test() {
  assert markdown.parse("`oops") == paragraph([Text("`oops")])
  assert markdown.parse("``a`") == paragraph([Text("``a`")])
}

pub fn a_star_beside_a_space_is_text_test() {
  assert markdown.parse("2 * 3 * 4") == paragraph([Text("2 * 3 * 4")])
  assert markdown.parse("a * b* c") == paragraph([Text("a * b* c")])
  assert markdown.parse("a *b *") == paragraph([Text("a *b *")])
}

pub fn underscores_inside_a_word_are_text_test() {
  assert markdown.parse("snake_case_name")
    == paragraph([Text("snake_case_name")])
}

pub fn a_bracket_without_a_link_is_text_test() {
  assert markdown.parse("[not a link]") == paragraph([Text("[not a link]")])
  assert markdown.parse("[a](b") == paragraph([Text("[a](b")])
  assert markdown.parse("[a](b c)") == paragraph([Text("[a](b c)")])
}

pub fn a_backslash_before_a_letter_is_literal_test() {
  assert markdown.parse("C:\\dir") == paragraph([Text("C:\\dir")])
  assert markdown.parse("end\\") == paragraph([Text("end\\")])
}

// 1. Code spans

pub fn code_span_test() {
  assert markdown.parse("use `x` here")
    == paragraph([Text("use "), Code("x"), Text(" here")])
}

pub fn code_content_is_literal_test() {
  assert markdown.parse("`**not** [bold](x)`")
    == paragraph([Code("**not** [bold](x)")])
}

pub fn code_span_longer_fence_test() {
  assert markdown.parse("`` a`b ``") == paragraph([Code("a`b")])
}

pub fn code_span_strips_one_space_each_side_test() {
  assert markdown.parse("`  a  `") == paragraph([Code(" a ")])
  assert markdown.parse("`  `") == paragraph([Code("  ")])
}

// 2. Bold and italic

pub fn strong_test() {
  assert markdown.parse("a **b** c")
    == paragraph([Text("a "), Strong([Text("b")]), Text(" c")])
  assert markdown.parse("__b__") == paragraph([Strong([Text("b")])])
}

pub fn emphasis_test() {
  assert markdown.parse("a *b* c")
    == paragraph([Text("a "), Emphasis([Text("b")]), Text(" c")])
  assert markdown.parse("_b_") == paragraph([Emphasis([Text("b")])])
}

pub fn star_emphasis_works_inside_a_word_test() {
  assert markdown.parse("foo*bar*baz")
    == paragraph([Text("foo"), Emphasis([Text("bar")]), Text("baz")])
}

pub fn strong_around_emoji_test() {
  assert markdown.parse("**héllo 👋**") == paragraph([Strong([Text("héllo 👋")])])
}

pub fn strong_nests_in_emphasis_test() {
  assert markdown.parse("***x***")
    == paragraph([Emphasis([Strong([Text("x")])])])
}

pub fn emphasis_nests_in_strong_test() {
  assert markdown.parse("**a *b* c**")
    == paragraph([Strong([Text("a "), Emphasis([Text("b")]), Text(" c")])])
}

pub fn a_run_closes_only_a_run_of_the_same_length_test() {
  assert markdown.parse("**a*") == paragraph([Text("**a*")])
  assert markdown.parse("*a**") == paragraph([Text("*a**")])
  assert markdown.parse("**a* *b*")
    == paragraph([Text("**a* "), Emphasis([Text("b")])])
}

pub fn a_run_longer_than_three_is_text_test() {
  assert markdown.parse("****a****") == paragraph([Text("****a****")])
  assert markdown.parse("****a**** *b*")
    == paragraph([Text("****a**** "), Emphasis([Text("b")])])
}

/// M2
pub fn heading_and_bold_test() {
  let bold = Paragraph([Text("some "), Strong([Text("bold")]), Text(" text")])

  assert markdown.parse("# Hi\n\nsome **bold** text")
    == [
      Block(first_row: 0, last_row: 0, content: Heading(H1, [Text("Hi")])),
      Block(first_row: 2, last_row: 2, content: bold),
    ]
}

// 3. Links

pub fn link_test() {
  assert markdown.parse("see [docs](https://example.com/a?b=c) now")
    == paragraph([
      Text("see "),
      Link([Text("docs")], "https://example.com/a?b=c"),
      Text(" now"),
    ])
}

pub fn link_label_is_parsed_test() {
  assert markdown.parse("[**docs**](/x)")
    == paragraph([Link([Strong([Text("docs")])], "/x")])
}

pub fn link_url_ends_at_the_first_paren_test() {
  assert markdown.parse("[a](b)c)")
    == paragraph([Link([Text("a")], "b"), Text("c)")])
}

pub fn a_url_may_hold_balanced_parentheses_test() {
  assert markdown.parse(
      "[Rust](https://en.wikipedia.org/wiki/Rust_(programming_language))",
    )
    == paragraph([
      Link(
        [Text("Rust")],
        "https://en.wikipedia.org/wiki/Rust_(programming_language)",
      ),
    ])
  assert markdown.parse("[x](javascript:alert(1))")
    == paragraph([Link([Text("x")], "javascript:alert(1)")])
  assert markdown.parse("[a](b(c(d)e)f)")
    == paragraph([Link([Text("a")], "b(c(d)e)f")])
}

pub fn an_unbalanced_paren_ends_the_url_or_the_link_test() {
  assert markdown.parse("[a](b(c)") == paragraph([Text("[a](b(c)")])
  assert markdown.parse("[a](b(c) d)") == paragraph([Text("[a](b(c) d)")])
  assert markdown.parse("[a](b))")
    == paragraph([Link([Text("a")], "b"), Text(")")])
  assert markdown.parse("[a]()") == paragraph([Link([Text("a")], "")])
}

pub fn parentheses_in_a_url_nest_32_deep_test() {
  let level_32 = string.repeat("(", 32) <> string.repeat(")", 32)
  assert markdown.parse("[a](" <> level_32 <> ")")
    == paragraph([Link([Text("a")], level_32)])

  let level_33 = string.repeat("(", 33) <> string.repeat(")", 33)
  let text = "[a](" <> level_33 <> ")"
  assert markdown.parse(text) == paragraph([Text(text)])
}

pub fn a_long_url_is_still_a_link_test() {
  let url = string.repeat("x", 20_000)
  assert markdown.parse("[a](" <> url <> ")")
    == paragraph([Link([Text("a")], url)])
}

pub fn lines_of_link_starts_that_never_close_are_text_test() {
  let starts = string.repeat("](", 20_000)
  assert markdown.parse(starts) == paragraph([Text(starts)])
  let opens = "[a](" <> string.repeat("(", 20_000)
  assert markdown.parse(opens) == paragraph([Text(opens)])
}

pub fn links_do_not_nest_test() {
  assert markdown.parse("[[a](b)](c)")
    == paragraph([Text("["), Link([Text("a")], "b"), Text("](c)")])
}

pub fn emphasis_wins_over_a_link_it_crosses_test() {
  assert markdown.parse("**a [b** c](u)")
    == paragraph([Strong([Text("a [b")]), Text(" c](u)")])
}

// 4. Escapes

pub fn escaped_delimiters_are_text_test() {
  assert markdown.parse("\\*not emphasis\\*")
    == paragraph([Text("*not emphasis*")])
  assert markdown.parse("\\*a*") == paragraph([Text("*a*")])
}

pub fn any_ascii_punctuation_can_be_escaped_test() {
  assert markdown.parse("\\# \\[ \\` \\\\") == paragraph([Text("# [ ` \\")])
}

pub fn backslash_is_literal_in_code_test() {
  assert markdown.parse("a `\\` b")
    == paragraph([Text("a "), Code("\\"), Text(" b")])
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

pub fn a_closer_gives_up_every_opener_inside_it_test() {
  let inside = string.repeat("[a ", 5000) <> "b"
  assert markdown.parse("*" <> inside <> "*")
    == paragraph([Emphasis([Text(inside)])])
}

pub fn a_link_gives_up_every_opener_around_it_test() {
  let openers = string.repeat("[a ", 3000)
  assert markdown.parse(openers <> "[a](b)")
    == paragraph([Text(openers), Link([Text("a")], "b")])
}

pub fn a_long_run_of_spaces_inside_a_line_is_kept_test() {
  let line = "a" <> string.repeat(" ", 20_000) <> "b"
  assert markdown.parse(line) == paragraph([Text(line)])
}

pub fn trimming_keeps_a_lone_accent_in_place_test() {
  assert markdown.parse("\u{301} a ") == paragraph([Text("\u{301} a")])
}

pub fn a_closer_passes_the_label_a_link_gave_up_test() {
  assert markdown.parse("*a [b [c](d) e*")
    == paragraph([
      Emphasis([Text("a [b "), Link([Text("c")], "d"), Text(" e")]),
    ])
}

pub fn a_label_opened_after_a_link_still_closes_test() {
  assert markdown.parse("[a [b](c) [d](e) f](g)")
    == paragraph([
      Text("[a "),
      Link([Text("b")], "c"),
      Text(" "),
      Link([Text("d")], "e"),
      Text(" f](g)"),
    ])
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
  let link = Link([Text("a")], "b")
  let expected =
    list.repeat([link, Text(" ")], 3999) |> list.flatten |> list.append([link])
  assert markdown.parse(string.repeat("[a](b) ", 4000)) == paragraph(expected)
}

pub fn nesting_stops_at_thirty_two_levels_test() {
  let line = string.repeat("*a ", 5000) <> "b" <> string.repeat(" a*", 5000)
  let assert [Block(0, 0, Paragraph(inlines))] = markdown.parse(line)

  assert depth(inlines) == 32
}

fn depth(inlines: List(markdown.Inline)) -> Int {
  list.fold(inlines, 0, fn(deepest, inline) {
    case inline {
      Text(_) | Code(_) -> deepest
      Strong(children) | Emphasis(children) | Link(children, _) ->
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
