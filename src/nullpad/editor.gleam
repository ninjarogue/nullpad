//// The editing session: the buffer, the key mode, and the rule for who wins
//// when the text field ("the control") and the model disagree. Pure Gleam.
////
////   control -> model  every event carries a full snapshot of the control
////                     (`shown`: text + selection), never a delta, so the two
////                     cannot drift.
////   model -> control  `update` returns a `Sync`, computed by comparing what
////                     we want with `shown`. Stateless and safe to apply twice.
////
////
//// In live view the control holds only some rows of the note (`Part`), so
//// `shown` is a slice. It is spliced into the buffer at those rows before
//// anything else looks at it, and what is written back is a slice too.
//// Live view also keeps the note's blocks, parsed once for each change to
//// its text, for the page to be drawn from.
////
//// Imported by: `surface`, the app shell, tests. Imports: `buffer`, `vim`,
//// `live`, `markdown`.

import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import nullpad/buffer.{type Buffer, type Position, Position}
import nullpad/live.{type Region, Region}
import nullpad/markdown.{type Block}
import nullpad/vim.{Step}

/// Every change to `buffer` goes through `edit`.
pub opaque type Editor {
  Editor(buffer: Buffer, keys: Keys, field: Field, focused: Bool)
}

/// What the control holds.
type Field {
  Whole
  /// Live view: these rows only. Invariants: the rows exist in `buffer`, and
  /// `blocks` is the text of `buffer` parsed.
  Part(rows: Region, blocks: List(Block))
}

type Keys {
  /// Vim off (phones, or the setting): the control does all the typing.
  PlainKeys
  VimKeys(vim.State)
}

/// What the view needs to know. `Plain` means vim is off.
pub type Mode {
  Plain
  Normal
  Insert
}

/// Something happened in the control. Built only by `surface`'s decoders.
pub type Event {
  /// The user typed, pasted, composed with an IME or moved the selection.
  ControlChanged(shown: Buffer)
  /// The same, in the middle of an IME composition. The control must not be
  /// written to until it ends, so the rows it holds stay as they are.
  Composing(shown: Buffer)
  /// A key that `claims` accepted. Its default action was cancelled, so
  /// `shown` is the control exactly as it is now.
  KeyPressed(key: vim.Key, shown: Buffer)
  /// A key at the edge of the control it would leave by. Its default action
  /// was cancelled: `update` crosses to the row past that edge if live view
  /// has one, and otherwise moves the caret as the key itself would have.
  /// `x` is how far the caret is from the control's left edge, in pixels.
  EdgePressed(edge: Edge, x: Float, shown: Buffer)
  /// Escape, outside an IME composition. In live view it ends editing, so
  /// the whole note is drawn.
  EscapePressed(shown: Buffer)
  /// Live view: a press on the drawn page (see `live.position`).
  Pointed(row: Int, visible: String, at_end: Bool)
  FocusChanged(focused: Bool)
}

pub type Edge {
  /// Arrow up on the control's first line, arrow down on its last.
  Up
  Down
  /// Backspace at the control's start, Delete at its end.
  JoinBefore
  JoinAfter
}

/// What `surface.sync` must do to the control after an update.
pub type Sync {
  InSync
  /// Write, and give the control the keyboard.
  Write(Buffer)
  /// Write, and leave the keyboard where it is: a ticked box is not a
  /// reason to start editing.
  WriteQuietly(Buffer)
  /// Write, then put the caret on the first or last drawn line of the
  /// control, as near to `x` pixels from its left edge as a character allows.
  WriteAndAim(Buffer, x: Float, line: Line)
  /// Write, and take the keyboard from the control: nothing is being edited.
  Release(Buffer)
}

pub type Line {
  FirstLine
  LastLine
}

/// The result of every editor operation. Returning `sync` from all of them
/// means pushing a change to the control cannot be forgotten without visibly
/// ignoring a value.
pub type Outcome {
  Outcome(editor: Editor, sync: Sync, requests: List(vim.Request))
}

pub fn new(vim vim_enabled: Bool, live live: Bool) -> Editor {
  let buffer = buffer.from_text("")
  Editor(
    buffer:,
    keys: fresh_keys(vim_enabled),
    field: case live {
      True -> Part(Region(0, 0), parse(buffer))
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

/// A note was loaded: replace the text, cursor at the start, fresh vim state.
/// Always asks for a `Write`.
pub fn open(editor: Editor, text: String) -> Outcome {
  let keys = fresh_keys(editor.keys != PlainKeys)
  Editor(..editor, keys:)
  |> edit(buffer.from_text(text))
  |> realign
  |> write_and_focus
}

/// A `Write` gives the control the keyboard, so the editor counts as in
/// focus from now, before the browser says so. The field is then drawn in
/// its block before it takes the keyboard, and the browser has no reason to
/// scroll to where an idle field sits, under the whole note.
fn write_and_focus(editor: Editor) -> Outcome {
  let editor = Editor(..editor, focused: True)
  Outcome(editor:, sync: Write(field_buffer(editor)), requests: [])
}

/// Turn live view on or off, keeping the text and the cursor.
pub fn set_live(editor: Editor, on: Bool) -> Outcome {
  let editor = case on {
    True ->
      Editor(..editor, field: Part(Region(0, 0), parse(editor.buffer)))
      |> realign
    False -> Editor(..editor, field: Whole)
  }
  write_and_focus(editor)
}

/// Turn vim on or off, keeping the text.
pub fn set_vim(editor: Editor, enabled: Bool) -> Outcome {
  let editor = case editor.keys, enabled {
    PlainKeys, False | VimKeys(_), True -> editor
    _, _ -> Editor(..editor, keys: fresh_keys(enabled))
  }
  Outcome(editor:, sync: InSync, requests: [])
}

/// The whole editing rule:
/// 0. Live view only: splice the control's rows into the buffer. From here
///    on `seen` is the whole note as the control shows it.
/// 1. Whose text wins? Plain / Insert: the control's, `base = seen`.
///    Normal: ours, `base` = our buffer with the control's selection (the
///    control is read-only then, so its text should match anyway).
/// 2. `KeyPressed` with vim on: `vim.press(state, base, key)` gives the
///    wanted buffer and any requests. Otherwise `wanted = base`.
/// 3. Live view only: the control's rows become the blocks the selection
///    touches now.
/// 4. `sync` is `InSync` when the control already shows what it should.
///
/// Guarantee (tested): with the whole note in the control, in Plain and
/// Insert, `ControlChanged` always gives `InSync`. We never answer the user's
/// typing with a write. That is what keeps IME composition, autocorrect and
/// the phone's native undo intact. In live view the control is rewritten
/// when the cursor's block changes, but never during a composition.
/// Idempotent: the same event twice gives the same editor.
pub fn update(editor: Editor, event: Event) -> Outcome {
  case event {
    ControlChanged(shown:) -> typed(editor, shown, None, realign)
    Composing(shown:) -> typed(editor, shown, None, hold_rows(_, shown))
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
    Up -> #(buffer.move_to(base, Position(row: cursor.row, col: 0)), None)
    Down -> #(buffer.move_to(base, end_of_row(cursor.row)), None)
    JoinBefore | JoinAfter -> #(base, None)
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

/// Steps 0 and 1 of `update`: the note an event acts on.
fn base(editor: Editor, shown: Buffer) -> Buffer {
  let seen = widen(editor, shown)
  case mode(editor) {
    Plain | Insert -> seen
    Normal -> with_selection_of(editor.buffer, seen)
  }
}

/// The whole note, given what the control shows.
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

/// What the control should show: the whole buffer, or its rows in live view.
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
    Part(rows:, blocks:) ->
      case same_lines(buffer.lines(buffer), buffer.lines(editor.buffer)) {
        True -> Part(rows:, blocks:)
        False -> Part(rows:, blocks: parse(buffer))
      }
  }
  Editor(..editor, buffer:, field:)
}

fn parse(buffer: Buffer) -> List(Block) {
  markdown.parse(buffer.text(buffer))
}

/// `==` on two lists walks them generically, about forty times slower than
/// comparing the lines as strings.
fn same_lines(lines: List(String), others: List(String)) -> Bool {
  case lines, others {
    [], [] -> True
    [line, ..lines], [other, ..others] if line == other ->
      same_lines(lines, others)
    _, _ -> False
  }
}

/// Live view: make the control's rows the blocks the selection touches.
fn realign(editor: Editor) -> Editor {
  case editor.field {
    Whole -> editor
    Part(blocks:, ..) -> {
      let #(anchor, head) = buffer.selection(editor.buffer)
      let rows = live.reveal(blocks, from: anchor.row, to: head.row)
      Editor(..editor, field: Part(rows:, blocks:))
    }
  }
}

/// Live view, mid-composition: keep the control's first row, and follow only
/// the number of rows it holds now.
fn hold_rows(editor: Editor, shown: Buffer) -> Editor {
  case editor.field {
    Whole -> editor
    Part(rows: Region(first_row:, ..), blocks:) -> {
      let count = list.length(buffer.lines(shown))
      let rows = Region(first_row:, last_row: first_row + count - 1)
      Editor(..editor, field: Part(rows:, blocks:))
    }
  }
}

/// Replace one line from outside the control. A row that does not exist
/// changes nothing.
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

/// What the preview and storage read.
pub fn text(editor: Editor) -> String {
  buffer.text(editor.buffer)
}

/// Live view: the rows the control holds. `None` when it holds the note.
pub fn region(editor: Editor) -> Option(Region) {
  case editor.field {
    Whole -> None
    Part(rows:, ..) -> Some(rows)
  }
}

/// Live view: the note's blocks, parsed once for each change to its text.
/// Empty while the control holds the note, since nothing draws it then.
pub fn blocks(editor: Editor) -> List(Block) {
  case editor.field {
    Whole -> []
    Part(blocks:, ..) -> blocks
  }
}

/// Live view with the control out of focus: nothing is being edited, so the
/// whole note is drawn.
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

/// Does the editor want this key instead of the browser? `surface` asks from
/// inside its keydown decoder, because a key must be cancelled before
/// `update` runs. Always False with vim off.
pub fn claims(editor: Editor, key: vim.Key) -> Bool {
  case editor.keys {
    PlainKeys -> False
    VimKeys(state) -> vim.claims(vim.mode(state), key)
  }
}
