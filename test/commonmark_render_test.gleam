import commonmark/render
import gleam/option.{None, Some}
import nullpad/markdown.{
  Block, BulletList, Center, Code, CodeBlock, Column, Emphasis, H3, Heading,
  Item, Left, Link, Loose, OrderedList, Paragraph, Quote, Right, Rule, Strike,
  Strong, Table, Task, Text, Tight, Unaligned,
}

fn paragraph(text: List(markdown.Inline)) -> String {
  render.html([Block(0, 0, Paragraph(text))])
}

fn href(url: String) -> String {
  paragraph([Link([Text("a")], url, None)])
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

pub fn a_rule_is_a_void_hr_test() {
  assert render.html([Block(0, 0, Rule), Block(1, 1, Paragraph([Text("a")]))])
    == "<hr />\n<p>a</p>\n"
}

pub fn a_quote_puts_its_blocks_on_lines_of_their_own_test() {
  assert render.html([Block(0, 0, Quote([Block(0, 0, Paragraph([Text("a")]))]))])
    == "<blockquote>\n<p>a</p>\n</blockquote>\n"
  assert render.html([Block(0, 0, Quote([]))])
    == "<blockquote>\n</blockquote>\n"
}

pub fn a_tight_item_shows_its_paragraphs_as_bare_text_test() {
  let nested = Block(1, 1, BulletList(Tight, [item(1, "b")]))
  let first = Item(0, None, [Block(0, 0, Paragraph([Text("a")])), nested])
  assert render.html([Block(0, 1, BulletList(Tight, [first]))])
    == "<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul>\n</li>\n</ul>\n"
}

pub fn a_loose_item_keeps_its_paragraphs_test() {
  assert render.html([
      Block(0, 2, BulletList(Loose, [item(0, "a"), item(2, "b")])),
    ])
    == "<ul>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n</li>\n</ul>\n"
}

pub fn an_ordered_list_names_its_start_unless_it_is_one_test() {
  assert render.html([Block(0, 0, OrderedList(1, Tight, [item(0, "a")]))])
    == "<ol>\n<li>a</li>\n</ol>\n"
  assert render.html([Block(0, 0, OrderedList(7, Tight, [item(0, "a")]))])
    == "<ol start=\"7\">\n<li>a</li>\n</ol>\n"
}

pub fn an_empty_item_is_an_empty_li_test() {
  assert render.html([Block(0, 0, BulletList(Tight, [Item(0, None, [])]))])
    == "<ul>\n<li></li>\n</ul>\n"
}

pub fn a_task_starts_its_item_with_a_disabled_checkbox_test() {
  let task = fn(checked) {
    Item(0, Some(Task(checked, 0, 3)), [Block(0, 0, Paragraph([Text("a")]))])
  }
  assert render.html([Block(0, 0, BulletList(Tight, [task(False)]))])
    == "<ul>\n<li><input type=\"checkbox\" disabled=\"\" /> a</li>\n</ul>\n"
  assert render.html([Block(0, 0, BulletList(Loose, [task(True)]))])
    == "<ul>\n<li><input type=\"checkbox\" checked=\"\" disabled=\"\" /> \n<p>a</p>\n</li>\n</ul>\n"
}

pub fn a_table_has_a_head_and_a_body_only_when_it_has_rows_test() {
  let heading = [Column(Unaligned, [Text("a")]), Column(Unaligned, [Text("b")])]
  assert render.html([Block(0, 1, Table(heading, [[[Text("1")], []]]))])
    == "<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n"
    <> "<tbody>\n<tr>\n<td>1</td>\n<td></td>\n</tr>\n</tbody>\n</table>\n"
  assert render.html([Block(0, 1, Table(heading, []))])
    == "<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n</table>\n"
}

pub fn a_column_names_its_alignment_on_every_cell_it_has_test() {
  let columns = [
    Column(Left, [Text("l")]),
    Column(Center, [Text("c")]),
    Column(Right, [Text("r")]),
    Column(Unaligned, [Text("n")]),
  ]
  let row = [[Text("1")], [Text("2")], [Text("3")], [Text("4")]]
  assert render.html([Block(0, 2, Table(columns, [row]))])
    == "<table>\n<thead>\n<tr>\n<th align=\"left\">l</th>\n<th align=\"center\">c</th>\n"
    <> "<th align=\"right\">r</th>\n<th>n</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n"
    <> "<td align=\"left\">1</td>\n<td align=\"center\">2</td>\n<td align=\"right\">3</td>\n<td>4</td>\n"
    <> "</tr>\n</tbody>\n</table>\n"
}

fn item(row: Int, text: String) -> markdown.Item {
  Item(row, None, [Block(row, row, Paragraph([Text(text)]))])
}

pub fn code_is_escaped_inside_pre_and_code_test() {
  assert render.html([Block(0, 0, CodeBlock(None, "<a> & \"b\"\n"))])
    == "<pre><code>&lt;a&gt; &amp; &quot;b&quot;\n</code></pre>\n"
  assert render.html([Block(0, 0, CodeBlock(Some("a&b"), ""))])
    == "<pre><code class=\"language-a&amp;b\"></code></pre>\n"
}

pub fn strike_is_del_test() {
  assert paragraph([Strike([Text("a"), Emphasis([Text("b")])])])
    == "<p><del>a<em>b</em></del></p>\n"
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

pub fn a_title_follows_the_href_test() {
  assert paragraph([Link([Text("a")], "/u", Some("t \"q\""))])
    == "<p><a href=\"/u\" title=\"t &quot;q&quot;\">a</a></p>\n"
}
