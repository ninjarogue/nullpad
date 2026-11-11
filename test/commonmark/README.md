# CommonMark spec examples

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
