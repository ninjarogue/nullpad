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

pub opaque type Editor {
  /// `press` is a mouse press the editor took, held until it is let go.
  /// `dragging` is while the browser drags the field's selection.
  Editor(
    buffer: Buffer,
    keys: Keys,
    field: Field,
    focus: Focus,
    history: History,
    clock: Int,
    press: Option(Press),
    last_plain_press: Option(Position),
    dragging: Bool,
    ime: Ime,
    paints: Bool,
    vertical_goal: Option(Goal),
    page_backlog: Page,
    travel: order.Order,
    note_choice: Choice,
  )
}

type Choice {
  Chosen
  Choosing(keys: List(Held))
}

type Page {
  CaughtUp
  Behind(steps_for_page: List(Queued), keys_behind_steps: List(Held))
}

type Ime {
  NotComposing
  ComposingHere
  ComposingBehindHeldKeys
}

type Goal {
  Goal(page_x: Float, markdown_col: Int)
}

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
  Composed(shown: Buffer, at: Int)
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
  Stepped(
    row: Int,
    visible: String,
    at_end: Bool,
    next: String,
    x: Option(Float),
  )
  Unstepped(x: Option(Float))
  FieldStepped(shown: Buffer, x: Option(Float))
  Aimed(shown: Buffer)
  /// A step with nothing drawn past the head: the head goes to the start or
  /// the end of the note, as in a text field.
  SteppedPast
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
  KeyHeld(held: Held)
  Replayed(then: Option(Event))
}

pub type Held {
  HeldKey(
    key: String,
    code: String,
    shift: Bool,
    ctrl: Bool,
    meta: Bool,
    alt: Bool,
    at: Int,
  )
  HeldPaste(text: String, at: Int)
  HeldMenuUndo
  HeldMenuRedo
}

pub type Keyboard {
  /// Cmd moves by lines and the whole note, Option by words, and Option
  /// types a character of its own.
  AppleKeyboard
  /// Ctrl moves by words and the whole note, and Ctrl with Alt is AltGr,
  /// which types a character of its own.
  WindowsKeyboard
  /// Ctrl moves by words and the whole note. AltGr comes with no modifier.
  OtherKeyboard
}

pub type Act {
  TypeText(text: String)
  MoveCaret(extend: Bool, direction: Direction, by: Granularity)
  DeleteBy(forward: Bool, by: Granularity)
  SelectWholeField
  CopySelection
  CutSelection
}

pub type Direction {
  Left
  Right
  Backward
  Forward
}

pub type Granularity {
  ByCharacter
  ByWord
  ByLine
  ByLineBoundary
  ByParagraph
  ByDocument
}

pub fn replay_matches_browser(held: Held, keyboard: Keyboard) -> Bool {
  case held {
    HeldKey(key: "Escape", ..)
    | HeldKey(key: "PageUp", ..)
    | HeldKey(key: "PageDown", ..) -> True
    HeldKey(key:, code:, shift:, ctrl:, meta:, alt:, ..) -> {
      let command = { ctrl || meta } && !alt
      let undoes =
        is_key(key, code, "z") || { is_key(key, code, "y") && ctrl && !shift }
      { command && undoes } || browser_act(held, keyboard) != None
    }
    HeldPaste(..) | HeldMenuUndo | HeldMenuRedo -> True
  }
}

pub fn browser_act(held: Held, keyboard: Keyboard) -> Option(Act) {
  case held {
    HeldKey(key:, code:, shift:, ctrl:, meta:, alt:, ..) -> {
      let plain = !ctrl && !meta && !alt
      let #(words, lines, types, command) = case keyboard {
        AppleKeyboard -> #(
          alt && !ctrl && !meta,
          meta && !ctrl && !alt,
          alt && !ctrl && !meta,
          meta && !ctrl && !alt,
        )
        WindowsKeyboard -> #(
          ctrl && !meta && !alt,
          False,
          ctrl && alt && !meta,
          ctrl && !meta && !alt,
        )
        OtherKeyboard -> #(
          ctrl && !meta && !alt,
          False,
          False,
          ctrl && !meta && !alt,
        )
      }
      let by = case plain, words, lines {
        True, _, _ -> Some(ByCharacter)
        False, True, _ -> Some(ByWord)
        False, False, True -> Some(ByLineBoundary)
        False, False, False -> None
      }
      let across = fn(back) {
        case by {
          Some(ByLineBoundary) if back ->
            Some(MoveCaret(shift, Backward, ByLineBoundary))
          Some(ByLineBoundary) ->
            Some(MoveCaret(shift, Forward, ByLineBoundary))
          Some(by) if back -> Some(MoveCaret(shift, Left, by))
          Some(by) -> Some(MoveCaret(shift, Right, by))
          None -> None
        }
      }
      let up_down = fn(direction) {
        case plain, lines, words && keyboard != AppleKeyboard {
          True, _, _ -> Some(MoveCaret(shift, direction, ByLine))
          False, True, _ -> Some(MoveCaret(shift, direction, ByDocument))
          False, False, True -> Some(MoveCaret(shift, direction, ByParagraph))
          False, False, False -> None
        }
      }
      let home_end = fn(direction) {
        case plain, words {
          True, _ -> Some(MoveCaret(shift, direction, ByLineBoundary))
          False, True if keyboard != AppleKeyboard ->
            Some(MoveCaret(shift, direction, ByDocument))
          False, _ -> None
        }
      }
      case key {
        "Enter" if plain -> Some(TypeText("\n"))
        "Enter" -> None
        "Backspace" -> option.map(by, DeleteBy(False, _))
        "Delete" -> option.map(by, DeleteBy(True, _))
        "ArrowLeft" -> across(True)
        "ArrowRight" -> across(False)
        "ArrowUp" -> up_down(Backward)
        "ArrowDown" -> up_down(Forward)
        "Home" -> home_end(Backward)
        "End" -> home_end(Forward)
        _ -> {
          let typed = case string.length(key) == 1 {
            False -> False
            True -> plain || { types && !names_printed_label(key, code) }
          }
          let shortcut = case command && !shift && string.length(key) == 1 {
            False -> None
            True ->
              [
                #("a", SelectWholeField),
                #("c", CopySelection),
                #("x", CutSelection),
              ]
              |> list.find(fn(letter) { is_key(key, code, letter.0) })
              |> option.from_result
              |> option.map(fn(letter) { letter.1 })
          }
          case typed {
            True -> Some(TypeText(key))
            False -> shortcut
          }
        }
      }
    }
    HeldPaste(..) | HeldMenuUndo | HeldMenuRedo -> None
  }
}

/// A shortcut letter on a keyboard laid out for another alphabet is named by
/// where the key sits.
pub fn is_key(name: String, code: String, letter: String) -> Bool {
  let typed = string.lowercase(name)
  let latin = string.length(typed) == 1 && string.contains(letters, typed)
  typed == letter || { !latin && code == "Key" <> string.uppercase(letter) }
}

const letters = "abcdefghijklmnopqrstuvwxyz"

fn names_printed_label(name: String, code: String) -> Bool {
  code == "Key" <> string.uppercase(name) || code == "Digit" <> name
}

/// A key that reaches past the rows the field holds. The `Select` keys move
/// the head and keep the anchor.
pub type Edge {
  Up
  Down
  JoinBefore
  JoinAfter
  Line(up: Bool, select: Bool)
  LineInField(up: Bool, select: Bool)
  SelectBefore
  SelectAfter
  /// Shift and an arrow left or right, Home or End, over a painted
  /// selection: the head steps over the drawn page.
  SelectLeft
  SelectRight
  SelectLineStart
  SelectLineEnd
  SelectToNoteStart
  SelectToNoteEnd
  SelectAll
  Page(up: Bool, select: Bool)
  NextRow(up: Bool, select: Bool)
  OntoRowBefore
  OntoRowAfter
  ToNoteStart
  ToNoteEnd
  WidenToNote
}

pub type Sync {
  InSync
  Write(Buffer)
  WriteQuietly(Buffer)
  WriteAndAim(Buffer, x: Float, line: Line, select: Bool)
  WriteAndStep(Buffer, move: Move, select: Bool, x: Option(Float))
  WriteAndRead(Buffer)
  WriteAndAct(Buffer, key: Held)
  Release(Buffer)
  /// A press at `x`, `y` in the window: the field is written, when there is
  /// a write, and focused where it is, and the pointer is followed until it
  /// is let go.
  Press(write: Option(Buffer), x: Float, y: Float)
  /// A press at `x`, `y` on the painted selection: the page drags the
  /// selected text when the pointer moves, and says when it is let go.
  HoldSelection(x: Float, y: Float)
}

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
    last_plain_press: None,
    dragging: False,
    ime: NotComposing,
    paints:,
    vertical_goal: None,
    page_backlog: CaughtUp,
    travel: order.Eq,
    note_choice: Chosen,
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
    press: None,
    last_plain_press: None,
    ime: NotComposing,
    vertical_goal: None,
    page_backlog: behind([], chosen_keys(editor)),
    travel: order.Eq,
    note_choice: Chosen,
  )
  |> realign
  |> write_and_focus
}

pub fn set_choosing(editor: Editor, choosing: Bool) -> Outcome {
  let editor = case editor.note_choice, choosing {
    Chosen, True ->
      Editor(..editor, page_backlog: CaughtUp, note_choice: Choosing([]))
    Choosing(keys:), False ->
      Editor(
        ..editor,
        page_backlog: behind(steps(editor), keys),
        note_choice: Chosen,
      )
    Chosen, False | Choosing(..), True -> editor
  }
  Outcome(editor:, sync: InSync, requests: [])
}

pub fn is_choosing(editor: Editor) -> Bool {
  editor.note_choice != Chosen
}

fn chosen_keys(editor: Editor) -> List(Held) {
  case editor.note_choice {
    Chosen -> []
    Choosing(keys:) -> keys
  }
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
  let editor =
    Editor(
      ..editor,
      press: None,
      last_plain_press: None,
      vertical_goal: None,
      travel: order.Eq,
    )
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
  case editor.note_choice {
    Chosen -> follow(editor, event)
    Choosing(keys:) -> choosing(editor, keys, event)
  }
}

fn choosing(editor: Editor, keys: List(Held), event: Event) -> Outcome {
  let wait = fn(held) {
    let choice = Choosing(list.append(keys, [held]))
    Outcome(
      editor: Editor(..editor, note_choice: choice),
      sync: InSync,
      requests: [],
    )
  }
  case event {
    KeyHeld(held:) -> wait(held)
    UndoAsked -> wait(HeldMenuUndo)
    RedoAsked -> wait(HeldMenuRedo)
    ControlChanged(..)
    | Composing(..)
    | Composed(..)
    | KeyPressed(..)
    | EdgePressed(..)
    | EscapePressed(..)
    | Pointed(..)
    | LinePointed(..)
    | ShiftPointed(..)
    | Grabbed(..)
    | WordPressed(..)
    | SelectionPointed(..)
    | Dragged(..)
    | Stepped(..)
    | Unstepped(..)
    | FieldStepped(..)
    | Aimed(..)
    | SteppedPast
    | Settled(..)
    | Released
    | DragStarted
    | Dropped(..)
    | FocusChanged(..)
    | Replayed(..) -> keep_note(editor, follow(editor, event))
  }
}

fn ends_steps(before: Editor, outcome: Outcome) -> Outcome {
  case outcome.editor.buffer == before.buffer {
    True -> outcome
    False -> {
      let page = behind([], held_keys(outcome.editor))
      Outcome(..outcome, editor: Editor(..outcome.editor, page_backlog: page))
    }
  }
}

fn keep_note(before: Editor, outcome: Outcome) -> Outcome {
  case buffer.text(outcome.editor.buffer) == buffer.text(before.buffer) {
    True -> outcome
    False ->
      Outcome(
        editor: before,
        sync: WriteQuietly(field_buffer(before)),
        requests: [],
      )
  }
}

fn follow(editor: Editor, event: Event) -> Outcome {
  let outcome = case event {
    Dragged(..) | Settled(..) | Released | Dropped(..) ->
      ends_steps(editor, apply(editor, event))
    ControlChanged(..)
    | Composing(..)
    | Composed(..)
    | KeyPressed(..)
    | EdgePressed(..)
    | EscapePressed(..)
    | Pointed(..)
    | LinePointed(..)
    | ShiftPointed(..)
    | Grabbed(..)
    | WordPressed(..)
    | SelectionPointed(..)
    | Stepped(..)
    | Unstepped(..)
    | FieldStepped(..)
    | Aimed(..)
    | SteppedPast
    | DragStarted
    | FocusChanged(..)
    | UndoAsked
    | RedoAsked
    | KeyHeld(..)
    | Replayed(..) -> apply(editor, event)
  }
  let goal = case in_run(event), outcome.editor.buffer == editor.buffer {
    KeepsRun, _ | EndsRunOnChange, True -> outcome.editor.vertical_goal
    EndsRunOnChange, False | EndsRun, _ -> None
  }
  let head = buffer.cursor(editor.buffer)
  let travel = case buffer.compare(buffer.cursor(outcome.editor.buffer), head) {
    order.Eq -> editor.travel
    moved ->
      case steers(event) {
        True -> moved
        False -> order.Eq
      }
  }
  Outcome(
    ..outcome,
    editor: Editor(..outcome.editor, vertical_goal: goal, travel:),
  )
}

pub fn last_key_travel(editor: Editor) -> order.Order {
  editor.travel
}

fn steers(event: Event) -> Bool {
  case event {
    ControlChanged(..)
    | Composed(..)
    | KeyPressed(..)
    | EdgePressed(..)
    | Stepped(..)
    | Unstepped(..)
    | FieldStepped(..)
    | Aimed(..)
    | SteppedPast -> True
    Composing(..)
    | EscapePressed(..)
    | Pointed(..)
    | LinePointed(..)
    | ShiftPointed(..)
    | Grabbed(..)
    | WordPressed(..)
    | SelectionPointed(..)
    | Dragged(..)
    | Settled(..)
    | Released
    | DragStarted
    | Dropped(..)
    | UndoAsked
    | RedoAsked
    | KeyHeld(..)
    | Replayed(None)
    | FocusChanged(..) -> False
    Replayed(Some(event)) -> steers(event)
  }
}

type InRun {
  KeepsRun
  EndsRun
  EndsRunOnChange
}

fn in_run(event: Event) -> InRun {
  case event {
    EdgePressed(edge:, ..) ->
      case is_vertical(edge) {
        True -> KeepsRun
        False -> EndsRunOnChange
      }
    Stepped(..)
    | Unstepped(..)
    | FieldStepped(..)
    | Aimed(..)
    | SteppedPast
    | Settled(..) -> KeepsRun
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
    | RedoAsked -> EndsRun
    ControlChanged(..)
    | Composing(..)
    | Composed(..)
    | KeyPressed(..)
    | FocusChanged(..)
    | KeyHeld(..)
    | Replayed(None) -> EndsRunOnChange
    Replayed(Some(event)) -> in_run(event)
  }
}

fn is_vertical(edge: Edge) -> Bool {
  case edge {
    Up | Down | Line(..) | LineInField(..) | Page(..) | NextRow(..) -> True
    JoinBefore
    | JoinAfter
    | SelectBefore
    | SelectAfter
    | SelectLeft
    | SelectRight
    | SelectLineStart
    | SelectLineEnd
    | SelectToNoteStart
    | SelectToNoteEnd
    | SelectAll
    | OntoRowBefore
    | OntoRowAfter
    | ToNoteStart
    | ToNoteEnd
    | WidenToNote -> False
  }
}

fn apply(editor: Editor, event: Event) -> Outcome {
  let unasked = steps(editor) == []
  case event {
    ControlChanged(shown:, at:) ->
      case editor.ime {
        NotComposing -> typed(Editor(..editor, clock: at), shown, None, realign)
        ComposingHere | ComposingBehindHeldKeys -> compose(editor, shown)
      }
    Composing(shown:) -> compose(editor, shown)
    Composed(shown:, at:) ->
      case editor.ime {
        ComposingBehindHeldKeys -> queue_ime_text_behind_page(editor, shown, at)
        ComposingHere | NotComposing ->
          typed(
            Editor(..editor, clock: at, ime: NotComposing),
            shown,
            None,
            realign,
          )
      }
    KeyPressed(key:, shown:) -> typed(editor, shown, Some(key), realign)
    EdgePressed(edge: WidenToNote, shown:, ..) ->
      widen_field_to_note(editor, shown)
    EdgePressed(edge:, x:, shown:) -> cross(editor, edge, x, shown)
    EscapePressed(shown:) -> {
      let outcome = typed(editor, shown, None, realign)
      case outcome.editor.field {
        Whole -> outcome
        Part(..) -> {
          let left = outcome.editor.buffer
          let editor =
            Editor(..outcome.editor, focus: Away, page_backlog: CaughtUp)
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
          last_plain_press: Some(at),
          page_backlog: CaughtUp,
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
          page_backlog: CaughtUp,
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
          page_backlog: CaughtUp,
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
      let at = case editor.last_plain_press {
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
          page_backlog: CaughtUp,
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
            editor: Editor(..editor, press:, page_backlog: CaughtUp),
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
    Stepped(..) | Unstepped(..) | SteppedPast if unasked ->
      Outcome(editor:, sync: InSync, requests: [])
    Stepped(row:, visible:, at_end:, next:, x:) -> {
      let #(anchor, head) = buffer.selection(editor.buffer)
      let placed = place(editor.buffer, row:, visible:, at_end:, next:)
      let #(line, select) = case steps(editor) {
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
      let #(placed, undrawn) = case line, placed.row - head.row {
        True, apart if apart > 1 -> #(undrawn_row(editor, head, 1), True)
        True, apart if apart < -1 -> #(undrawn_row(editor, head, -1), True)
        True, _ -> #(among_marks(editor, head, placed, visible:, next:), False)
        False, _ -> #(placed, False)
      }
      let placed = in_row(editor, row:, visible:, from: head, to: placed)
      let anchor = case select {
        True -> anchor
        False -> placed
      }
      let landed = landing(steps(editor))
      let moved = case stays(editor, placed) {
        True -> editor
        False ->
          edit(editor, buffer.select(editor.buffer, anchor:, head: placed))
          |> realign
      }
      moved
      |> begin_run(editor, landed, x)
      |> next_step(landed, undrawn)
    }
    Unstepped(x:) ->
      editor
      |> begin_run(editor, landing(steps(editor)), x)
      |> next_step(None, False)
    FieldStepped(shown:, x:) ->
      case steps(editor) {
        [] -> typed(editor, shown, None, realign)
        [_, ..] -> {
          let landed = landing(steps(editor))
          editor
          |> edit(base(editor, shown))
          |> realign
          |> begin_run(editor, landed, x)
          |> next_step(landed, False)
        }
      }
    Aimed(shown:) -> typed(editor, shown, None, realign)
    SteppedPast -> {
      let #(anchor, from) = buffer.selection(editor.buffer)
      let #(back, line, select) = case steps(editor) {
        [Queued(move: LineUp, select:), ..] -> #(True, True, select)
        [Queued(move: LineStart, select:), ..]
        | [Queued(move: LetterBack, select:), ..]
        | [Queued(move: PageUp, select:), ..] -> #(True, False, select)
        [Queued(move: LineDown, select:), ..] -> #(False, True, select)
        [Queued(move: LineEnd, select:), ..]
        | [Queued(move: LetterOn, select:), ..]
        | [Queued(move: PageDown, select:), ..] -> #(False, False, select)
        [] -> #(False, False, True)
      }
      let last = list.length(buffer.lines(editor.buffer)) - 1
      let #(head, undrawn) = case back, line {
        True, True if from.row > 0 -> #(undrawn_row(editor, from, -1), True)
        False, True if from.row < last -> #(undrawn_row(editor, from, 1), True)
        True, _ -> #(Position(0, 0), False)
        False, _ -> #(buffer.end_of(buffer.text(editor.buffer)), False)
      }
      let anchor = case select {
        True -> anchor
        False -> head
      }
      let moved = case stays(editor, head) {
        True -> editor
        False ->
          edit(editor, buffer.select(editor.buffer, anchor:, head:))
          |> realign
      }
      let landed = case undrawn {
        True -> landing(steps(editor))
        False -> None
      }
      moved
      |> begin_run(editor, landing(steps(editor)), None)
      |> next_step(landed, undrawn)
    }
    Settled(from:, to: #(anchor, head)) ->
      case
        is_painted(editor)
        && { editor.travel != order.Eq || editor.press != None }
        && buffer.selection(editor.buffer) == from
      {
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
      let #(focus, press, page) = case focused {
        True -> #(Focused, editor.press, editor.page_backlog)
        False -> #(Away, None, CaughtUp)
      }
      let changed =
        Editor(..editor, focus:, press:, page_backlog: page)
        |> edit(editor.buffer)
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
    UndoAsked ->
      case editor.page_backlog, editor.ime {
        Behind(..), NotComposing -> hold_key(editor, HeldMenuUndo)
        CaughtUp, _
        | Behind(..), ComposingHere
        | Behind(..), ComposingBehindHeldKeys
        -> travel(editor, history.undo)
      }
    RedoAsked ->
      case editor.page_backlog, editor.ime {
        Behind(..), NotComposing -> hold_key(editor, HeldMenuRedo)
        CaughtUp, _
        | Behind(..), ComposingHere
        | Behind(..), ComposingBehindHeldKeys
        -> travel(editor, history.redo)
      }
    KeyHeld(held) -> hold_key(editor, held)
    Replayed(Some(UndoAsked)) -> travel(replayed(editor), history.undo)
    Replayed(Some(RedoAsked)) -> travel(replayed(editor), history.redo)
    Replayed(Some(event)) -> {
      let outcome = apply(replayed(editor), event)
      case outcome.sync, replay(editor) {
        WriteAndRead(whole), Some(key) ->
          Outcome(..outcome, sync: WriteAndAct(whole, key:))
        WriteAndRead(_), None
        | InSync, _
        | Write(_), _
        | WriteQuietly(_), _
        | WriteAndAim(..), _
        | WriteAndStep(..), _
        | WriteAndAct(..), _
        | Release(_), _
        | Press(..), _
        | HoldSelection(..), _
        -> outcome
      }
    }
    Replayed(None) ->
      Outcome(editor: replayed(editor), sync: InSync, requests: [])
  }
}

fn hold_key(editor: Editor, held: Held) -> Outcome {
  let page = behind(steps(editor), list.append(held_keys(editor), [held]))
  Outcome(
    editor: Editor(..editor, page_backlog: page),
    sync: InSync,
    requests: [],
  )
}

fn replayed(editor: Editor) -> Editor {
  case replay(editor), editor.page_backlog {
    Some(_), Behind(steps_for_page: steps, keys_behind_steps: [_, ..keys]) ->
      Editor(..editor, page_backlog: behind(steps, keys))
    Some(_), Behind(keys_behind_steps: [], ..) | Some(_), CaughtUp | None, _ ->
      editor
  }
}

fn behind(steps: List(Queued), keys: List(Held)) -> Page {
  case steps, keys {
    [], [] -> CaughtUp
    [_, ..], _ | _, [_, ..] ->
      Behind(steps_for_page: steps, keys_behind_steps: keys)
  }
}

fn steps(editor: Editor) -> List(Queued) {
  case editor.page_backlog {
    CaughtUp -> []
    Behind(steps_for_page: steps, ..) -> steps
  }
}

fn held_keys(editor: Editor) -> List(Held) {
  case editor.page_backlog {
    CaughtUp -> []
    Behind(keys_behind_steps: keys, ..) -> keys
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
  case editor.ime, editor.focus, through(editor.history) {
    ComposingHere, _, _ | ComposingBehindHeldKeys, _, _ ->
      Outcome(editor:, sync: InSync, requests: [])
    NotComposing, Focused, Ok(history) ->
      Editor(..editor, history:, page_backlog: behind([], held_keys(editor)))
      |> edit(history.present(history))
      |> realign
      |> write
    NotComposing, Focused, Error(Nil) | NotComposing, Away, _ ->
      Outcome(editor:, sync: WriteQuietly(field_buffer(editor)), requests: [])
  }
}

fn next_step(editor: Editor, landed: Option(Bool), undrawn: Bool) -> Outcome {
  let waiting = list.drop(steps(editor), 1)
  let editor =
    Editor(..editor, page_backlog: behind(waiting, held_keys(editor)))
  case waiting, landed, editor.vertical_goal {
    [], Some(select), Some(Goal(page_x: x, ..)) ->
      case is_painted(editor) || undrawn {
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

fn begin_run(
  editor: Editor,
  before: Editor,
  landed: Option(Bool),
  x: Option(Float),
) -> Editor {
  case landed, editor.vertical_goal, x {
    Some(_), None, Some(x) ->
      Editor(
        ..editor,
        vertical_goal: Some(Goal(
          page_x: x,
          markdown_col: buffer.cursor(before.buffer).col,
        )),
      )
    None, _, _ if editor.buffer != before.buffer ->
      Editor(..editor, vertical_goal: None)
    Some(_), _, _ | None, _, _ -> editor
  }
}

pub fn run_started_at_row_start(editor: Editor) -> Bool {
  case editor.vertical_goal {
    Some(Goal(markdown_col: col, ..)) -> col == 0
    None -> step_start(editor).col == 0
  }
}

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

pub fn step_start(editor: Editor) -> Position {
  let #(anchor, head) = buffer.selection(editor.buffer)
  let #(start, end) = case buffer.compare(anchor, head) {
    order.Gt -> #(head, anchor)
    order.Lt | order.Eq -> #(anchor, head)
  }
  case steps(editor) {
    [Queued(move: PageUp, select: False), ..] -> start
    [Queued(move: PageDown, select: False), ..] -> end
    [Queued(move: PageUp, select: True), ..]
    | [Queued(move: PageDown, select: True), ..]
    | [Queued(move: LineUp, ..), ..]
    | [Queued(move: LineDown, ..), ..]
    | [Queued(move: LineStart, ..), ..]
    | [Queued(move: LineEnd, ..), ..]
    | [Queued(move: LetterBack, ..), ..]
    | [Queued(move: LetterOn, ..), ..]
    | [] -> head
  }
}

fn in_row(
  editor: Editor,
  row row: Int,
  visible visible: String,
  from head: Position,
  to placed: Position,
) -> Position {
  let lines = buffer.lines(editor.buffer)
  let #(anchor, _) = buffer.selection(editor.buffer)
  let left = placed.row != head.row
  let hidden = fn(col) {
    let at = Position(..head, col:)
    live.settle(
      lines,
      row: head.row,
      visible: "",
      at:,
      other: anchor,
      toward: order.Eq,
    )
  }
  case steps(editor) {
    [Queued(move: LetterOn, ..), ..] if !left && placed.col > head.col + 1 -> {
      let at = Position(..head, col: head.col + 1)
      case
        live.settle(lines, row:, visible:, at:, other: anchor, toward: order.Eq)
        == at
      {
        True -> at
        False -> placed
      }
    }
    [Queued(move: LetterOn, ..), ..] if left -> {
      let at = hidden(head.col + 1)
      case at.col > head.col {
        True -> at
        False -> placed
      }
    }
    [Queued(move: LetterBack, ..), ..] if left && head.col > 0 -> {
      let at = hidden(head.col - 1)
      case at.col < head.col {
        True -> at
        False -> placed
      }
    }
    [Queued(move: LineStart, ..), ..] if left -> Position(..head, col: 0)
    [Queued(move: LineEnd, ..), ..] if left -> line_end(editor.buffer, head.row)
    [Queued(move: LetterOn, ..), ..]
    | [Queued(move: LetterBack, ..), ..]
    | [Queued(move: LineStart, ..), ..]
    | [Queued(move: LineEnd, ..), ..]
    | [Queued(move: LineUp, ..), ..]
    | [Queued(move: LineDown, ..), ..]
    | [Queued(move: PageUp, ..), ..]
    | [Queued(move: PageDown, ..), ..]
    | [] -> placed
  }
}

fn stays(editor: Editor, reached: Position) -> Bool {
  let #(anchor, head) = buffer.selection(editor.buffer)
  case steps(editor) {
    [Queued(move: PageUp, select: False), ..]
    | [Queued(move: PageDown, select: False), ..] ->
      anchor != head && reached == step_start(editor)
    [Queued(move: PageUp, select: True), ..]
    | [Queued(move: PageDown, select: True), ..]
    | [Queued(move: LineUp, ..), ..]
    | [Queued(move: LineDown, ..), ..]
    | [Queued(move: LineStart, ..), ..]
    | [Queued(move: LineEnd, ..), ..]
    | [Queued(move: LetterBack, ..), ..]
    | [Queued(move: LetterOn, ..), ..]
    | [] -> False
  }
}

fn step_x(editor: Editor, move: Move) -> Option(Float) {
  case move, editor.vertical_goal {
    LineUp, Some(Goal(page_x: x, ..))
    | LineDown, Some(Goal(page_x: x, ..))
    | PageUp, Some(Goal(page_x: x, ..))
    | PageDown, Some(Goal(page_x: x, ..))
    -> Some(x)
    LineUp, None
    | LineDown, None
    | PageUp, None
    | PageDown, None
    | LineStart, _
    | LineEnd, _
    | LetterBack, _
    | LetterOn, _
    -> None
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

fn undrawn_row(editor: Editor, head: Position, by: Int) -> Position {
  let row = head.row + by
  Position(
    row:,
    col: int.min(run_col(editor, head), line_end(editor.buffer, row).col),
  )
}

fn among_marks(
  editor: Editor,
  head: Position,
  placed: Position,
  visible visible: String,
  next next: String,
) -> Position {
  let row_start = list.last(string.split(visible, "\n")) == Ok("")
  let blocks = case editor.field {
    Part(parsed:, ..) -> parsed
    Whole -> []
  }
  case row_start && next == "" && placed.col == 0 {
    False -> placed
    True ->
      case live.text_col(blocks, placed.row) {
        None -> placed
        Some(text) -> {
          let marks = int.min(text, line_end(editor.buffer, placed.row).col)
          Position(..placed, col: int.min(run_col(editor, head), marks))
        }
      }
  }
}

fn run_col(editor: Editor, head: Position) -> Int {
  case editor.vertical_goal {
    Some(Goal(markdown_col: col, ..)) -> col
    None -> head.col
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
  let page = case shown == field_buffer(editor) {
    True -> editor.page_backlog
    False -> behind([], held_keys(editor))
  }
  let editor =
    Editor(..editor, keys:, page_backlog: page) |> edit(wanted) |> place
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
  case editor.ime, editor.page_backlog {
    ComposingBehindHeldKeys, _ | NotComposing, Behind(..) ->
      Outcome(
        editor: Editor(..editor, ime: ComposingBehindHeldKeys),
        sync: InSync,
        requests: [],
      )
    ComposingHere, _ | NotComposing, CaughtUp -> compose_here(editor, shown)
  }
}

fn compose_here(editor: Editor, shown: Buffer) -> Outcome {
  let composed = base(editor, shown)
  let rows_kept =
    list.length(buffer.lines(composed))
    == list.length(buffer.lines(editor.buffer))
  case editor.field, rows_kept {
    Part(rows:, drawn:, parsed:, ..), True -> {
      let field = Part(rows:, drawn:, parsed:, composing: True, wide: False)
      Outcome(
        editor: Editor(..editor, buffer: composed, field:, ime: ComposingHere),
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
    Editor(..outcome.editor, history: before.history, ime: ComposingHere)
  Outcome(..outcome, editor:)
}

fn queue_ime_text_behind_page(
  editor: Editor,
  shown: Buffer,
  at: Int,
) -> Outcome {
  let field = field_buffer(editor)
  case ime_inserted_text(field, shown) {
    Error(Nil) -> typed(Editor(..editor, clock: at), shown, None, realign)
    Ok(text) -> {
      let keys = case text {
        "" -> held_keys(editor)
        _ -> list.append(held_keys(editor), [HeldPaste(text:, at:)])
      }
      let editor =
        Editor(
          ..editor,
          ime: NotComposing,
          page_backlog: behind(steps(editor), keys),
        )
      let sync = case steps(editor) {
        [Queued(move:, select:), ..] ->
          WriteAndStep(field, move:, select:, x: step_x(editor, move))
        [] -> Write(field)
      }
      Outcome(editor:, sync:, requests: [])
    }
  }
}

fn ime_inserted_text(before: Buffer, after: Buffer) -> Result(String, Nil) {
  let #(anchor, head) = buffer.selection(before)
  let #(from, to) = case buffer.compare(anchor, head) {
    order.Gt -> #(head, anchor)
    order.Lt | order.Eq -> #(anchor, head)
  }
  let end = buffer.cursor(after)
  let without = fn(text: Buffer, to: Position) {
    buffer.text(buffer.replace(text, from:, to:, with: ""))
  }
  case buffer.compare(from, end), without(before, to) == without(after, end) {
    order.Lt, True | order.Eq, True -> {
      let last = buffer.end_of(buffer.text(after))
      buffer.replace(after, from: end, to: last, with: "")
      |> buffer.replace(from: Position(0, 0), to: from, with: "")
      |> buffer.text
      |> Ok
    }
    order.Gt, _ | order.Lt, False | order.Eq, False -> Error(Nil)
  }
}

fn widen_field_to_note(editor: Editor, shown: Buffer) -> Outcome {
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
    editor.vertical_goal,
    shown == field_buffer(editor)
  {
    True, Some(goal), True -> Some(goal)
    True, _, _ if x >=. 0.0 -> Some(Goal(page_x: x, markdown_col: cursor.col))
    False, goal, _ if edge == OntoRowBefore || edge == OntoRowAfter -> goal
    True, _, _ | False, _, _ -> None
  }
  let start = Position(row: 0, col: 0)
  let end = end_of_row(list.length(lines) - 1)
  let at_row_end = head == end_of_row(head.row)
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
    SelectLeft if live && head.col == 0 && head.row > 0 ->
      reach(end_of_row(head.row - 1))
    SelectRight if live && at_row_end && head.row < end.row ->
      reach(Position(row: head.row + 1, col: 0))
    SelectLeft if live -> #(base, StepTo(Queued(LetterBack, select: True)))
    SelectRight if live -> #(base, StepTo(Queued(LetterOn, select: True)))
    SelectLineStart if live -> #(base, StepTo(Queued(LineStart, select: True)))
    SelectLineEnd if live -> #(base, StepTo(Queued(LineEnd, select: True)))
    LineInField(up: True, select: False) if live && anchor != head -> #(
      base,
      StepTo(Queued(LineUp, select: False)),
    )
    LineInField(up: False, select: False) if live && anchor != head -> #(
      base,
      StepTo(Queued(LineDown, select: False)),
    )
    LineInField(up: True, select:) if live -> #(base, Aim(LineAbove, select:))
    LineInField(up: False, select:) if live -> #(base, Aim(LineBelow, select:))
    NextRow(up:, select:) if live -> {
      let #(to, then) = case up {
        True if head.row == 0 -> #(start, Done)
        True -> #(end_of_row(head.row - 1), Aim(LastLine, select:))
        False if head.row == end.row -> #(end, Done)
        False -> #(Position(row: head.row + 1, col: 0), Aim(FirstLine, select:))
      }
      let selected = buffer.select(base, anchor:, head: to)
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
    OntoRowBefore if row_above -> #(
      buffer.move_to(base, end_of_row(cursor.row - 1)),
      Done,
    )
    OntoRowAfter if row_below -> #(
      buffer.move_to(base, Position(row: cursor.row + 1, col: 0)),
      Done,
    )
    ToNoteStart -> #(buffer.move_to(base, start), Done)
    ToNoteEnd -> #(buffer.move_to(base, end), Done)
    SelectToNoteStart -> reach(start)
    SelectToNoteEnd -> reach(end)
    SelectAll -> #(buffer.select(base, anchor: start, head: end), Done)
    Up
    | Down
    | JoinBefore
    | JoinAfter
    | Line(..)
    | SelectBefore
    | SelectAfter
    | Page(..)
    | LineInField(..)
    | NextRow(..)
    | WidenToNote
    | SelectLeft
    | SelectRight
    | SelectLineStart
    | SelectLineEnd
    | OntoRowBefore
    | OntoRowAfter -> #(base, Done)
  }
  let page = case then {
    StepTo(step) ->
      behind(list.append(steps(editor), [step]), held_keys(editor))
    Done | Aim(..) -> editor.page_backlog
  }
  let first = steps(editor) == []
  let editor =
    Editor(..edit(editor, wanted), page_backlog: page, vertical_goal: goal)
    |> realign
  let wanted_shown = field_buffer(editor)
  let sync = case then, wanted_shown == shown {
    Aim(line, select:), _ ->
      WriteAndAim(
        wanted_shown,
        x: option.map(goal, fn(goal) { goal.page_x }) |> option.unwrap(x),
        line:,
        select:,
      )
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
  let ime = case buffer == editor.buffer {
    True -> editor.ime
    False -> NotComposing
  }
  Editor(..editor, buffer:, field:, history:, ime:)
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
    editor.note_choice,
    markdown.set_task(text, task, checked),
    list.drop(buffer.lines(editor.buffer), task.row)
  {
    Chosen, Ok(line), [old, ..] -> {
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
    Choosing(..), _, _ | Chosen, Error(_), _ | Chosen, _, [] ->
      Outcome(editor:, sync: InSync, requests: [])
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

/// How the field is set (`kind`), and the kind of rows whose height and
/// margins it keeps (`frame`).
pub type Setting {
  Setting(kind: live.Kind, frame: live.Kind)
}

/// `kind`: like the field's blocks as drawn, so that typing changes no row
/// but the one typed on. A field that holds only the caret's row is set as
/// typed, at once: like the blocks typed there, or as body text when that row
/// joins a block outside the field.
///
/// `frame`: the kind of the field's rows as the page was laid out, so the
/// page around a row typed as another kind does not move. A heading, even
/// one with no text yet, is the exception: a row typed as one, or a heading's row typed as
/// something else, is framed as typed at once, and the rows below move once.
///
/// None while the field holds the whole note.
pub fn setting(editor: Editor) -> Option(Setting) {
  case editor.field {
    Whole -> None
    Part(rows:, drawn:, parsed:, ..) -> {
      let lines = buffer.lines(editor.buffer)
      let row = buffer.cursor(editor.buffer).row
      let alone = rows == Region(row, row)
      let own = live.reveal(parsed, from: row, to: row) == rows
      let laid_out = live.kind(drawn, field: rows, lines:)
      let kind = case alone, own {
        True, True -> live.kind(parsed, field: rows, lines:)
        True, False -> live.Body
        False, _ -> laid_out
      }
      let frame = case live.is_title(laid_out) || live.is_title(kind) {
        True -> kind
        False -> laid_out
      }
      Some(Setting(kind:, frame:))
    }
  }
}

pub fn kind(editor: Editor) -> Option(live.Kind) {
  option.map(setting(editor), fn(setting) { setting.kind })
}

pub fn frame(editor: Editor) -> Option(live.Kind) {
  option.map(setting(editor), fn(setting) { setting.frame })
}

/// The page as laid out, drawn around the field. Empty while the field
/// holds the whole note.
pub fn blocks(editor: Editor) -> List(Block) {
  case editor.field {
    Whole -> []
    Part(drawn:, ..) -> drawn
  }
}

pub fn is_painted(editor: Editor) -> Bool {
  let #(anchor, head) = buffer.selection(editor.buffer)
  case editor.paints, editor.field, editor.focus {
    _, Part(wide: True, ..), Focused -> True
    True, Part(rows:, drawn:, ..), Focused ->
      anchor != head && rows != live.reveal(drawn, from: head.row, to: head.row)
    _, Part(..), Away | _, Whole, _ | False, Part(..), Focused -> False
  }
}

pub fn is_stepping(editor: Editor) -> Bool {
  steps(editor) != [] && editor.ime == NotComposing
}

pub fn keys_wait(editor: Editor) -> Bool {
  editor.page_backlog != CaughtUp
  || is_wide(editor)
  || editor.note_choice != Chosen
}

pub fn replay(editor: Editor) -> Option(Held) {
  let held_back =
    editor.ime != NotComposing
    || is_wide(editor)
    || editor.note_choice != Chosen
  case editor.page_backlog, held_back {
    Behind(steps_for_page: [], keys_behind_steps: [key, ..]), False -> Some(key)
    Behind(steps_for_page: [], keys_behind_steps: [_, ..]), True
    | Behind(steps_for_page: [], keys_behind_steps: []), _
    | Behind(steps_for_page: [_, ..], ..), _
    | CaughtUp, _
    -> None
  }
}

fn is_wide(editor: Editor) -> Bool {
  case editor.field {
    Part(wide:, ..) -> wide
    Whole -> False
  }
}

pub fn is_pressed(editor: Editor) -> Bool {
  editor.press != None
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
