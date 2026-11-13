//// Generates the scripts of a run, runs them, and counts what they covered.

import gleam/dict.{type Dict}
import gleam/int
import gleam/list
import gleam/option.{None, Some}
import gleam/string
import nullpad/markdown
import typist/check.{type Divergence}
import typist/gen
import typist/script.{type Config, type Script}
import typist/shrink
import typist/textbox

/// Everything a run found out about itself.
pub type Report {
  Report(
    scripts: Int,
    keys: Int,
    key_kinds: Dict(String, Int),
    block_kinds: Dict(String, Int),
    /// With a selection that starts the run, and a note of several rows.
    selecting_starts: Int,
    /// By signature: how many scripts went wrong that way, and the first,
    /// shrunk.
    failures: Dict(String, #(Int, Script, Divergence)),
    clean: Int,
  )
}

pub fn scripts(config: Config, seed: Int, count: Int) -> List(Script) {
  let generate = script.script(config)
  gen.indexes(count)
  |> list.map(fn(index) { gen.run(generate, gen.stream(seed, index)) })
}

pub fn run(scripts: List(Script)) -> Report {
  let empty =
    Report(
      scripts: 0,
      keys: 0,
      key_kinds: dict.new(),
      block_kinds: dict.new(),
      selecting_starts: 0,
      failures: dict.new(),
      clean: 0,
    )
  list.fold(scripts, empty, fn(report, script) {
    let report = covered(report, script)
    case check.run(script) {
      Ok(Nil) -> Report(..report, clean: report.clean + 1)
      Error(divergence) -> {
        let signature = divergence.signature
        let seen = case dict.get(report.failures, signature) {
          Ok(#(count, first, divergence)) -> #(count + 1, first, divergence)
          Error(Nil) -> {
            let same = fn(candidate) {
              case check.run(candidate) {
                Error(found) -> found.signature == signature
                Ok(Nil) -> False
              }
            }
            let small = shrink.shrink(script, same)
            let assert Error(shrunk) = check.run(small)
            #(1, small, shrunk)
          }
        }
        Report(
          ..report,
          failures: dict.insert(report.failures, signature, seen),
        )
      }
    }
  })
}

fn covered(report: Report, script: Script) -> Report {
  let key_kinds =
    list.fold(script.keys, report.key_kinds, fn(kinds, key) {
      bump(kinds, textbox.label(key))
    })
  let block_kinds = list.fold(kinds_in(script.note), report.block_kinds, bump)
  Report(
    ..report,
    scripts: report.scripts + 1,
    keys: report.keys + list.length(script.keys),
    key_kinds:,
    block_kinds:,
    selecting_starts: case script.start.width > 0 {
      True -> report.selecting_starts + 1
      False -> report.selecting_starts
    },
  )
}

fn bump(counts: Dict(String, Int), name: String) -> Dict(String, Int) {
  dict.upsert(counts, name, fn(found) {
    case found {
      Some(count) -> count + 1
      None -> 1
    }
  })
}

/// The kinds of block the parser finds in a note, each once per note.
fn kinds_in(note: String) -> List(String) {
  markdown.parse(note) |> list.flat_map(block_names) |> list.unique
}

fn block_names(block: markdown.Block) -> List(String) {
  case block.content {
    markdown.Heading(..) -> ["heading"]
    markdown.Paragraph(..) -> ["paragraph"]
    markdown.BulletList(items:, ..) -> [
      "bullet list",
      ..list.flat_map(items, item_names)
    ]
    markdown.OrderedList(items:, ..) -> [
      "ordered list",
      ..list.flat_map(items, item_names)
    ]
    markdown.Quote(blocks:) -> ["quote", ..list.flat_map(blocks, block_names)]
    markdown.CodeBlock(..) -> ["code"]
    markdown.Rule -> ["rule"]
    markdown.Table(..) -> ["table"]
  }
}

fn item_names(item: markdown.Item) -> List(String) {
  let task = case item.task {
    Some(_) -> ["task item"]
    None -> []
  }
  list.append(task, list.flat_map(item.blocks, block_names))
}

/// A few lines saying what the run covered.
pub fn coverage(report: Report) -> String {
  let counts = fn(counts: Dict(String, Int)) {
    dict.to_list(counts)
    |> list.sort(fn(a, b) { string.compare(a.0, b.0) })
    |> list.map(fn(pair) { pair.0 <> " " <> int.to_string(pair.1) })
    |> string.join(", ")
  }
  string.join(
    [
      "typist: "
        <> int.to_string(report.scripts)
        <> " scripts, "
        <> int.to_string(report.keys)
        <> " keys, "
        <> int.to_string(report.selecting_starts)
        <> " starting with a selection",
      "  keys: " <> counts(report.key_kinds),
      "  blocks in the notes: " <> counts(report.block_kinds),
    ],
    "\n",
  )
}
