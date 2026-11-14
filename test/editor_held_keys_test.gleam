//// Keys pressed before the page has drawn what the editor asked of it: they
//// wait behind the steps of the head the page has not taken, and are replayed
//// one at a time, in the order they were pressed, once it has.

import gleam/list
import gleam/option.{None, Some}
import nullpad/buffer.{Position}
import nullpad/editor.{type Editor, type Held, Outcome}

const note = "alpha beta\n\nsecond para here\nthird row\n\nlast"

fn opened() -> Editor {
  let opened =
    editor.new(vim: False, live: False, paint: True) |> editor.open(note)
  editor.set_live(opened.editor, True).editor
}

fn key(name: String) -> Held {
  editor.HeldKey(
    key: name,
    code: "",
    shift: False,
    ctrl: False,
    meta: False,
    alt: False,
    at: 0,
  )
}

fn shifted(name: String) -> Held {
  editor.HeldKey(
    key: name,
    code: "",
    shift: True,
    ctrl: False,
    meta: False,
    alt: False,
    at: 0,
  )
}

fn ctrl(name: String) -> Held {
  editor.HeldKey(
    key: name,
    code: "",
    shift: False,
    ctrl: True,
    meta: False,
    alt: False,
    at: 0,
  )
}

/// Shift and Down, which the page takes.
fn step_down(ed: Editor) -> Editor {
  let shown = editor.field_buffer(ed)
  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.EdgePressed(editor.Line(up: False, select: True), x: 0.0, shown:),
    )
  let assert editor.WriteAndStep(..) = sync
  ed
}

/// The page took the step down from the first row to the blank row.
fn stepped(ed: Editor) -> Editor {
  editor.update(
    ed,
    editor.Stepped(row: 1, visible: "", at_end: False, next: "", x: 0.0),
  ).editor
}

fn hold(ed: Editor, held: Held) -> Editor {
  let Outcome(editor: after, sync:, ..) =
    editor.update(ed, editor.KeyHeld(held))
  assert sync == editor.InSync
  assert editor.buffer(after) == editor.buffer(ed)
  after
}

pub fn every_kind_of_key_waits_behind_a_step_and_replays_in_order_test() {
  let keys = [
    key("x"),
    key("Enter"),
    key("Backspace"),
    key("Delete"),
    key("ArrowLeft"),
    shifted("ArrowRight"),
    ctrl("ArrowLeft"),
    key("Home"),
    shifted("ArrowDown"),
    key("PageDown"),
    ctrl("Backspace"),
    ctrl("a"),
    ctrl("z"),
    ctrl("e"),
    editor.HeldPaste(text: "pasted", at: 0),
    editor.HeldUndo,
    editor.HeldRedo,
    key("Escape"),
  ]
  let ed = opened() |> step_down
  let ed = list.fold(keys, ed, hold)
  assert editor.is_waiting(ed)
  assert editor.replay(ed) == None

  let ed = stepped(ed)
  assert buffer.selection(editor.buffer(ed))
    == #(Position(row: 0, col: 0), Position(row: 1, col: 0))
  let ed =
    list.fold(keys, ed, fn(ed, held) {
      assert editor.replay(ed) == Some(held)
      editor.update(ed, editor.Replayed(None)).editor
    })
  assert editor.replay(ed) == None
  assert !editor.is_waiting(ed)
}

pub fn a_replayed_step_holds_the_keys_behind_it_until_the_page_takes_it_test() {
  let ed =
    opened()
    |> step_down
    |> hold(shifted("ArrowDown"))
    |> hold(key("x"))
    |> stepped
  assert editor.replay(ed) == Some(shifted("ArrowDown"))

  let shown = editor.field_buffer(ed)
  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.Replayed(
        Some(editor.EdgePressed(
          editor.Line(up: False, select: True),
          x: 0.0,
          shown:,
        )),
      ),
    )
  let assert editor.WriteAndStep(move: editor.LineDown, select: True, ..) = sync
  assert editor.replay(ed) == None

  let ed =
    editor.update(
      ed,
      editor.Stepped(row: 2, visible: "", at_end: False, next: "", x: 0.0),
    ).editor
  assert buffer.selection(editor.buffer(ed))
    == #(Position(row: 0, col: 0), Position(row: 2, col: 0))
  assert editor.replay(ed) == Some(key("x"))
}

pub fn a_replayed_letter_types_over_what_the_step_selected_test() {
  let ed = opened() |> step_down |> hold(key("x")) |> stepped
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.Replayed(
        Some(editor.ControlChanged(shown: typed_over(ed, "x"), at: 0)),
      ),
    )
  assert editor.text(ed) == "x\nsecond para here\nthird row\n\nlast"
  assert editor.replay(ed) == None
  assert !editor.is_waiting(ed)
}

/// The field once `text` is typed over its selection.
fn typed_over(ed: Editor, text: String) -> buffer.Buffer {
  let field = editor.field_buffer(ed)
  let #(anchor, head) = buffer.selection(field)
  buffer.replace(field, from: anchor, to: head, with: text)
}

pub fn a_press_drops_the_keys_waiting_behind_a_step_test() {
  let ed = opened() |> step_down |> hold(key("x")) |> hold(key("Enter"))
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.Pointed(
        row: 2,
        visible: "sec",
        at_end: False,
        next: "",
        x: 0.0,
        y: 0.0,
      ),
    )
  assert !editor.is_waiting(ed)
  assert editor.replay(ed) == None

  let ed = stepped(ed)
  assert buffer.selection(editor.buffer(ed))
    == #(Position(row: 2, col: 3), Position(row: 2, col: 3))
  assert editor.replay(ed) == None
}

pub fn the_focus_leaving_drops_the_keys_waiting_test() {
  let ed = opened() |> step_down |> hold(key("x"))
  let ed = editor.update(ed, editor.FocusChanged(focused: False)).editor
  assert !editor.is_waiting(ed)
  assert editor.replay(ed) == None
}

pub fn an_undo_waits_behind_the_keys_pressed_before_it_test() {
  let ed = opened() |> step_down |> hold(key("x"))
  let Outcome(editor: ed, sync:, ..) = editor.update(ed, editor.UndoAsked)
  assert sync == editor.InSync
  assert editor.text(ed) == note

  let ed = stepped(ed)
  assert editor.replay(ed) == Some(key("x"))
  let ed =
    editor.update(
      ed,
      editor.Replayed(
        Some(editor.ControlChanged(shown: typed_over(ed, "x"), at: 0)),
      ),
    ).editor
  assert editor.text(ed) == "x\nsecond para here\nthird row\n\nlast"
  assert editor.replay(ed) == Some(editor.HeldUndo)

  let ed = editor.update(ed, editor.Replayed(Some(editor.UndoAsked))).editor
  assert editor.text(ed) == note
  assert !editor.is_waiting(ed)
}

pub fn a_key_held_when_nothing_waits_is_replayed_at_once_test() {
  let ed = opened() |> hold(key("x"))
  assert editor.is_waiting(ed)
  assert editor.replay(ed) == Some(key("x"))
}

pub fn held_keys_wait_while_an_ime_composes_test() {
  let ed = opened() |> hold(key("x"))
  let composing =
    buffer.from_text("あalpha beta") |> buffer.move_to(Position(row: 0, col: 1))
  let ed = editor.update(ed, editor.Composing(shown: composing)).editor
  assert editor.replay(ed) == None

  let ed =
    editor.update(ed, editor.ControlChanged(shown: composing, at: 0)).editor
  assert editor.replay(ed) == Some(key("x"))
}

pub fn a_replayed_key_the_browser_takes_past_the_field_is_acted_on_test() {
  let ed = opened() |> step_down |> hold(ctrl("End")) |> stepped
  let shown = editor.field_buffer(ed)
  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.Replayed(Some(editor.EdgePressed(editor.Widen, x: 0.0, shown:))),
    )
  let assert editor.WriteAndAct(whole, key: held) = sync
  assert held == ctrl("End")
  assert buffer.text(whole) == note
  assert editor.replay(ed) == None
}
