import commonmark/render
import scribbl/markdown.{
  Block, Code, Emphasis, H3, Heading, Link, Paragraph, Strong, Text,
}

fn paragraph(text: List(markdown.Inline)) -> String {
  render.html([Block(0, 0, Paragraph(text))])
}

fn href(url: String) -> String {
  paragraph([Link([Text("a")], url)])
}

pub fn blocks_end_with_a_newline_test() {
  assert render.html([
      Block(0, 0, Heading(H3, [Text("a")])),
      Block(1, 1, Paragraph([Text("b")])),
    ])
    == "<h3>a</h3>\n<p>b</p>\n"
  assert render.html([]) == ""
}

pub fn text_and_code_escape_four_characters_test() {
  assert paragraph([Text("a & <b> \"c\"")])
    == "<p>a &amp; &lt;b&gt; &quot;c&quot;</p>\n"
  assert paragraph([Code("<&>\"")])
    == "<p><code>&lt;&amp;&gt;&quot;</code></p>\n"
}

pub fn inlines_nest_test() {
  assert paragraph([Strong([Emphasis([Text("a")]), Text("b")])])
    == "<p><strong><em>a</em>b</strong></p>\n"
}

pub fn href_keeps_the_characters_the_reference_renderers_keep_test() {
  assert href("/a-b_c.d!~*'();:@=+$,/?#x9")
    == "<p><a href=\"/a-b_c.d!~*'();:@=+$,/?#x9\">a</a></p>\n"
}

pub fn href_percent_encodes_everything_else_test() {
  assert href("/my uri") == "<p><a href=\"/my%20uri\">a</a></p>\n"
  assert href("a\\b\"c[d]") == "<p><a href=\"a%5Cb%22c%5Bd%5D\">a</a></p>\n"
  assert href("/f\u{E4}") == "<p><a href=\"/f%C3%A4\">a</a></p>\n"
  assert href("/\u{1F600}") == "<p><a href=\"/%F0%9F%98%80\">a</a></p>\n"
}

pub fn href_keeps_an_existing_escape_and_fixes_a_lone_percent_test() {
  assert href("/a%20b%e4") == "<p><a href=\"/a%20b%e4\">a</a></p>\n"
  assert href("/100%") == "<p><a href=\"/100%25\">a</a></p>\n"
  assert href("/%zz%2") == "<p><a href=\"/%25zz%252\">a</a></p>\n"
}

pub fn href_escapes_ampersand_for_html_test() {
  assert href("/a?b=1&c=2") == "<p><a href=\"/a?b=1&amp;c=2\">a</a></p>\n"
}
