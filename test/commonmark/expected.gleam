import commonmark/report.{type Outcome}
import commonmark/spec
import gleam/int
import gleam/io
import gleam/list
import gleam/string

pub type Reason {
  // Features nullpad does not have yet.
  HtmlBlocks
  // Reference definitions and reference-style links.
  LinkReferences
  Images
  Autolinks
  // By decision, raw HTML shows as text.
  RawHtml
  HardBreaks
  Entities
  // Until the parser reads them: every table example.
  Tables
}

/// The examples that may fail, by the missing feature each one needs.
pub type Listing =
  List(#(Reason, List(Int)))

fn numbers(listing: Listing) -> List(Int) {
  list.flat_map(listing, fn(entry) { entry.1 })
}

fn is_listed(listing: Listing, outcome: Outcome) -> Bool {
  list.contains(numbers(listing), outcome.example.number)
}

pub fn unlisted_failures(
  outcomes: List(Outcome),
  listing: Listing,
) -> List(Outcome) {
  list.filter(outcomes, fn(outcome) {
    !report.passed(outcome) && !is_listed(listing, outcome)
  })
}

/// Listed numbers whose example passes: the list is out of date.
pub fn stale(outcomes: List(Outcome), listing: Listing) -> List(Int) {
  outcomes
  |> list.filter(fn(outcome) {
    report.passed(outcome) && is_listed(listing, outcome)
  })
  |> list.map(fn(outcome) { outcome.example.number })
}

pub fn repeated(listing: Listing) -> List(Int) {
  let numbers = numbers(listing)
  numbers
  |> list.filter(fn(number) {
    list.count(numbers, fn(other) { other == number }) > 1
  })
  |> list.unique
}

/// Listed numbers that are no example of the run.
pub fn unknown(outcomes: List(Outcome), listing: Listing) -> List(Int) {
  let known = list.map(outcomes, fn(outcome) { outcome.example.number })
  list.filter(numbers(listing), fn(number) { !list.contains(known, number) })
}

/// What `gleam run -m <module>` prints: the pass count, a table per section
/// and the count per reason, or with a reason's name the examples it lists.
pub fn print_report(
  name: String,
  outcomes: List(Outcome),
  listing: Listing,
  module: String,
) -> Nil {
  case spec.command_line_arguments() {
    [] -> {
      io.println(report.summary_line(name, outcomes))
      io.println("")
      report.print_sections(outcomes)
      io.println("")
      print_reason_counts(listing)
    }
    [reason] -> print_reason(outcomes, listing, reason)
    _ -> io.println("usage: gleam run -m " <> module <> " [-- <Reason>]")
  }
}

fn print_reason_counts(listing: Listing) -> Nil {
  list.each(listing, fn(entry) {
    io.println(
      string.pad_end(string.inspect(entry.0), 16, " ")
      <> int.to_string(list.length(entry.1)),
    )
  })
}

fn print_reason(
  outcomes: List(Outcome),
  listing: Listing,
  reason: String,
) -> Nil {
  case list.find(listing, fn(entry) { string.inspect(entry.0) == reason }) {
    Error(Nil) -> {
      io.println("no such reason: " <> reason)
      io.println(
        "reasons: "
        <> string.join(
          list.map(listing, fn(entry) { string.inspect(entry.0) }),
          ", ",
        ),
      )
    }
    Ok(#(_, numbers)) ->
      outcomes
      |> list.filter(fn(outcome) {
        list.contains(numbers, outcome.example.number)
      })
      |> list.each(report.print_outcome)
  }
}
