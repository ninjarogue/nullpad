//// Imported by: `surface`, the app shell, tests. Imports: `buffer`, `vim`,
//// `live`, `markdown`.

import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/order
import gleam/string
import nullpad/buffer.{type Buffer, type Position, Position}
import nullpad/live.{type Region, Region}
import nullpad/markdown.{type Block}
import nullpad/vim.{Step}

/// Every change to `buffer` goes through `edit` or `compose`.
pub opaque type Editor {
  /// `press` is a mouse press the editor took, held until it is let go.
  /// `dragging` is while the browser drags the field's selection.
  Editor(
    buffer: Buffer,
    keys: Keys,
    field: Field,
    focus: Focus,
    press: Option(Press),
    dragging: Bool,
  )
}

type Press {
  /// A drag selects from here.
  PressedAt(Position)
  /// A second press in a row selected this word: a drag selects whole words,
  /// and always this one.
  PressedOnWord(start: Position, end: Position)
}

type Focus {
  Away
  Focused
}

type Field {
  Whole
  /// The note drawn as a page, with `rows` of it in the text field.
  ///
  /// `parsed` is the text of `buffer` parsed. While `composing` it is the
  /// text from before the composition, which differs only inside `rows`.
  ///
  /// `drawn` is the page as it was laid out: `parsed` as it was when the
  /// rows of the selection last changed, the number of rows changed, a row
  /// outside `rows` changed, or the field was out of focus. So it differs
  /// from `parsed` only inside `rows`, and typing on a row moves nothing
  /// outside the field. The page around the field and the field's rows come
  /// from `drawn`: `rows` is `drawn` revealed around the selection. Out of
  /// focus, and while a composition that added or took rows, `rows` stay
  /// the rows the field shows: a blurred field is left as it is, so the
  /// browser can give it the focus back, and an IME owns the field it
  /// composes in.
  Part(rows: Region, drawn: List(Block), parsed: List(Block), composing: Bool)
}

type Keys {
  PlainKeys
  VimKeys(vim.State)
}

pub type Mode {
  Plain
  Normal
  Insert
}

pub type Event {
  ControlChanged(shown: Buffer)
  /// In the middle of an IME composition: the control must not be written
  /// to until it ends.
  Composing(shown: Buffer)
  KeyPressed(key: vim.Key, shown: Buffer)
  EdgePressed(edge: Edge, x: Float, shown: Buffer)
  EscapePressed(shown: Buffer)
  /// A press at a place on the page, at `x`, `y` in the window.
  Pointed(row: Int, visible: String, at_end: Bool, x: Float, y: Float)
  /// The second press of a double click: selects the word there.
  WordPointed(row: Int, visible: String, at_end: Bool, x: Float, y: Float)
  /// Shift and a press: the head moves there and the anchor stays where
  /// `shown`, the field as it is now, has it.
  ShiftPointed(
    row: Int,
    visible: String,
    at_end: Bool,
    shown: Buffer,
    x: Float,
    y: Float,
  )
  /// A press on a link or a box, which keeps its click: the caret stays
  /// where it is unless the pointer drags from there.
  Grabbed(row: Int, visible: String, at_end: Bool, x: Float, y: Float)
  /// The pointer of a held press, once it has moved off the place pressed.
  Dragged(row: Int, visible: String, at_end: Bool)
  Released
  /// The browser starts to drag the field's selection.
  DragStarted
  /// Text dropped on a place on the page. It moves there when it is the
  /// field's selection, unless the drop copies it.
  Dropped(
    row: Int,
    visible: String,
    at_end: Bool,
    text: String,
    copy: Bool,
    shown: Buffer,
  )
  FocusChanged(focused: Bool)
}

/// A key that reaches past the rows the field holds. The `Select` keys move
/// the head and keep the anchor.
pub type Edge {
  Up
  Down
  JoinBefore
  JoinAfter
  SelectUp
  SelectDown
  SelectBefore
  SelectAfter
  SelectToStart
  SelectToEnd
  SelectAll
}

pub type Sync {
  InSync
  Write(Buffer)
  WriteQuietly(Buffer)
  /// Then the head moves to the place nearest `x` on the first or last drawn
  /// line of its row. A selection keeps its anchor.
  WriteAndAim(Buffer, x: Float, line: Line)
  Release(Buffer)
  /// A press at `x`, `y` in the window: the field is written, when there is
  /// a write, and focused where it is, and the pointer is followed until it
  /// is let go.
  Press(write: Option(Buffer), x: Float, y: Float)
}

pub type Line {
  FirstLine
  LastLine
}

pub type Outcome {
  Outcome(editor: Editor, sync: Sync, requests: List(vim.Request))
}

pub fn new(vim vim_enabled: Bool, live live: Bool) -> Editor {
  let buffer = buffer.from_text("")
  Editor(
    buffer:,
    keys: fresh_keys(vim_enabled),
    field: case live {
      True -> laid_out(buffer)
      False -> Whole
    },
    focus: Away,
    press: None,
    dragging: False,
  )
}

fn fresh_keys(vim_enabled: Bool) -> Keys {
  case vim_enabled {
    True -> VimKeys(vim.new())
    False -> PlainKeys
  }
}

pub fn open(editor: Editor, text: String) -> Outcome {
  let keys = fresh_keys(editor.keys != PlainKeys)
  let buffer = buffer.from_text(text)
  let field = case editor.field {
    Whole -> Whole
    Part(..) -> laid_out(buffer)
  }
  Editor(..editor, keys:, buffer:, field:)
  |> realign
  |> write_and_focus
}

fn laid_out(buffer: Buffer) -> Field {
  let blocks = parse(buffer)
  Part(rows: Region(0, 0), drawn: blocks, parsed: blocks, composing: False)
}

fn write_and_focus(editor: Editor) -> Outcome {
  write(Editor(..editor, focus: Focused))
}

fn write(editor: Editor) -> Outcome {
  Outcome(editor:, sync: Write(field_buffer(editor)), requests: [])
}

pub fn set_live(editor: Editor, on: Bool) -> Outcome {
  let editor = case on {
    True -> Editor(..editor, field: laid_out(editor.buffer)) |> realign
    False -> Editor(..editor, field: Whole)
  }
  write_and_focus(editor)
}

pub fn set_vim(editor: Editor, enabled: Bool) -> Outcome {
  let editor = case editor.keys, enabled {
    PlainKeys, False | VimKeys(_), True -> editor
    _, _ -> Editor(..editor, keys: fresh_keys(enabled))
  }
  Outcome(editor:, sync: InSync, requests: [])
}

pub fn update(editor: Editor, event: Event) -> Outcome {
  case event {
    ControlChanged(shown:) -> typed(editor, shown, None, realign)
    Composing(shown:) -> compose(editor, shown)
    KeyPressed(key:, shown:) -> typed(editor, shown, Some(key), realign)
    EdgePressed(edge:, x:, shown:) -> cross(editor, edge, x, shown)
    EscapePressed(shown:) -> {
      let outcome = typed(editor, shown, None, realign)
      case outcome.editor.field {
        Whole -> outcome
        Part(..) -> {
          let left = outcome.editor.buffer
          let editor =
            Editor(..outcome.editor, focus: Away)
            |> edit(buffer.move_to(left, buffer.cursor(left)))
            |> realign
          Outcome(..outcome, editor:, sync: Release(field_buffer(editor)))
        }
      }
    }
    Pointed(row:, visible:, at_end:, x:, y:) -> {
      let at = place(editor.buffer, row:, visible:, at_end:)
      let editor =
        Editor(..editor, focus: Focused, press: Some(PressedAt(at)))
        |> edit(buffer.move_to(editor.buffer, at))
        |> realign
      Outcome(
        editor:,
        sync: Press(Some(field_buffer(editor)), x:, y:),
        requests: [],
      )
    }
    WordPointed(row:, visible:, at_end:, x:, y:) -> {
      let at = place(editor.buffer, row:, visible:, at_end:)
      let #(start, end) = buffer.word_at(editor.buffer, at)
      let editor =
        Editor(
          ..editor,
          focus: Focused,
          press: Some(PressedOnWord(start:, end:)),
        )
        |> edit(buffer.select(editor.buffer, anchor: start, head: end))
        |> realign
      Outcome(
        editor:,
        sync: Press(Some(field_buffer(editor)), x:, y:),
        requests: [],
      )
    }
    ShiftPointed(row:, visible:, at_end:, shown:, x:, y:) -> {
      let from = base(editor, shown)
      let #(anchor, _) = buffer.selection(from)
      let head = place(from, row:, visible:, at_end:)
      let editor =
        Editor(..editor, focus: Focused, press: Some(PressedAt(anchor)))
        |> edit(buffer.select(from, anchor:, head:))
        |> realign
      Outcome(
        editor:,
        sync: Press(Some(field_buffer(editor)), x:, y:),
        requests: [],
      )
    }
    Grabbed(row:, visible:, at_end:, x:, y:) -> {
      let at = place(editor.buffer, row:, visible:, at_end:)
      Outcome(
        editor: Editor(..editor, press: Some(PressedAt(at))),
        sync: Press(None, x:, y:),
        requests: [],
      )
    }
    Dragged(row:, visible:, at_end:) ->
      case editor.press {
        Some(press) -> {
          let at = place(editor.buffer, row:, visible:, at_end:)
          let #(anchor, head) = stretch(editor.buffer, press, to: at)
          let dragged =
            Editor(..editor, focus: Focused)
            |> edit(buffer.select(editor.buffer, anchor:, head:))
            |> realign
          let sync = case
            editor.focus,
            field_buffer(dragged) == field_buffer(editor)
          {
            Away, _ -> Write(field_buffer(dragged))
            Focused, True -> InSync
            Focused, False -> WriteQuietly(field_buffer(dragged))
          }
          Outcome(editor: dragged, sync:, requests: [])
        }
        None -> Outcome(editor:, sync: InSync, requests: [])
      }
    Released ->
      Outcome(
        editor: Editor(..editor, press: None, dragging: False),
        sync: InSync,
        requests: [],
      )
    DragStarted ->
      Outcome(
        editor: Editor(..editor, dragging: True),
        sync: InSync,
        requests: [],
      )
    Dropped(row:, visible:, at_end:, text:, copy:, shown:) -> {
      let let_go = Editor(..editor, dragging: False)
      case mode(editor) {
        Normal -> Outcome(editor: let_go, sync: InSync, requests: [])
        Plain | Insert -> {
          let base = base(editor, shown)
          let at = place(base, row:, visible:, at_end:)
          let dropped = case editor.dragging && !copy {
            True -> buffer.move_selection(base, to: at)
            False ->
              buffer.replace(base, from: at, to: at, with: text)
              |> fn(put) {
                buffer.select(put, anchor: at, head: buffer.cursor(put))
              }
          }
          let editor =
            Editor(..let_go, focus: Focused) |> edit(dropped) |> realign
          Outcome(editor:, sync: Write(field_buffer(editor)), requests: [])
        }
      }
    }
    FocusChanged(focused:) -> {
      let #(focus, press) = case focused {
        True -> #(Focused, editor.press)
        False -> #(Away, None)
      }
      let changed = Editor(..editor, focus:, press:) |> edit(editor.buffer)
      let changed = case focus {
        Away -> changed
        Focused -> realign(changed)
      }
      let sync = case field_buffer(changed) == field_buffer(editor) {
        True -> InSync
        False -> Write(field_buffer(changed))
      }
      Outcome(editor: changed, sync:, requests: [])
    }
  }
}

/// The anchor and head of a drag from a press to `at`.
fn stretch(in: Buffer, press: Press, to at: Position) -> #(Position, Position) {
  case press {
    PressedAt(from) -> #(from, at)
    PressedOnWord(start:, end:) ->
      case buffer.compare(at, start), buffer.compare(at, end) {
        order.Lt, _ -> #(end, buffer.word_at(in, at).0)
        _, order.Gt -> #(start, buffer.word_at(in, at).1)
        order.Eq, _ | order.Gt, order.Lt | order.Gt, order.Eq -> #(start, end)
      }
  }
}

fn place(
  in: Buffer,
  row row: Int,
  visible visible: String,
  at_end at_end: Bool,
) -> Position {
  live.position(buffer.lines(in), row:, visible:, at_end:)
}

fn typed(
  editor: Editor,
  shown: Buffer,
  key: Option(vim.Key),
  place: fn(Editor) -> Editor,
) -> Outcome {
  let base = base(editor, shown)
  let #(keys, wanted, requests) = case key, editor.keys {
    Some(key), VimKeys(state) -> {
      let Step(state:, buffer:, requests:) = vim.press(state, base, key)
      #(VimKeys(state), buffer, requests)
    }
    _, _ -> #(editor.keys, base, [])
  }
  let editor = Editor(..editor, keys:) |> edit(wanted) |> place
  let wanted_shown = field_buffer(editor)
  let sync = case wanted_shown == shown {
    True -> InSync
    False -> Write(wanted_shown)
  }
  Outcome(editor:, sync:, requests:)
}

/// An IME redraws its own text in the control, so the control is not
/// written to, and the blocks around the field stay as they were drawn.
fn compose(editor: Editor, shown: Buffer) -> Outcome {
  let composed = base(editor, shown)
  let rows_kept =
    list.length(buffer.lines(composed))
    == list.length(buffer.lines(editor.buffer))
  case editor.field, rows_kept {
    Part(rows:, drawn:, parsed:, ..), True -> {
      let field = Part(rows:, drawn:, parsed:, composing: True)
      Outcome(
        editor: Editor(..editor, buffer: composed, field:),
        sync: InSync,
        requests: [],
      )
    }
    Part(rows:, drawn:, ..), False -> {
      let count = list.length(buffer.lines(shown))
      let held = Region(rows.first_row, rows.first_row + count - 1)
      let drawn = live.shift(drawn, from: rows, to: held)
      typed(editor, shown, None, hold(_, held, drawn))
    }
    Whole, _ -> typed(editor, shown, None, fn(editor) { editor })
  }
}

fn cross(editor: Editor, edge: Edge, x: Float, shown: Buffer) -> Outcome {
  let base = base(editor, shown)
  let cursor = buffer.cursor(base)
  let lines = buffer.lines(base)
  let end_of_row = fn(row) {
    let line = list.drop(lines, row) |> list.first
    Position(row:, col: string.length(result_or_empty(line)))
  }
  let live = editor.field != Whole
  let row_above = live && cursor.row > 0
  let row_below = live && cursor.row < list.length(lines) - 1
  let #(anchor, _) = buffer.selection(base)
  let reach = fn(head) { #(buffer.select(base, anchor:, head:), None) }
  let start = Position(row: 0, col: 0)
  let end = end_of_row(list.length(lines) - 1)
  let #(wanted, aim) = case edge {
    Up if row_above -> #(
      buffer.move_to(base, end_of_row(cursor.row - 1)),
      Some(LastLine),
    )
    Down if row_below -> #(
      buffer.move_to(base, Position(row: cursor.row + 1, col: 0)),
      Some(FirstLine),
    )
    JoinBefore if row_above -> {
      let from = end_of_row(cursor.row - 1)
      let to = Position(row: cursor.row, col: 0)
      #(buffer.replace(base, from:, to:, with: ""), None)
    }
    JoinAfter if row_below -> {
      let from = end_of_row(cursor.row)
      let to = Position(row: cursor.row + 1, col: 0)
      #(buffer.replace(base, from:, to:, with: ""), None)
    }
    Up if live && anchor != cursor -> #(buffer.move_to(base, start), None)
    Down if live && anchor != cursor -> #(buffer.move_to(base, end), None)
    SelectUp if row_above -> #(
      buffer.select(base, anchor:, head: end_of_row(cursor.row - 1)),
      Some(LastLine),
    )
    SelectDown if row_below -> #(
      buffer.select(base, anchor:, head: Position(row: cursor.row + 1, col: 0)),
      Some(FirstLine),
    )
    SelectUp if live -> reach(start)
    SelectDown if live -> reach(end)
    SelectBefore if row_above -> reach(end_of_row(cursor.row - 1))
    SelectAfter if row_below -> reach(Position(row: cursor.row + 1, col: 0))
    SelectToStart -> reach(start)
    SelectToEnd -> reach(end)
    SelectAll -> #(buffer.select(base, anchor: start, head: end), None)
    Up
    | Down
    | JoinBefore
    | JoinAfter
    | SelectUp
    | SelectDown
    | SelectBefore
    | SelectAfter -> #(base, None)
  }
  let editor = edit(editor, wanted) |> realign
  let wanted_shown = field_buffer(editor)
  let sync = case aim, wanted_shown == shown {
    Some(line), _ -> WriteAndAim(wanted_shown, x:, line:)
    None, True -> InSync
    None, False -> Write(wanted_shown)
  }
  Outcome(editor:, sync:, requests: [])
}

fn result_or_empty(line: Result(String, Nil)) -> String {
  case line {
    Ok(line) -> line
    Error(Nil) -> ""
  }
}

fn base(editor: Editor, shown: Buffer) -> Buffer {
  let seen = widen(editor, shown)
  case mode(editor) {
    Plain | Insert -> seen
    Normal -> with_selection_of(editor.buffer, seen)
  }
}

fn widen(editor: Editor, shown: Buffer) -> Buffer {
  case editor.field {
    Whole -> shown
    Part(rows: Region(first_row:, last_row:), ..) -> {
      let #(anchor, head) = buffer.selection(shown)
      let down = fn(position: Position) {
        Position(..position, row: position.row + first_row)
      }
      let last_line =
        buffer.lines(editor.buffer) |> list.drop(last_row) |> list.first
      editor.buffer
      |> buffer.replace(
        from: Position(row: first_row, col: 0),
        to: Position(
          row: last_row,
          col: string.length(result_or_empty(last_line)),
        ),
        with: buffer.text(shown),
      )
      |> buffer.select(anchor: down(anchor), head: down(head))
    }
  }
}

pub fn field_buffer(editor: Editor) -> Buffer {
  case editor.field {
    Whole -> editor.buffer
    Part(rows: Region(first_row:, last_row:), ..) -> {
      let #(anchor, head) = buffer.selection(editor.buffer)
      let up = fn(position: Position) {
        Position(..position, row: position.row - first_row)
      }
      buffer.lines(editor.buffer)
      |> list.drop(first_row)
      |> list.take(last_row - first_row + 1)
      |> string.join("\n")
      |> buffer.from_text
      |> buffer.select(anchor: up(anchor), head: up(head))
    }
  }
}

fn edit(editor: Editor, buffer: Buffer) -> Editor {
  let field = case editor.field {
    Whole -> Whole
    Part(rows:, drawn:, parsed:, composing:) -> {
      let before = buffer.lines(editor.buffer)
      let after = buffer.lines(buffer)
      let parsed = case before == after && !composing {
        True -> parsed
        False -> parse(buffer)
      }
      let drawn = case editor.focus, typed_on(editor.buffer, buffer) {
        Focused, Ok(#(from, to)) if from == to -> drawn
        Focused, Ok(#(from, to)) -> live.shift(drawn, from:, to:)
        Focused, Error(Nil) | Away, _ -> parsed
      }
      Part(rows:, drawn:, parsed:, composing: False)
    }
  }
  Editor(..editor, buffer:, field:)
}

/// The page keeps how it was laid out through an edit that leaves the
/// caret on its row: typing on that row, or joining it to the row above
/// or below. Every other edit, and every move to another row, lays it out
/// again. On a join the rows below move up as they are. This gives the
/// rows the edit took and the rows that took their place, which the page
/// shifts by.
fn typed_on(old: Buffer, new: Buffer) -> Result(#(Region, Region), Nil) {
  let #(old_anchor, old_head) = buffer.selection(old)
  let #(new_anchor, new_head) = buffer.selection(new)
  let before = buffer.lines(old)
  let after = buffer.lines(new)
  let old_count = list.length(before)
  let new_count = list.length(after)
  let same = common(before, after, 0, int.min(old_head.row, new_head.row))
  let tail =
    common(
      list.reverse(before),
      list.reverse(after),
      0,
      int.min(old_count - old_head.row, new_count - new_head.row) - 1,
    )
  let from = Region(same, old_count - tail - 1)
  let to = Region(same, new_count - tail - 1)
  let one_row = from.last_row == same && to.last_row == same
  let joined = case from.last_row == same + 1 && to.last_row == same {
    True ->
      case list.drop(before, same), list.drop(after, same) {
        [upper, lower, ..], [line, ..] -> line == upper <> lower
        _, _ -> False
      }
    False -> False
  }
  case
    old_anchor.row == old_head.row
    && new_anchor.row == new_head.row
    && { one_row || joined }
  {
    True -> Ok(#(from, to))
    False -> Error(Nil)
  }
}

/// How many of the first lines of both are the same, up to `limit`.
fn common(
  lines: List(String),
  others: List(String),
  count: Int,
  limit: Int,
) -> Int {
  case lines, others {
    [line, ..lines], [other, ..others] if line == other && count < limit ->
      common(lines, others, count + 1, limit)
    _, _ -> count
  }
}

fn parse(buffer: Buffer) -> List(Block) {
  markdown.parse(buffer.text(buffer))
}

fn realign(editor: Editor) -> Editor {
  case editor.field {
    Whole -> editor
    Part(drawn:, parsed:, composing:, ..) -> {
      let #(anchor, head) = buffer.selection(editor.buffer)
      let rows = live.reveal(drawn, from: anchor.row, to: head.row)
      Editor(..editor, field: Part(rows:, drawn:, parsed:, composing:))
    }
  }
}

/// An IME owns the field it composes in, so the field keeps the rows it
/// shows, and the page around it stays as it was drawn.
fn hold(editor: Editor, rows: Region, drawn: List(Block)) -> Editor {
  case editor.field {
    Whole -> editor
    Part(parsed:, composing:, ..) ->
      Editor(..editor, field: Part(rows:, drawn:, parsed:, composing:))
  }
}

/// Ticks or unticks a box drawn on the page. The page keeps how it was laid
/// out but for the box. A box the text no longer has changes nothing.
pub fn tick(editor: Editor, task: markdown.Task, checked: Bool) -> Outcome {
  let text = buffer.text(editor.buffer)
  case
    markdown.set_task(text, task, checked),
    list.drop(buffer.lines(editor.buffer), task.row)
  {
    Ok(line), [old, ..] -> {
      let buffer =
        editor.buffer
        |> buffer.replace(
          from: Position(row: task.row, col: 0),
          to: Position(row: task.row, col: string.length(old)),
          with: line,
        )
        |> with_selection_of(editor.buffer)
      let before = field_buffer(editor)
      let ticked = edit(editor, buffer)
      let ticked = case editor.field, ticked.field {
        Part(drawn:, ..), Part(rows:, parsed:, composing:, ..) ->
          Editor(
            ..ticked,
            field: Part(
              rows:,
              drawn: live.tick(drawn, task, checked),
              parsed:,
              composing:,
            ),
          )
        _, _ -> ticked
      }
      let editor = realign(ticked)
      let sync = case field_buffer(editor) == before {
        True -> InSync
        False -> WriteQuietly(field_buffer(editor))
      }
      Outcome(editor:, sync:, requests: [])
    }
    _, _ -> Outcome(editor:, sync: InSync, requests: [])
  }
}

fn with_selection_of(buffer: Buffer, other: Buffer) -> Buffer {
  let #(anchor, head) = buffer.selection(other)
  buffer.select(buffer, anchor:, head:)
}

pub fn buffer(editor: Editor) -> Buffer {
  editor.buffer
}

pub fn text(editor: Editor) -> String {
  buffer.text(editor.buffer)
}

pub fn region(editor: Editor) -> Option(Region) {
  case editor.field {
    Whole -> None
    Part(rows:, ..) -> Some(rows)
  }
}

/// How the field is set: like its blocks as drawn, so that typing changes
/// no row but the one typed on. A field that holds only the caret's row is
/// set as typed, at once: like the blocks typed there, or as body text when
/// that row joins a block outside the field. None while the field holds
/// the whole note.
pub fn kind(editor: Editor) -> Option(live.Kind) {
  case editor.field {
    Whole -> None
    Part(rows:, drawn:, parsed:, ..) -> {
      let lines = buffer.lines(editor.buffer)
      let row = buffer.cursor(editor.buffer).row
      let alone = rows == Region(row, row)
      let own = live.reveal(parsed, from: row, to: row) == rows
      Some(case alone, own {
        True, True -> live.kind(parsed, field: rows, lines:)
        True, False -> live.Body
        False, _ -> live.kind(drawn, field: rows, lines:)
      })
    }
  }
}

/// The kind of the field's rows as the page was laid out. The field keeps
/// their height and margins while a row is typed as another kind, so the
/// page around it does not move. None while the field holds the whole note.
pub fn frame(editor: Editor) -> Option(live.Kind) {
  case editor.field {
    Whole -> None
    Part(rows:, drawn:, ..) ->
      Some(live.kind(drawn, field: rows, lines: buffer.lines(editor.buffer)))
  }
}

/// The page as laid out, drawn around the field. Empty while the field
/// holds the whole note.
pub fn blocks(editor: Editor) -> List(Block) {
  case editor.field {
    Whole -> []
    Part(drawn:, ..) -> drawn
  }
}

pub fn is_idle(editor: Editor) -> Bool {
  editor.field != Whole && editor.focus == Away
}

pub fn row_count(editor: Editor) -> Int {
  list.length(buffer.lines(editor.buffer))
}

pub fn mode(editor: Editor) -> Mode {
  case editor.keys {
    PlainKeys -> Plain
    VimKeys(state) ->
      case vim.mode(state) {
        vim.Normal -> Normal
        vim.Insert -> Insert
      }
  }
}

/// A key must be cancelled before `update` runs, so `surface` asks from
/// inside its keydown decoder.
pub fn claims(editor: Editor, key: vim.Key) -> Bool {
  case editor.keys {
    PlainKeys -> False
    VimKeys(state) -> vim.claims(vim.mode(state), key)
  }
}
