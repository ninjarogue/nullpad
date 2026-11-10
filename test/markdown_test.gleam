//// Examples of how the parser is used. Each `pending_` function is a test
//// that is waiting for its milestone: rename it so it ends in `_test`
//// (`pending_heading_and_bold` -> `heading_and_bold_test`) when you start on
//// it, watch it fail, then make it pass.

import scribbl/markdown.{
  Block, BulletList, Checked, H1, Heading, Item, Paragraph, Strong, Text,
  Unchecked,
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
