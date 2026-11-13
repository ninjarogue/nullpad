//// Imported by: `surface`, the app shell, tests. Imports: `buffer`, `vim`,
//// `live`, `markdown`, `history`.

import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import nullpad/buffer.{type Buffer, type Position, Position}
import nullpad/history.{type History}
import nullpad/live.{type Region, Region}
import nullpad/markdown.{type Block}
import nullpad/vim.{Step}

/// Every change to `buffer` goes through `edit` or `compose`. `edit`
/// records it in `history`.
///
/// `waiting` holds the steps up or down on the drawn page that the page has
/// not placed yet. Only the first is asked for, so each step is measured on
/// a page that shows the step before it.
pub opaque type Editor {
  /// `press` is where a mouse press the editor took is held: a drag selects
  /// from there.
  Editor(
    buffer: Buffer,
    keys: Keys,
    field: Field,
    focus: Focus,
    history: History,
    clock: Int,
    press: Option(Position),
    paints: Bool,
    goal: Option(Goal),
    waiting: List(Move),
  )
}

/// A step of the head on the drawn page: a line, or a window with `page`.
/// Without `select` the anchor goes with the head.
type Move {
  Move(up: Bool, page: Bool, select: Bool)
}

/// Where a run of steps up or down aims on the drawn page: `x` from the left
/// of the text, for as long as the head stays at `head`, where the last step
/// put it.
type Goal {
  Goal(head: Position, x: Float)
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
  /// from `drawn`: `rows` is `drawn` revealed around the selection, or the
  /// whole note while it is `wide`, for a key the browser acts on. Out of
  /// focus, and while a composition that added or took rows, `rows` stay
  /// the rows the field shows: a blurred field is left as it is, so the
  /// browser can give it the focus back, and an IME owns the field it
  /// composes in.
  Part(
    rows: Region,
    drawn: List(Block),
    parsed: List(Block),
    composing: Bool,
    wide: Bool,
  )
}

/// What the surface does after a key at the edge of the field.
type Then {
  Done
  ByLine(up: Bool)
  Aim(Line)
  StepTo(Move)
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
  ControlChanged(shown: Buffer, at: Int)
  /// In the middle of an IME composition: the control must not be written
  /// to until it ends.
  Composing(shown: Buffer)
  KeyPressed(key: vim.Key, shown: Buffer)
  EdgePressed(edge: Edge, x: Float, shown: Buffer)
  EscapePressed(shown: Buffer)
  /// A press at a place on the page, at `x`, `y` in the window.
  Pointed(
    row: Int,
    visible: String,
    at_end: Bool,
    next: String,
    x: Float,
    y: Float,
  )
  /// Shift and a press: the head moves there and the anchor stays where
  /// `shown`, the field as it is now, has it.
  ShiftPointed(
    row: Int,
    visible: String,
    at_end: Bool,
    next: String,
    shown: Buffer,
    x: Float,
    y: Float,
  )
  /// A press on a link or a box, which keeps its click: the caret stays
  /// where it is unless the pointer drags from there.
  Grabbed(
    row: Int,
    visible: String,
    at_end: Bool,
    next: String,
    x: Float,
    y: Float,
  )
  /// The pointer of a held press, once it has moved off the place pressed.
  Dragged(row: Int, visible: String, at_end: Bool, next: String)
  /// Shift and an arrow up or down, taken by the surface: the head moves to
  /// the place on the drawn page found `x` from the left of the text, one
  /// drawn line from where the head was drawn. The anchor stays.
  Stepped(row: Int, visible: String, at_end: Bool, next: String, x: Float)
  /// A step the page had no place for: the head stays where it is, and a
  /// step of a window goes to the start or end of the note.
  Unstepped(x: Float)
  /// The field as an arrow up or down that crossed into it left it, aimed
  /// `x` from the left of the text.
  Aimed(shown: Buffer, x: Float)
  /// Shift and an arrow left or right over a painted selection: the head
  /// moves one character drawn on the page, past the marks it does not draw.
  /// `row` and `visible` are the element the head is drawn in.
  Nudged(forward: Bool, row: Int, visible: String, shown: Buffer)
  Released
  FocusChanged(focused: Bool)
  /// Undo or redo, by a key or the browser's Edit menu. The editor keeps the
  /// history, because the browser's own is lost each time the field is
  /// written.
  UndoAsked
  RedoAsked
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
  /// Page Up or Page Down: the head moves a window up or down the drawn
  /// page.
  Page(up: Bool, select: Bool)
  /// Ctrl and an arrow up or down: the head moves to its column of the row
  /// above or below, as in a text field that holds the markdown, or to the
  /// start or end of the note from its first or last row. Without `select`
  /// it moves from the start of the selection.
  Row(up: Bool, select: Bool)
  /// A key the browser acts on by the text alone, which can take the head
  /// past the field: the field holds the whole note while it does.
  Widen
}

pub type Sync {
  InSync
  Write(Buffer)
  WriteQuietly(Buffer)
  /// Then the head moves to the place nearest `x` on the first or last drawn
  /// line of its row. A selection keeps its anchor.
  WriteAndAim(Buffer, x: Float, line: Line)
  /// Then the head moves to the place on the drawn page nearest `x`, from
  /// the left of the text, one drawn line above or below where it is drawn.
  /// A selection keeps its anchor. A `queued` step waited for the page to
  /// draw the step before it. A `page` step goes a window, not a line.
  WriteAndStep(Buffer, x: Float, up: Bool, page: Bool, queued: Bool)
  /// Then the browser acts on the key, and the field is read once it has.
  WriteAndRead(Buffer)
  /// Then the head moves a line up or down the field as the browser moves
  /// it, which keeps the column for the next line.
  WriteAndMove(Buffer, up: Bool)
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

/// `paint` says whether a selection across blocks can be painted over the
/// drawn page.
pub fn new(
  vim vim_enabled: Bool,
  live live: Bool,
  paint paints: Bool,
) -> Editor {
  let buffer = buffer.from_text("")
  Editor(
    buffer:,
    keys: fresh_keys(vim_enabled),
    field: case live {
      True -> laid_out(buffer)
      False -> Whole
    },
    focus: Away,
    history: history.new(buffer),
    clock: 0,
    press: None,
    paints:,
    goal: None,
    waiting: [],
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
  Editor(..editor, keys:, buffer:, field:, history: history.new(buffer))
  |> realign
  |> write_and_focus
}

fn laid_out(buffer: Buffer) -> Field {
  let blocks = parse(buffer)
  Part(
    rows: Region(0, 0),
    drawn: blocks,
    parsed: blocks,
    composing: False,
    wide: False,
  )
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
    ControlChanged(shown:, at:) ->
      typed(Editor(..editor, clock: at), shown, None, realign)
    Composing(shown:) -> compose(editor, shown)
    KeyPressed(key:, shown:) -> typed(editor, shown, Some(key), realign)
    EdgePressed(edge: Widen, shown:, ..) -> spread(editor, shown)
    EdgePressed(edge:, x:, shown:) -> cross(editor, edge, x, shown)
    EscapePressed(shown:) -> {
      let outcome = typed(editor, shown, None, realign)
      case outcome.editor.field {
        Whole -> outcome
        Part(..) -> {
          let left = outcome.editor.buffer
          let editor =
            Editor(..outcome.editor, focus: Away, waiting: [], goal: None)
            |> edit(buffer.move_to(left, buffer.cursor(left)))
            |> realign
          Outcome(..outcome, editor:, sync: Release(field_buffer(editor)))
        }
      }
    }
    Pointed(row:, visible:, at_end:, next:, x:, y:) -> {
      let at = place(editor.buffer, row:, visible:, at_end:, next:)
      let editor =
        Editor(
          ..editor,
          focus: Focused,
          press: Some(at),
          waiting: [],
          goal: None,
        )
        |> edit(buffer.move_to(editor.buffer, at))
        |> realign
      Outcome(
        editor:,
        sync: Press(Some(field_buffer(editor)), x:, y:),
        requests: [],
      )
    }
    ShiftPointed(row:, visible:, at_end:, next:, shown:, x:, y:) -> {
      let from = base(editor, shown)
      let #(anchor, _) = buffer.selection(from)
      let editor =
        Editor(
          ..editor,
          focus: Focused,
          press: Some(anchor),
          waiting: [],
          goal: None,
        )
        |> reach(from, anchor, row:, visible:, at_end:, next:)
      Outcome(
        editor:,
        sync: Press(Some(field_buffer(editor)), x:, y:),
        requests: [],
      )
    }
    Grabbed(row:, visible:, at_end:, next:, x:, y:) -> {
      let at = place(editor.buffer, row:, visible:, at_end:, next:)
      Outcome(
        editor: Editor(..editor, press: Some(at)),
        sync: Press(None, x:, y:),
        requests: [],
      )
    }
    Dragged(row:, visible:, at_end:, next:) ->
      case editor.press {
        Some(from) -> {
          let dragged =
            Editor(..editor, focus: Focused)
            |> reach(editor.buffer, from, row:, visible:, at_end:, next:)
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
    Stepped(row:, visible:, at_end:, next:, x:) -> {
      let #(anchor, head) = buffer.selection(editor.buffer)
      let placed = place(editor.buffer, row:, visible:, at_end:, next:)
      let line = case editor.waiting {
        [Move(page: False, ..), ..] -> True
        [Move(page: True, ..), ..] | [] -> False
      }
      // A line step past rows the page does not draw, such as a fence, stops
      // on the first of them, as it does in a text field.
      let placed = case line, placed.row - head.row {
        True, apart if apart > 1 -> Position(row: head.row + 1, col: 0)
        True, apart if apart < -1 -> Position(row: head.row - 1, col: 0)
        _, _ -> placed
      }
      let anchor = case editor.waiting {
        [Move(select: False, ..), ..] -> placed
        [Move(select: True, ..), ..] | [] -> anchor
      }
      let stepped =
        edit(editor, buffer.select(editor.buffer, anchor:, head: placed))
        |> realign
      let goal = Some(Goal(head: buffer.cursor(stepped.buffer), x:))
      next_step(Editor(..stepped, goal:), x)
    }
    Unstepped(x:) ->
      case editor.waiting {
        [Move(up:, page: True, select:), ..] -> {
          let #(anchor, _) = buffer.selection(editor.buffer)
          let head = case up {
            True -> Position(row: 0, col: 0)
            False -> buffer.end_of(buffer.text(editor.buffer))
          }
          let anchor = case select {
            True -> anchor
            False -> head
          }
          editor
          |> edit(buffer.select(editor.buffer, anchor:, head:))
          |> realign
          |> next_step(x)
        }
        [Move(page: False, ..), ..] | [] -> next_step(editor, x)
      }
    Aimed(shown:, x:) -> {
      let outcome = typed(editor, shown, None, realign)
      let head = buffer.cursor(outcome.editor.buffer)
      let editor = Editor(..outcome.editor, goal: Some(Goal(head:, x:)))
      Outcome(..outcome, editor:)
    }
    Nudged(forward:, row:, visible:, shown:) -> {
      let base = base(editor, shown)
      let #(anchor, head) = buffer.selection(base)
      let head =
        live.nudge(buffer.lines(base), row:, visible:, at: head, forward:)
      let editor = edit(editor, buffer.select(base, anchor:, head:)) |> realign
      let sync = case field_buffer(editor) == shown {
        True -> InSync
        False -> Write(field_buffer(editor))
      }
      Outcome(editor:, sync:, requests: [])
    }
    Released ->
      Outcome(editor: Editor(..editor, press: None), sync: InSync, requests: [])
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
    UndoAsked -> travel(editor, history.undo)
    RedoAsked -> travel(editor, history.redo)
  }
}

/// The note goes back to how it was, with its selection, as an edit would
/// take it there.
fn travel(
  editor: Editor,
  through: fn(History) -> Result(History, Nil),
) -> Outcome {
  case through(editor.history) {
    Ok(history) ->
      Editor(..editor, history:)
      |> edit(history.present(history))
      |> realign
      |> write
    Error(Nil) -> Outcome(editor:, sync: InSync, requests: [])
  }
}

fn next_step(editor: Editor, x: Float) -> Outcome {
  let waiting = list.drop(editor.waiting, 1)
  let editor = Editor(..editor, waiting:)
  case waiting {
    [] -> write(editor)
    [Move(up:, page:, ..), ..] -> {
      let sync =
        WriteAndStep(field_buffer(editor), x:, up:, page:, queued: True)
      Outcome(editor:, sync:, requests: [])
    }
  }
}

/// Selects `from` from `anchor` to a place on the drawn page.
fn reach(
  editor: Editor,
  from: Buffer,
  anchor: Position,
  row row: Int,
  visible visible: String,
  at_end at_end: Bool,
  next next: String,
) -> Editor {
  let head = place(from, row:, visible:, at_end:, next:)
  edit(editor, buffer.select(from, anchor:, head:)) |> realign
}

fn place(
  in: Buffer,
  row row: Int,
  visible visible: String,
  at_end at_end: Bool,
  next next: String,
) -> Position {
  live.position(buffer.lines(in), row:, visible:, at_end:, next:)
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
/// Its keys are not steps of the history: the event that ends it records the
/// whole composition as one.
fn compose(editor: Editor, shown: Buffer) -> Outcome {
  let composed = base(editor, shown)
  let rows_kept =
    list.length(buffer.lines(composed))
    == list.length(buffer.lines(editor.buffer))
  case editor.field, rows_kept {
    Part(rows:, drawn:, parsed:, ..), True -> {
      let field = Part(rows:, drawn:, parsed:, composing: True, wide: False)
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
      keep_history(editor, typed(editor, shown, None, hold(_, held, drawn)))
    }
    Whole, _ ->
      keep_history(editor, typed(editor, shown, None, fn(editor) { editor }))
  }
}

fn keep_history(before: Editor, outcome: Outcome) -> Outcome {
  Outcome(..outcome, editor: Editor(..outcome.editor, history: before.history))
}

/// The field holds the whole note, as it is, for the browser to act on.
fn spread(editor: Editor, shown: Buffer) -> Outcome {
  let editor = edit(editor, base(editor, shown))
  case editor.field {
    Whole -> Outcome(editor:, sync: InSync, requests: [])
    Part(drawn:, parsed:, composing:, ..) -> {
      let rows = Region(0, row_count(editor) - 1)
      let field = Part(rows:, drawn:, parsed:, composing:, wide: True)
      let editor = Editor(..editor, field:)
      Outcome(editor:, sync: WriteAndRead(field_buffer(editor)), requests: [])
    }
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
  let #(anchor, head) = buffer.selection(base)
  let reach = fn(head) { #(buffer.select(base, anchor:, head:), Done) }
  let goal = case editor.goal {
    Some(Goal(head: aimed, x: kept)) if aimed == head -> kept
    Some(_) | None -> x
  }
  let start = Position(row: 0, col: 0)
  let end = end_of_row(list.length(lines) - 1)
  let #(wanted, then) = case edge {
    Up if row_above -> #(
      buffer.move_to(base, end_of_row(cursor.row - 1)),
      Aim(LastLine),
    )
    Down if row_below -> #(
      buffer.move_to(base, Position(row: cursor.row + 1, col: 0)),
      Aim(FirstLine),
    )
    JoinBefore if row_above -> {
      let from = end_of_row(cursor.row - 1)
      let to = Position(row: cursor.row, col: 0)
      #(buffer.replace(base, from:, to:, with: ""), Done)
    }
    JoinAfter if row_below -> {
      let from = end_of_row(cursor.row)
      let to = Position(row: cursor.row + 1, col: 0)
      #(buffer.replace(base, from:, to:, with: ""), Done)
    }
    Up if live && anchor != cursor -> #(buffer.move_to(base, start), Done)
    Down if live && anchor != cursor -> #(buffer.move_to(base, end), Done)
    Up if live && cursor != start -> #(base, ByLine(up: True))
    Down if live && cursor != end -> #(base, ByLine(up: False))
    SelectUp if live -> #(
      base,
      StepTo(Move(up: True, page: False, select: True)),
    )
    SelectDown if live -> #(
      base,
      StepTo(Move(up: False, page: False, select: True)),
    )
    Page(up:, select:) if live -> #(base, StepTo(Move(up:, page: True, select:)))
    Row(up:, select:) -> {
      let from = case select {
        True -> head
        False -> earlier(anchor, head)
      }
      let line = fn(row) {
        let length =
          string.length(result_or_empty(list.first(list.drop(lines, row))))
        Position(row:, col: int.min(from.col, length))
      }
      let to = case up {
        True if from.row == 0 -> start
        True -> line(from.row - 1)
        False if from.row == end.row -> end
        False -> line(from.row + 1)
      }
      case select {
        True -> reach(to)
        False -> #(buffer.move_to(base, to), Done)
      }
    }
    SelectBefore if row_above -> reach(end_of_row(cursor.row - 1))
    SelectAfter if row_below -> reach(Position(row: cursor.row + 1, col: 0))
    SelectToStart -> reach(start)
    SelectToEnd -> reach(end)
    SelectAll -> #(buffer.select(base, anchor: start, head: end), Done)
    Up
    | Down
    | JoinBefore
    | JoinAfter
    | SelectUp
    | SelectDown
    | SelectBefore
    | SelectAfter
    | Page(..)
    | Widen -> #(base, Done)
  }
  let waiting = case then {
    StepTo(move) -> list.append(editor.waiting, [move])
    Done | ByLine(_) | Aim(_) -> editor.waiting
  }
  let first = editor.waiting == []
  let editor = Editor(..edit(editor, wanted), waiting:) |> realign
  let wanted_shown = field_buffer(editor)
  let sync = case then, wanted_shown == shown {
    Aim(line), _ -> WriteAndAim(wanted_shown, x: goal, line:)
    ByLine(up:), _ -> WriteAndMove(wanted_shown, up:)
    StepTo(Move(up:, page:, ..)), _ if first ->
      WriteAndStep(wanted_shown, x: goal, up:, page:, queued: False)
    StepTo(_), True | Done, True -> InSync
    StepTo(_), False | Done, False -> Write(wanted_shown)
  }
  Outcome(editor:, sync:, requests: [])
}

fn earlier(one: Position, other: Position) -> Position {
  case one.row < other.row || one.row == other.row && one.col < other.col {
    True -> one
    False -> other
  }
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
    Part(rows:, drawn:, parsed:, composing:, wide:) -> {
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
      Part(rows:, drawn:, parsed:, composing: False, wide:)
    }
  }
  Editor(
    ..editor,
    buffer:,
    field:,
    history: history.record(editor.history, buffer, at: editor.clock),
  )
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
      let field = Part(rows:, drawn:, parsed:, composing:, wide: False)
      Editor(..editor, field:)
    }
  }
}

/// An IME owns the field it composes in, so the field keeps the rows it
/// shows, and the page around it stays as it was drawn.
fn hold(editor: Editor, rows: Region, drawn: List(Block)) -> Editor {
  case editor.field {
    Whole -> editor
    Part(parsed:, composing:, ..) ->
      Editor(
        ..editor,
        field: Part(rows:, drawn:, parsed:, composing:, wide: False),
      )
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

/// A selection that reaches past the block it ends in is painted over the
/// drawn page, which is drawn whole. The field keeps the focus and the
/// selected rows, and is not seen. A wide field is not seen either.
pub fn is_painted(editor: Editor) -> Bool {
  let #(anchor, head) = buffer.selection(editor.buffer)
  case editor.paints, editor.field, editor.focus {
    _, Part(wide: True, ..), Focused -> True
    True, Part(rows:, drawn:, ..), Focused ->
      anchor != head && rows != live.reveal(drawn, from: head.row, to: head.row)
    _, Part(..), Away | _, Whole, _ | False, Part(..), Focused -> False
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
