//// Imported by: `surface`, the app shell, tests. Imports: `buffer`, `vim`,
//// `live`, `markdown`, `history`.

import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/order
import gleam/string
import nullpad/buffer.{type Buffer, type Position, Position}
import nullpad/history.{type History}
import nullpad/live.{type Region, Region}
import nullpad/markdown.{type Block}
import nullpad/vim.{Step}

/// Every change to `buffer` goes through `edit` or `compose`. `edit`
/// records it in `history`, except while a drag is under way: the browser
/// moves dragged text in two changes, and the drag's end records both as
/// one step. `composing` is while an IME composes in the field, from its
/// first change through `compose` to the next through `edit`: undo and redo
/// wait for it to end.
///
/// `waiting` holds the steps of the head over the drawn page that the page
/// has not placed yet. Only the first is asked for, so each step starts
/// where the step before it ended.
///
/// `goal` is where a run of moves up and down aims, as a text field keeps
/// the caret's x: how far from the left of the page's text the head was
/// drawn when the run began, with the start of a row at 0. Every move up or
/// down lands nearest it, on the line as the page will show it. The first
/// move of a run sets it, and any other change to the selection or the text
/// ends the run.
pub opaque type Editor {
  /// `press` is a mouse press the editor took, held until it is let go.
  /// `clicked` is where the last plain press put the caret.
  /// `dragging` is while the browser drags the field's selection.
  Editor(
    buffer: Buffer,
    keys: Keys,
    field: Field,
    focus: Focus,
    history: History,
    clock: Int,
    press: Option(Press),
    clicked: Option(Position),
    dragging: Bool,
    composing: Bool,
    paints: Bool,
    goal: Option(Float),
    waiting: List(Queued),
  )
}

/// A move of the head that waits for the page. Without `select` the anchor
/// goes with the head.
type Queued {
  Queued(move: Move, select: Bool)
}

type Press {
  /// A drag selects from here.
  PressedAt(Position)
  /// A second press in a row selected this word: a drag selects whole words,
  /// and always this one.
  PressedOnWord(start: Position, end: Position)
  /// A third press in a row selected this line: a drag selects whole lines,
  /// and always this one.
  PressedOnLine(start: Position, end: Position)
  /// A press on a painted selection, which drags it: let go where it was
  /// pressed, it puts the caret there.
  PressedOnSelection(Position)
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
  Aim(Line, select: Bool)
  StepTo(Queued)
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
  /// A press at a place on the page, at `x`, `y` in the window. The place
  /// is as `live.position` takes it.
  Pointed(
    row: Int,
    visible: String,
    at_end: Bool,
    next: String,
    x: Float,
    y: Float,
  )
  /// The third press of a triple click: selects the line there, as a text
  /// field does.
  LinePointed(
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
  /// The second press of a double click, at a place on the page or at none,
  /// and at `x`, `y` in the window: selects the word the first press put the
  /// caret in, wherever showing its block moved that word, or else the word
  /// at the place.
  WordPressed(
    row: Int,
    visible: String,
    at_end: Bool,
    next: String,
    x: Float,
    y: Float,
  )
  /// A press on a painted selection: moved, it drags the selected text, as
  /// a press on a text field's selection does, and let go, it puts the caret
  /// there.
  SelectionPointed(
    row: Int,
    visible: String,
    at_end: Bool,
    next: String,
    x: Float,
    y: Float,
  )
  /// The pointer of a held press, once it has moved off the place pressed.
  Dragged(row: Int, visible: String, at_end: Bool, next: String)
  /// The page took the first waiting step of the head: the head moves to
  /// the place on the drawn page that the step reached. The anchor stays.
  /// `x` is where the step aimed, from the left of the text, which starts a
  /// run that had no column yet.
  Stepped(row: Int, visible: String, at_end: Bool, next: String, x: Float)
  /// A step the page had no place for: the head stays where it is.
  Unstepped(x: Float)
  /// The field took the first waiting step itself, and shows where it put
  /// the selection. `x` is where a step of a line aimed, as for `Stepped`.
  FieldStepped(shown: Buffer, x: Float)
  /// The field as an aim at the run's column left it.
  Aimed(shown: Buffer)
  /// A step with nothing drawn past the head: the head goes to the start or
  /// the end of the note, as in a text field.
  SteppedPast
  /// The page painted a selection from `from`, whose ends it draws where
  /// `live.settle` puts them, at `to`. Unless the selection has moved since,
  /// it is taken there, so it holds what is painted.
  Settled(from: #(Position, Position), to: #(Position, Position))
  Released
  /// The browser starts to drag the field's selection.
  DragStarted
  /// Text dropped on a place on the page. It moves there when it is the
  /// field's selection, unless the drop copies it.
  Dropped(
    row: Int,
    visible: String,
    at_end: Bool,
    next: String,
    text: String,
    copy: Bool,
    shown: Buffer,
  )
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
  /// An arrow up or down: the head moves one line up or down the drawn
  /// page.
  Line(up: Bool, select: Bool)
  /// An arrow up or down, with Shift for `select`, from a line of the field
  /// that has a line of the field above or below it: the head moves to that
  /// line, at the run's column, which the browser does not know.
  Beside(up: Bool, select: Bool)
  SelectBefore
  SelectAfter
  /// Shift and an arrow left or right, Home or End, over a painted
  /// selection: the head steps over the drawn page.
  SelectLeft
  SelectRight
  SelectLineStart
  SelectLineEnd
  SelectToStart
  SelectToEnd
  SelectAll
  /// Page Up or Page Down: the head moves a window up or down the drawn
  /// page.
  Page(up: Bool, select: Bool)
  /// Ctrl and an arrow up or down: the head moves to the run's column on
  /// the last drawn line of the row above, or the first of the row below, as
  /// in a text field that holds the markdown, or to the start or end of the
  /// note from its first or last row. It moves from the head, with or
  /// without `select`, as Chrome's text field does.
  Row(up: Bool, select: Bool)
  /// A key the browser acts on by the text alone, which can take the head
  /// past the field: the field holds the whole note while it does.
  Widen
}

pub type Sync {
  InSync
  Write(Buffer)
  WriteQuietly(Buffer)
  /// Then the head moves to the place nearest `x` from the left of the text
  /// on a drawn line of the field. With `select` the anchor stays, and
  /// without it the caret moves.
  WriteAndAim(Buffer, x: Float, line: Line, select: Bool)
  /// Then the head takes `move` over the drawn page, a step of a line or a
  /// window to the place nearest `x` from the left of the text, or below
  /// where the head is drawn when `x` is below 0. A selection keeps its
  /// anchor with `select`, and goes with the head without.
  WriteAndStep(Buffer, move: Move, select: Bool, x: Float)
  /// Then the browser acts on the key, and the field is read once it has.
  WriteAndRead(Buffer)
  Release(Buffer)
  /// A press at `x`, `y` in the window: the field is written, when there is
  /// a write, and focused where it is, and the pointer is followed until it
  /// is let go.
  Press(write: Option(Buffer), x: Float, y: Float)
  /// A press at `x`, `y` on the painted selection: the page drags the
  /// selected text when the pointer moves, and says when it is let go.
  HoldSelection(x: Float, y: Float)
}

/// A line of the field, by where the head is: the first or last line of its
/// row, the line above or below the head's, or the head's own.
pub type Line {
  FirstLine
  LastLine
  LineAbove
  LineBelow
  HeadLine
}

/// One move of the head over the drawn page, as a caret moves over it.
pub type Move {
  LineUp
  LineDown
  LineStart
  LineEnd
  LetterBack
  LetterOn
  /// A window up or down.
  PageUp
  PageDown
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
    clicked: None,
    dragging: False,
    composing: False,
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
  Editor(
    ..editor,
    keys:,
    buffer:,
    field:,
    history: history.new(buffer),
    composing: False,
  )
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
  let outcome = apply(editor, event)
  let goal = case in_run(event), outcome.editor.buffer == editor.buffer {
    Moves, _ | Changes, True -> outcome.editor.goal
    Changes, False | Ends, _ -> None
  }
  Outcome(..outcome, editor: Editor(..outcome.editor, goal:))
}

/// What an event does to a run of moves up and down, as a text field keeps
/// the caret's x: a move of the run, a press or a key that ends it, or
/// anything else, which ends it when it changes the selection or the text.
/// A key that moves nothing keeps it.
type InRun {
  Moves
  Ends
  Changes
}

fn in_run(event: Event) -> InRun {
  case event {
    EdgePressed(edge:, ..) ->
      case is_vertical(edge) {
        True -> Moves
        False -> Changes
      }
    Stepped(..)
    | Unstepped(..)
    | FieldStepped(..)
    | Aimed(..)
    | SteppedPast
    | Settled(..) -> Moves
    Pointed(..)
    | LinePointed(..)
    | ShiftPointed(..)
    | Grabbed(..)
    | WordPressed(..)
    | SelectionPointed(..)
    | Dragged(..)
    | Released
    | DragStarted
    | Dropped(..)
    | EscapePressed(..)
    | UndoAsked
    | RedoAsked -> Ends
    ControlChanged(..) | Composing(..) | KeyPressed(..) | FocusChanged(..) ->
      Changes
  }
}

fn is_vertical(edge: Edge) -> Bool {
  case edge {
    Up | Down | Line(..) | Beside(..) | Page(..) | Row(..) -> True
    JoinBefore
    | JoinAfter
    | SelectBefore
    | SelectAfter
    | SelectLeft
    | SelectRight
    | SelectLineStart
    | SelectLineEnd
    | SelectToStart
    | SelectToEnd
    | SelectAll
    | Widen -> False
  }
}

fn apply(editor: Editor, event: Event) -> Outcome {
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
            Editor(..outcome.editor, focus: Away, waiting: [])
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
          press: Some(PressedAt(at)),
          clicked: Some(at),
          waiting: [],
        )
        |> edit(buffer.move_to(editor.buffer, at))
        |> realign
      Outcome(
        editor:,
        sync: Press(Some(field_buffer(editor)), x:, y:),
        requests: [],
      )
    }
    LinePointed(row:, visible:, at_end:, next:, x:, y:) -> {
      let at = place(editor.buffer, row:, visible:, at_end:, next:)
      let #(start, end) = line_at(editor, at.row)
      let editor =
        Editor(
          ..editor,
          focus: Focused,
          press: Some(PressedOnLine(start:, end:)),
          waiting: [],
        )
        |> edit(buffer.select(editor.buffer, anchor: start, head: end))
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
          press: Some(PressedAt(anchor)),
          waiting: [],
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
        editor: Editor(..editor, press: Some(PressedAt(at))),
        sync: Press(None, x:, y:),
        requests: [],
      )
    }
    WordPressed(row:, visible:, at_end:, next:, x:, y:) -> {
      let cursor = buffer.cursor(editor.buffer)
      let at = case editor.clicked {
        Some(clicked) if clicked == cursor -> cursor
        Some(_) | None if row >= 0 ->
          place(editor.buffer, row:, visible:, at_end:, next:)
        Some(_) | None -> cursor
      }
      let #(start, end) = buffer.word_at(editor.buffer, at)
      let editor =
        Editor(
          ..editor,
          focus: Focused,
          press: Some(PressedOnWord(start:, end:)),
          waiting: [],
        )
        |> edit(buffer.select(editor.buffer, anchor: start, head: end))
        |> realign
      Outcome(
        editor:,
        sync: Press(Some(field_buffer(editor)), x:, y:),
        requests: [],
      )
    }
    SelectionPointed(row:, visible:, at_end:, next:, x:, y:) ->
      case is_painted(editor) {
        True -> {
          let at = place(editor.buffer, row:, visible:, at_end:, next:)
          let press = Some(PressedOnSelection(at))
          Outcome(
            editor: Editor(..editor, press:, waiting: []),
            sync: HoldSelection(x:, y:),
            requests: [],
          )
        }
        False -> update(editor, Pointed(row:, visible:, at_end:, next:, x:, y:))
      }
    Dragged(row:, visible:, at_end:, next:) ->
      case editor.press {
        Some(press) -> {
          let at = place(editor.buffer, row:, visible:, at_end:, next:)
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
    // A step that comes after the steps were ended is dropped.
    Stepped(..) | Unstepped(..) | SteppedPast if editor.waiting == [] ->
      Outcome(editor:, sync: InSync, requests: [])
    Stepped(row:, visible:, at_end:, next:, x:) -> {
      let #(anchor, head) = buffer.selection(editor.buffer)
      let placed = place(editor.buffer, row:, visible:, at_end:, next:)
      let #(line, select) = case editor.waiting {
        [Queued(move: LineUp, select:), ..]
        | [Queued(move: LineDown, select:), ..] -> #(True, select)
        [Queued(move: PageUp, select:), ..]
        | [Queued(move: PageDown, select:), ..]
        | [Queued(move: LineStart, select:), ..]
        | [Queued(move: LineEnd, select:), ..]
        | [Queued(move: LetterBack, select:), ..]
        | [Queued(move: LetterOn, select:), ..] -> #(False, select)
        [] -> #(False, True)
      }
      // A caret's line step past rows the page does not draw, such as a
      // fence, stops on the first of them, as it does in a text field. A
      // selection's steps go over the drawn page.
      let placed = case line && !select, placed.row - head.row {
        True, apart if apart > 1 -> Position(row: head.row + 1, col: 0)
        True, apart if apart < -1 -> Position(row: head.row - 1, col: 0)
        _, _ -> placed
      }
      let anchor = case select {
        True -> anchor
        False -> placed
      }
      let landed = landing(editor.waiting)
      edit(editor, buffer.select(editor.buffer, anchor:, head: placed))
      |> realign
      |> begin_run(editor, landed, x)
      |> next_step(landed)
    }
    Unstepped(x:) ->
      editor |> begin_run(editor, landing(editor.waiting), x) |> next_step(None)
    FieldStepped(shown:, x:) ->
      case editor.waiting {
        [] -> typed(editor, shown, None, realign)
        [_, ..] -> {
          let landed = landing(editor.waiting)
          editor
          |> edit(base(editor, shown))
          |> realign
          |> begin_run(editor, landed, x)
          |> next_step(landed)
        }
      }
    Aimed(shown:) -> typed(editor, shown, None, realign)
    SteppedPast -> {
      let #(anchor, _) = buffer.selection(editor.buffer)
      let #(back, select) = case editor.waiting {
        [Queued(move: LineUp, select:), ..]
        | [Queued(move: LineStart, select:), ..]
        | [Queued(move: LetterBack, select:), ..]
        | [Queued(move: PageUp, select:), ..] -> #(True, select)
        [Queued(move: LineDown, select:), ..]
        | [Queued(move: LineEnd, select:), ..]
        | [Queued(move: LetterOn, select:), ..]
        | [Queued(move: PageDown, select:), ..] -> #(False, select)
        [] -> #(False, True)
      }
      let head = case back {
        True -> Position(0, 0)
        False -> buffer.end_of(buffer.text(editor.buffer))
      }
      let anchor = case select {
        True -> anchor
        False -> head
      }
      edit(editor, buffer.select(editor.buffer, anchor:, head:))
      |> realign
      |> begin_run(editor, landing(editor.waiting), -1.0)
      |> next_step(None)
    }
    Settled(from:, to: #(anchor, head)) ->
      case is_painted(editor) && buffer.selection(editor.buffer) == from {
        True -> {
          let settled =
            edit(editor, buffer.select(editor.buffer, anchor:, head:))
            |> realign
          Outcome(
            editor: settled,
            sync: WriteQuietly(field_buffer(settled)),
            requests: [],
          )
        }
        False -> Outcome(editor:, sync: InSync, requests: [])
      }
    Released -> {
      let let_go = Editor(..editor, press: None, dragging: False)
      case editor.press, editor.dragging {
        Some(PressedOnSelection(at)), False ->
          Editor(..let_go, focus: Focused)
          |> edit(buffer.move_to(editor.buffer, at))
          |> realign
          |> write
        Some(PressedOnSelection(_)), True
        | Some(PressedAt(_)), _
        | Some(PressedOnWord(..)), _
        | Some(PressedOnLine(..)), _
        | None, _
        -> {
          let history =
            history.record(let_go.history, let_go.buffer, at: let_go.clock)
          Outcome(
            editor: Editor(..let_go, history:),
            sync: InSync,
            requests: [],
          )
        }
      }
    }
    DragStarted ->
      Outcome(
        editor: Editor(..editor, dragging: True),
        sync: InSync,
        requests: [],
      )
    Dropped(row:, visible:, at_end:, next:, text:, copy:, shown:) -> {
      let let_go = Editor(..editor, press: None, dragging: False)
      case mode(editor) {
        Normal -> Outcome(editor: let_go, sync: InSync, requests: [])
        Plain | Insert -> {
          let base = base(editor, shown)
          let at = place(base, row:, visible:, at_end:, next:)
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
      let #(focus, press, waiting) = case focused {
        True -> #(Focused, editor.press, editor.waiting)
        False -> #(Away, None, [])
      }
      let changed =
        Editor(..editor, focus:, press:, waiting:) |> edit(editor.buffer)
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
/// take it there. With nothing to take back, or the focus elsewhere, the
/// note stays, and the field is put back as it was: the browser may have
/// changed it from its own history, which can hold another note's steps,
/// or reached it from another field whose history ran out.
fn travel(
  editor: Editor,
  through: fn(History) -> Result(History, Nil),
) -> Outcome {
  case editor.composing, editor.focus, through(editor.history) {
    True, Focused, _ | True, Away, _ ->
      Outcome(editor:, sync: InSync, requests: [])
    False, Focused, Ok(history) ->
      Editor(..editor, history:, waiting: [])
      |> edit(history.present(history))
      |> realign
      |> write
    False, Focused, Error(Nil) | False, Away, _ ->
      Outcome(editor:, sync: WriteQuietly(field_buffer(editor)), requests: [])
  }
}

/// The next waiting step, once the first has landed. A step up or down
/// that `landed` with nothing waiting after it is aimed at the run's column
/// on the line it reached, as the field shows that line, unless the
/// selection is painted over the drawn page, which then shows it.
fn next_step(editor: Editor, landed: Option(Bool)) -> Outcome {
  let waiting = list.drop(editor.waiting, 1)
  let editor = Editor(..editor, waiting:)
  case waiting, landed, editor.goal {
    [], Some(select), Some(x) ->
      case is_painted(editor) {
        True -> write(editor)
        False -> {
          let sync =
            WriteAndAim(field_buffer(editor), x:, line: HeadLine, select:)
          Outcome(editor:, sync:, requests: [])
        }
      }
    [], _, _ -> write(editor)
    [Queued(move:, select:), ..], _, _ -> {
      let x = step_x(editor, move)
      let sync = WriteAndStep(field_buffer(editor), move:, select:, x:)
      Outcome(editor:, sync:, requests: [])
    }
  }
}

/// A step up or down measured from where the head was drawn starts the
/// run's column there, when the run has none yet. Any other step that moved
/// the head ends the run, before the next waiting step aims.
fn begin_run(
  editor: Editor,
  before: Editor,
  landed: Option(Bool),
  x: Float,
) -> Editor {
  case landed, editor.goal {
    Some(_), None if x >=. 0.0 -> Editor(..editor, goal: Some(x))
    None, _ if editor.buffer != before.buffer -> Editor(..editor, goal: None)
    Some(_), _ | None, _ -> editor
  }
}

/// Whether the first waiting step goes up or down, and if so whether it
/// selects.
fn landing(waiting: List(Queued)) -> Option(Bool) {
  case waiting {
    [Queued(move: LineUp, select:), ..]
    | [Queued(move: LineDown, select:), ..]
    | [Queued(move: PageUp, select:), ..]
    | [Queued(move: PageDown, select:), ..] -> Some(select)
    [Queued(move: LineStart, ..), ..]
    | [Queued(move: LineEnd, ..), ..]
    | [Queued(move: LetterBack, ..), ..]
    | [Queued(move: LetterOn, ..), ..]
    | [] -> None
  }
}

/// A step up or down aims at the run's column. Any other, or one with no
/// run, is measured from where the head is drawn.
fn step_x(editor: Editor, move: Move) -> Float {
  case move, editor.goal {
    LineUp, Some(x) | LineDown, Some(x) | PageUp, Some(x) | PageDown, Some(x) ->
      x
    LineUp, None
    | LineDown, None
    | PageUp, None
    | PageDown, None
    | LineStart, _
    | LineEnd, _
    | LetterBack, _
    | LetterOn, _
    -> -1.0
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

/// The anchor and head of a drag from a press to `at`.
fn stretch(in: Buffer, press: Press, to at: Position) -> #(Position, Position) {
  case press {
    PressedAt(from) | PressedOnSelection(from) -> #(from, at)
    PressedOnWord(start:, end:) ->
      case buffer.compare(at, start), buffer.compare(at, end) {
        order.Lt, _ -> #(end, buffer.word_at(in, at).0)
        _, order.Gt -> #(start, buffer.word_at(in, at).1)
        order.Eq, _ | order.Gt, order.Lt | order.Gt, order.Eq -> #(start, end)
      }
    PressedOnLine(start:, end:) ->
      case buffer.compare(at, start), buffer.compare(at, end) {
        order.Lt, _ -> #(end, Position(row: at.row, col: 0))
        _, order.Gt -> #(start, line_end(in, at.row))
        order.Eq, _ | order.Gt, order.Lt | order.Gt, order.Eq -> #(start, end)
      }
  }
}

/// What a third click in the field selects on `row`: the row, and the line
/// break after it when the field would hold the row below too.
fn line_at(editor: Editor, row: Int) -> #(Position, Position) {
  let last = case editor.field {
    Whole -> list.length(buffer.lines(editor.buffer)) - 1
    Part(drawn:, ..) -> live.reveal(drawn, from: row, to: row).last_row
  }
  case row < last {
    True -> #(Position(row:, col: 0), Position(row: row + 1, col: 0))
    False -> #(Position(row:, col: 0), line_end(editor.buffer, row))
  }
}

fn line_end(in: Buffer, row: Int) -> Position {
  let line = buffer.lines(in) |> list.drop(row) |> list.first
  Position(row:, col: string.length(result_or_empty(line)))
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
  // A change the editor did not write ends the steps still waiting.
  let waiting = case shown == field_buffer(editor) {
    True -> editor.waiting
    False -> []
  }
  let editor = Editor(..editor, keys:, waiting:) |> edit(wanted) |> place
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
        editor: Editor(..editor, buffer: composed, field:, composing: True),
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
  let editor =
    Editor(..outcome.editor, history: before.history, composing: True)
  Outcome(..outcome, editor:)
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
  let goal = case
    is_vertical(edge),
    editor.goal,
    shown == field_buffer(editor)
  {
    True, Some(goal), True -> Some(goal)
    True, _, _ if x >=. 0.0 -> Some(x)
    True, _, _ | False, _, _ -> None
  }
  let start = Position(row: 0, col: 0)
  let end = end_of_row(list.length(lines) - 1)
  let #(wanted, then) = case edge {
    Up if row_above -> #(
      buffer.move_to(base, end_of_row(cursor.row - 1)),
      Aim(LastLine, select: False),
    )
    Down if row_below -> #(
      buffer.move_to(base, Position(row: cursor.row + 1, col: 0)),
      Aim(FirstLine, select: False),
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
    Up if live && cursor != start -> #(buffer.move_to(base, start), Done)
    Down if live && cursor != end -> #(buffer.move_to(base, end), Done)
    Line(up: True, select:) if live -> #(base, StepTo(Queued(LineUp, select:)))
    Line(up: False, select:) if live -> #(
      base,
      StepTo(Queued(LineDown, select:)),
    )
    Page(up: True, select:) if live -> #(base, StepTo(Queued(PageUp, select:)))
    Page(up: False, select:) if live -> #(
      base,
      StepTo(Queued(PageDown, select:)),
    )
    SelectLeft if live -> #(base, StepTo(Queued(LetterBack, select: True)))
    SelectRight if live -> #(base, StepTo(Queued(LetterOn, select: True)))
    SelectLineStart if live -> #(base, StepTo(Queued(LineStart, select: True)))
    SelectLineEnd if live -> #(base, StepTo(Queued(LineEnd, select: True)))
    // Collapsed, the selection may leave the rows the field holds, so its
    // head steps over the page as the field will show it.
    Beside(up: True, select: False) if live && anchor != head -> #(
      base,
      StepTo(Queued(LineUp, select: False)),
    )
    Beside(up: False, select: False) if live && anchor != head -> #(
      base,
      StepTo(Queued(LineDown, select: False)),
    )
    Beside(up: True, select:) if live -> #(base, Aim(LineAbove, select:))
    Beside(up: False, select:) if live -> #(base, Aim(LineBelow, select:))
    Row(up:, select:) if live -> {
      let #(to, then) = case up {
        True if head.row == 0 -> #(start, Done)
        True -> #(end_of_row(head.row - 1), Aim(LastLine, select:))
        False if head.row == end.row -> #(end, Done)
        False -> #(Position(row: head.row + 1, col: 0), Aim(FirstLine, select:))
      }
      let selected = buffer.select(base, anchor:, head: to)
      // A selection painted over the drawn page is not laid out as the
      // field lays it out, so its head steps over the page from the edge of
      // its row instead.
      case select, then, is_painted(edit(editor, selected) |> realign) {
        True, Aim(..), True -> {
          let edge = case up {
            True -> Position(row: head.row, col: 0)
            False -> end_of_row(head.row)
          }
          let move = case up {
            True -> LineUp
            False -> LineDown
          }
          #(
            buffer.select(base, anchor:, head: edge),
            StepTo(Queued(move:, select: True)),
          )
        }
        True, _, _ -> #(selected, then)
        False, _, _ -> #(buffer.move_to(base, to), then)
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
    | Line(..)
    | SelectBefore
    | SelectAfter
    | Page(..)
    | Beside(..)
    | Row(..)
    | Widen
    | SelectLeft
    | SelectRight
    | SelectLineStart
    | SelectLineEnd -> #(base, Done)
  }
  let waiting = case then {
    StepTo(step) -> list.append(editor.waiting, [step])
    Done | Aim(..) -> editor.waiting
  }
  let first = editor.waiting == []
  let editor = Editor(..edit(editor, wanted), waiting:, goal:) |> realign
  let wanted_shown = field_buffer(editor)
  let sync = case then, wanted_shown == shown {
    Aim(line, select:), _ ->
      WriteAndAim(wanted_shown, x: option.unwrap(goal, x), line:, select:)
    StepTo(Queued(move:, select:)), _ if first ->
      WriteAndStep(wanted_shown, move:, select:, x: step_x(editor, move))
    StepTo(_), True | Done, True -> InSync
    StepTo(_), False | Done, False -> Write(wanted_shown)
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
  let history = case editor.dragging {
    True -> editor.history
    False -> history.record(editor.history, buffer, at: editor.clock)
  }
  Editor(..editor, buffer:, field:, history:, composing: False)
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
        Part(drawn:, ..), Part(rows:, parsed:, composing:, wide:, ..) ->
          Editor(
            ..ticked,
            field: Part(
              rows:,
              drawn: live.tick(drawn, task, checked),
              parsed:,
              composing:,
              wide:,
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

/// Whether a step of the head waits for the page.
pub fn is_stepping(editor: Editor) -> Bool {
  editor.waiting != []
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
