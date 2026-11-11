//// Examples of how the parser is used. Each `pending_` function is a test
//// that is waiting for its milestone: rename it so it ends in `_test`
//// (`pending_heading_and_bold` -> `heading_and_bold_test`) when you start on
//// it, watch it fail, then make it pass.

import scribbl/markdown.{
  Block, BulletList, Checked, H1, H2, H3, H4, H5, H6, Heading, Item, Paragraph,
  Strong, Text, Unchecked,
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

/// M2
pub fn pending_heading_and_bold() {
  let bold = Paragraph([Text("some "), Strong([Text("bold")]), Text(" text")])

  assert markdown.parse("# Hi\n\nsome **bold** text")
    == [
      Block(first_row: 0, last_row: 0, content: Heading(H1, [Text("Hi")])),
      Block(first_row: 2, last_row: 2, content: bold),
    ]
}

/// M2: syntax that never closes is plain text, not an error.
pub fn pending_unclosed_bold_is_text() {
  assert markdown.parse("**oops") == [Block(0, 0, Paragraph([Text("**oops")]))]
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
