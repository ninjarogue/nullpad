# Spec examples

`spec.json` holds the 652 examples of the CommonMark specification, version
0.31.2. Each object has `markdown`, `html`, `example` (1 to 652),
`start_line`, `end_line` and `section`.

Source: https://spec.commonmark.org/0.31.2/spec.json

The specification is by John MacFarlane and is licensed under CC BY-SA 4.0
(https://creativecommons.org/licenses/by-sa/4.0/). The examples are copied
from it unchanged.

It was made from `spec.txt` at tag 0.31.2 of https://github.com/commonmark/commonmark-spec
by the extractor in that repository, `python3 test/spec_tests.py --dump-tests`.

`commonmark_test.gleam` runs the examples against `markdown.parse` through
the HTML renderer in `render.gleam`. Reports:

    gleam run -m commonmark_test                 pass count, table per section, count per reason
    gleam run -m commonmark_test -- Lists        the listed examples of one reason, with expected and actual html

## GFM

`gfm.json` holds the examples of GitHub Flavored Markdown's strikethrough
extension, in the same shape plus `extensions`. They come unchanged from two
files of https://github.com/github/cmark-gfm at commit
27d942c8b0a62d192f616e5bf3578f4b6a89e180:

- `test/spec.txt` (GFM 0.29), section "Strikethrough (extension)".
- `test/extensions.txt`, section "Strikethroughs".

Each object is what that repository's extractor, `python3
test/spec_tests.py --spec <file> --pattern strikethrough --dump-tests`, writes
for the example, so `example`, `start_line` and `end_line` count within its
own file. The two dumps are joined in that order. `test/spec.txt` is licensed
under CC BY-SA 4.0, as its front matter says. `test/extensions.txt` is under
cmark-gfm's BSD 2-clause licence (its `COPYING`).

`gfm_test.gleam` runs them the same way. Every one must pass.
