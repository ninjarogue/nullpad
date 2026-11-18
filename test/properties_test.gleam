//// Properties of the pure core, over generated notes and generated things a
//// person does. Each runs a fixed number of cases from a fixed seed, so a
//// run repeats exactly, and a failing case is shrunk before it is shown.
//// `properties/gen` makes the text, `properties/script` the actions, and
//// `rows`, `kept` and `saving` hold what a property is checked against.

import gleam/dict
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/string
import nullpad/buffer.{type Position, Position}
import nullpad/editor.{type Editor}
import nullpad/live.{Region}
import nullpad/markdown
import nullpad/surface
import properties/gen.{Anything, Tame}
import properties/kept
import properties/rows
import properties/saving
import properties/script.{type Action, type Run}
import qcheck.{type Generator}

fn check(
  count: Int,
  seed: Int,
  gen: Generator(a),
  property: fn(a) -> Nil,
) -> Nil {
  let config =
    qcheck.config(test_count: count, max_retries: 1, seed: qcheck.seed(seed))
  qcheck.run(config, gen, property)
}

fn rows_of(text: String) -> List(String) {
  string.split(script.normalized(text), "\n")
}

fn sample(gen: Generator(a), count: Int) -> List(a) {
  qcheck.generate(gen, count, qcheck.seed(1)).0
}

// 1. Offsets

fn utf16_length(text: String) -> Int {
  string.to_utf_codepoints(text)
  |> list.fold(0, fn(sum, codepoint) {
    case string.utf_codepoint_to_int(codepoint) > 0xFFFF {
      True -> sum + 2
      False -> sum + 1
    }
  })
}

pub fn an_offset_and_its_line_and_column_round_trip_test() {
  let cases =
    qcheck.tuple3(
      gen.note(Anything),
      qcheck.tuple2(qcheck.bounded_int(0, 200), qcheck.bounded_int(0, 400)),
      qcheck.bounded_int(0, 4000),
    )
  use #(raw, #(row, col), pick) <- check(500, 101, cases)
  let text = script.normalized(raw)
  let lines = rows_of(text)
  let row = row % list.length(lines)
  let line = list.drop(lines, row) |> list.first |> option.from_result
  let col = col % { string.length(option.unwrap(line, "")) + 1 }
  let place = Position(row:, col:)
  let offset = surface.offset(lines, place)
  assert surface.position(text, offset) == place
    as {
      "line and column " <> string.inspect(place) <> " came back as another"
    }

  let boundary =
    utf16_length(string.slice(text, 0, pick % { string.length(text) + 1 }))
  let found = surface.position(text, boundary)
  assert surface.offset(lines, found) == boundary
    as { "offset " <> int.to_string(boundary) <> " came back as another" }
}

// 2. Rows

pub fn every_row_belongs_to_exactly_one_block_test() {
  use text <- check(2000, 102, gen.note(Anything))
  case rows.check(text) {
    Ok(Nil) -> Nil
    Error(reason) -> panic as reason
  }
}

// 3. Text kept

pub fn parsing_keeps_every_character_of_the_text_test() {
  use text <- check(1500, 103, gen.note(Tame))
  assert kept.every_letter(text) as "the parsed blocks lost or changed text"
}

// 4 to 8: the editor

type Setup {
  Setup(live: Bool, paint: Bool, note: String)
}

/// Vim mode is left out while `vim` is a scaffold that stops on any key.
fn setup(live: Generator(Bool)) -> Generator(Setup) {
  qcheck.map3(live, qcheck.bool(), gen.note(Anything), Setup)
}

fn opened(setup: Setup) -> Editor {
  editor.new(vim: False, live: setup.live, paint: setup.paint)
  |> editor.open(setup.note)
  |> fn(outcome) { outcome.editor }
}

fn scenario(
  live: Generator(Bool),
  action: Generator(Action),
  longest: Int,
) -> Generator(#(Setup, List(Action))) {
  qcheck.tuple2(setup(live), gen.few(action, 1, longest))
}

fn inside_note(ed: Editor) -> Result(Nil, String) {
  let note = editor.buffer(ed)
  let lines = buffer.lines(note)
  let count = list.length(lines)
  let #(anchor, head) = buffer.selection(note)
  let in_text = fn(place: Position) {
    let width =
      list.drop(lines, place.row)
      |> list.first
      |> option.from_result
      |> option.map(string.length)
    place.row >= 0
    && place.row < count
    && place.col >= 0
    && option.map(width, fn(width) { place.col <= width }) == Some(True)
  }
  let region_fits = case editor.region(ed) {
    Some(Region(first_row:, last_row:)) ->
      first_row >= 0 && first_row <= last_row && last_row < count
    None -> True
  }
  case
    lines != [],
    list.any(lines, string.contains(_, "\n")),
    in_text(anchor),
    in_text(head),
    region_fits
  {
    False, _, _, _, _ -> Error("the note has no lines")
    _, True, _, _, _ -> Error("a line holds a line break")
    _, _, False, _, _ ->
      Error(
        "the anchor "
        <> string.inspect(anchor)
        <> " is outside "
        <> string.inspect(lines),
      )
    _, _, _, False, _ ->
      Error(
        "the cursor "
        <> string.inspect(head)
        <> " is outside "
        <> string.inspect(lines),
      )
    _, _, _, _, False ->
      Error("the field's rows are outside " <> string.inspect(lines))
    True, False, True, True, True -> Ok(Nil)
  }
}

pub fn the_cursor_and_anchor_stay_inside_the_note_after_any_events_test() {
  use #(setup, actions) <- check(
    400,
    104,
    scenario(qcheck.bool(), script.anything(), 40),
  )
  let _ =
    list.fold(actions, script.start(opened(setup)), fn(run, action) {
      let next = script.run(run, action)
      case inside_note(next.editor) {
        Ok(Nil) -> Nil
        Error(reason) -> panic as reason
      }
      next
    })
  Nil
}

/// The editor after undo, and after redo of that, or `None` when there was
/// nothing to undo.
fn undone_and_redone(ed: Editor) -> Option(#(Editor, Editor)) {
  let undone = editor.update(ed, editor.UndoAsked)
  case undone.sync {
    editor.Write(_) ->
      Some(#(
        undone.editor,
        editor.update(undone.editor, editor.RedoAsked).editor,
      ))
    editor.InSync
    | editor.InSyncInPlace
    | editor.WriteInPlace(_)
    | editor.WriteQuietly(_)
    | editor.WriteAndAim(..)
    | editor.WriteAndStep(..)
    | editor.WriteAndRead(_)
    | editor.WriteAndAct(..)
    | editor.Release(_)
    | editor.Press(..)
    | editor.HoldSelection(..) -> None
  }
}

pub fn undo_then_redo_restores_the_text_and_the_cursor_test() {
  use #(setup, actions) <- check(
    300,
    105,
    scenario(qcheck.bool(), script.typing(), 30),
  )
  let start = opened(setup)
  let _ =
    list.fold(
      actions,
      #(script.start(start), [editor.buffer(start)]),
      fn(state, action) {
        let #(run, shown) = state
        let next = script.run(run, action)
        let note = editor.buffer(next.editor)
        case editor.text(next.editor) != editor.text(run.editor) {
          True -> {
            let assert Some(#(undone, redone)) = undone_and_redone(next.editor)
            assert list.contains(shown, editor.buffer(undone))
              as "undo gave a text or cursor the editor never had"
            assert editor.buffer(redone) == note
              as "redo gave back another text or cursor"
          }
          False -> Nil
        }
        #(next, [note, ..shown])
      },
    )
  Nil
}

// 7. Live layout

fn leaving(ed: Editor, how: Int, shift: Int) -> Action {
  let rows = editor.row_count(ed)
  let row = buffer.cursor(editor.buffer(ed)).row
  case how % 3, rows > 1 {
    0, True ->
      script.Point(
        script.Pressed,
        row: { row + 1 + shift % { rows - 1 } } % rows,
        col: 0,
        at_end: False,
      )
    1, _ | 0, False -> script.Focus(False)
    _, _ -> script.Escape
  }
}

pub fn laying_out_one_line_then_moving_away_matches_laying_out_the_whole_note_test() {
  let cases =
    qcheck.tuple2(
      scenario(qcheck.return(True), script.edits(), 20),
      qcheck.tuple3(
        qcheck.bounded_int(0, 60),
        qcheck.bounded_int(0, 2),
        qcheck.bounded_int(0, 60),
      ),
    )
  use #(#(setup, actions), #(first, how, shift)) <- check(300, 107, cases)
  let start =
    script.run(
      script.start(opened(setup)),
      script.Point(script.Pressed, first, 0, False),
    )
  let typed = list.fold(actions, start, script.run)
  let away = script.run(typed, leaving(typed.editor, how, shift)).editor
  let text = editor.text(away)
  assert editor.blocks(away)
    == live.setext_as_typed(
      markdown.parse(text),
      buffer.lines(buffer.from_text(text)),
    )
    as "the page drawn is not the page the whole note lays out"
}

// 8. A plain string as the model

fn rows_text(model: String, rows: Option(#(Int, Int))) -> String {
  case rows {
    Some(#(first, last)) ->
      string.split(model, "\n")
      |> list.drop(first)
      |> list.take(last - first + 1)
      |> string.join("\n")
    None -> model
  }
}

pub fn the_editor_edits_the_text_the_way_a_plain_string_does_test() {
  use #(setup, actions) <- check(
    300,
    108,
    scenario(qcheck.bool(), script.typing(), 30),
  )
  let _ =
    list.fold(
      actions,
      #(script.start(opened(setup)), script.normalized(setup.note)),
      fn(state, action) {
        let #(run, model) = state
        let next = script.run(run, action)
        let model = case next.edit {
          Some(script.FieldEdit(rows:, field:, from:, to:, with:)) -> {
            assert field == rows_text(model, rows)
              as "the field is not the rows of the note it shows"
            let base = case rows {
              Some(#(first, _)) ->
                script.offset_of(model, Position(row: first, col: 0))
              None -> 0
            }
            string.slice(model, 0, base + from)
            <> with
            <> string.slice(model, base + to, string.length(model))
          }
          None -> model
        }
        assert editor.text(next.editor) == model
          as "the editor's text is not the plain string's"
        #(next, model)
      },
    )
  Nil
}

// 9. Runs of typing and erasing

type Streak {
  TypedStreak(codepoints: List(String), selected: Int)
  BackspacedStreak(times: Int)
  DeletedStreak(times: Int)
}

fn streaks() -> Generator(Streak) {
  gen.weighted(
    #(
      3,
      qcheck.map2(
        gen.keystrokes(),
        gen.weighted(#(2, qcheck.return(0)), [#(1, qcheck.bounded_int(1, 4))]),
        TypedStreak,
      ),
    ),
    [
      #(1, qcheck.map(qcheck.bounded_int(1, 6), BackspacedStreak)),
      #(1, qcheck.map(qcheck.bounded_int(1, 6), DeletedStreak)),
    ],
  )
}

/// The caret at `at`, or the `selected` letters after it when they are on
/// one row.
fn placed(ed: Editor, at: Int, selected: Int) -> Run {
  let start = script.start(ed)
  let caret = script.run(start, script.Select(at:, length: 0, backward: False))
  let ranged =
    script.run(start, script.Select(at:, length: selected, backward: False))
  let #(anchor, head) = buffer.selection(editor.buffer(ranged.editor))
  case anchor.row == head.row {
    True -> ranged
    False -> caret
  }
}

pub fn a_run_of_typing_or_erasing_undoes_in_one_step_test() {
  let cases =
    qcheck.tuple3(setup(qcheck.bool()), streaks(), qcheck.bounded_int(0, 4000))
  use #(setup, streak, at) <- check(300, 109, cases)
  let selected = case streak {
    TypedStreak(selected:, ..) -> selected
    BackspacedStreak(_) | DeletedStreak(_) -> 0
  }
  let start = placed(opened(setup), at, selected)
  let before = editor.buffer(start.editor)
  let #(anchor, head) = buffer.selection(before)
  let line =
    list.drop(buffer.lines(before), head.row)
    |> list.first
    |> result.unwrap("")
  let width = string.length(line)
  // A letter typed before a combining mark or a joiner becomes one letter
  // with it, so no run of letters is typed there.
  let next = string.slice(line, int.max(anchor.col, head.col), 1)
  let actions = case streak {
    TypedStreak(codepoints:, ..) ->
      case next != "" && string.length("a" <> next) < 2 {
        True -> []
        False -> list.map(codepoints, script.Type(_, gap: 10))
      }
    BackspacedStreak(times:) ->
      list.repeat(script.Backspace(gap: 10), int.min(times, head.col))
    DeletedStreak(times:) ->
      list.repeat(
        script.DeleteForward(gap: 10),
        int.min(times, width - head.col),
      )
  }
  let done = list.fold(actions, start, script.run)
  case editor.text(done.editor) == editor.text(start.editor) {
    True -> Nil
    False -> {
      let undone = editor.update(done.editor, editor.UndoAsked).editor
      let restored = editor.buffer(undone)
      assert buffer.lines(restored) == buffer.lines(before)
        as "one undo did not take back the whole run"
      assert selected > 0 || restored == before
        as "undo did not put the caret back"
    }
  }
}

// 6. Saving

fn title() -> Generator(Option(String)) {
  gen.weighted(#(2, qcheck.return(None)), [
    #(1, qcheck.map(gen.typed(), fn(title) { Some("T" <> title) })),
  ])
}

pub fn saving_twice_is_the_same_as_saving_once_test() {
  let cases =
    qcheck.tuple3(title(), gen.note(Anything), gen.few(saving.again(), 1, 5))
  use #(title, body, extras) <- check(300, 106, cases)
  let once = saving.saved_then(title, body, [])
  assert saving.saved_then(title, body, extras) == once
    as "saving again changed the store, the library or the saves asked for"
  assert once.saves_asked == 1 as "one edit was not saved exactly once"
  assert dict.get(once.stored, "k") == Ok(saving.stored(title, body))
    as "the store does not hold what was saved"
}

pub fn the_generated_notes_hold_every_kind_of_text_test() {
  let notes = sample(gen.note(Anything), 600)
  let text = string.join(notes, "\u{0}")
  let kinds = [
    "é",
    "日本語",
    "😀",
    "\u{200D}",
    "🇯🇵",
    "a\u{300}\u{323}",
    "\r\n",
    "\t",
    string.repeat(" ", 40),
    "\n# ",
    "\n===",
    "\n- ",
    "\n> ",
    "\n```",
    "|---|",
    "- [x] ",
    "1. ",
    "\n    ",
    "~~~",
    "\n***",
  ]
  list.each(kinds, fn(kind) {
    assert string.contains(text, kind)
      as { "no note holds " <> string.inspect(kind) }
  })
  assert list.any(notes, fn(note) { string.ends_with(note, "\n") })
  assert list.contains(notes, "")
}

pub fn the_generated_actions_hold_every_kind_of_action_test() {
  let named = fn(action: Action) {
    let assert [name, ..] = string.split(string.inspect(action), "(")
    name
  }
  let seen = sample(script.anything(), 3000) |> list.map(named)
  let expected = [
    "Type", "Backspace", "DeleteForward", "Replace", "Select", "Point", "Key",
    "Edge", "Escape", "Release", "StartDrag", "Drop", "Focus", "Undo", "Redo",
    "Compose", "Unstep", "FieldStep", "Aim", "StepPast", "Settle", "Hold",
    "Replay", "Tick", "Open", "SetLive",
  ]
  list.each(expected, fn(name) {
    assert list.contains(seen, name) as { "no action is " <> name }
  })
}
