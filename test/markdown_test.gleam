//// Examples of how the parser is used.

import gleam/int
import gleam/list
import gleam/option.{None, Some}
import gleam/string
import lustre/element
import nullpad/markdown.{
  Block, BulletList, Code, Emphasis, H1, H2, H3, H4, H5, H6, Heading, Item, Link,
  Loose, OrderedList, Paragraph, Quote, Rule, Strike, Strong, Task, Text, Tight,
}
import nullpad/preview

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

// Thematic breaks and setext headings

pub fn three_marks_make_a_rule_test() {
  assert markdown.parse("***\n- - -\n _  _  _ \n-----")
    == [
      Block(0, 0, Rule),
      Block(1, 1, Rule),
      Block(2, 2, Rule),
      Block(3, 3, Rule),
    ]
}

pub fn two_marks_or_mixed_marks_are_text_test() {
  assert markdown.parse("--\n-*-")
    == [Block(0, 1, Paragraph([Text("--\n-*-")]))]
}

pub fn a_rule_ends_the_paragraph_above_it_test() {
  assert markdown.parse("Foo\n***\nbar")
    == [para(0, "Foo"), Block(1, 1, Rule), para(2, "bar")]
}

pub fn a_dash_underline_makes_the_paragraph_above_a_heading_test() {
  assert markdown.parse("Foo *bar*\nbaz\n---")
    == [
      Block(
        0,
        2,
        Heading(H2, [Text("Foo "), Emphasis([Text("bar")]), Text("\nbaz")]),
      ),
    ]
}

pub fn an_equals_underline_makes_a_level_one_heading_test() {
  assert markdown.parse("Title  \n=")
    == [Block(0, 1, Heading(H1, [Text("Title")]))]
}

pub fn an_underline_after_a_blank_line_is_no_heading_test() {
  assert markdown.parse("Foo\n\n---") == [para(0, "Foo"), Block(2, 2, Rule)]
  assert markdown.parse("Foo\n\n===") == [para(0, "Foo"), para(2, "===")]
}

pub fn an_underline_with_a_gap_or_four_spaces_of_indent_is_no_underline_test() {
  assert markdown.parse("Foo\n= =")
    == [Block(0, 1, Paragraph([Text("Foo\n= =")]))]
  assert markdown.parse("Foo\n--- -") == [para(0, "Foo"), Block(1, 1, Rule)]
  assert markdown.parse("Foo\n    ---")
    == [Block(0, 1, Paragraph([Text("Foo\n---")]))]
}

// Block quotes

pub fn a_quote_holds_blocks_with_their_rows_test() {
  assert markdown.parse("> # Title\n> one\n> two\n>\n> ---")
    == [
      Block(
        0,
        4,
        Quote([
          Block(0, 0, Heading(H1, [Text("Title")])),
          Block(1, 2, Paragraph([Text("one\ntwo")])),
          Block(4, 4, Rule),
        ]),
      ),
    ]
}

pub fn a_quote_mark_needs_no_space_after_it_test() {
  assert markdown.parse(">a\n>  b")
    == [Block(0, 1, Quote([Block(0, 1, Paragraph([Text("a\nb")]))]))]
}

pub fn a_line_without_its_quote_mark_still_continues_the_paragraph_test() {
  assert markdown.parse("> a\nb\n> c")
    == [Block(0, 2, Quote([Block(0, 2, Paragraph([Text("a\nb\nc")]))]))]
}

pub fn a_lazy_line_continues_a_paragraph_at_any_depth_test() {
  let paragraph = Block(0, 1, Paragraph([Text("a\nb")]))
  assert markdown.parse("> > a\n> b")
    == [Block(0, 1, Quote([Block(0, 1, Quote([paragraph]))]))]
}

pub fn a_lazy_line_is_never_an_underline_test() {
  assert markdown.parse("> a\n---")
    == [Block(0, 0, Quote([para(0, "a")])), Block(1, 1, Rule)]
  assert markdown.parse("> a\n===")
    == [Block(0, 1, Quote([Block(0, 1, Paragraph([Text("a\n===")]))]))]
}

pub fn a_blank_line_ends_a_quote_test() {
  assert markdown.parse("> a\n\n> b")
    == [Block(0, 0, Quote([para(0, "a")])), Block(2, 2, Quote([para(2, "b")]))]
}

pub fn quotes_stop_at_thirty_two_levels_test() {
  let blocks = markdown.parse(string.repeat("> ", 10_000) <> "a")
  let #(depth, innermost) = innermost_quote(blocks, 0)

  assert depth == 32
  assert innermost == [para(0, string.repeat("> ", 9968) <> "a")]
  let html = element.to_string(preview.view(blocks, fn(_, _) { Nil }))
  assert list.length(string.split(html, "<blockquote>")) == 33
}

pub fn quote_marks_without_spaces_stop_at_thirty_two_levels_test() {
  let blocks = markdown.parse(string.repeat(">", 10_000) <> "a")
  let #(depth, innermost) = innermost_quote(blocks, 0)

  assert depth == 32
  assert innermost == [para(0, string.repeat(">", 9968) <> "a")]
}

fn innermost_quote(
  blocks: List(markdown.Block),
  depth: Int,
) -> #(Int, List(markdown.Block)) {
  case blocks {
    [Block(content: Quote(inner), ..)] -> innermost_quote(inner, depth + 1)
    _ -> #(depth, blocks)
  }
}

// Lists

pub fn a_list_holds_items_with_their_rows_test() {
  assert markdown.parse("- one\n- two\n  more\n- three")
    == [
      Block(
        0,
        3,
        BulletList(Tight, [
          item(0, [para(0, "one")]),
          item(1, [Block(1, 2, Paragraph([Text("two\nmore")]))]),
          item(3, [para(3, "three")]),
        ]),
      ),
    ]
}

pub fn an_ordered_list_keeps_only_its_first_number_test() {
  assert markdown.parse("3. a\n9. b")
    == [
      Block(
        0,
        1,
        OrderedList(3, Tight, [item(0, [para(0, "a")]), item(1, [para(1, "b")])]),
      ),
    ]
}

pub fn another_bullet_or_delimiter_starts_another_list_test() {
  assert markdown.parse("- a\n+ b")
    == [
      Block(0, 0, BulletList(Tight, [item(0, [para(0, "a")])])),
      Block(1, 1, BulletList(Tight, [item(1, [para(1, "b")])])),
    ]
  assert markdown.parse("1. a\n2) b")
    == [
      Block(0, 0, OrderedList(1, Tight, [item(0, [para(0, "a")])])),
      Block(1, 1, OrderedList(2, Tight, [item(1, [para(1, "b")])])),
    ]
}

pub fn a_blank_line_between_items_makes_the_list_loose_test() {
  assert markdown.parse("- a\n\n- b")
    == [
      Block(
        0,
        2,
        BulletList(Loose, [item(0, [para(0, "a")]), item(2, [para(2, "b")])]),
      ),
    ]
}

pub fn a_blank_line_inside_an_item_makes_the_list_loose_test() {
  assert markdown.parse("- a\n\n  b\n- c")
    == [
      Block(
        0,
        3,
        BulletList(Loose, [
          item(0, [para(0, "a"), para(2, "b")]),
          item(3, [para(3, "c")]),
        ]),
      ),
    ]
}

pub fn a_nested_list_is_loose_on_its_own_test() {
  let inner =
    Block(1, 3, BulletList(Loose, [item(1, [para(1, "b"), para(3, "c")])]))
  assert markdown.parse("- a\n  - b\n\n    c\n- d")
    == [
      Block(
        0,
        4,
        BulletList(Tight, [
          item(0, [para(0, "a"), inner]),
          item(4, [para(4, "d")]),
        ]),
      ),
    ]
}

pub fn a_lazy_line_continues_the_paragraph_of_an_item_test() {
  assert markdown.parse("- a\nb")
    == [
      Block(
        0,
        1,
        BulletList(Tight, [item(0, [Block(0, 1, Paragraph([Text("a\nb")]))])]),
      ),
    ]
}

pub fn a_tab_after_the_marker_sets_how_far_later_lines_indent_test() {
  assert markdown.parse("-\tone\n\ttwo")
    == [
      Block(
        0,
        1,
        BulletList(Tight, [
          item(0, [Block(0, 1, Paragraph([Text("one\ntwo")]))]),
        ]),
      ),
    ]
}

pub fn only_a_list_from_one_with_text_interrupts_a_paragraph_test() {
  assert markdown.parse("a\n2. b")
    == [Block(0, 1, Paragraph([Text("a\n2. b")]))]
  assert markdown.parse("a\n*") == [Block(0, 1, Paragraph([Text("a\n*")]))]
  assert markdown.parse("a\n1. b")
    == [
      para(0, "a"),
      Block(1, 1, OrderedList(1, Tight, [item(1, [para(1, "b")])])),
    ]
}

pub fn an_item_may_begin_with_one_blank_line_test() {
  assert markdown.parse("-\n  a")
    == [Block(0, 1, BulletList(Tight, [item(0, [para(1, "a")])]))]
  assert markdown.parse("-\n\n  a")
    == [Block(0, 0, BulletList(Tight, [item(0, [])])), para(2, "a")]
}

pub fn lists_stop_at_thirty_two_levels_test() {
  let blocks = markdown.parse(string.repeat("- ", 10_000) <> "a")
  let #(depth, innermost) = innermost_item(blocks, 0)

  assert depth == 32
  assert innermost == [para(0, string.repeat("- ", 9968) <> "a")]
  let html = element.to_string(preview.view(blocks, fn(_, _) { Nil }))
  assert list.length(string.split(html, "<ul>")) == 33
}

pub fn quotes_and_lists_share_the_thirty_two_levels_test() {
  let blocks = markdown.parse(string.repeat("> 1. ", 5000) <> "a")
  let html = element.to_string(preview.view(blocks, fn(_, _) { Nil }))

  assert list.length(string.split(html, "<blockquote>")) == 17
  assert list.length(string.split(html, "<ol>")) == 17
}

fn innermost_item(
  blocks: List(markdown.Block),
  depth: Int,
) -> #(Int, List(markdown.Block)) {
  case blocks {
    [Block(content: BulletList(items: [Item(blocks: inner, ..)], ..), ..)] ->
      innermost_item(inner, depth + 1)
    _ -> #(depth, blocks)
  }
}

fn item(row: Int, blocks: List(markdown.Block)) -> markdown.Item {
  Item(row, None, blocks)
}

// Tasks, from GFM

pub fn a_box_after_the_marker_makes_a_task_test() {
  let milk = Item(0, Some(Task(False, 0, 3)), [para(0, "milk")])
  let eggs = Item(1, Some(Task(True, 1, 3)), [para(1, "eggs")])

  assert markdown.parse("- [ ] milk\n- [x] eggs")
    == [Block(0, 1, BulletList(Tight, [milk, eggs]))]
}

pub fn a_capital_x_is_checked_and_a_box_may_be_all_there_is_test() {
  let one = Item(0, Some(Task(True, 0, 4)), [para(0, "a")])
  let two = Item(1, Some(Task(False, 1, 4)), [])

  assert markdown.parse("1. [X] a\n2. [ ]")
    == [Block(0, 1, OrderedList(1, Tight, [one, two]))]
}

pub fn a_box_alone_keeps_its_item_open_across_a_blank_line_test() {
  let task = Item(0, Some(Task(False, 0, 3)), [para(2, "a")])

  assert markdown.parse("- [ ]\n\n  a")
    == [Block(0, 2, BulletList(Tight, [task]))]
}

pub fn a_box_needs_a_space_after_it_and_one_mark_inside_test() {
  assert markdown.parse("- [x]a\n- [ x]\n- [@] b\n- [] c")
    == [
      Block(
        0,
        3,
        BulletList(Tight, [
          item(0, [para(0, "[x]a")]),
          item(1, [para(1, "[ x]")]),
          item(2, [para(2, "[@] b")]),
          item(3, [para(3, "[] c")]),
        ]),
      ),
    ]
}

pub fn a_box_outside_a_list_or_after_the_first_line_is_text_test() {
  assert markdown.parse("[ ] a") == [para(0, "[ ] a")]
  assert markdown.parse("- a\n  [ ] b")
    == [
      Block(
        0,
        1,
        BulletList(Tight, [
          item(0, [Block(0, 1, Paragraph([Text("a\n[ ] b")]))]),
        ]),
      ),
    ]
  assert markdown.parse("- a\n\n  [ ] b")
    == [
      Block(
        0,
        2,
        BulletList(Loose, [item(0, [para(0, "a"), para(2, "[ ] b")])]),
      ),
    ]
}

pub fn a_task_knows_its_place_inside_a_quote_and_a_nested_list_test() {
  let task = Item(1, Some(Task(True, 1, 7)), [para(1, "b")])
  let inner = Block(1, 1, BulletList(Tight, [task]))

  assert markdown.parse("> - a\n>   - [x] b")
    == [
      Block(
        0,
        1,
        Quote([Block(0, 1, BulletList(Tight, [item(0, [para(0, "a"), inner])]))]),
      ),
    ]
}

pub fn a_tab_before_the_box_is_one_character_test() {
  assert markdown.parse("-\t[ ] a")
    == [
      Block(
        0,
        0,
        BulletList(Tight, [Item(0, Some(Task(False, 0, 3)), [para(0, "a")])]),
      ),
    ]
}

pub fn set_task_ticks_and_unticks_a_box_test() {
  let source = "# List\n- [ ] milk\n  - [x] eggs"

  assert markdown.set_task(source, Task(False, 1, 3), True) == Ok("- [x] milk")
  assert markdown.set_task(source, Task(True, 2, 5), False)
    == Ok("  - [ ] eggs")
}

pub fn set_task_leaves_a_box_already_in_that_state_test() {
  assert markdown.set_task("- [x] a", Task(False, 0, 3), True) == Ok("- [x] a")
  assert markdown.set_task("- [ ] a", Task(True, 0, 3), False) == Ok("- [ ] a")
}

pub fn set_task_refuses_a_place_with_no_box_test() {
  assert markdown.set_task("- [ ] a", Task(False, 0, 2), True) == Error(Nil)
  assert markdown.set_task("- [ ] a", Task(False, 1, 3), True) == Error(Nil)
  assert markdown.set_task("[ ] a", Task(False, 0, 1), True) == Error(Nil)
  assert markdown.set_task("- a\n  [ ] b", Task(False, 1, 3), True)
    == Error(Nil)
}

pub fn set_task_keeps_the_rest_of_the_line_as_typed_test() {
  assert markdown.set_task("- [ ] a\u{0}\t*b*  ", Task(False, 0, 3), True)
    == Ok("- [x] a\u{0}\t*b*  ")
  assert markdown.set_task(
      "x\r\n> 1. [x] \u{1F600}\r\n",
      Task(True, 1, 6),
      False,
    )
    == Ok("> 1. [ ] \u{1F600}")
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
pub fn a_link_nullpad_will_not_follow_stays_as_typed_test() {
  assert markdown.parse("[x](javascript:alert(1))")
    == paragraph([Text("[x](javascript:alert(1))")])
  assert markdown.parse("[**x**](<data:text/html,hi> \"t\") *y*")
    == paragraph([
      Text("["),
      Strong([Text("x")]),
      Text("](<data:text/html,hi> \"t\") "),
      Emphasis([Text("y")]),
    ])
}

pub fn web_mail_and_relative_links_are_followed_test() {
  assert markdown.is_safe_url("https://example.com/a:b")
  assert markdown.is_safe_url("HTTP://example.com")
  assert markdown.is_safe_url("mailto:a@example.com")
  assert markdown.is_safe_url("notes/today.md")
  assert markdown.is_safe_url("/a?time=10:30")
  assert markdown.is_safe_url("#part:two")
  assert !markdown.is_safe_url("javascript:alert(1)")
  assert !markdown.is_safe_url(" javascript:alert(1)")
  assert !markdown.is_safe_url("java\tscript:alert(1)")
  assert !markdown.is_safe_url("data:text/html,hi")
  assert !markdown.is_safe_url(":alert(1)")
  assert markdown.is_safe_url("java%73cript:alert(1)")
  assert markdown.is_safe_url("a(b):c")
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

// Strikethrough, from GFM

pub fn one_or_two_tildes_strike_through_test() {
  assert markdown.parse("~~gone~~ and ~this~")
    == paragraph([
      Strike([Text("gone")]),
      Text(" and "),
      Strike([Text("this")]),
    ])
}

pub fn three_tildes_or_more_are_text_test() {
  assert markdown.parse("~~~a~~~ ~~~~b~~~~")
    == paragraph([Text("~~~a~~~ ~~~~b~~~~")])
}

pub fn tildes_strike_only_with_a_run_of_the_same_length_test() {
  assert markdown.parse("~a~~") == paragraph([Text("~a~~")])
  assert markdown.parse("~~a ~b~~") == paragraph([Text("~~a ~b~~")])
  assert markdown.parse("~a ~~b~~")
    == paragraph([Text("~a "), Strike([Text("b")])])
}

pub fn tildes_strike_inside_a_word_test() {
  assert markdown.parse("a~~b~~c")
    == paragraph([Text("a"), Strike([Text("b")]), Text("c")])
}

pub fn strike_and_emphasis_nest_test() {
  assert markdown.parse("*a ~~b~~* ~~**c**~~")
    == paragraph([
      Emphasis([Text("a "), Strike([Text("b")])]),
      Text(" "),
      Strike([Strong([Text("c")])]),
    ])
}

/// A star that found no opener sets a floor for later stars. Tildes that do
/// not pair take openers off the stack, and a star opened after that must
/// still be found.
pub fn tildes_that_do_not_pair_leave_later_stars_free_test() {
  assert markdown.parse("~a ~~b c* d~ *e*")
    == paragraph([Text("~a ~~b c* d~ "), Emphasis([Text("e")])])
}

pub fn strikes_nest_thirty_two_levels_like_emphasis_test() {
  let line = string.repeat("~~a ", 40) <> "b" <> string.repeat(" a~~", 40)
  let assert [Block(0, 0, Paragraph([Text(before), deep, Text(after)]))] =
    markdown.parse(line)

  assert before == string.repeat("~~a ", 8)
  assert depth([deep]) == 32
  assert after == string.repeat(" a~~", 8)
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
  let stars = "a" <> string.repeat("*", 20_000)
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

// Plain text, for checkbox labels and note titles

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
  assert markdown.plain_text([Strike([Text("gone")])]) == "gone"
}

pub fn first_text_is_the_first_line_the_page_shows_test() {
  assert markdown.first_text("") == ""
  assert markdown.first_text("\n***\n#\n> *a*  b \n> c") == "a  b"
  assert markdown.first_text("- [ ]\n\n  1. ~~[x](u)~~") == "x"
  assert markdown.first_text("*a\nb*") == "a"
  assert markdown.first_text("[](u)\n\u{3000}b\u{A0}") == "b"
}

pub fn first_text_reads_past_the_first_sixteen_lines_test() {
  assert markdown.first_text(string.repeat("---\n", 16) <> "a") == "a"
  assert markdown.first_text(string.repeat(">\n", 5000) <> "\n- b") == "b"
  assert markdown.first_text(string.repeat(">\n", 5000)) == ""
}

pub fn first_text_keeps_marks_that_do_not_close_test() {
  assert markdown.first_text("**bold") == "**bold"
  assert markdown.first_text("\\*a\\*") == "*a*"
}

fn depth(inlines: List(markdown.Inline)) -> Int {
  list.fold(inlines, 0, fn(deepest, inline) {
    case inline {
      Text(_) | Code(_) -> deepest
      Strong(children) | Emphasis(children) | Link(children, _, _) ->
        int.max(deepest, 1 + depth(children))
      Strike(children) -> int.max(deepest, 1 + depth(children))
    }
  })
}

fn para(row: Int, text: String) -> markdown.Block {
  Block(row, row, Paragraph([Text(text)]))
}

fn paragraph(inlines: List(markdown.Inline)) -> List(markdown.Block) {
  [Block(0, 0, Paragraph(inlines))]
}
