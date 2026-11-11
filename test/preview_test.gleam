import gleam/list
import gleam/option.{None}
import gleam/string
import lustre/element
import scribbl/markdown.{
  type Content, type Inline, Block, BulletList, Code, CodeBlock, Emphasis, H1,
  H2, H3, H4, H5, H6, Heading, Link, OrderedList, Paragraph, Quote, Rule, Strike,
  Strong, Text,
}
import scribbl/preview

pub fn the_page_is_a_marked_preview_root_test() {
  let html = element.to_string(preview.view([], fn(row) { row }))

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
  let html = render(paragraph(Link(label, "/x")))

  assert string.contains(html, "<a ")
  assert string.contains(html, "><strong>docs</strong></a>")
}

pub fn script_links_render_their_label_without_an_anchor_test() {
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

      assert string.contains(html, "<p>label</p>")
      assert !string.contains(html, "<a")
      assert !string.contains(html, "href")
    },
  )
}

pub fn an_unsafe_link_keeps_its_label_markup_test() {
  let html = render(paragraph(Link([Strong([Text("x")])], "javascript:x")))

  assert string.contains(html, "<p><strong>x</strong></p>")
  assert !string.contains(html, "<a")
}

pub fn strike_renders_its_children_plainly_test() {
  assert string.contains(
    render(paragraph(Strike([Text("gone"), Code("x")]))),
    "<p>gone<code>x</code></p>",
  )
}

pub fn blocks_the_parser_cannot_produce_yet_render_nothing_test() {
  let html =
    render_blocks([
      Block(0, 0, BulletList([])),
      Block(1, 1, OrderedList(1, [])),
      Block(2, 2, Quote([])),
      Block(3, 3, CodeBlock(None, "code")),
      Block(4, 4, Rule),
    ])

  assert !string.contains(html, "<ul")
  assert !string.contains(html, "<ol")
  assert !string.contains(html, "<blockquote")
  assert !string.contains(html, "<pre")
  assert !string.contains(html, "<hr")
}

fn render(content: Content) -> String {
  render_blocks([Block(0, 0, content)])
}

fn render_blocks(blocks: List(markdown.Block)) -> String {
  element.to_string(preview.view(blocks, fn(row) { row }))
}

fn paragraph(inline: Inline) -> Content {
  Paragraph([inline])
}

fn link(url: String, label: String) -> Inline {
  Link([Text(label)], url)
}
