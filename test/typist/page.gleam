//// The real editor in page view, driven the way `surface` drives it, with a
//// text field that edits the way a plain browser text box does.
////
//// The field holds `editor.field_buffer`, the rows of the note the cursor is
//// in. A key the page lets the browser handle edits the field, and the
//// editor is told what the field now shows. A key at the edge of the field
//// is handled by the editor, and the browser does nothing.
////
//// `edge` copies the table in `surface.edge_decoder`. `e2e/tests/typist.e2e.ts`
//// presses the same keys in the real page, so a copy that drifts is found
//// there.

import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import nullpad/buffer.{type Buffer, Position}
import nullpad/editor.{type Edge, type Editor}
import typist/script.{type Start, Start}
import typist/textbox.{type Box, type Key, type State}

pub type Page {
  Page(editor: Editor, field: Box)
}

pub fn open(note: String, start: Start) -> Page {
  let opened = editor.new(vim: False, live: True) |> editor.open(note)
  let page = Page(opened.editor, textbox.new("", 0, 0)) |> synced(opened.sync)
  let Start(row:, col:, width:) = start
  let lines = buffer.lines(editor.buffer(page.editor))
  let line = case list.drop(lines, row) {
    [line, ..] -> line
    [] -> ""
  }
  let seen = fn(col) { string.slice(line, 0, col) }
  let at_end = fn(col) { col >= string.length(line) }
  let clicked =
    editor.update(
      page.editor,
      editor.Pointed(row:, visible: seen(col), at_end: at_end(col)),
    )
  let page = Page(clicked.editor, page.field) |> synced(clicked.sync)
  let released = editor.update(page.editor, editor.Released)
  let page = Page(..page, editor: released.editor)
  case width > 0 {
    False -> page
    True -> {
      let to = col + width
      let shown = to_buffer(textbox.state(page.field))
      let dragged =
        editor.update(
          page.editor,
          editor.ShiftPointed(
            row:,
            visible: seen(to),
            at_end: at_end(to),
            shown:,
          ),
        )
      let page = Page(dragged.editor, page.field) |> synced(dragged.sync)
      let released = editor.update(page.editor, editor.Released)
      Page(..page, editor: released.editor)
    }
  }
}

pub fn press(page: Page, key: Key) -> Page {
  case edge(key, page.field) {
    Some(edge) -> {
      let shown = to_buffer(textbox.state(page.field))
      let outcome =
        editor.update(page.editor, editor.EdgePressed(edge:, x: 0.0, shown:))
      Page(outcome.editor, page.field) |> synced(outcome.sync)
    }
    None -> {
      let field = textbox.press(page.field, key)
      let shown = to_buffer(textbox.state(field))
      let outcome = editor.update(page.editor, editor.ControlChanged(shown:))
      Page(outcome.editor, field) |> synced(outcome.sync)
    }
  }
}

/// What the page shows in the field has to follow the editor. A `Write` puts
/// the field's text and selection where the editor says.
fn synced(page: Page, sync: editor.Sync) -> Page {
  case sync {
    editor.InSync -> page
    editor.Write(written)
    | editor.WriteQuietly(written)
    | editor.Release(written)
    | editor.WriteAndAim(written, ..) ->
      Page(..page, field: textbox.write(page.field, of_buffer(written)))
  }
}

/// Mirrors `surface.edge_decoder` for the keys this check presses.
fn edge(key: Key, field: Box) -> Option(Edge) {
  let state = textbox.state(field)
  let collapsed = state.anchor == state.head
  let at_start = state.head == 0
  let at_end = state.head == textbox.length(field)
  case key {
    textbox.Backspace(textbox.Grapheme) if collapsed && at_start ->
      Some(editor.JoinBefore)
    textbox.Delete(textbox.Grapheme) if collapsed && at_end ->
      Some(editor.JoinAfter)
    textbox.Go(textbox.Left(textbox.Grapheme), extend: True) if at_start ->
      Some(editor.SelectBefore)
    textbox.Go(textbox.Right(textbox.Grapheme), extend: True) if at_end ->
      Some(editor.SelectAfter)
    textbox.SelectAll -> Some(editor.SelectAll)
    textbox.Go(textbox.DocStart, extend: True) -> Some(editor.SelectToStart)
    textbox.Go(textbox.DocEnd, extend: True) -> Some(editor.SelectToEnd)
    _ -> None
  }
}

/// The whole note and its selection, as the editor holds them.
pub fn note(page: Page) -> State {
  of_buffer(editor.buffer(page.editor))
}

/// What the field holds, and what the editor says it should hold.
pub fn field(page: Page) -> State {
  textbox.state(page.field)
}

pub fn field_wanted(page: Page) -> State {
  of_buffer(editor.field_buffer(page.editor))
}

pub fn of_buffer(buffer: Buffer) -> State {
  let #(anchor, head) = buffer.selection(buffer)
  let lines = buffer.lines(buffer)
  textbox.State(
    text: buffer.text(buffer),
    anchor: offset(lines, anchor),
    head: offset(lines, head),
  )
}

pub fn to_buffer(state: State) -> Buffer {
  let position = fn(offset) {
    let before = string.to_graphemes(state.text) |> list.take(offset)
    buffer.end_of(string.concat(before))
  }
  buffer.from_text(state.text)
  |> buffer.select(anchor: position(state.anchor), head: position(state.head))
}

fn offset(lines: List(String), position: buffer.Position) -> Int {
  let Position(row:, col:) = position
  let above =
    list.take(lines, row)
    |> list.fold(0, fn(sum, line) { sum + string.length(line) + 1 })
  above + col
}
