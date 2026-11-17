import gleam/list
import gleam/option.{None, Some}
import gleam/order
import nullpad/buffer.{Position}
import nullpad/editor.{type Editor, type Held, Outcome}
import nullpad/markdown

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

fn stepped(ed: Editor) -> Editor {
  editor.update(
    ed,
    editor.Stepped(row: 1, visible: "", at_end: False, next: "", x: Some(0.0)),
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
    editor.HeldMenuUndo,
    editor.HeldMenuRedo,
    key("Escape"),
  ]
  let ed = opened() |> step_down
  let ed = list.fold(keys, ed, hold)
  assert editor.keys_wait(ed)
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
  assert !editor.keys_wait(ed)
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
      editor.Stepped(row: 2, visible: "", at_end: False, next: "", x: Some(0.0)),
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
  assert !editor.keys_wait(ed)
}

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
  assert !editor.keys_wait(ed)
  assert editor.replay(ed) == None

  let ed = stepped(ed)
  assert buffer.selection(editor.buffer(ed))
    == #(Position(row: 2, col: 3), Position(row: 2, col: 3))
  assert editor.replay(ed) == None
}

pub fn the_focus_leaving_drops_the_keys_waiting_test() {
  let ed = opened() |> step_down |> hold(key("x"))
  let ed = editor.update(ed, editor.FocusChanged(focused: False)).editor
  assert !editor.keys_wait(ed)
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
  assert editor.replay(ed) == Some(editor.HeldMenuUndo)

  let ed = editor.update(ed, editor.Replayed(Some(editor.UndoAsked))).editor
  assert editor.text(ed) == note
  assert !editor.keys_wait(ed)
}

pub fn a_key_held_when_nothing_waits_is_replayed_at_once_test() {
  let ed = opened() |> hold(key("x"))
  assert editor.keys_wait(ed)
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
      editor.Replayed(
        Some(editor.EdgePressed(editor.WidenToNote, x: 0.0, shown:)),
      ),
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
      editor.EdgePressed(
        editor.WidenToNote,
        x: 0.0,
        shown: editor.field_buffer(ed),
      ),
    )
  let assert editor.WriteAndRead(whole) = sync
  assert editor.keys_wait(ed)

  let ed = hold(ed, shifted("ArrowLeft"))
  assert editor.replay(ed) == None
  let ed = editor.update(ed, editor.ControlChanged(shown: whole, at: 0)).editor
  assert editor.replay(ed) == Some(shifted("ArrowLeft"))
}

pub fn a_replayed_key_steers_the_head_the_way_it_moved_it_test() {
  let held = shifted("ArrowLeft")
  let ed = opened() |> step_down |> hold(held) |> stepped
  assert editor.last_key_travel(ed) == order.Gt
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
  assert editor.last_key_travel(ed) == order.Lt
}

fn over(field: buffer.Buffer, text: String) -> buffer.Buffer {
  let #(anchor, head) = buffer.selection(field)
  let #(from, to) = case buffer.compare(anchor, head) {
    order.Gt -> #(head, anchor)
    order.Lt | order.Eq -> #(anchor, head)
  }
  buffer.replace(field, from:, to:, with: text)
}

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
    Some(editor.HeldMenuUndo) ->
      drain(editor.update(ed, editor.Replayed(Some(editor.UndoAsked))).editor)
    Some(editor.HeldMenuRedo) ->
      drain(editor.update(ed, editor.Replayed(Some(editor.RedoAsked))).editor)
  }
}

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
  assert !editor.keys_wait(ed)
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
  assert !editor.keys_wait(ed)
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
  assert !editor.keys_wait(ed)
}

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
  assert !editor.keys_wait(ed)
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
  assert !editor.keys_wait(ed)
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
  assert !editor.keys_wait(ed)
}

pub fn text_an_ime_converts_again_behind_a_held_key_is_kept_test() {
  let ed = opened() |> step_down |> hold(key("z"))
  let converted =
    buffer.from_text("ALPHA beta") |> buffer.move_to(Position(row: 0, col: 5))
  let ed = editor.update(ed, editor.Composing(shown: converted)).editor
  let ed = editor.update(ed, editor.Composed(shown: converted, at: 0)).editor
  assert editor.text(ed) == "ALPHA beta\n\nsecond para here\nthird row\n\nlast"

  let ed = drain(ed)
  assert editor.text(ed) == "ALPHAz beta\n\nsecond para here\nthird row\n\nlast"
  assert !editor.keys_wait(ed)
}

pub fn keys_typed_while_a_chosen_note_loads_go_into_it_test() {
  let choosing = editor.set_choosing(opened(), True).editor
  assert editor.keys_wait(choosing)
  let choosing = hold(choosing, key("Z"))
  assert editor.replay(choosing) == None

  let typed = buffer.from_text("typed" <> note)
  let Outcome(editor: kept, sync:, ..) =
    editor.update(choosing, editor.ControlChanged(shown: typed, at: 0))
  assert editor.text(kept) == note
  assert sync == editor.WriteQuietly(editor.field_buffer(choosing))

  let arrived = editor.open(kept, "next").editor
  assert !editor.is_choosing(arrived)
  assert editor.replay(arrived) == Some(key("Z"))
}

pub fn keys_typed_while_choosing_go_into_the_note_kept_test() {
  let choosing = editor.set_choosing(opened(), True).editor |> hold(key("Z"))
  let stayed = editor.set_choosing(choosing, False).editor
  assert editor.text(stayed) == note
  assert editor.replay(stayed) == Some(key("Z"))
  assert editor.set_choosing(stayed, False).editor == stayed
}

pub fn choosing_another_note_drops_the_keys_waiting_behind_a_step_test() {
  let choosing =
    opened() |> step_down |> hold(key("x")) |> editor.set_choosing(True)
  assert editor.replay(choosing.editor) == None

  let arrived = editor.open(choosing.editor, "next").editor
  assert editor.replay(arrived) == None
  assert !editor.keys_wait(arrived)
}

pub fn a_box_ticked_while_a_chosen_note_loads_changes_nothing_test() {
  let box = markdown.Task(checked: False, row: 0, col: 3)
  let listed = editor.new(vim: False, live: True, paint: True)
  let listed = editor.open(listed, "- [ ] milk").editor
  assert editor.text(editor.tick(listed, box, True).editor) == "- [x] milk"
  let choosing = editor.set_choosing(listed, True).editor
  assert editor.text(editor.tick(choosing, box, True).editor) == "- [ ] milk"
}

fn pressed(
  key: String,
  code: String,
  ctrl ctrl: Bool,
  meta meta: Bool,
  alt alt: Bool,
) -> Held {
  editor.HeldKey(key:, code:, shift: False, ctrl:, meta:, alt:, at: 0)
}

pub fn a_modifier_that_types_a_character_has_it_typed_test() {
  let option_a = pressed("å", "KeyA", ctrl: False, meta: False, alt: True)
  let alt_gr_q = pressed("@", "KeyQ", ctrl: True, meta: False, alt: True)
  let ctrl_alt_r = pressed("r", "KeyR", ctrl: True, meta: False, alt: True)
  let alt_e = pressed("e", "KeyE", ctrl: False, meta: False, alt: True)
  assert editor.browser_act(option_a, editor.AppleKeyboard)
    == Some(editor.TypeText("å"))
  assert editor.browser_act(alt_gr_q, editor.WindowsKeyboard)
    == Some(editor.TypeText("@"))
  assert editor.browser_act(alt_gr_q, editor.AppleKeyboard) == None
  assert editor.browser_act(option_a, editor.OtherKeyboard) == None
  assert editor.browser_act(ctrl_alt_r, editor.WindowsKeyboard) == None
  assert editor.browser_act(alt_e, editor.AppleKeyboard) == None
  assert !editor.replay_matches_browser(ctrl_alt_r, editor.WindowsKeyboard)
}

pub fn only_the_shortcuts_the_replay_can_do_are_held_test() {
  let ctrl_key = fn(key) {
    pressed(key, "", ctrl: True, meta: False, alt: False)
  }
  let cmd_key = fn(key) {
    pressed(key, "", ctrl: False, meta: True, alt: False)
  }
  let held =
    ["a", "c", "x", "z", "y", "f", "p", "s", "l", "r", "d", "+", "-", "v"]
    |> list.filter(fn(key) {
      editor.replay_matches_browser(ctrl_key(key), editor.WindowsKeyboard)
    })
  assert held == ["a", "c", "x", "z", "y"]
  assert !editor.replay_matches_browser(ctrl_key("a"), editor.AppleKeyboard)
  assert editor.browser_act(cmd_key("a"), editor.AppleKeyboard)
    == Some(editor.SelectWholeField)
  assert editor.replay_matches_browser(cmd_key("z"), editor.AppleKeyboard)
  assert !editor.replay_matches_browser(cmd_key("s"), editor.AppleKeyboard)
}

pub fn cmd_and_option_move_by_lines_and_words_on_a_mac_test() {
  let apple = fn(key, meta, alt) {
    editor.browser_act(
      pressed(key, "", ctrl: False, meta:, alt:),
      editor.AppleKeyboard,
    )
  }
  assert apple("ArrowLeft", True, False)
    == Some(editor.MoveCaret(False, editor.Backward, editor.ByLineBoundary))
  assert apple("ArrowRight", False, True)
    == Some(editor.MoveCaret(False, editor.Right, editor.ByWord))
  assert apple("Backspace", True, False)
    == Some(editor.DeleteBy(False, editor.ByLineBoundary))
  assert apple("Delete", False, True)
    == Some(editor.DeleteBy(True, editor.ByWord))
  assert apple("ArrowUp", True, False)
    == Some(editor.MoveCaret(False, editor.Backward, editor.ByDocument))
  assert editor.browser_act(ctrl("ArrowLeft"), editor.OtherKeyboard)
    == Some(editor.MoveCaret(False, editor.Left, editor.ByWord))
  assert editor.browser_act(ctrl("ArrowLeft"), editor.AppleKeyboard) == None
}

pub fn control_and_up_or_down_is_held_off_a_mac_test() {
  let up =
    editor.HeldKey(
      key: "ArrowUp",
      code: "",
      shift: True,
      ctrl: True,
      meta: False,
      alt: False,
      at: 0,
    )
  assert editor.replay_matches_browser(up, editor.OtherKeyboard)
  assert editor.replay_matches_browser(
    ctrl("ArrowDown"),
    editor.WindowsKeyboard,
  )
  assert !editor.replay_matches_browser(ctrl("ArrowUp"), editor.AppleKeyboard)
  assert editor.browser_act(up, editor.OtherKeyboard)
    == Some(editor.MoveCaret(True, editor.Backward, editor.ByParagraph))
  assert editor.browser_act(ctrl("ArrowDown"), editor.WindowsKeyboard)
    == Some(editor.MoveCaret(False, editor.Forward, editor.ByParagraph))
}

pub fn control_and_home_or_end_is_held_off_a_mac_test() {
  assert editor.replay_matches_browser(ctrl("Home"), editor.WindowsKeyboard)
  assert editor.browser_act(ctrl("Home"), editor.WindowsKeyboard)
    == Some(editor.MoveCaret(False, editor.Backward, editor.ByDocument))
  assert editor.browser_act(ctrl("End"), editor.OtherKeyboard)
    == Some(editor.MoveCaret(False, editor.Forward, editor.ByDocument))
  let option_home = pressed("Home", "", ctrl: False, meta: False, alt: True)
  assert editor.browser_act(option_home, editor.AppleKeyboard) == None
  assert !editor.replay_matches_browser(option_home, editor.AppleKeyboard)
}

pub fn the_focus_coming_back_leaves_a_composition_behind_a_key_composing_test() {
  let ed = opened() |> step_down |> hold(key("z"))
  let field = editor.field_buffer(ed)
  let ed = editor.update(ed, editor.Composing(shown: over(field, "k"))).editor
  let ed = editor.update(ed, editor.FocusChanged(focused: True)).editor
  assert editor.replay(ed) == None
  let ed =
    editor.update(ed, editor.Composed(shown: over(field, "か"), at: 0)).editor
  assert editor.text(ed) == note

  let ed = ed |> stepped |> drain
  assert editor.text(ed) == "zか\nsecond para here\nthird row\n\nlast"
}

pub fn a_drop_ends_the_steps_still_waiting_test() {
  let ed = opened() |> step_down
  let shown = editor.field_buffer(ed)
  let Outcome(editor: dropped, ..) =
    editor.update(
      ed,
      editor.Dropped(
        row: 0,
        visible: "alpha",
        at_end: False,
        next: "",
        text: "x",
        copy: True,
        shown:,
      ),
    )
  assert editor.text(dropped)
    == "alphax beta\n\nsecond para here\nthird row\n\nlast"
  assert !editor.is_stepping(dropped)
  assert !editor.keys_wait(dropped)
}

pub fn keys_held_behind_the_steps_a_drop_ends_are_still_replayed_test() {
  let ed = opened() |> step_down |> hold(key("x"))
  let shown = editor.field_buffer(ed)
  let Outcome(editor: dropped, ..) =
    editor.update(
      ed,
      editor.Dropped(
        row: 0,
        visible: "alpha",
        at_end: False,
        next: "",
        text: "y",
        copy: True,
        shown:,
      ),
    )
  assert !editor.is_stepping(dropped)
  assert editor.replay(dropped) == Some(key("x"))
}

pub fn a_drag_ends_the_steps_still_waiting_test() {
  let ed =
    editor.update(
      opened(),
      editor.Pointed(
        row: 0,
        visible: "al",
        at_end: False,
        next: "",
        x: 0.0,
        y: 0.0,
      ),
    ).editor
    |> step_down
  let Outcome(editor: dragged, ..) =
    editor.update(
      ed,
      editor.Dragged(row: 0, visible: "alpha", at_end: False, next: ""),
    )
  assert buffer.selection(editor.buffer(dragged))
    == #(Position(row: 0, col: 2), Position(row: 0, col: 5))
  assert !editor.is_stepping(dragged)
}
