import gleam/list
import gleam/option.{None, Some}
import gleam/string
import lustre/element
import nullpad/markdown.{
  type Content, type Inline, Block, BulletList, Center, Code, CodeBlock, Column,
  Emphasis, H1, H2, H3, H4, H5, H6, Heading, Left, Link, Loose, OrderedList,
  Paragraph, Quote, Right, Rule, Strike, Strong, Table, Text, Tight, Unaligned,
}
import nullpad/preview

pub fn the_page_is_a_marked_preview_root_test() {
  let html =
    element.to_string(preview.view([], fn(task, checked) { #(task, checked) }))

  assert string.contains(html, "class=\"preview\"")
  assert string.contains(html, "data-test-id=\"preview\"")
}

pub fn blocks_render_in_order_test() {
  let html =
    render_blocks([
      Block(0, 0, Heading(H1, [Text("Title")])),
      Block(2, 2, Paragraph([Text("Body")])),
    ])

  assert string.contains(html, "<h1>Title</h1><p>Body</p>")
}

pub fn headings_render_as_h1_to_h6_test() {
  let levels = [
    #(H1, "h1"),
    #(H2, "h2"),
    #(H3, "h3"),
    #(H4, "h4"),
    #(H5, "h5"),
    #(H6, "h6"),
  ]
  use #(level, tag) <- list.each(levels)

  let html = render(Heading(level, [Text("T")]))

  assert string.contains(html, "<" <> tag <> ">T</" <> tag <> ">")
}

pub fn paragraphs_render_as_p_test() {
  assert string.contains(render(Paragraph([Text("hello")])), "<p>hello</p>")
}

pub fn strong_emphasis_and_code_render_as_their_elements_test() {
  assert string.contains(
    render(paragraph(Strong([Text("x")]))),
    "<strong>x</strong>",
  )
  assert string.contains(render(paragraph(Emphasis([Text("x")]))), "<em>x</em>")
  assert string.contains(render(paragraph(Code("x"))), "<code>x</code>")
}

pub fn inlines_nest_test() {
  let html = render(paragraph(Emphasis([Strong([Text("x")])])))

  assert string.contains(html, "<em><strong>x</strong></em>")
}

pub fn text_is_escaped_test() {
  let html = render(Paragraph([Text("<b>bold</b> & <script>x</script>")]))

  assert string.contains(html, "&lt;b&gt;bold&lt;/b&gt; &amp; &lt;script&gt;")
  assert !string.contains(html, "<b>")
  assert !string.contains(html, "<script>")
}

pub fn code_and_heading_text_are_escaped_test() {
  assert string.contains(
    render(paragraph(Code("<i>"))),
    "<code>&lt;i&gt;</code>",
  )
  assert string.contains(
    render(Heading(H2, [Text("<i>")])),
    "<h2>&lt;i&gt;</h2>",
  )
}

pub fn a_safe_link_is_an_anchor_that_opens_in_a_new_tab_test() {
  let html = render(paragraph(link("https://example.com/a?b=c", "docs")))

  assert string.contains(html, "href=\"https://example.com/a?b=c\"")
  assert string.contains(html, "target=\"_blank\"")
  assert string.contains(html, "rel=\"noopener noreferrer\"")
  assert string.contains(html, ">docs</a>")
}

pub fn a_link_title_becomes_its_title_attribute_test() {
  let html =
    render(paragraph(Link([Text("docs")], "/x", Some("say \"hi\" & go"))))

  assert string.contains(html, "href=\"/x\"")
  assert string.contains(html, "title=\"say &quot;hi&quot; &amp; go\"")
}

pub fn a_link_without_a_title_has_no_title_attribute_test() {
  let html = render(paragraph(link("/x", "docs")))

  assert !string.contains(html, "title=")
}

pub fn http_and_mailto_links_are_safe_in_any_case_test() {
  list.each(
    ["http://a.test", "HTTPS://a.test", "mailto:me@a.test", "MailTo:me@a.test"],
    fn(url) {
      let html = render(paragraph(link(url, "x")))

      assert string.contains(html, "<a ")
      assert string.contains(html, "href=\"" <> url <> "\"")
    },
  )
}

pub fn relative_links_keep_their_href_test() {
  list.each(["/notes/1", "notes/1", "#top", "?q=1", "a/b:c", "x.md"], fn(url) {
    let html = render(paragraph(link(url, "x")))

    assert string.contains(html, "href=\"" <> url <> "\"")
  })
}

pub fn a_link_label_keeps_its_inline_markup_test() {
  let label = [Strong([Text("docs")])]
  let html = render(paragraph(Link(label, "/x", None)))

  assert string.contains(html, "<a ")
  assert string.contains(html, "><strong>docs</strong></a>")
}

pub fn an_unsafe_link_shows_as_the_text_typed_test() {
  let html = render(paragraph(link("javascript:alert(1)", "x")))

  assert string.contains(html, "<p>[x](javascript:alert(1))</p>")
}

pub fn an_unsafe_link_shows_its_title_as_typed_test() {
  let html =
    render(paragraph(Link([Text("x")], "javascript:alert(1)", Some("t"))))

  assert string.contains(html, "<p>[x](javascript:alert(1) &quot;t&quot;)</p>")
}

pub fn an_unsafe_link_keeps_its_label_markup_test() {
  let html =
    render(paragraph(Link([Strong([Text("x")])], "javascript:x", None)))

  assert string.contains(html, "<p>[<strong>x</strong>](javascript:x)</p>")
}

pub fn script_links_make_no_anchor_test() {
  list.each(
    [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "JAVASCRIPT:alert(1)",
      " javascript:alert(1)",
      "\njavascript:alert(1)",
      "java\tscript:alert(1)",
      "data:text/html,<b>x</b>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ],
    fn(url) {
      let html = render(paragraph(link(url, "label")))

      assert string.contains(html, "<p>[label](")
      assert !string.contains(html, "<a")
      assert !string.contains(html, "href")
    },
  )
}

pub fn strike_renders_as_del_test() {
  assert string.contains(
    render(paragraph(Strike([Text("gone"), Code("x")]))),
    "<p><del>gone<code>x</code></del></p>",
  )
}

pub fn a_rule_renders_as_hr_test() {
  assert string.contains(
    render_blocks([
      Block(0, 0, Paragraph([Text("a")])),
      Block(1, 1, Rule),
      Block(2, 2, Paragraph([Text("b")])),
    ]),
    "<p>a</p><hr><p>b</p>",
  )
}

pub fn a_quote_renders_as_blockquote_test() {
  let quote = Quote([Block(0, 0, Paragraph([Text("a")])), Block(1, 1, Rule)])

  assert string.contains(render(quote), "<blockquote><p>a</p><hr></blockquote>")
}

pub fn a_tight_list_shows_its_paragraphs_as_bare_text_test() {
  let html =
    render(
      BulletList(Tight, [
        item(0, [Block(0, 0, Paragraph([Strong([Text("milk")])]))]),
        item(1, [Block(1, 1, Paragraph([Text("eggs")])), Block(2, 2, Rule)]),
      ]),
    )

  assert string.contains(
    html,
    "<ul><li><strong>milk</strong></li><li>eggs<hr></li></ul>",
  )
}

pub fn a_loose_list_shows_its_paragraphs_as_p_test() {
  let html =
    render(
      BulletList(Loose, [
        item(0, [Block(0, 0, Paragraph([Text("milk")]))]),
        item(2, [Block(2, 2, Quote([Block(2, 2, Paragraph([Text("eggs")]))]))]),
      ]),
    )

  assert string.contains(
    html,
    "<ul><li><p>milk</p></li><li><blockquote><p>eggs</p></blockquote></li></ul>",
  )
}

pub fn only_a_tight_list_drops_the_paragraphs_directly_in_its_items_test() {
  let inner = Block(0, 0, Quote([Block(0, 0, Paragraph([Text("a")]))]))

  assert string.contains(
    render(BulletList(Tight, [item(0, [inner])])),
    "<li><blockquote><p>a</p></blockquote></li>",
  )
}

pub fn an_ordered_list_names_its_start_unless_it_is_one_test() {
  let items = [item(0, [Block(0, 0, Paragraph([Text("a")]))])]

  assert string.contains(render(OrderedList(1, Tight, items)), "<ol><li>a</li>")
  assert string.contains(
    render(OrderedList(7, Tight, items)),
    "<ol start=\"7\"><li>a</li>",
  )
  assert string.contains(
    render(OrderedList(0, Tight, items)),
    "<ol start=\"0\"><li>a</li>",
  )
}

pub fn a_task_is_an_li_that_starts_with_its_checkbox_test() {
  let html =
    render(
      BulletList(Tight, [
        task(False, [Block(0, 0, Paragraph([Text("milk")]))]),
        task(True, [Block(1, 1, Paragraph([Text("eggs")]))]),
        item(2, [Block(2, 2, Paragraph([Text("bread")]))]),
      ]),
    )

  assert string.contains(
    html,
    "<li class=\"task\"><input aria-label=\"milk\" type=\"checkbox\">milk</li>",
  )
  assert string.contains(
    html,
    "<li class=\"task\"><input aria-label=\"eggs\" checked type=\"checkbox\">eggs</li>",
  )
  assert string.contains(html, "<li>bread</li>")
}

pub fn a_checkbox_is_named_after_the_words_of_the_first_paragraph_test() {
  let words = [Text("buy "), Emphasis([Text("fresh\nmilk")])]
  let nested = Block(1, 1, BulletList(Tight, [item(1, [])]))

  assert string.contains(
    render(BulletList(Loose, [task(False, [Block(0, 0, Paragraph(words))])])),
    "aria-label=\"buy fresh milk\"",
  )
  assert string.contains(
    render(BulletList(Tight, [task(False, [nested])])),
    "aria-label=\"Task\"",
  )
  assert string.contains(
    render(BulletList(Tight, [task(False, [])])),
    "aria-label=\"Task\"",
  )
}

pub fn code_renders_as_pre_and_code_as_typed_test() {
  assert string.contains(
    render(CodeBlock(None, "  a <b> &c\n\nd\n", 0)),
    "<pre><code>  a &lt;b&gt; &amp;c\n\nd\n</code></pre>",
  )
}

pub fn code_names_its_language_in_a_class_test() {
  assert string.contains(
    render(CodeBlock(Some("gleam"), "x\n", 0)),
    "<pre><code class=\"language-gleam\">x\n</code></pre>",
  )
}

pub fn a_table_is_a_real_table_in_a_box_that_takes_the_keyboard_test() {
  let html =
    render(
      Table([Column(Unaligned, [Text("a")]), Column(Unaligned, [Text("b")])], [
        [[Text("1")], [Text("2")]],
        [[Text("3")], []],
      ]),
    )

  assert string.contains(
    html,
    "<div aria-label=\"Table\" class=\"table-scroll\" role=\"region\" tabindex=\"0\">"
      <> "<table><thead><tr><th scope=\"col\">a</th><th scope=\"col\">b</th></tr></thead>"
      <> "<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td></td></tr></tbody>"
      <> "</table></div>",
  )
}

pub fn a_table_with_no_rows_has_no_tbody_test() {
  let html = render(Table([Column(Unaligned, [Text("a")])], []))

  assert string.contains(
    html,
    "<table><thead><tr><th scope=\"col\">a</th></tr></thead></table>",
  )
  assert !string.contains(html, "tbody")
}

pub fn a_column_aligns_its_heading_and_its_cells_test() {
  let html =
    render(
      Table(
        [
          Column(Left, [Text("l")]),
          Column(Center, [Text("c")]),
          Column(Right, [Text("r")]),
          Column(Unaligned, [Text("n")]),
        ],
        [[[Text("1")], [Text("2")], [Text("3")], [Text("4")]]],
      ),
    )

  assert string.contains(
    html,
    "<th align=\"left\" scope=\"col\">l</th><th align=\"center\" scope=\"col\">c</th>"
      <> "<th align=\"right\" scope=\"col\">r</th><th scope=\"col\">n</th>",
  )
  assert string.contains(
    html,
    "<td align=\"left\">1</td><td align=\"center\">2</td><td align=\"right\">3</td><td>4</td>",
  )
}

pub fn a_cell_shows_its_inlines_and_escapes_its_text_test() {
  let html =
    render(
      Table([Column(Unaligned, [Strong([Text("<b>")])])], [
        [[Text("x "), Code("a|b"), Text(" "), link("https://x.test/", "go")]],
      ]),
    )

  assert string.contains(
    html,
    "<th scope=\"col\"><strong>&lt;b&gt;</strong></th>",
  )
  assert string.contains(
    html,
    "<td>x <code>a|b</code> <a href=\"https://x.test/\" rel=\"noopener noreferrer\" target=\"_blank\">go</a></td>",
  )
}

pub fn a_table_in_a_tight_item_stays_a_table_test() {
  let table = Block(1, 2, Table([Column(Unaligned, [Text("a")])], []))
  let html =
    render(
      BulletList(Tight, [
        item(0, [Block(0, 0, Paragraph([Text("x")])), table]),
      ]),
    )

  assert string.contains(html, "<li>x<div aria-label=\"Table\"")
}

fn render(content: Content) -> String {
  render_blocks([Block(0, 0, content)])
}

fn render_blocks(blocks: List(markdown.Block)) -> String {
  element.to_string(
    preview.view(blocks, fn(task, checked) { #(task, checked) }),
  )
}

fn item(row: Int, blocks: List(markdown.Block)) -> markdown.Item {
  markdown.Item(row:, content_col: 2, task: None, blocks:)
}

fn task(checked: Bool, blocks: List(markdown.Block)) -> markdown.Item {
  markdown.Item(
    row: 0,
    content_col: 6,
    task: Some(markdown.Task(checked, 0, 3)),
    blocks:,
  )
}

fn paragraph(inline: Inline) -> Content {
  Paragraph([inline])
}

fn link(url: String, label: String) -> Inline {
  Link([Text(label)], url, None)
}

pub fn a_part_marks_each_element_with_its_row_in_the_note_test() {
  let html =
    markdown.parse(
      "above\n\n\n\n\n\n\n\n\n\n# Trip\n\n- one\n- two\n\n```\ncode\n```\n\n| a |\n|---|\n| 1 |",
    )
    |> preview.part(
      rows: 12,
      first_row: 10,
      test_id: "live-below",
      on_task: fn(task, _) { task },
    )
    |> element.to_string

  assert string.contains(html, "data-test-id=\"live-below\"")
  assert string.contains(html, "<h1 data-row=\"10\">")
  // Row 1 of the run is blank, and so is every other row between blocks.
  assert string.contains(html, "<div class=\"blank\" data-row=\"11\">")
  assert list.length(string.split(html, "class=\"blank\"")) == 4
  assert string.contains(html, "<li data-row=\"12\">one")
  assert string.contains(html, "<li data-row=\"13\">two")
  // The code starts one row below its fence.
  assert string.contains(html, "<pre data-row=\"16\">")
  assert string.contains(html, "<tr data-row=\"19\">")
  assert string.contains(html, "<tr data-row=\"21\">")
}

pub fn the_rendered_page_carries_no_row_marks_test() {
  let html =
    markdown.parse("# Trip\n\n- one")
    |> preview.view(fn(task, _) { task })
    |> element.to_string

  assert !string.contains(html, "data-row")
}

pub fn a_part_draws_the_blank_rows_inside_a_list_test() {
  let html =
    markdown.parse("- one\n\n- two\n\n  more\n\n\n- three")
    |> preview.part(
      rows: 8,
      first_row: 0,
      test_id: "live-below",
      on_task: fn(task, _) { task },
    )
    |> element.to_string

  let blank_item = fn(row) {
    "<li aria-hidden=\"true\" class=\"blank\" data-row=\"" <> row <> "\">"
  }
  assert string.contains(html, "</li>" <> blank_item("1") <> "</li><li")
  assert string.contains(
    html,
    "</p><div class=\"blank\" data-row=\"3\"></div><p",
  )
  assert string.contains(html, blank_item("5") <> "</li>" <> blank_item("6"))
  assert list.length(string.split(html, "class=\"blank\"")) == 5
}

pub fn a_part_draws_the_rows_of_a_quote_with_nothing_after_the_mark_as_blank_rows_test() {
  let draw = fn(source) {
    markdown.parse(source)
    |> preview.part(
      rows: 5,
      first_row: 0,
      test_id: "live-below",
      on_task: fn(task, _) { task },
    )
    |> element.to_string
  }

  assert draw(">\n\nnext")
    == "<div class=\"preview part\" data-test-id=\"live-below\"><blockquote data-row=\"0\"><div class=\"blank\" data-row=\"0\"></div></blockquote><div class=\"blank\" data-row=\"1\"></div><p data-row=\"2\">next</p><div class=\"blank\" data-row=\"3\"></div><div class=\"blank\" data-row=\"4\"></div></div>"
  assert string.contains(
    draw("> a\n>\n> > b"),
    "<blockquote data-row=\"0\"><p data-row=\"0\">a</p><div class=\"blank\" data-row=\"1\"></div><blockquote data-row=\"2\"><p data-row=\"2\">b</p></blockquote></blockquote>",
  )
}

pub fn the_whole_page_draws_no_blank_rows_test() {
  let html =
    markdown.parse("- one\n\n- two")
    |> preview.view(fn(task, _) { task })
    |> element.to_string

  assert !string.contains(html, "blank")
}

fn marked(source: String) -> String {
  markdown.parse(source)
  |> preview.part(
    rows: list.length(string.split(source, "\n")),
    first_row: 0,
    test_id: "live-below",
    on_task: fn(task, _) { task },
  )
  |> element.to_string
}

fn pre_rows(source: String) -> List(String) {
  marked(source) |> marks("<pre data-row=\"")
}

fn tr_rows(source: String) -> List(String) {
  marked(source) |> marks("<tr data-row=\"")
}

fn marks(html: String, opening: String) -> List(String) {
  case string.split(html, opening) {
    [_, ..after] ->
      list.map(after, fn(rest) {
        let assert [row, ..] = string.split(rest, "\"")
        row
      })
    [] -> []
  }
}

pub fn a_fenced_block_is_marked_with_the_row_of_its_first_line_of_code_test() {
  assert pre_rows("```\nfirst\nsecond\n```") == ["1"]
  assert pre_rows("p\n\n~~~ru\nx\n~~~") == ["3"]
  assert pre_rows("```\nx\n\n```") == ["1"]
}

pub fn an_indented_block_is_marked_with_its_own_first_row_test() {
  assert pre_rows("    a") == ["0"]
  assert pre_rows("p\n\n    a\n\n    b") == ["2"]
}

pub fn code_in_a_list_item_is_marked_with_its_row_in_the_note_test() {
  assert pre_rows("- a\n- ```\n  x\n  ```") == ["2"]
  assert pre_rows("- a\n\n      x") == ["2"]
  assert pre_rows("1. ```\n   x\n   ```\n2. b") == ["1"]
}

pub fn code_in_a_quote_is_marked_with_its_row_in_the_note_test() {
  assert pre_rows("p\n\n> ```\n> x\n> ```") == ["3"]
  assert pre_rows("> a\n>\n>     x") == ["2"]
  assert pre_rows("> ```\n> x\nb") == ["1"]
}

pub fn an_empty_fenced_block_is_marked_with_its_opening_fence_test() {
  assert pre_rows("```\n```") == ["0"]
  assert pre_rows("p\n\n~~~ a\n~~~\n\nq") == ["2"]
}

pub fn an_unclosed_empty_fence_is_marked_inside_its_block_test() {
  assert pre_rows("```") == ["0"]
  assert pre_rows("p\n\n```") == ["2"]
  assert pre_rows("> ```\n\nb") == ["0"]
  assert pre_rows("- ```\n- b") == ["0"]
}

pub fn the_body_rows_of_a_table_are_marked_below_its_delimiter_row_test() {
  assert tr_rows("| a |\n|---|\n| 1 |\n| 2 |") == ["0", "2", "3"]
  assert tr_rows("p\n| a |\n|---|\n| 1 |") == ["1", "3"]
  assert tr_rows("a|b\n-|-\n1\n1|2|3\n\nx") == ["0", "2", "3"]
}

pub fn the_rows_of_a_table_in_a_quote_are_marked_with_their_rows_in_the_note_test() {
  assert tr_rows("> | a |\n> |---|\n> | 1 |\n> | 2 |") == ["0", "2", "3"]
  assert tr_rows("> p\n>\n> | a |\n> |---|\n> | 1 |") == ["2", "4"]
}

pub fn the_rows_of_a_table_in_a_list_item_are_marked_with_their_rows_in_the_note_test() {
  assert tr_rows("- | a |\n  |---|\n  | 1 |\n  | 2 |") == ["0", "2", "3"]
  assert tr_rows("- x\n\n  | a |\n  |---|\n  | 1 |\n  | 2 |") == ["2", "4", "5"]
  assert tr_rows("- > | a |\n  > |---|\n  > | 1 |") == ["0", "2"]
}

/// Rows `first_row` up to `first_row + rows` of `note`, drawn the way live
/// view draws the note beside the text field.
fn beside_field(note: String, first_row: Int, rows: Int) -> String {
  markdown.parse(note)
  |> preview.part(
    rows:,
    first_row:,
    test_id: "live-below",
    on_task: fn(task, _) { task },
  )
  |> element.to_string
}

fn drawn_part(inner: String) -> String {
  "<div class=\"preview part\" data-test-id=\"live-below\">"
  <> inner
  <> "</div>"
}

pub fn a_list_split_by_the_field_draws_its_items_on_each_side_test() {
  let note = "- one\n- two\n- three\n- four"

  assert beside_field(note, 0, 1)
    == drawn_part("<ul data-row=\"0\"><li data-row=\"0\">one</li></ul>")
  assert beside_field(note, 2, 2)
    == drawn_part(
      "<ul data-row=\"2\"><li data-row=\"2\">three</li><li data-row=\"3\">four</li></ul>",
    )
}

pub fn a_loose_list_split_by_the_field_keeps_its_blank_rows_test() {
  let note = "- one\n\n- two\n\n- three"

  assert beside_field(note, 0, 4)
    == drawn_part(
      "<ul data-row=\"0\"><li data-row=\"0\"><p data-row=\"0\">one</p></li><li aria-hidden=\"true\" class=\"blank\" data-row=\"1\"></li><li data-row=\"2\"><p data-row=\"2\">two</p></li></ul><div class=\"blank\" data-row=\"3\"></div>",
    )
}

pub fn an_ordered_list_split_by_the_field_keeps_its_numbers_test() {
  assert beside_field("3. a\n4. b\n5. c", 0, 1)
    == drawn_part(
      "<ol data-row=\"0\" start=\"3\"><li data-row=\"0\">a</li></ol>",
    )
  assert beside_field("3. a\n4. b\n5. c", 2, 1)
    == drawn_part(
      "<ol data-row=\"2\" start=\"5\"><li data-row=\"2\">c</li></ol>",
    )
}

pub fn the_items_of_a_split_list_are_spaced_like_the_whole_list_test() {
  let note = "- one\n\n- two\n\n- three"

  assert beside_field(note, 0, 2)
    == drawn_part(
      "<ul data-row=\"0\"><li data-row=\"0\"><p data-row=\"0\">one</p></li></ul><div class=\"blank\" data-row=\"1\"></div>",
    )
  assert beside_field(note, 3, 2)
    == drawn_part(
      "<div class=\"blank\" data-row=\"3\"></div><ul data-row=\"4\"><li data-row=\"4\"><p data-row=\"4\">three</p></li></ul>",
    )
}

pub fn the_items_of_a_split_list_are_numbered_like_the_whole_list_test() {
  assert beside_field("1. a\n1. b\n1. c", 2, 1)
    == drawn_part(
      "<ol data-row=\"2\" start=\"3\"><li data-row=\"2\">c</li></ol>",
    )
  assert beside_field("7. a\n1. b\n1. c\n1. d", 2, 2)
    == drawn_part(
      "<ol data-row=\"2\" start=\"9\"><li data-row=\"2\">c</li><li data-row=\"3\">d</li></ol>",
    )
}

pub fn an_item_beside_the_field_is_drawn_with_what_it_holds_test() {
  assert beside_field("- a\n  - a1\n- b\n- c", 0, 2)
    == drawn_part(
      "<ul data-row=\"0\"><li data-row=\"0\">a<ul data-row=\"1\"><li data-row=\"1\">a1</li></ul></li></ul>",
    )
  assert beside_field("- [ ] a\n- [x] b\n- [ ] c", 2, 1)
    == drawn_part(
      "<ul data-row=\"2\"><li class=\"task\" data-row=\"2\"><input aria-label=\"c\" type=\"checkbox\">c</li></ul>",
    )
}

pub fn a_quote_a_table_and_code_beside_the_field_are_drawn_whole_test() {
  assert beside_field("p\n\n> a\n> b\n\nq", 1, 5)
    == drawn_part(
      "<div class=\"blank\" data-row=\"1\"></div><blockquote data-row=\"2\"><p data-row=\"2\">a\nb</p></blockquote><div class=\"blank\" data-row=\"4\"></div><p data-row=\"5\">q</p>",
    )
  assert beside_field("# T\n\n| a | b |\n|---|---|\n| 1 | 2 |", 1, 4)
    == drawn_part(
      "<div class=\"blank\" data-row=\"1\"></div><div aria-label=\"Table\" class=\"table-scroll\" role=\"region\" tabindex=\"0\"><table><thead><tr data-row=\"2\"><th scope=\"col\">a</th><th scope=\"col\">b</th></tr></thead><tbody><tr data-row=\"4\"><td>1</td><td>2</td></tr></tbody></table></div>",
    )
  assert beside_field("```\ncode\n\nmore\n```\n\np", 0, 6)
    == drawn_part(
      "<pre data-row=\"1\"><code>code\n\nmore\n</code></pre><div class=\"blank\" data-row=\"5\"></div>",
    )
}

pub fn the_blank_rows_beside_the_field_are_drawn_test() {
  assert beside_field("a\n\n\n\nb", 0, 2)
    == drawn_part(
      "<p data-row=\"0\">a</p><div class=\"blank\" data-row=\"1\"></div>",
    )
  assert beside_field("a\n\n\n\nb", 3, 2)
    == drawn_part(
      "<div class=\"blank\" data-row=\"3\"></div><p data-row=\"4\">b</p>",
    )
  assert beside_field("a\n\n\n\nb", 5, 0) == drawn_part("")
}

/// Only a composition holds the field on rows that cut a block in two.
pub fn the_rows_of_a_block_the_field_cuts_are_blank_test() {
  assert beside_field("```\na\nb", 1, 2)
    == drawn_part(
      "<div class=\"blank\" data-row=\"1\"></div><div class=\"blank\" data-row=\"2\"></div>",
    )
  assert beside_field("- a\n  b\n- c", 1, 2)
    == drawn_part(
      "<div class=\"blank\" data-row=\"1\"></div><ul data-row=\"2\"><li data-row=\"2\">c</li></ul>",
    )
}

pub fn twenty_thousand_blank_rows_are_drawn_test() {
  let blanks = fn(html) {
    list.length(string.split(html, "class=\"blank\"")) - 1
  }

  let note = "a" <> string.repeat("\n", 20_000) <> "b"
  assert blanks(beside_field(note, 1, 20_000)) == 19_999
  assert blanks(beside_field("```\n" <> string.repeat("a\n", 20_000), 1, 20_000))
    == 20_000
}

pub fn a_list_of_twenty_thousand_items_is_drawn_test() {
  let items = fn(html) { list.length(string.split(html, "<li")) - 1 }
  let note = string.repeat("- a\n\n", 20_000)

  assert items(render_blocks(markdown.parse(note))) == 20_000
  assert items(beside_field(note, 0, 40_000)) == 39_999
}
