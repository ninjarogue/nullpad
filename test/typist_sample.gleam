//// Prints scripts and their answers as JSON for the browser to replay:
////
////   gleam run -m typist_sample -- [count] [seed] [undo] > scripts.json
////
//// The sample in `e2e/tests/typist-sample.json` is `-- 30 1`.

import commonmark/spec
import gleam/int
import gleam/io
import gleam/list
import typist/export
import typist/notes
import typist/run
import typist/script

pub fn main() -> Nil {
  let arguments = spec.command_line_arguments()
  let number = fn(at, default) {
    case list.drop(arguments, at) {
      [text, ..] ->
        case int.parse(text) {
          Ok(n) -> n
          Error(Nil) -> default
        }
      [] -> default
    }
  }
  let undo = list.contains(arguments, "undo")
  let config = script.Config(undo:, max_keys: 12, size: notes.Small)
  let scripts = run.scripts(config, number(1, 1), number(0, 30))
  io.print(export.document(scripts))
}
