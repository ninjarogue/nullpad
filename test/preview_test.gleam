import gleam/list
import gleam/option.{None, Some}
import gleam/string
import lustre/element
import nullpad/markdown.{
  type Content, type Inline, Block, BulletList, Code, CodeBlock, Emphasis, H1,
  H2, H3, H4, H5, H6, Heading, Link, Loose, OrderedList, Paragraph, Quote, Rule,
  Strike, Strong, Text, Tight,
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
    render(CodeBlock(None, "  a <b> &c\n\nd\n")),
    "<pre><code>  a &lt;b&gt; &amp;c\n\nd\n</code></pre>",
  )
}

pub fn code_names_its_language_in_a_class_test() {
  assert string.contains(
    render(CodeBlock(Some("gleam"), "x\n")),
    "<pre><code class=\"language-gleam\">x\n</code></pre>",
  )
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
  markdown.Item(row:, task: None, blocks:)
}

fn task(checked: Bool, blocks: List(markdown.Block)) -> markdown.Item {
  markdown.Item(row: 0, task: Some(markdown.Task(checked, 0, 3)), blocks:)
}

fn paragraph(inline: Inline) -> Content {
  Paragraph([inline])
}

fn link(url: String, label: String) -> Inline {
  Link([Text(label)], url, None)
}
