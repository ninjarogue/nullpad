import gleam/list

pub type Example {
  Example(number: Int, section: String, markdown: String, html: String)
}

pub const commonmark_file = "test/commonmark/spec.json"

pub const gfm_file = "test/commonmark/gfm.json"

pub fn examples(file: String) -> List(Example) {
  list.map(load(file), fn(row) {
    let #(number, section, markdown, html) = row
    Example(number:, section:, markdown:, html:)
  })
}

@external(javascript, "./spec.ffi.mjs", "load")
fn load(file: String) -> List(#(Int, String, String, String))

@external(javascript, "./spec.ffi.mjs", "commandLineArguments")
pub fn command_line_arguments() -> List(String)
