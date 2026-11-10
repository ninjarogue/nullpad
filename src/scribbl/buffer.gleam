//// The note being edited: lines of text plus one selection. Pure Gleam.
//// This is the single source of truth that the preview, storage and vim read.
//// The text field on screen only mirrors it (see `scribbl/surface`).
//// Imported by: any module. Imports: gleam_stdlib only.

/// A place *between* two graphemes, both numbers counted from 0. `col` counts
/// graphemes (what a person calls a character), never bytes or UTF-16 units.
/// Browser offsets are converted in `surface` and nowhere else.
pub type Position {
  Position(row: Int, col: Int)
}

/// Invariants, kept by every function here so callers never check:
/// - `lines` is never empty (an empty note is `[""]`) and no line holds "\n".
/// - `anchor` and `head` are inside the text.
/// - `head` is the cursor. `anchor == head` means nothing is selected.
/// A list of lines is enough for notes of a few pages. The type is opaque, so
/// a faster structure can replace it later without touching a caller.
pub opaque type Buffer {
  Buffer(lines: List(String), anchor: Position, head: Position)
}

/// Split on "\n" (after turning "\r\n" into "\n"). Cursor at the start.
pub fn from_text(text: String) -> Buffer {
  let _ = text
  todo as "not implemented"
}

/// The lines joined with "\n". Law: `text(from_text(t)) == t` (no "\r" in t).
pub fn text(buffer: Buffer) -> String {
  let _ = buffer
  todo as "not implemented"
}

pub fn lines(buffer: Buffer) -> List(String) {
  buffer.lines
}

/// Where typing would happen.
pub fn cursor(buffer: Buffer) -> Position {
  buffer.head
}

/// `#(anchor, head)`. The anchor stays put while the head moves, which is
/// what vim's visual mode needs later.
pub fn selection(buffer: Buffer) -> #(Position, Position) {
  #(buffer.anchor, buffer.head)
}

/// Move the selection. Total: positions outside the text are clamped, so this
/// cannot fail or break the invariants.
pub fn select(
  buffer: Buffer,
  anchor anchor: Position,
  head head: Position,
) -> Buffer {
  let _ = #(buffer, anchor, head)
  todo as "not implemented"
}

/// Put the cursor at `position` with nothing selected.
pub fn move_to(buffer: Buffer, position: Position) -> Buffer {
  select(buffer, anchor: position, head: position)
}

/// The one editing primitive: replace what lies between `from` and `to` with
/// `new` (which may contain "\n"). The cursor lands just after it.
/// Typing "x" is `replace(c, c, "x")`. Vim `dd` on row r is
/// `replace(Position(r, 0), Position(r + 1, 0), "")`.
pub fn replace(
  buffer: Buffer,
  from from: Position,
  to to: Position,
  with new: String,
) -> Buffer {
  // head = line from.row up to from.col; tail = line to.row after to.col
  // middle = string.split(head <> new <> tail, "\n")
  // lines = rows above from.row ++ middle ++ rows below to.row
  let _ = #(buffer, from, to, new)
  todo as "not implemented"
}
