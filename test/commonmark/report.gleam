import commonmark/render
import commonmark/spec.{type Example}
import gleam/dict
import gleam/int
import gleam/io
import gleam/list
import gleam/string
import scribbl/markdown

pub type Outcome {
  Outcome(example: Example, actual: String)
}

pub fn run() -> List(Outcome) {
  list.map(spec.examples(), fn(example) {
    let actual = render.html(markdown.parse(example.markdown))
    Outcome(example:, actual:)
  })
}

pub fn passed(outcome: Outcome) -> Bool {
  outcome.actual == outcome.example.html
}

pub fn summary_line(outcomes: List(Outcome)) -> String {
  let passing = list.count(outcomes, passed)
  "CommonMark 0.31.2: "
  <> int.to_string(passing)
  <> " of "
  <> int.to_string(list.length(outcomes))
  <> " examples pass"
}

pub fn print_sections(outcomes: List(Outcome)) -> Nil {
  let sections = list.unique(list.map(outcomes, fn(o) { o.example.section }))
  let by_section = list.group(outcomes, fn(outcome) { outcome.example.section })
  let rows =
    list.map(sections, fn(section) {
      let assert Ok(in_section) = dict.get(by_section, section)
      #(section, list.count(in_section, passed), list.length(in_section))
    })
  let width =
    list.fold(rows, 0, fn(widest, row) { int.max(widest, string.length(row.0)) })
  io.println(string.pad_end("section", width, " ") <> "  passed  total")
  list.each(rows, fn(row) {
    let #(section, passing, total) = row
    io.println(
      string.pad_end(section, width, " ")
      <> "  "
      <> string.pad_start(int.to_string(passing), 6, " ")
      <> "  "
      <> string.pad_start(int.to_string(total), 5, " "),
    )
  })
}

pub fn print_outcome(outcome: Outcome) -> Nil {
  let example = outcome.example
  io.println(
    "--- example "
    <> int.to_string(example.number)
    <> " ("
    <> example.section
    <> ")\nmarkdown: "
    <> string.inspect(example.markdown)
    <> "\nexpected: "
    <> string.inspect(example.html)
    <> "\nactual:   "
    <> string.inspect(outcome.actual),
  )
}
