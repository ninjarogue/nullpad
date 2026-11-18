//// Enter, Tab and Shift+Tab in a list, with no browser. A note is written
//// with `|` where the caret is.

import gleam/list
import gleam/option
import gleam/string
import nullpad/buffer.{type Buffer}
import nullpad/editor.{type Editor, Outcome}
import nullpad/live
import nullpad/markdown
import nullpad/vim

fn at_caret(note: String) -> Buffer {
  let assert Ok(#(before, after)) = string.split_once(note, "|")
  let at = buffer.end_of(before)
  buffer.from_text(before <> after) |> buffer.select(anchor: at, head: at)
}

fn shown(ed: Editor) -> String {
  let b = editor.buffer(ed)
  let at = buffer.cursor(b)
  let lines = buffer.lines(b)
  list.index_map(lines, fn(line, row) {
    case row == at.row {
      True ->
        string.slice(line, 0, at.col) <> "|" <> string.drop_start(line, at.col)
      False -> line
    }
  })
  |> string.join("\n")
}

fn opened(note: String, live: Bool) -> Editor {
  let b = at_caret(note)
  let ed =
    editor.new(vim: False, live: False, paint: True)
    |> editor.open(buffer.text(b))
  let ed = editor.update(ed.editor, editor.ControlChanged(shown: b, at: 0))
  editor.set_live(ed.editor, live).editor
}

fn press_in(note: String, key: vim.Key, live: Bool) -> String {
  let ed = opened(note, live)
  let Outcome(editor: ed, ..) =
    editor.update(ed, editor.KeyPressed(key, shown: editor.field_buffer(ed)))
  shown(ed)
}

fn press(note: String, key: vim.Key) -> String {
  let whole = press_in(note, key, False)
  assert press_in(note, key, True) == whole
  whole
}

pub fn the_plain_editor_takes_enter_and_tab_test() {
  let ed = editor.new(vim: False, live: True, paint: True)
  assert editor.claims(ed, vim.Enter)
  assert editor.claims(ed, vim.Tab)
  assert editor.claims(ed, vim.BackTab)
}

pub fn enter_after_an_item_starts_the_next_test() {
  assert press("- yay|", vim.Enter) == "- yay\n- |"
  assert press("* yay|", vim.Enter) == "* yay\n* |"
  assert press("weee:\n- yay\n- cool|", vim.Enter)
    == "weee:\n- yay\n- cool\n- |"
}

pub fn enter_counts_up_a_numbered_list_test() {
  assert press("1. one|", vim.Enter) == "1. one\n2. |"
  assert press("1. one\n2. two|", vim.Enter) == "1. one\n2. two\n3. |"
  assert press("9) nine|", vim.Enter) == "9) nine\n10) |"
}

pub fn enter_after_a_task_starts_an_unticked_task_test() {
  assert press("- [x] done|", vim.Enter) == "- [x] done\n- [ ] |"
  assert press("- [ ] todo|", vim.Enter) == "- [ ] todo\n- [ ] |"
}

pub fn enter_in_the_middle_of_an_item_splits_it_test() {
  assert press("- ab|cd", vim.Enter) == "- ab\n- |cd"
  assert press("- ab| cd", vim.Enter) == "- ab\n- |cd"
}

pub fn enter_keeps_the_items_depth_and_its_quote_test() {
  assert press("- a\n  - b|", vim.Enter) == "- a\n  - b\n  - |"
  assert press("> - a|", vim.Enter) == "> - a\n> - |"
}

pub fn enter_on_an_empty_item_ends_the_list_test() {
  assert press("- a\n- |", vim.Enter) == "- a\n\n|"
  assert press("- a\n-|", vim.Enter) == "- a\n\n|"
  assert press("1. a\n2. |", vim.Enter) == "1. a\n\n|"
  assert press("- [ ] a\n- [ ] |", vim.Enter) == "- [ ] a\n\n|"
}

pub fn ending_an_empty_item_inside_a_numbered_list_keeps_the_count_test() {
  assert press("1. a\n2. |\n3. b\n4. c", vim.Enter) == "1. a\n\n|\n2. b\n3. c"
  assert press("8. a\n9. |\n10. b\n    - x", vim.Enter)
    == "8. a\n\n|\n9. b\n   - x"
}

pub fn enter_on_an_empty_nested_item_moves_it_out_a_level_test() {
  assert press("- a\n  - b\n  - |", vim.Enter) == "- a\n  - b\n- |"
  assert press("1. a\n   - b\n   - |", vim.Enter) == "1. a\n   - b\n2. |"
}

pub fn enter_outside_a_list_starts_a_line_test() {
  assert press("plain|", vim.Enter) == "plain\n|"
  assert press("pla|in", vim.Enter) == "pla\n|in"
  assert press("|", vim.Enter) == "\n|"
}

pub fn enter_in_a_code_block_inside_an_item_starts_a_line_test() {
  assert press("- a\n\n      co|de", vim.Enter) == "- a\n\n      co\n|de"
}

pub fn enter_inside_the_marker_starts_a_line_test() {
  assert press("|- a", vim.Enter) == "\n|- a"
}

pub fn tab_nests_an_item_under_the_one_above_test() {
  assert press("- a\n- b|", vim.Tab) == "- a\n  - b|"
  assert press("1. a\n2. b|", vim.Tab) == "1. a\n   1. b|"
  assert press("- a\n- b|\n  - c", vim.Tab) == "- a\n  - b|\n    - c"
}

pub fn tab_under_an_empty_item_of_a_loose_list_changes_nothing_test() {
  assert press("- a\n\n-\n\n- b|", vim.Tab) == "- a\n\n-\n\n- b|"
}

pub fn tab_on_a_first_item_changes_nothing_test() {
  assert press("- a|", vim.Tab) == "- a|"
  assert press("plain|", vim.Tab) == "plain|"
}

pub fn shift_tab_moves_a_nested_item_out_test() {
  assert press("- a\n  - b|", vim.BackTab) == "- a\n- b|"
  assert press("1. a\n   1. b|", vim.BackTab) == "1. a\n2. b|"
}

pub fn shift_tab_keeps_the_items_below_under_the_moved_item_test() {
  assert press("1. a\n   1. b|\n      1. x\n   2. c", vim.BackTab)
    == "1. a\n2. b|\n   1. x\n   2. c"
  assert press("- a\n  1) b\n  2) c|\n  3) d", vim.BackTab)
    == "- a\n  1) b\n2) c|\n   1) d"
  assert press("10. a\n    - b|\n    - c", vim.BackTab) == "10. a\n- b|\n  - c"
  assert press("- a\n  - b|\n  2) c", vim.BackTab) == "- a\n- b|\n  1) c"
}

pub fn shift_tab_on_a_top_item_changes_nothing_test() {
  assert press("- a|", vim.BackTab) == "- a|"
}

pub fn enter_in_a_list_is_one_undo_step_test() {
  let ed = opened("- yay|", False)
  let Outcome(editor: ed, ..) =
    editor.update(ed, editor.KeyPressed(vim.Enter, shown: editor.buffer(ed)))
  let Outcome(editor: ed, ..) = editor.update(ed, editor.UndoAsked)
  assert shown(ed) == "- yay|"
}

pub fn a_lone_dash_hangs_as_far_as_a_dash_and_a_space_test() {
  let lines = ["- yay", "-"]
  let blocks = markdown.parse(string.join(lines, "\n"))
  let field = live.Region(1, 1)
  assert live.kind(blocks, field:, lines:)
    == live.ListItem(task: False, marker: "- ")
}

pub fn the_page_is_laid_out_again_after_tab_test() {
  let ed = opened("- a\n- b|", True)
  assert editor.region(ed) == option.Some(live.Region(1, 1))
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.KeyPressed(vim.Tab, shown: editor.field_buffer(ed)),
    )
  assert editor.region(ed) == option.Some(live.Region(0, 1))
  let Outcome(editor: ed, ..) =
    editor.update(
      ed,
      editor.KeyPressed(vim.BackTab, shown: editor.field_buffer(ed)),
    )
  assert editor.region(ed) == option.Some(live.Region(1, 1))
}

fn selected(note: String, live: Bool) -> Editor {
  let assert Ok(#(before, rest)) = string.split_once(note, "[")
  let assert Ok(#(inside, after)) = string.split_once(rest, "]")
  let anchor = buffer.end_of(before)
  let head = buffer.end_of(before <> inside)
  let b =
    buffer.from_text(before <> inside <> after)
    |> buffer.select(anchor:, head:)
  let ed =
    editor.new(vim: False, live: False, paint: True)
    |> editor.open(buffer.text(b))
  let ed = editor.update(ed.editor, editor.ControlChanged(shown: b, at: 0))
  editor.set_live(ed.editor, live).editor
}

fn press_selected(note: String, key: vim.Key) -> String {
  let run = fn(live) {
    let ed = selected(note, live)
    editor.update(ed, editor.KeyPressed(key, shown: editor.field_buffer(ed))).editor
    |> shown
  }
  let whole = run(False)
  assert run(True) == whole
  whole
}

pub fn enter_numbers_the_items_after_the_new_one_test() {
  assert press("1. a\n2. b|\n3. c\n4. d", vim.Enter)
    == "1. a\n2. b\n3. |\n4. c\n5. d"
  assert press("1. a\n   1. b|\n   2. c\n2. d", vim.Enter)
    == "1. a\n   1. b\n   2. |\n   3. c\n2. d"
}

pub fn tab_and_shift_tab_number_the_items_after_test() {
  assert press("1. a\n2. b|\n3. c\n4. d", vim.Tab)
    == "1. a\n   1. b|\n2. c\n3. d"
  assert press("1. a\n   1. b|\n   2. c\n2. d", vim.BackTab)
    == "1. a\n2. b|\n   1. c\n3. d"
}

pub fn a_split_leaves_no_space_at_the_end_of_the_first_half_test() {
  assert press("- hello |world", vim.Enter) == "- hello\n- |world"
}

pub fn enter_inside_the_marker_starts_an_item_above_test() {
  assert press("-| hello", vim.Enter) == "- \n- |hello"
  assert press("- [| ] a", vim.Enter) == "- [ ] \n- [ ] |a"
}

pub fn enter_over_words_of_an_item_replaces_them_with_a_new_item_test() {
  assert press_selected("- hello [world]", vim.Enter) == "- hello\n- |"
}

pub fn tab_with_words_selected_nests_the_item_test() {
  assert press_selected("- a\n- hello [world]", vim.Tab)
    == "- a\n  - hello world|"
}

pub fn a_number_that_grows_a_digit_keeps_its_items_nested_test() {
  assert press("8. a|\n9. b\n   1. c", vim.Enter)
    == "8. a\n9. |\n10. b\n    1. c"
  assert press("9. a|\n   1. x", vim.Enter) == "9. a\n10. |\n    1. x"
}

pub fn tab_and_shift_tab_keep_items_nested_when_a_number_changes_width_test() {
  assert press("9. i\n   1. kid\n      1. gr|and", vim.BackTab)
    == "9. i\n   1. kid\n   2. gr|and"
  assert press("9. i\n   1. k|id\n      1. grand", vim.BackTab)
    == "9. i\n10. k|id\n    1. grand"
  assert press("9. i\n10. k|id\n    1. grand", vim.Tab)
    == "9. i\n   1. k|id\n      1. grand"
}

pub fn every_bullet_and_spacing_carries_on_test() {
  assert press("+ yay|", vim.Enter) == "+ yay\n+ |"
  assert press("1.  x|", vim.Enter) == "1.  x\n2.  |"
  assert press("- - a|", vim.Enter) == "- - a\n  - |"
}

pub fn tab_numbers_an_item_after_the_list_it_joins_test() {
  assert press("1. a\n   1. x\n2. b|", vim.Tab) == "1. a\n   1. x\n   2. b|"
}

pub fn list_keys_keep_a_quote_whole_test() {
  assert press("> - a\n> - b|", vim.Tab) == "> - a\n>   - b|"
  assert press("> - a\n> - |", vim.Enter) == "> - a\n>\n> |"
}

pub fn the_caret_before_the_marker_stays_before_it_test() {
  assert press("- a\n  - b\n |  - c", vim.BackTab) == "- a\n  - b\n|- c"
  assert press("- a\n|- b", vim.Tab) == "- a\n  |- b"
}

pub fn enter_in_a_loose_list_keeps_a_blank_row_between_items_test() {
  assert press("- a\n\n- b|", vim.Enter) == "- a\n\n- b\n\n- |"
  assert press("1. a\n\n2. b|\n\n3. c", vim.Enter)
    == "1. a\n\n2. b\n\n3. |\n\n4. c"
}
