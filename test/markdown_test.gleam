//// Examples of how the parser is used. Each `pending_` function is a test
//// that is waiting for its milestone: rename it so it ends in `_test`
//// (`pending_strong` -> `strong_test`) when you start on it, watch it fail,
//// then make it pass.
////
//// The pending inline tests exercise `inlines` in `markdown.gleam` through
//// `markdown.parse`. They are ordered: code spans, bold and italic, links,
//// escapes. Work from the top down.

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

pub fn heading_text_is_trimmed_test() {
  assert markdown.parse("#   spaced out   ")
    == [Block(0, 0, Heading(H1, [Text("spaced out")]))]
}

pub fn a_heading_may_have_no_text_test() {
  assert markdown.parse("#") == [Block(0, 0, Heading(H1, []))]
  assert markdown.parse("### ") == [Block(0, 0, Heading(H3, []))]
}

pub fn closing_hashes_stay_in_the_text_test() {
  assert markdown.parse("# Hi #") == [Block(0, 0, Heading(H1, [Text("Hi #")]))]
}

pub fn a_hash_needs_a_space_to_make_a_heading_test() {
  assert markdown.parse("#hashtag") == [para(0, "#hashtag")]
  assert markdown.parse("##tight") == [para(0, "##tight")]
}

pub fn seven_hashes_are_not_a_heading_test() {
  assert markdown.parse("####### seven") == [para(0, "####### seven")]
}

pub fn three_spaces_may_indent_a_heading_test() {
  assert markdown.parse("   # indented")
    == [Block(0, 0, Heading(H1, [Text("indented")]))]
  assert markdown.parse("    # too far") == [para(0, "# too far")]
}

pub fn a_heading_ends_the_paragraph_before_it_test() {
  assert markdown.parse("one\ntwo\n# Title\nthree")
    == [
      Block(0, 1, Paragraph([Text("one two")])),
      Block(2, 2, Heading(H1, [Text("Title")])),
      para(3, "three"),
    ]
}

pub fn paragraph_lines_are_trimmed_and_joined_by_a_space_test() {
  assert markdown.parse("  one  \n\ttwo\nthree  ")
    == [Block(0, 2, Paragraph([Text("one two three")]))]
}

pub fn blank_lines_separate_blocks_test() {
  assert markdown.parse("one\n\ntwo\n  \n\n three")
    == [para(0, "one"), para(2, "two"), para(5, "three")]
}

pub fn a_trailing_newline_adds_no_block_test() {
  assert markdown.parse("one\n") == [para(0, "one")]
}

pub fn windows_line_ends_count_like_unix_ones_test() {
  assert markdown.parse("# Title\r\n\r\none\r\ntwo\r\n")
    == [
      Block(0, 0, Heading(H1, [Text("Title")])),
      Block(2, 3, Paragraph([Text("one two")])),
    ]
}

pub fn emoji_and_accents_are_kept_test() {
  assert markdown.parse("# héllo 👋\n\nbye 👋")
    == [Block(0, 0, Heading(H1, [Text("héllo 👋")])), para(2, "bye 👋")]
}

pub fn raw_html_is_text_test() {
  assert markdown.parse("<h1>hi</h1>\n<script>alert(1)</script>")
    == [Block(0, 1, Paragraph([Text("<h1>hi</h1> <script>alert(1)</script>")]))]
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

pub fn pending_code_span() {
  assert markdown.parse("use `x` here")
    == paragraph([Text("use "), Code("x"), Text(" here")])
}

pub fn pending_code_content_is_literal() {
  assert markdown.parse("`**not** [bold](x)`")
    == paragraph([Code("**not** [bold](x)")])
}

pub fn pending_code_span_longer_fence() {
  assert markdown.parse("`` a`b ``") == paragraph([Code("a`b")])
}

pub fn pending_code_span_strips_one_space_each_side() {
  assert markdown.parse("`  a  `") == paragraph([Code(" a ")])
  assert markdown.parse("`  `") == paragraph([Code("  ")])
}

// 2. Bold and italic

pub fn pending_strong() {
  assert markdown.parse("a **b** c")
    == paragraph([Text("a "), Strong([Text("b")]), Text(" c")])
  assert markdown.parse("__b__") == paragraph([Strong([Text("b")])])
}

pub fn pending_emphasis() {
  assert markdown.parse("a *b* c")
    == paragraph([Text("a "), Emphasis([Text("b")]), Text(" c")])
  assert markdown.parse("_b_") == paragraph([Emphasis([Text("b")])])
}

pub fn pending_star_emphasis_works_inside_a_word() {
  assert markdown.parse("foo*bar*baz")
    == paragraph([Text("foo"), Emphasis([Text("bar")]), Text("baz")])
}

pub fn pending_strong_around_emoji() {
  assert markdown.parse("**héllo 👋**") == paragraph([Strong([Text("héllo 👋")])])
}

pub fn pending_strong_nests_in_emphasis() {
  assert markdown.parse("***x***")
    == paragraph([Emphasis([Strong([Text("x")])])])
}

pub fn pending_emphasis_nests_in_strong() {
  assert markdown.parse("**a *b* c**")
    == paragraph([Strong([Text("a "), Emphasis([Text("b")]), Text(" c")])])
}

pub fn pending_a_run_closes_only_a_run_of_the_same_length() {
  assert markdown.parse("**a*") == paragraph([Text("**a*")])
  assert markdown.parse("*a**") == paragraph([Text("*a**")])
  assert markdown.parse("**a* *b*")
    == paragraph([Text("**a* "), Emphasis([Text("b")])])
}

pub fn pending_a_run_longer_than_three_is_text() {
  assert markdown.parse("****a****") == paragraph([Text("****a****")])
  assert markdown.parse("****a**** *b*")
    == paragraph([Text("****a**** "), Emphasis([Text("b")])])
}

/// M2
pub fn pending_heading_and_bold() {
  let bold = Paragraph([Text("some "), Strong([Text("bold")]), Text(" text")])

  assert markdown.parse("# Hi\n\nsome **bold** text")
    == [
      Block(first_row: 0, last_row: 0, content: Heading(H1, [Text("Hi")])),
      Block(first_row: 2, last_row: 2, content: bold),
    ]
}

// 3. Links

pub fn pending_link() {
  assert markdown.parse("see [docs](https://example.com/a?b=c) now")
    == paragraph([
      Text("see "),
      Link([Text("docs")], "https://example.com/a?b=c"),
      Text(" now"),
    ])
}

pub fn pending_link_label_is_parsed() {
  assert markdown.parse("[**docs**](/x)")
    == paragraph([Link([Strong([Text("docs")])], "/x")])
}

pub fn pending_link_url_ends_at_the_first_paren() {
  assert markdown.parse("[a](b)c)")
    == paragraph([Link([Text("a")], "b"), Text("c)")])
}

pub fn pending_links_do_not_nest() {
  assert markdown.parse("[[a](b)](c)")
    == paragraph([Text("["), Link([Text("a")], "b"), Text("](c)")])
}

pub fn pending_emphasis_wins_over_a_link_it_crosses() {
  assert markdown.parse("**a [b** c](u)")
    == paragraph([Strong([Text("a [b")]), Text(" c](u)")])
}

// 4. Escapes

pub fn pending_escaped_delimiters_are_text() {
  assert markdown.parse("\\*not emphasis\\*")
    == paragraph([Text("*not emphasis*")])
  assert markdown.parse("\\*a*") == paragraph([Text("*a*")])
}

pub fn pending_any_ascii_punctuation_can_be_escaped() {
  assert markdown.parse("\\# \\[ \\` \\\\") == paragraph([Text("# [ ` \\")])
}

pub fn pending_backslash_is_literal_in_code() {
  assert markdown.parse("a `\\` b")
    == paragraph([Text("a "), Code("\\"), Text(" b")])
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
