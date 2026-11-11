import commonmark/report
import commonmark/spec
import gleam/io
import gleam/list

const name = "GFM strikethrough and task lists"

pub fn every_example_passes_test() {
  let failures =
    report.run(spec.gfm_file)
    |> list.filter(fn(outcome) { !report.passed(outcome) })
  assert failures == []
}

pub fn every_section_has_its_examples_test() {
  let sections =
    spec.examples(spec.gfm_file)
    |> list.map(fn(example) { example.section })
  assert sections
    == [
      "Strikethrough (extension)",
      "Strikethrough (extension)",
      "Strikethroughs",
      "Strikethroughs",
      "Task lists",
      "Task lists",
      "Task lists",
    ]
}

pub fn pass_count_is_printed_test() {
  io.println("\n" <> report.summary_line(name, report.run(spec.gfm_file)))
}
