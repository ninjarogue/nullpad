//// The note's undo history: the note before each step that can be undone,
//// and after each step undone. Pure.
////
//// Imported by: `editor`. Imports: `buffer`.

import nullpad/buffer.{type Buffer}

pub opaque type History {
  History(past: List(Buffer), present: Buffer, future: List(Buffer))
}

pub fn new(buffer: Buffer) -> History {
  History(past: [], present: buffer, future: [])
}

pub fn record(history: History, buffer: Buffer) -> History {
  let _ = buffer
  todo as "not implemented"
}

pub fn undo(history: History) -> Result(History, Nil) {
  let _ = history
  todo as "not implemented"
}

pub fn redo(history: History) -> Result(History, Nil) {
  let _ = history
  todo as "not implemented"
}

pub fn present(history: History) -> Buffer {
  history.present
}
