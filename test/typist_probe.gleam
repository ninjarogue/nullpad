import gleam/dict
import gleam/int
import gleam/io
import gleam/list
import typist/check
import typist/notes
import typist/run
import typist/script

pub fn main() -> Nil {
  let config = script.Config(undo: False, max_keys: 12, size: notes.Small)
  let scripts = run.scripts(config, 1, 2000)
  let report = run.run(scripts)
  io.println(run.coverage(report))
  io.println("clean: " <> int.to_string(report.clean))
  dict.to_list(report.failures)
  |> list.sort(fn(a, b) { int.compare(b.1.0, a.1.0) })
  |> list.each(fn(entry) {
    let #(signature, #(count, small, divergence)) = entry
    io.println("\n" <> int.to_string(count) <> " x " <> signature)
    io.println(check.describe(small, divergence))
  })
}
