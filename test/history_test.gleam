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
  let #(history, _) = {
    use #(history, now), buffer <- list.fold(buffers, #(history, 0))
    #(history.record(history, buffer, at: now), now + typing_gap)
  }
  history
}

/// Typed fast, as a person does: far under the pause.
const typing_gap = 150

/// Each buffer recorded at its time, in milliseconds.
fn record_at(history: History, steps: List(#(Buffer, Int))) -> History {
  use history, #(buffer, now) <- list.fold(steps, history)
  history.record(history, buffer, at: now)
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
    |> history.record(at("a c", 3), at: 0)

  assert history.redo(typed) == Error(Nil)
  assert shown(undone(typed)) == "a"
}

pub fn a_caret_move_after_undo_keeps_redo_test() {
  let moved =
    history.new(at("x", 0))
    |> record_all([at("ax", 1)])
    |> undone
    |> history.record(at("x", 1), at: 0)

  assert shown(redone(moved)) == "ax"
}

pub fn undo_puts_back_the_selection_typed_over_test() {
  let selected =
    buffer.from_text("abc")
    |> buffer.select(anchor: Position(0, 3), head: Position(0, 1))
  let typed = history.new(selected) |> history.record(at("ax", 2), at: 0)

  assert history.present(undone(typed)) == selected
}

pub fn a_history_keeps_a_bounded_number_of_steps_test() {
  let typed =
    int.range(1, 1501, history.new(at("", 0)), fn(history, step) {
      history.record(history, at(shown(history) <> "\n", step), at: 0)
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
    |> history.record(at("xy", 0), at: 0)
    |> redone

  assert history.present(undone(typed)) == at("xy", 1)
}

pub fn a_pause_while_typing_starts_a_new_step_test() {
  let typed =
    history.new(at("", 0))
    |> record_at([
      #(at("a", 1), 0),
      #(at("ab", 2), 150),
      #(at("abc", 3), 300),
      #(at("abcd", 4), 1800),
      #(at("abcde", 5), 1950),
    ])

  assert shown(undone(typed)) == "abc"
  assert shown(undone(undone(typed))) == ""
}

pub fn typing_with_gaps_under_the_pause_stays_one_step_test() {
  let typed =
    history.new(at("", 0))
    |> record_at([
      #(at("a", 1), 0),
      #(at("ab", 2), 900),
      #(at("abc", 3), 1800),
      #(at("abcd", 4), 2700),
    ])

  assert shown(undone(typed)) == ""
}

pub fn a_gap_of_exactly_the_pause_does_not_end_a_step_test() {
  let typed =
    history.new(at("", 0))
    |> record_at([#(at("a", 1), 0), #(at("ab", 2), 1000)])
  assert shown(undone(typed)) == ""

  let paused =
    history.new(at("", 0))
    |> record_at([#(at("a", 1), 0), #(at("ab", 2), 1001)])
  assert shown(undone(paused)) == "a"
}

pub fn a_pause_while_erasing_starts_a_new_step_test() {
  let erased =
    history.new(at("abcd", 4))
    |> record_at([
      #(at("abc", 3), 0),
      #(at("ab", 2), 100),
      #(at("a", 1), 5000),
    ])

  assert shown(undone(erased)) == "ab"
  assert shown(undone(undone(erased))) == "abcd"
}

pub fn a_gap_of_exactly_the_pause_while_erasing_does_not_end_a_step_test() {
  let erased =
    history.new(at("abc", 3))
    |> record_at([#(at("ab", 2), 0), #(at("a", 1), 1000)])
  assert shown(undone(erased)) == "abc"

  let paused =
    history.new(at("abc", 3))
    |> record_at([#(at("ab", 2), 0), #(at("a", 1), 1001)])
  assert shown(undone(paused)) == "ab"
}

pub fn backspace_then_delete_are_two_steps_test() {
  let erased =
    history.new(at("abcd", 2))
    |> record_all([at("acd", 1), at("ad", 1)])

  assert shown(undone(erased)) == "acd"
  assert shown(undone(undone(erased))) == "abcd"
}

pub fn delete_then_backspace_are_two_steps_test() {
  let erased =
    history.new(at("abcd", 2))
    |> record_all([at("abd", 2), at("ad", 1)])

  assert shown(undone(erased)) == "abd"
  assert shown(undone(undone(erased))) == "abcd"
}

pub fn a_tab_typed_after_a_word_starts_a_new_step_like_a_space_test() {
  let typed =
    history.new(at("", 0))
    |> record_all([at("a", 1), at("ab", 2), at("ab\t", 3), at("ab\t ", 4)])

  assert shown(undone(typed)) == "ab"
  assert shown(undone(undone(typed))) == ""
}

pub fn a_pause_before_a_character_typed_after_a_caret_move_changes_nothing_test() {
  let typed =
    history.new(at("xy", 0))
    |> record_at([
      #(at("axy", 1), 0),
      #(at("axy", 3), 50_000),
      #(at("axyb", 4), 50_100),
    ])

  assert history.present(undone(typed)) == at("axy", 3)
  assert history.present(undone(undone(typed))) == at("xy", 0)
}

pub fn typing_over_a_selection_is_one_step_with_the_typing_after_it_test() {
  let selected =
    buffer.from_text("an old word")
    |> buffer.select(anchor: Position(0, 3), head: Position(0, 6))
  let typed =
    history.new(selected)
    |> record_all([
      at("an N word", 4),
      at("an NE word", 5),
      at("an NEW word", 6),
    ])

  assert history.present(undone(typed)) == selected
  assert history.undo(undone(typed)) == Error(Nil)
  assert history.present(redone(undone(typed))) == at("an NEW word", 6)
}

pub fn typing_over_a_selection_across_rows_is_one_step_test() {
  let selected =
    buffer.from_text("one\ntwo\nthree")
    |> buffer.select(anchor: Position(1, 1), head: Position(0, 2))
  let typed =
    history.new(selected)
    |> record_all([at("onXwo\nthree", 3), at("onXYwo\nthree", 4)])

  assert history.present(undone(typed)) == selected
  assert history.undo(undone(typed)) == Error(Nil)
}

pub fn typing_over_a_selection_across_rows_below_the_first_is_one_step_test() {
  let selected =
    buffer.from_text("zero\none\ntwo\nthree")
    |> buffer.select(anchor: Position(1, 2), head: Position(2, 1))
  let typed =
    history.new(selected)
    |> record_all([
      buffer.from_text("zero\nonXwo\nthree") |> buffer.move_to(Position(1, 3)),
      buffer.from_text("zero\nonXYwo\nthree") |> buffer.move_to(Position(1, 4)),
    ])

  assert history.present(undone(typed)) == selected
  assert shown(redone(undone(typed))) == "zero\nonXYwo\nthree"
}

/// Edits of every kind at places all over a note, typed fast enough to join:
/// each undo gives back a note that was, all of them the first note, and
/// redoing all of them the last.
pub fn undo_and_redo_give_back_each_note_exactly_test() {
  let start =
    buffer.from_text("alpha\nbravo two\n\ncharlie\ndelta echo\nfoxtrot")
    |> buffer.move_to(Position(1, 2))
  let #(history, seen, _) = {
    use #(history, seen, seed), step <- int.range(0, 400, #(
      history.new(start),
      [buffer.text(start)],
      7,
    ))
    let seed = { seed * 1_103_515_245 + 12_345 } % 2_147_483_648
    let note = history.present(history)
    let lines = buffer.lines(note)
    let row = seed / 7 % list.length(lines)
    let width = string.length(list.drop(lines, row) |> list.first |> unwrap)
    let place = Position(row:, col: seed / 11 % { width + 1 })
    let caret = buffer.cursor(note)
    let next = case seed % 9 {
      0 -> buffer.move_to(note, place)
      1 -> buffer.replace(note, from: caret, to: caret, with: "\n")
      2 -> buffer.select(note, anchor: caret, head: place)
      3 ->
        case caret.col > 0 {
          True ->
            buffer.replace(
              note,
              from: Position(..caret, col: caret.col - 1),
              to: caret,
              with: "",
            )
          False -> buffer.replace(note, from: place, to: caret, with: "")
        }
      4 -> buffer.replace(note, from: caret, to: caret, with: " ")
      _ -> {
        let #(anchor, head) = buffer.selection(note)
        buffer.replace(note, from: anchor, to: head, with: "x")
      }
    }
    let history = history.record(history, next, at: step * 150)
    #(history, [buffer.text(next), ..seen], seed)
  }
  let end = history.present(history)
  let #(first, undos) = undo_all(history, 0)

  assert undos > 20
  assert shown(first) == buffer.text(start)
  assert list.all(texts_on_the_way(history), list.contains(seen, _))
  assert buffer.text(history.present(redo_all(first))) == buffer.text(end)
}

fn unwrap(line: Result(String, Nil)) -> String {
  case line {
    Ok(line) -> line
    Error(Nil) -> ""
  }
}

fn undo_all(history: History, count: Int) -> #(History, Int) {
  case history.undo(history) {
    Ok(history) -> undo_all(history, count + 1)
    Error(Nil) -> #(history, count)
  }
}

fn redo_all(history: History) -> History {
  case history.redo(history) {
    Ok(history) -> redo_all(history)
    Error(Nil) -> history
  }
}

fn texts_on_the_way(history: History) -> List(String) {
  case history.undo(history) {
    Ok(history) -> [shown(history), ..texts_on_the_way(history)]
    Error(Nil) -> []
  }
}
