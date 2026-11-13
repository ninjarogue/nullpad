//// The undo history on its own: what a step is, and what undo and redo give
//// back.

import gleam/int
import gleam/list
import gleam/string
import nullpad/buffer.{type Buffer, Position}
import nullpad/history.{type History}

fn at(text: String, col: Int) -> Buffer {
  let place = Position(row: 0, col:)
  buffer.from_text(text) |> buffer.select(anchor: place, head: place)
}

fn record_all(history: History, buffers: List(Buffer)) -> History {
  list.fold(buffers, history, history.record)
}

fn undone(history: History) -> History {
  let assert Ok(history) = history.undo(history)
  history
}

fn redone(history: History) -> History {
  let assert Ok(history) = history.redo(history)
  history
}

fn shown(history: History) -> String {
  buffer.text(history.present(history))
}

pub fn nothing_to_undo_or_redo_in_a_new_history_test() {
  let fresh = history.new(at("note", 0))
  assert history.undo(fresh) == Error(Nil)
  assert history.redo(fresh) == Error(Nil)
}

pub fn a_run_of_typing_is_one_step_test() {
  let typed =
    history.new(at("", 0))
    |> record_all([at("a", 1), at("ab", 2), at("abc", 3)])

  let back = undone(typed)
  assert history.present(back) == at("", 0)
  assert history.undo(back) == Error(Nil)
}

pub fn a_space_typed_after_a_word_starts_a_new_step_test() {
  let typed =
    history.new(at("", 0))
    |> record_all([at("a", 1), at("ab", 2), at("ab ", 3), at("ab c", 4)])

  assert shown(undone(typed)) == "ab"
  assert shown(undone(undone(typed))) == ""
}

pub fn a_caret_move_ends_a_run_of_typing_test() {
  let typed =
    history.new(at("xy", 0))
    |> record_all([at("axy", 1), at("axy", 3), at("axyb", 4)])

  assert history.present(undone(typed)) == at("axy", 3)
  assert history.present(undone(undone(typed))) == at("xy", 0)
}

pub fn a_line_break_is_a_step_of_its_own_test() {
  let typed =
    history.new(at("", 0))
    |> record_all([
      at("x", 1),
      buffer.from_text("x\n") |> buffer.move_to(Position(1, 0)),
      buffer.from_text("x\ny") |> buffer.move_to(Position(1, 1)),
    ])

  assert shown(undone(typed)) == "x\n"
  assert shown(undone(undone(typed))) == "x"
  assert shown(undone(undone(undone(typed)))) == ""
}

pub fn a_run_of_backspaces_is_one_step_apart_from_the_typing_before_it_test() {
  let edited =
    history.new(at("", 0))
    |> record_all([
      at("a", 1),
      at("ab", 2),
      at("abc", 3),
      at("ab", 2),
      at("a", 1),
    ])

  assert history.present(undone(edited)) == at("abc", 3)
  assert history.present(undone(undone(edited))) == at("", 0)
}

pub fn redo_gives_back_the_text_and_caret_undo_took_test() {
  let typed = history.new(at("", 0)) |> record_all([at("a", 1), at("ab", 2)])
  let again = typed |> undone |> redone

  assert history.present(again) == at("ab", 2)
  assert history.redo(again) == Error(Nil)
}

pub fn an_edit_after_undo_clears_redo_test() {
  let typed =
    history.new(at("", 0))
    |> record_all([at("a", 1), at("a ", 2), at("a b", 3)])
    |> undone
    |> history.record(at("a c", 3))

  assert history.redo(typed) == Error(Nil)
  assert shown(undone(typed)) == "a"
}

pub fn a_caret_move_after_undo_keeps_redo_test() {
  let moved =
    history.new(at("x", 0))
    |> record_all([at("ax", 1)])
    |> undone
    |> history.record(at("x", 1))

  assert shown(redone(moved)) == "ax"
}

pub fn undo_puts_back_the_selection_typed_over_test() {
  let selected =
    buffer.from_text("abc")
    |> buffer.select(anchor: Position(0, 3), head: Position(0, 1))
  let typed = history.new(selected) |> history.record(at("ax", 2))

  assert history.present(undone(typed)) == selected
}

pub fn a_history_keeps_a_bounded_number_of_steps_test() {
  let typed =
    int.range(1, 1501, history.new(at("", 0)), fn(history, step) {
      history.record(history, at(shown(history) <> "\n", step))
    })
  let undo_all = fn(history) {
    use history, _ <- int.range(1, 2001, history)
    case history.undo(history) {
      Ok(history) -> history
      Error(Nil) -> history
    }
  }

  assert shown(undo_all(typed)) == string.drop_end(shown(typed), 1000)
}

pub fn redo_puts_the_caret_where_the_step_ended_after_a_caret_move_test() {
  let typed =
    history.new(at("x", 0))
    |> record_all([at("ax", 1), at("abx", 2), at("abx", 3)])

  assert history.present(undone(typed)) == at("x", 0)
  assert history.present(redone(undone(typed))) == at("abx", 2)
}

pub fn undo_after_redo_puts_the_caret_where_the_step_began_test() {
  let typed =
    history.new(at("xy", 1))
    |> record_all([at("xay", 2)])
    |> undone
    |> history.record(at("xy", 0))
    |> redone

  assert history.present(undone(typed)) == at("xy", 1)
}
