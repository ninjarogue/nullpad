//// What a person does to the editor, as data, and how it reaches the editor:
//// each action becomes the events the page would send for it, built from the
//// field as the editor last wrote it, the way a text field reports a change.
//// Positions and lengths are numbers that wrap into the note when the action
//// runs, so a shrunk action stays valid whatever the note became.

import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/string
import nullpad/buffer.{type Buffer, type Position, Position}
import nullpad/editor.{type Editor}
import nullpad/live.{Region}
import nullpad/markdown.{Task}
import nullpad/vim
import properties/gen
import qcheck.{type Generator}

pub type Pointer {
  Pressed
  TriplePressed
  ShiftPressed
  Grabbed
  DoublePressed
  PressedOnSelection
  Dragged
  Stepped
}

pub type Action {
  Type(text: String, gap: Int)
  Backspace(gap: Int)
  DeleteForward(gap: Int)
  Replace(at: Int, length: Int, text: String, gap: Int)
  Select(at: Int, length: Int, backward: Bool)
  Point(pointer: Pointer, row: Int, col: Int, at_end: Bool)
  Key(key: vim.Key)
  Edge(edge: editor.Edge, x: Float)
  Escape
  Release
  StartDrag
  Drop(row: Int, col: Int, text: String, copy: Bool)
  Focus(focused: Bool)
  Undo
  Redo
  Compose(at: Int, length: Int, text: String, ends: Bool, gap: Int)
  Unstep(x: Float)
  FieldStep(at: Int, length: Int)
  Aim(at: Int)
  StepPast
  Settle(row: Int, col: Int)
  Hold(editor.Held)
  Replay
  Tick(row: Int, col: Int, checked: Bool)
  Open(text: String)
  SetLive(on: Bool)
}

/// What an action changed in the field's text: the graphemes from `from` to
/// `to` became `with`. `rows` are the rows of the note the field held, and
/// `field` its text, before the change.
pub type FieldEdit {
  FieldEdit(
    rows: Option(#(Int, Int)),
    field: String,
    from: Int,
    to: Int,
    with: String,
  )
}

pub type Run {
  Run(editor: Editor, clock: Int, edit: Option(FieldEdit))
}

pub fn start(editor: Editor) -> Run {
  Run(editor:, clock: 0, edit: None)
}

fn gap() -> Generator(Int) {
  gen.element(0, [50, 400, 1500, 6000])
}

fn offset() -> Generator(Int) {
  qcheck.bounded_int(0, 400)
}

fn row() -> Generator(Int) {
  qcheck.bounded_int(0, 60)
}

pub fn edits() -> Generator(Action) {
  gen.weighted(#(6, qcheck.map2(gen.typed(), gap(), Type)), [
    #(3, qcheck.map(gap(), Backspace)),
    #(1, qcheck.map(gap(), DeleteForward)),
    #(
      3,
      qcheck.map4(
        offset(),
        qcheck.bounded_int(0, 12),
        gen.typed(),
        gap(),
        Replace,
      ),
    ),
    #(
      2,
      qcheck.map3(offset(), qcheck.bounded_int(0, 30), qcheck.bool(), Select),
    ),
  ])
}

pub fn typing() -> Generator(Action) {
  gen.weighted(#(10, edits()), [
    #(
      3,
      qcheck.map4(qcheck.return(Pressed), row(), offset(), qcheck.bool(), Point),
    ),
  ])
}

fn pointer() -> Generator(Pointer) {
  gen.element(Pressed, [
    TriplePressed,
    ShiftPressed,
    Grabbed,
    DoublePressed,
    PressedOnSelection,
    Dragged,
    Stepped,
  ])
}

fn key() -> Generator(vim.Key) {
  gen.weighted(
    #(
      8,
      gen.element("i", [
        "a", "o", "h", "j", "k", "l", "x", "d", "w", "b", "0", "$", "p", "u",
        ".", "y", "G", "O", "A", "I", "D", "é", "😀", " ", "-",
      ])
        |> qcheck.map(vim.Char),
    ),
    [
      #(2, qcheck.return(vim.Escape)),
      #(1, qcheck.return(vim.Enter)),
      #(1, qcheck.return(vim.Ctrl("r"))),
    ],
  )
}

fn edge() -> Generator(editor.Edge) {
  gen.element(editor.Up, [
    editor.Down,
    editor.JoinBefore,
    editor.JoinAfter,
    editor.Line(up: True, select: False),
    editor.Line(up: False, select: True),
    editor.Beside(up: False, select: False),
    editor.Beside(up: True, select: True),
    editor.SelectBefore,
    editor.SelectAfter,
    editor.SelectLeft,
    editor.SelectRight,
    editor.SelectLineStart,
    editor.SelectLineEnd,
    editor.SelectToStart,
    editor.SelectToEnd,
    editor.SelectAll,
    editor.Page(up: True, select: False),
    editor.Page(up: False, select: True),
    editor.Row(up: True, select: True),
    editor.Row(up: False, select: False),
    editor.Before,
    editor.After,
    editor.ToStart,
    editor.ToEnd,
    editor.Widen,
  ])
}

fn x() -> Generator(Float) {
  qcheck.bounded_float(-1.0, 300.0)
}

fn held() -> Generator(editor.Held) {
  gen.weighted(
    #(
      4,
      qcheck.map2(
        gen.element("a", [
          "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Backspace",
          "Delete", "Enter", "Home", "End", "é",
        ]),
        qcheck.bool(),
        fn(key, shift) {
          editor.HeldKey(
            key:,
            code: "",
            shift:,
            ctrl: False,
            meta: False,
            alt: False,
            at: 0,
          )
        },
      ),
    ),
    [
      #(1, qcheck.map(gen.typed(), editor.HeldPaste(_, 0))),
      #(1, qcheck.return(editor.HeldUndo)),
      #(1, qcheck.return(editor.HeldRedo)),
    ],
  )
}

pub fn anything() -> Generator(Action) {
  gen.weighted(#(10, typing()), [
    #(6, qcheck.map4(pointer(), row(), offset(), qcheck.bool(), Point)),
    #(5, qcheck.map(key(), Key)),
    #(4, qcheck.map2(edge(), x(), Edge)),
    #(1, qcheck.return(Escape)),
    #(1, qcheck.return(Release)),
    #(1, qcheck.return(StartDrag)),
    #(2, qcheck.map4(row(), offset(), gen.typed(), qcheck.bool(), Drop)),
    #(2, qcheck.map(qcheck.bool(), Focus)),
    #(2, qcheck.return(Undo)),
    #(2, qcheck.return(Redo)),
    #(
      2,
      qcheck.map5(
        offset(),
        qcheck.bounded_int(0, 6),
        gen.typed(),
        qcheck.bool(),
        gap(),
        Compose,
      ),
    ),
    #(1, qcheck.map(x(), Unstep)),
    #(1, qcheck.map2(offset(), qcheck.bounded_int(0, 20), FieldStep)),
    #(1, qcheck.map(offset(), Aim)),
    #(1, qcheck.return(StepPast)),
    #(1, qcheck.map2(row(), offset(), Settle)),
    #(1, qcheck.map(held(), Hold)),
    #(1, qcheck.return(Replay)),
    #(1, qcheck.map3(row(), offset(), qcheck.bool(), Tick)),
    #(1, qcheck.map(gen.note(gen.Anything), Open)),
    #(1, qcheck.map(qcheck.bool(), SetLive)),
  ])
}

/// A plain-string model of one position: the place after the first `offset`
/// graphemes of `text`.
pub fn position_of(text: String, offset: Int) -> Position {
  let rows = string.split(string.slice(text, 0, offset), "\n")
  let last = list.last(rows) |> option.from_result |> option.unwrap("")
  Position(row: list.length(rows) - 1, col: string.length(last))
}

/// The number of graphemes of the text before `position`.
pub fn offset_of(text: String, position: Position) -> Int {
  let above =
    string.split(text, "\n")
    |> list.take(position.row)
    |> list.fold(0, fn(sum, line) { sum + string.length(line) + 1 })
  above + position.col
}

pub fn normalized(text: String) -> String {
  string.replace(text, "\r\n", "\n")
}

fn shown(text: String, anchor: Int, head: Int) -> Buffer {
  buffer.from_text(text)
  |> buffer.select(
    anchor: position_of(text, anchor),
    head: position_of(text, head),
  )
}

fn send(ed: Editor, event: editor.Event) -> Editor {
  editor.update(ed, event).editor
}

fn field(ed: Editor) -> #(Buffer, String, Int) {
  let field = editor.field_buffer(ed)
  let text = buffer.text(field)
  #(field, text, string.length(text))
}

fn selection_offsets(field: Buffer, text: String) -> #(Int, Int) {
  let #(anchor, head) = buffer.selection(field)
  #(offset_of(text, anchor), offset_of(text, head))
}

fn change(
  ed: Editor,
  clock: Int,
  from from: Int,
  to to: Int,
  with inserted: String,
  gap gap: Int,
) -> Run {
  let #(_, text, size) = field(ed)
  let inserted = normalized(inserted)
  let after =
    string.slice(text, 0, from) <> inserted <> string.slice(text, to, size)
  let caret = string.length(string.slice(text, 0, from) <> inserted)
  let clock = clock + gap
  let rows = case editor.region(ed) {
    Some(Region(first_row:, last_row:)) -> Some(#(first_row, last_row))
    None -> None
  }
  let edit = FieldEdit(rows:, field: text, from:, to:, with: inserted)
  let shown = shown(after, caret, caret)
  let ed = send(ed, editor.ControlChanged(shown:, at: clock))
  Run(editor: ed, clock:, edit: Some(edit))
}

fn typed_over(ed: Editor, clock: Int, text: String, gap: Int) -> Run {
  let #(field, now, _) = field(ed)
  let #(anchor, head) = selection_offsets(field, now)
  let from = int.min(anchor, head)
  let to = int.max(anchor, head)
  change(ed, clock, from:, to:, with: text, gap:)
}

fn select_range(
  ed: Editor,
  clock: Int,
  at: Int,
  length: Int,
  backward: Bool,
) -> Editor {
  let #(_, text, size) = field(ed)
  let start = at % { size + 1 }
  let end = start + length % { size - start + 1 }
  let #(anchor, head) = case backward {
    True -> #(end, start)
    False -> #(start, end)
  }
  send(ed, editor.ControlChanged(shown: shown(text, anchor, head), at: clock))
}

/// A row past the end of the note is kept: the page may measure a place
/// against a note that has since changed.
fn place(ed: Editor, row: Int, col: Int) -> #(Int, String, String) {
  let line = row_of(buffer.lines(editor.buffer(ed)), row)
  let col = col % { string.length(line) + 1 }
  let next = case string.slice(line, col, 1) {
    "" -> "\n"
    letter -> letter
  }
  #(row, string.slice(line, 0, col), next)
}

fn row_of(lines: List(String), row: Int) -> String {
  list.drop(lines, row) |> list.first |> option.from_result |> option.unwrap("")
}

fn pointer_event(
  ed: Editor,
  pointer: Pointer,
  row: Int,
  col: Int,
  at_end: Bool,
) -> editor.Event {
  let #(row, visible, next) = place(ed, row, col)
  let shown = editor.field_buffer(ed)
  case pointer {
    Pressed -> editor.Pointed(row:, visible:, at_end:, next:, x: 0.0, y: 0.0)
    TriplePressed ->
      editor.LinePointed(row:, visible:, at_end:, next:, x: 0.0, y: 0.0)
    ShiftPressed ->
      editor.ShiftPointed(
        row:,
        visible:,
        at_end:,
        next:,
        shown:,
        x: 0.0,
        y: 0.0,
      )
    Grabbed -> editor.Grabbed(row:, visible:, at_end:, next:, x: 0.0, y: 0.0)
    DoublePressed ->
      editor.WordPressed(row:, visible:, at_end:, next:, x: 0.0, y: 0.0)
    PressedOnSelection ->
      editor.SelectionPointed(row:, visible:, at_end:, next:, x: 0.0, y: 0.0)
    Dragged -> editor.Dragged(row:, visible:, at_end:, next:)
    Stepped -> editor.Stepped(row:, visible:, at_end:, next:, x: 5.0)
  }
}

pub fn run(previous: Run, action: Action) -> Run {
  let Run(editor: ed, clock:, ..) = previous
  let plain = fn(ed) { Run(editor: ed, clock:, edit: None) }
  case action {
    Type(text:, gap:) -> typed_over(ed, clock, text, gap)
    Backspace(gap:) -> {
      let #(field, text_now, _) = field(ed)
      let #(anchor, head) = selection_offsets(field, text_now)
      let #(from, to) = case anchor == head {
        True -> #(int.max(head - 1, 0), head)
        False -> #(int.min(anchor, head), int.max(anchor, head))
      }
      change(ed, clock, from:, to:, with: "", gap:)
    }
    DeleteForward(gap:) -> {
      let #(field, text_now, size) = field(ed)
      let #(anchor, head) = selection_offsets(field, text_now)
      let #(from, to) = case anchor == head {
        True -> #(head, int.min(head + 1, size))
        False -> #(int.min(anchor, head), int.max(anchor, head))
      }
      change(ed, clock, from:, to:, with: "", gap:)
    }
    Replace(at:, length:, text:, gap:) -> {
      let #(_, _, size) = field(ed)
      let from = at % { size + 1 }
      change(
        ed,
        clock,
        from:,
        to: from + length % { size - from + 1 },
        with: text,
        gap:,
      )
    }
    Select(at:, length:, backward:) ->
      plain(select_range(ed, clock, at, length, backward))
    Point(pointer:, row:, col:, at_end:) ->
      plain(send(ed, pointer_event(ed, pointer, row, col, at_end)))
    Key(key:) ->
      plain(send(ed, editor.KeyPressed(key:, shown: editor.field_buffer(ed))))
    Edge(edge:, x:) ->
      plain(send(
        ed,
        editor.EdgePressed(edge:, x:, shown: editor.field_buffer(ed)),
      ))
    Escape ->
      plain(send(ed, editor.EscapePressed(shown: editor.field_buffer(ed))))
    Release -> plain(send(ed, editor.Released))
    StartDrag -> plain(send(ed, editor.DragStarted))
    Drop(row:, col:, text:, copy:) -> {
      let #(row, visible, next) = place(ed, row, col)
      let event =
        editor.Dropped(
          row:,
          visible:,
          at_end: False,
          next:,
          text: normalized(text),
          copy:,
          shown: editor.field_buffer(ed),
        )
      plain(send(ed, event))
    }
    Focus(focused:) -> plain(send(ed, editor.FocusChanged(focused:)))
    Undo -> plain(send(ed, editor.UndoAsked))
    Redo -> plain(send(ed, editor.RedoAsked))
    Compose(at:, length:, text:, ends:, gap:) -> {
      let #(_, current, size) = field(ed)
      let from = at % { size + 1 }
      let to = from + length % { size - from + 1 }
      let inserted = normalized(text)
      let after =
        string.slice(current, 0, from)
        <> inserted
        <> string.slice(current, to, size)
      let caret = string.length(string.slice(current, 0, from) <> inserted)
      let clock = clock + gap
      let event = case ends {
        True -> editor.Composed(shown: shown(after, caret, caret), at: clock)
        False -> editor.Composing(shown: shown(after, caret, caret))
      }
      Run(editor: send(ed, event), clock:, edit: None)
    }
    Unstep(x:) -> plain(send(ed, editor.Unstepped(x:)))
    FieldStep(at:, length:) -> {
      let selected = select_range(ed, clock, at, length, False)
      plain(send(
        ed,
        editor.FieldStepped(shown: editor.field_buffer(selected), x: 4.0),
      ))
    }
    Aim(at:) -> {
      let selected = select_range(ed, clock, at, 0, False)
      plain(send(ed, editor.Aimed(shown: editor.field_buffer(selected))))
    }
    StepPast -> plain(send(ed, editor.SteppedPast))
    Settle(row:, col:) -> {
      let current = buffer.selection(editor.buffer(ed))
      let to = Position(row:, col:)
      plain(send(ed, editor.Settled(from: current, to: #(to, to))))
    }
    Hold(held) -> plain(send(ed, editor.KeyHeld(held)))
    Replay -> plain(send(ed, editor.Replayed(None)))
    Tick(row:, col:, checked:) ->
      plain(editor.tick(ed, Task(checked:, row:, col:), checked).editor)
    Open(text:) ->
      Run(editor: editor.open(ed, text).editor, clock: 0, edit: None)
    SetLive(on:) -> plain(editor.set_live(ed, on).editor)
  }
}
