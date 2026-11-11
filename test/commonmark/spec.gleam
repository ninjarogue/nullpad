import gleam/list

pub type Example {
  Example(number: Int, section: String, markdown: String, html: String)
}

pub fn examples() -> List(Example) {
  list.map(load(), fn(row) {
    let #(number, section, markdown, html) = row
    Example(number:, section:, markdown:, html:)
  })
}

@external(javascript, "./spec.ffi.mjs", "load")
fn load() -> List(#(Int, String, String, String))

@external(javascript, "./spec.ffi.mjs", "commandLineArguments")
pub fn command_line_arguments() -> List(String)
