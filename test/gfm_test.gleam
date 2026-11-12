import commonmark/expected.{type Listing, Autolinks, LinkReferences, RawHtml}
import commonmark/report.{type Outcome}
import commonmark/spec
import gleam/io
import gleam/list

const name = "GFM tables, strikethrough and task lists"

const expected_failures: Listing = [
  #(LinkReferences, [13]),
  #(Autolinks, [27]),
  #(RawHtml, [12]),
]

fn outcomes() -> List(Outcome) {
  report.run(spec.gfm_file)
}

pub fn unlisted_examples_pass_test() {
  assert expected.unlisted_failures(outcomes(), expected_failures) == []
}

pub fn listed_examples_still_fail_test() {
  assert expected.stale(outcomes(), expected_failures) == []
}

pub fn no_example_is_listed_twice_test() {
  assert expected.repeated(expected_failures) == []
}

pub fn listed_numbers_are_examples_test() {
  assert expected.unknown(outcomes(), expected_failures) == []
}

pub fn every_section_has_its_examples_test() {
  let sections =
    spec.examples(spec.gfm_file)
    |> list.map(fn(example) { example.section })
    |> list.chunk(fn(section) { section })
    |> list.map(fn(run) {
      let assert [section, ..] = run
      #(section, list.length(run))
    })
  assert sections
    == [
      #("Tables (extension)", 8),
      #("Strikethrough (extension)", 2),
      #("Tables", 6),
      #("Table cell count mismatches", 2),
      #("Embedded pipes", 1),
      #("Oddly-formatted markers", 1),
      #("Escaping", 1),
      #("Embedded HTML", 1),
      #("Reference-style links", 1),
      #("Sequential cells", 1),
      #("Interaction with emphasis", 1),
      #(
        "a table can be recognised when separated from a paragraph of text without an empty line",
        1,
      ),
      #("Strikethroughs", 2),
      #("Task lists", 3),
      #("Interop", 1),
    ]
}

pub fn pass_count_is_printed_test() {
  io.println("\n" <> report.summary_line(name, outcomes()))
}

pub fn main() -> Nil {
  expected.print_report(name, outcomes(), expected_failures, "gfm_test")
}
