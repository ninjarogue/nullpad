//// Imported by: `surface`, the app shell, tests. Imports: `buffer`, `vim`,
//// `live`, `markdown`.

import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import nullpad/buffer.{type Buffer, type Position, Position}
import nullpad/live.{type Region, Region}
import nullpad/markdown.{type Block}
import nullpad/vim.{Step}

/// Every change to `buffer` goes through `edit` or `compose`.
pub opaque type Editor {
  Editor(buffer: Buffer, keys: Keys, field: Field, focus: Focus)
}

type Focus {
  Away
  Focused
  /// Focused, and a mouse press the editor took is held: moves select.
  Pressing
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

/// What an edit changed, by the rows the field holds.
type Change {
  Unchanged
  Inside
  /// The number of rows, or a row the field does not hold.
  Outside
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
  Pointed(row: Int, visible: String, at_end: Bool)
  /// Shift and a press: the head moves there and the anchor stays where
  /// `shown`, the field as it is now, has it.
  ShiftPointed(row: Int, visible: String, at_end: Bool, shown: Buffer)
  Dragged(row: Int, visible: String, at_end: Bool)
  Released
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
    Pointed(row:, visible:, at_end:) -> {
      let lines = buffer.lines(editor.buffer)
      let position = live.position(lines, row:, visible:, at_end:)
      Editor(..editor, focus: Pressing)
      |> edit(buffer.move_to(editor.buffer, position))
      |> realign
      |> write
    }
    ShiftPointed(row:, visible:, at_end:, shown:) ->
      Editor(..editor, focus: Pressing)
      |> reach(base(editor, shown), row:, visible:, at_end:)
      |> write
    Dragged(row:, visible:, at_end:) ->
      case editor.focus {
        Pressing -> {
          let dragged = reach(editor, editor.buffer, row:, visible:, at_end:)
          let sync = case field_buffer(dragged) == field_buffer(editor) {
            True -> InSync
            False -> WriteQuietly(field_buffer(dragged))
          }
          Outcome(editor: dragged, sync:, requests: [])
        }
        Away | Focused -> Outcome(editor:, sync: InSync, requests: [])
      }
    Released -> {
      let focus = case editor.focus {
        Pressing | Focused -> Focused
        Away -> Away
      }
      Outcome(editor: Editor(..editor, focus:), sync: InSync, requests: [])
    }
    FocusChanged(focused:) -> {
      let focus = case focused, editor.focus {
        False, Away | False, Focused | False, Pressing -> Away
        True, Pressing -> Pressing
        True, Away | True, Focused -> Focused
      }
      let changed = Editor(..editor, focus:) |> edit(editor.buffer)
      let changed = case focus {
        Away -> changed
        Focused | Pressing -> realign(changed)
      }
      let sync = case field_buffer(changed) == field_buffer(editor) {
        True -> InSync
        False -> Write(field_buffer(changed))
      }
      Outcome(editor: changed, sync:, requests: [])
    }
  }
}

/// Moves the head of `from`'s selection to a place on the drawn page, and
/// keeps its anchor.
fn reach(
  editor: Editor,
  from: Buffer,
  row row: Int,
  visible visible: String,
  at_end at_end: Bool,
) -> Editor {
  let head = live.position(buffer.lines(from), row:, visible:, at_end:)
  let #(anchor, _) = buffer.selection(from)
  edit(editor, buffer.select(from, anchor:, head:)) |> realign
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
    Part(..), False | Whole, _ ->
      typed(editor, shown, None, hold_rows(_, shown))
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
      let change =
        change(
          buffer.lines(editor.buffer),
          buffer.lines(buffer),
          rows,
          0,
          Unchanged,
        )
      let parsed = case change, composing {
        Unchanged, False -> parsed
        Unchanged, True | Inside, _ | Outside, _ -> parse(buffer)
      }
      let kept =
        change != Outside
        && editor.focus != Away
        && selected_rows(editor.buffer) == selected_rows(buffer)
      let drawn = case kept {
        True -> drawn
        False -> parsed
      }
      Part(rows:, drawn:, parsed:, composing: False)
    }
  }
  Editor(..editor, buffer:, field:)
}

fn selected_rows(buffer: Buffer) -> #(Int, Int) {
  let #(anchor, head) = buffer.selection(buffer)
  #(anchor.row, head.row)
}

fn parse(buffer: Buffer) -> List(Block) {
  markdown.parse(buffer.text(buffer))
}

fn change(
  lines: List(String),
  others: List(String),
  rows: Region,
  row: Int,
  found: Change,
) -> Change {
  case lines, others {
    [], [] -> found
    [line, ..lines], [other, ..others] if line == other ->
      change(lines, others, rows, row + 1, found)
    [_, ..lines], [_, ..others]
      if row >= rows.first_row && row <= rows.last_row
    -> change(lines, others, rows, row + 1, Inside)
    _, _ -> Outside
  }
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

fn hold_rows(editor: Editor, shown: Buffer) -> Editor {
  case editor.field {
    Whole -> editor
    Part(rows: Region(first_row:, ..), drawn:, parsed:, composing:) -> {
      let count = list.length(buffer.lines(shown))
      let rows = Region(first_row:, last_row: first_row + count - 1)
      Editor(..editor, field: Part(rows:, drawn:, parsed:, composing:))
    }
  }
}

/// A row that does not exist changes nothing.
pub fn replace_line(editor: Editor, row: Int, with line: String) -> Outcome {
  case list.drop(buffer.lines(editor.buffer), row) {
    [old, ..] if row >= 0 -> {
      let buffer =
        editor.buffer
        |> buffer.replace(
          from: Position(row:, col: 0),
          to: Position(row:, col: string.length(old)),
          with: line,
        )
        |> with_selection_of(editor.buffer)
      let before = field_buffer(editor)
      let editor = edit(editor, buffer) |> realign
      let sync = case field_buffer(editor) == before {
        True -> InSync
        False -> WriteQuietly(field_buffer(editor))
      }
      Outcome(editor:, sync:, requests: [])
    }
    _ -> Outcome(editor:, sync: InSync, requests: [])
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
