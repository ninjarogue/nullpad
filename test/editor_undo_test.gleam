//// Undo and redo through the editor, the way `surface` reports them: the
//// field's rows as typed, then `UndoAsked` or `RedoAsked`.

import gleam/int
import gleam/list
import gleam/option.{Some}
import gleam/set.{type Set}
import gleam/string
import nullpad/buffer.{type Buffer, Position}
import nullpad/editor.{type Editor, Outcome}
import nullpad/live.{Region}

fn live(text: String) -> Editor {
  let opened =
    editor.new(vim: False, live: False, paint: True) |> editor.open(text)
  editor.set_live(opened.editor, True).editor
}

fn whole(text: String) -> Editor {
  editor.open(editor.new(vim: False, live: False, paint: True), text).editor
}

fn caret(text: String, row: Int, col: Int) -> Buffer {
  buffer.from_text(text) |> buffer.move_to(Position(row:, col:))
}

/// Types `text` at the caret, one grapheme a key, into the field as it is.
fn type_in(ed: Editor, text: String) -> Editor {
  use ed, key <- list.fold(string.to_graphemes(text), ed)
  let field = editor.field_buffer(ed)
  let at = buffer.cursor(field)
  let shown = buffer.replace(field, from: at, to: at, with: key)
  editor.update(ed, editor.ControlChanged(shown:, at: 0)).editor
}

fn point(ed: Editor, row: Int, at_end: Bool) -> Editor {
  editor.update(
    ed,
    editor.Pointed(row:, visible: "", at_end:, next: "", x: 0.0, y: 0.0),
  ).editor
}

fn undo(ed: Editor) -> Editor {
  editor.update(ed, editor.UndoAsked).editor
}

fn redo(ed: Editor) -> Editor {
  editor.update(ed, editor.RedoAsked).editor
}

pub fn undo_takes_back_typing_in_a_block_the_caret_has_left_test() {
  let ed =
    live("one\n\ntwo")
    |> point(0, True)
    |> type_in(" A")
    |> point(2, True)
    |> type_in(" B")
  assert editor.text(ed) == "one A\n\ntwo B"

  let Outcome(editor: back, sync:, ..) = editor.update(ed, editor.UndoAsked)
  assert editor.text(back) == "one A\n\ntwo"
  assert sync == editor.Write(editor.field_buffer(back))

  let back = undo(undo(back))
  assert editor.text(back) == "one\n\ntwo"
  assert buffer.cursor(editor.buffer(back)) == Position(row: 0, col: 3)
  assert editor.region(back) == Some(Region(0, 0))
  assert editor.field_buffer(back) == caret("one", 0, 3)
}

pub fn redo_gives_back_what_undo_took_with_the_caret_after_it_test() {
  let typed = live("one\n\ntwo") |> point(2, True) |> type_in("!")
  let again = typed |> undo |> redo

  assert editor.text(again) == "one\n\ntwo!"
  assert editor.buffer(again) == editor.buffer(typed)
}

pub fn undo_takes_back_a_join_and_redo_joins_again_test() {
  let ed = live("one\n\ntwo") |> point(2, False)
  let shown = editor.field_buffer(ed)
  let joined =
    editor.update(ed, editor.EdgePressed(editor.JoinBefore, x: 0.0, shown:)).editor
  assert editor.text(joined) == "one\ntwo"

  let back = undo(joined)
  assert editor.text(back) == "one\n\ntwo"
  assert buffer.cursor(editor.buffer(back)) == Position(row: 2, col: 0)
  assert editor.text(redo(back)) == "one\ntwo"
}

pub fn a_line_break_and_the_letters_around_it_undo_one_at_a_time_test() {
  let typed = live("") |> type_in("x\ny")
  assert editor.text(typed) == "x\ny"

  assert editor.text(undo(typed)) == "x\n"
  assert editor.text(undo(undo(typed))) == "x"
  assert editor.text(undo(undo(undo(typed)))) == ""
  assert editor.text(typed |> undo |> undo |> undo |> redo |> redo |> redo)
    == "x\ny"
}

pub fn an_edit_after_undo_clears_redo_test() {
  let ed = live("one") |> point(0, True) |> type_in(" two") |> undo
  let ed = type_in(ed, "!")
  let Outcome(editor: after, sync:, ..) = editor.update(ed, editor.RedoAsked)

  assert editor.text(after) == "one!"
  assert sync == editor.InSync
}

pub fn undo_with_nothing_to_undo_changes_nothing_test() {
  let ed = live("one\n\ntwo")
  let Outcome(editor: after, sync:, ..) = editor.update(ed, editor.UndoAsked)

  assert sync == editor.InSync
  assert editor.buffer(after) == editor.buffer(ed)
}

pub fn opening_a_note_starts_a_fresh_history_test() {
  let ed = live("one") |> point(0, True) |> type_in("!")
  let other = editor.open(ed, "two").editor

  assert editor.text(undo(other)) == "two"
}

pub fn a_composition_is_one_step_test() {
  let ed = live("one") |> point(0, True)
  let composing =
    ["one n", "one に", "one 日本"]
    |> list.fold(ed, fn(ed, text) {
      let shown = caret(text, 0, string.length(text))
      editor.update(ed, editor.Composing(shown:)).editor
    })
  let ended =
    editor.update(
      composing,
      editor.ControlChanged(shown: caret("one 日本", 0, 6), at: 0),
    ).editor

  assert editor.text(undo(ended)) == "one"
}

pub fn undo_works_the_same_with_the_whole_note_in_the_field_test() {
  let at_end = caret("one\ntwo", 1, 3)
  let typed =
    whole("one\ntwo")
    |> editor.update(editor.ControlChanged(shown: at_end, at: 0))
    |> fn(outcome: editor.Outcome) { type_in(outcome.editor, "!") }
  let Outcome(editor: back, sync:, ..) = editor.update(typed, editor.UndoAsked)

  assert editor.text(back) == "one\ntwo"
  assert sync == editor.Write(at_end)
  assert editor.text(redo(back)) == "one\ntwo!"
}

pub fn undo_reaches_back_past_a_switch_to_the_whole_note_test() {
  let typed = live("one\n\ntwo") |> point(2, True) |> type_in("!")
  let switched = editor.set_live(typed, False).editor

  assert editor.text(undo(switched)) == "one\n\ntwo"
}

/// Random edits, undos and redos in the page view: an undo or a redo only
/// ever gives back a note the person had, undoing everything gives the note
/// as it opened, and redoing everything the note as last edited.
pub fn undo_and_redo_only_give_back_notes_that_were_test() {
  use _, seed <- int.range(1, 61, Nil)
  let opened = "one\n\n- two\n- three\n\nfour"
  let start = Walk(live(opened), set.from_list([opened]), opened, seed * 7919)
  let walked = int.range(1, 121, start, step)
  let Walk(editor: ed, seen:, tip:, ..) = walked

  let back = int.range(1, 301, ed, fn(ed, _) { undo(ed) })
  assert editor.text(back) == opened
  let ahead = int.range(1, 301, back, fn(ed, _) { redo(ed) })
  assert editor.text(ahead) == tip
  assert set.contains(seen, tip)
}

type Walk {
  Walk(editor: Editor, seen: Set(String), tip: String, random: Int)
}

fn step(walk: Walk, _: Int) -> Walk {
  let #(choice, random) = next(walk.random, 9)
  let #(pick, random) = next(random, 1000)
  let ed = walk.editor
  case choice {
    0 | 1 ->
      edited(walk, type_in(ed, pick_from(["a", "b", " ", "-"], pick)), random)
    2 -> edited(walk, type_in(ed, "\n"), random)
    3 -> edited(walk, backspace(ed), random)
    4 ->
      edited(
        walk,
        point(ed, pick % editor.row_count(ed), pick % 2 == 0),
        random,
      )
    5 -> edited(walk, select_and_type(ed, pick), random)
    6 | 7 -> travelled(walk, undo(ed), random)
    _ -> travelled(walk, redo(ed), random)
  }
}

fn edited(walk: Walk, ed: Editor, random: Int) -> Walk {
  let text = editor.text(ed)
  let tip = case text == editor.text(walk.editor) {
    True -> walk.tip
    False -> text
  }
  Walk(editor: ed, seen: set.insert(walk.seen, text), tip:, random:)
}

fn travelled(walk: Walk, ed: Editor, random: Int) -> Walk {
  assert set.contains(walk.seen, editor.text(ed))
  Walk(..walk, editor: ed, random:)
}

fn backspace(ed: Editor) -> Editor {
  let field = editor.field_buffer(ed)
  let at = buffer.cursor(field)
  case at {
    Position(row: 0, col: 0) ->
      editor.update(
        ed,
        editor.EdgePressed(editor.JoinBefore, x: 0.0, shown: field),
      ).editor
    Position(row:, col: 0) -> {
      let above = list.drop(buffer.lines(field), row - 1) |> list.first
      let assert Ok(above) = above
      let from = Position(row: row - 1, col: string.length(above))
      let shown = buffer.replace(field, from:, to: at, with: "")
      editor.update(ed, editor.ControlChanged(shown:, at: 0)).editor
    }
    Position(row:, col:) -> {
      let from = Position(row:, col: col - 1)
      let shown = buffer.replace(field, from:, to: at, with: "")
      editor.update(ed, editor.ControlChanged(shown:, at: 0)).editor
    }
  }
}

fn select_and_type(ed: Editor, pick: Int) -> Editor {
  let field = editor.field_buffer(ed)
  let at = buffer.cursor(field)
  let from = Position(row: at.row, col: int.max(0, at.col - pick % 3))
  let shown = buffer.replace(field, from:, to: at, with: "Z")
  editor.update(ed, editor.ControlChanged(shown:, at: 0)).editor
}

fn pick_from(items: List(String), pick: Int) -> String {
  let assert Ok(item) =
    list.drop(items, pick % list.length(items)) |> list.first
  item
}

/// Park and Miller's generator: small enough to stay exact in a float.
fn next(random: Int, below: Int) -> #(Int, Int) {
  let random = random * 48_271 % 2_147_483_647
  #(random % below, random)
}

pub fn undo_of_typing_over_a_painted_selection_restores_text_and_selection_test() {
  let note = "# Trip\n\nFlights are **booked**.\n\n- one\n- two"
  let ed =
    live(note)
    |> point(2, False)
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.Dragged(row: 4, visible: "o", at_end: False, next: ""),
    )
  assert editor.is_painted(ed)
  let selected = buffer.selection(editor.buffer(ed))

  let field = editor.field_buffer(ed)
  let #(from, to) = buffer.selection(field)
  assert from != to
  let shown = buffer.replace(field, from:, to:, with: "X")
  let ed = editor.update(ed, editor.ControlChanged(shown:, at: 0)).editor
  assert !editor.is_painted(ed)
  assert string.length(editor.text(ed)) < string.length(note)

  let Outcome(editor: back, sync:, ..) = editor.update(ed, editor.UndoAsked)
  assert editor.text(back) == note
  assert buffer.selection(editor.buffer(back)) == selected
  assert sync == editor.Write(editor.field_buffer(back))

  let forward = redo(back)
  assert editor.text(forward) == editor.text(ed)
}

fn type_at(ed: Editor, key: String, at: Int) -> Editor {
  let field = editor.field_buffer(ed)
  let place = buffer.cursor(field)
  let shown = buffer.replace(field, from: place, to: place, with: key)
  editor.update(ed, editor.ControlChanged(shown:, at:)).editor
}

pub fn a_pause_between_two_typed_characters_is_two_undo_steps_test() {
  let ed =
    whole("")
    |> type_at("a", 10_000)
    |> type_at("b", 10_200)
    |> type_at("c", 12_000)
    |> type_at("d", 12_200)
  assert editor.text(ed) == "abcd"
  assert editor.text(undo(ed)) == "ab"
  assert editor.text(undo(undo(ed))) == ""
}
