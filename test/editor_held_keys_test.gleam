//// Keys pressed before the page has drawn what the editor asked of it: they
//// wait behind the steps of the head the page has not taken, and are replayed
//// one at a time, in the order they were pressed, once it has.

import gleam/list
import gleam/option.{None, Some}
import gleam/order
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

  let ed = editor.update(ed, editor.Composed(shown: composing, at: 0)).editor
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

pub fn keys_wait_while_the_field_holds_the_note_for_the_browser_test() {
  let ed = opened()
  let Outcome(editor: ed, sync:, ..) =
    editor.update(
      ed,
      editor.EdgePressed(editor.Widen, x: 0.0, shown: editor.field_buffer(ed)),
    )
  let assert editor.WriteAndRead(whole) = sync
  assert editor.is_waiting(ed)

  let ed = hold(ed, shifted("ArrowLeft"))
  assert editor.replay(ed) == None
  let ed = editor.update(ed, editor.ControlChanged(shown: whole, at: 0)).editor
  assert editor.replay(ed) == Some(shifted("ArrowLeft"))
}

pub fn a_replayed_key_steers_the_head_the_way_it_moved_it_test() {
  let held = shifted("ArrowLeft")
  let ed = opened() |> step_down |> hold(held) |> stepped
  assert editor.direction(ed) == order.Gt
  assert editor.replay(ed) == Some(held)

  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.Replayed(
        Some(editor.EdgePressed(
          editor.SelectLeft,
          x: 0.0,
          shown: editor.field_buffer(ed),
        )),
      ),
    )
  assert buffer.selection(editor.buffer(ed))
    == #(Position(row: 0, col: 0), Position(row: 0, col: 10))
  assert editor.direction(ed) == order.Lt
}

/// `field` with `text` put over its selection, as an IME composes it there.
fn over(field: buffer.Buffer, text: String) -> buffer.Buffer {
  let #(anchor, head) = buffer.selection(field)
  let #(from, to) = case buffer.compare(anchor, head) {
    order.Gt -> #(head, anchor)
    order.Lt | order.Eq -> #(anchor, head)
  }
  buffer.replace(field, from:, to:, with: text)
}

/// Every held key replayed, as the surface replays them once the page has
/// caught up: a letter or a text typed over the field's selection, an undo
/// or a redo asked again.
fn drain(ed: Editor) -> Editor {
  let typed = fn(text) {
    editor.update(
      ed,
      editor.Replayed(
        Some(editor.ControlChanged(shown: typed_over(ed, text), at: 0)),
      ),
    ).editor
  }
  case editor.replay(ed) {
    None -> ed
    Some(editor.HeldKey(key:, ..)) -> drain(typed(key))
    Some(editor.HeldPaste(text:, ..)) -> drain(typed(text))
    Some(editor.HeldUndo) ->
      drain(editor.update(ed, editor.Replayed(Some(editor.UndoAsked))).editor)
    Some(editor.HeldRedo) ->
      drain(editor.update(ed, editor.Replayed(Some(editor.RedoAsked))).editor)
  }
}

/// An IME begins to compose while the page is behind: a text field would
/// have done the step and the key first, so what it composes goes in after
/// them, over what they leave selected. The field is the IME's until it
/// ends, so the step waits too, and the field is put back once it ends.
pub fn text_an_ime_composes_behind_a_held_key_goes_in_after_it_test() {
  let ed = opened() |> step_down |> hold(key("z"))
  let field = editor.field_buffer(ed)
  let ed = editor.update(ed, editor.Composing(shown: over(field, "k"))).editor
  assert !editor.is_stepping(ed)
  assert editor.replay(ed) == None
  let ed = editor.update(ed, editor.Composing(shown: over(field, "か"))).editor

  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.Composed(shown: over(field, "か"), at: 0))
  assert editor.text(ed) == note
  let assert editor.WriteAndStep(
    written,
    move: editor.LineDown,
    select: True,
    ..,
  ) = sync
  assert written == field

  let ed = ed |> stepped |> drain
  assert editor.text(ed) == "zか\nsecond para here\nthird row\n\nlast"
  assert !editor.is_waiting(ed)
}

pub fn text_an_ime_composes_while_only_a_step_waits_goes_over_what_it_selects_test() {
  let ed = opened() |> step_down
  let field = editor.field_buffer(ed)
  let ed = editor.update(ed, editor.Composing(shown: over(field, "か"))).editor
  let ed =
    editor.update(ed, editor.Composed(shown: over(field, "か"), at: 0)).editor
  assert editor.text(ed) == note

  let ed = ed |> stepped |> drain
  assert editor.text(ed) == "か\nsecond para here\nthird row\n\nlast"
  assert !editor.is_waiting(ed)
}

pub fn text_an_ime_composes_before_a_held_key_is_replayed_goes_in_after_it_test() {
  let ed = opened() |> hold(key("x"))
  let field = editor.field_buffer(ed)
  let ed = editor.update(ed, editor.Composing(shown: over(field, "あ"))).editor
  assert editor.replay(ed) == None

  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.Composed(shown: over(field, "あ"), at: 0))
  assert sync == editor.Write(field)
  assert editor.text(ed) == note

  let ed = drain(ed)
  assert editor.text(ed) == "xあ" <> note
  assert !editor.is_waiting(ed)
}

/// Chrome sends `select` while an IME composes, which the surface reports as
/// a change of the field.
pub fn a_select_while_an_ime_composes_behind_a_key_does_not_end_it_test() {
  let ed = opened() |> step_down |> hold(key("z"))
  let field = editor.field_buffer(ed)
  let ed = editor.update(ed, editor.Composing(shown: over(field, "k"))).editor

  let Outcome(editor: ed, sync:, ..) =
    editor.update(ed, editor.ControlChanged(shown: over(field, "k"), at: 0))
  assert sync == editor.InSync
  assert editor.text(ed) == note
  assert !editor.is_stepping(ed)
  assert editor.replay(ed) == None

  let ed =
    editor.update(ed, editor.Composed(shown: over(field, "k"), at: 0)).editor
  let ed = ed |> stepped |> drain
  assert editor.text(ed) == "zk\nsecond para here\nthird row\n\nlast"
}

pub fn undo_and_redo_asked_while_an_ime_composes_behind_a_key_are_not_taken_test() {
  let ed = opened() |> step_down |> hold(key("z"))
  let field = editor.field_buffer(ed)
  let ed = editor.update(ed, editor.Composing(shown: over(field, "k"))).editor

  let Outcome(editor: ed, sync:, ..) = editor.update(ed, editor.UndoAsked)
  assert sync == editor.InSync
  let Outcome(editor: ed, sync:, ..) = editor.update(ed, editor.RedoAsked)
  assert sync == editor.InSync

  let ed =
    editor.update(ed, editor.Composed(shown: over(field, "か"), at: 0)).editor
  let ed = ed |> stepped |> drain
  assert editor.text(ed) == "zか\nsecond para here\nthird row\n\nlast"
  assert !editor.is_waiting(ed)
}

pub fn an_undo_held_before_a_composition_is_taken_before_it_test() {
  let ed = opened() |> step_down |> hold(key("z"))
  let ed = editor.update(ed, editor.UndoAsked).editor
  let field = editor.field_buffer(ed)
  let ed = editor.update(ed, editor.Composing(shown: over(field, "k"))).editor
  let ed = editor.update(ed, editor.RedoAsked).editor
  let ed =
    editor.update(ed, editor.Composed(shown: over(field, "か"), at: 0)).editor

  let ed = ed |> stepped |> drain
  assert editor.text(ed) == "か\nsecond para here\nthird row\n\nlast"
  assert !editor.is_waiting(ed)
}

pub fn an_undo_after_a_composition_behind_a_key_takes_back_the_composition_test() {
  let ed = opened() |> step_down |> hold(key("z"))
  let field = editor.field_buffer(ed)
  let ed = editor.update(ed, editor.Composing(shown: over(field, "か"))).editor
  let ed =
    editor.update(ed, editor.Composed(shown: over(field, "か"), at: 0)).editor
  let ed = editor.update(ed, editor.UndoAsked).editor

  let ed = ed |> stepped |> drain
  assert editor.text(ed) == note
  assert !editor.is_waiting(ed)
}

/// An IME may convert text before the caret again, past the selection it
/// began in: what it leaves is kept where it left it.
pub fn text_an_ime_converts_again_behind_a_held_key_is_kept_test() {
  let ed = opened() |> step_down |> hold(key("z"))
  let converted =
    buffer.from_text("ALPHA beta") |> buffer.move_to(Position(row: 0, col: 5))
  let ed = editor.update(ed, editor.Composing(shown: converted)).editor
  let ed = editor.update(ed, editor.Composed(shown: converted, at: 0)).editor
  assert editor.text(ed) == "ALPHA beta\n\nsecond para here\nthird row\n\nlast"

  let ed = drain(ed)
  assert editor.text(ed) == "ALPHAz beta\n\nsecond para here\nthird row\n\nlast"
  assert !editor.is_waiting(ed)
}
