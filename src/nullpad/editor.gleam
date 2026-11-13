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
  Editor(buffer: Buffer, keys: Keys, field: Field, focused: Bool)
}

type Field {
  Whole
  /// Invariants: the rows exist in `buffer`, and `blocks` is the text of
  /// `buffer` parsed. While `composing`, `blocks` is the text from before
  /// the composition, which differs only inside `rows`.
  Part(rows: Region, blocks: List(Block), composing: Bool)
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
      True -> Part(Region(0, 0), parse(buffer), composing: False)
      False -> Whole
    },
    focused: False,
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
  Editor(..editor, keys:)
  |> edit(buffer.from_text(text))
  |> realign
  |> write_and_focus
}

fn write_and_focus(editor: Editor) -> Outcome {
  let editor = Editor(..editor, focused: True)
  Outcome(editor:, sync: Write(field_buffer(editor)), requests: [])
}

pub fn set_live(editor: Editor, on: Bool) -> Outcome {
  let editor = case on {
    True ->
      Editor(
        ..editor,
        field: Part(Region(0, 0), parse(editor.buffer), composing: False),
      )
      |> realign
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
          let editor = Editor(..outcome.editor, focused: False)
          Outcome(..outcome, editor:, sync: Release(field_buffer(editor)))
        }
      }
    }
    Pointed(row:, visible:, at_end:) -> {
      let lines = buffer.lines(editor.buffer)
      let position = live.position(lines, row:, visible:, at_end:)
      edit(editor, buffer.move_to(editor.buffer, position))
      |> realign
      |> write_and_focus
    }
    ShiftPointed(..) | Dragged(..) | Released ->
      Outcome(editor:, sync: InSync, requests: [])
    FocusChanged(focused:) ->
      Outcome(editor: Editor(..editor, focused:), sync: InSync, requests: [])
  }
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
    Part(rows:, blocks:, ..), True -> {
      let field = Part(rows:, blocks:, composing: True)
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
    Up
    | Down
    | JoinBefore
    | JoinAfter
    | SelectUp
    | SelectDown
    | SelectBefore
    | SelectAfter
    | SelectToStart
    | SelectToEnd
    | SelectAll -> #(base, None)
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
    Part(rows:, blocks:, composing:) -> {
      let parsed =
        !composing
        && same_lines(buffer.lines(buffer), buffer.lines(editor.buffer))
      case parsed {
        True -> Part(rows:, blocks:, composing: False)
        False -> Part(rows:, blocks: parse(buffer), composing: False)
      }
    }
  }
  Editor(..editor, buffer:, field:)
}

fn parse(buffer: Buffer) -> List(Block) {
  markdown.parse(buffer.text(buffer))
}

fn same_lines(lines: List(String), others: List(String)) -> Bool {
  case lines, others {
    [], [] -> True
    [line, ..lines], [other, ..others] if line == other ->
      same_lines(lines, others)
    _, _ -> False
  }
}

fn realign(editor: Editor) -> Editor {
  case editor.field {
    Whole -> editor
    Part(blocks:, composing:, ..) -> {
      let #(anchor, head) = buffer.selection(editor.buffer)
      let rows = live.reveal(blocks, from: anchor.row, to: head.row)
      Editor(..editor, field: Part(rows:, blocks:, composing:))
    }
  }
}

fn hold_rows(editor: Editor, shown: Buffer) -> Editor {
  case editor.field {
    Whole -> editor
    Part(rows: Region(first_row:, ..), blocks:, composing:) -> {
      let count = list.length(buffer.lines(shown))
      let rows = Region(first_row:, last_row: first_row + count - 1)
      Editor(..editor, field: Part(rows:, blocks:, composing:))
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
      let editor = edit(editor, buffer)
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

/// Empty while the control holds the note.
pub fn blocks(editor: Editor) -> List(Block) {
  case editor.field {
    Whole -> []
    Part(blocks:, ..) -> blocks
  }
}

pub fn is_idle(editor: Editor) -> Bool {
  editor.field != Whole && !editor.focused
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
