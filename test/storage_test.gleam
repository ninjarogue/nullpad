//// Examples for the storage module. See `markdown_test` for how `pending_`
//// functions work.

import gleam/option.{None, Some}
import gleam/string
import scribbl/storage

pub fn display_title_test() {
  assert storage.display_title(Some("Groceries"), "# Other") == "Groceries"
  assert storage.display_title(None, "\n# Trip notes\nmore") == "Trip notes"
  assert storage.display_title(Some("  "), "") == "Untitled"
}

pub fn long_title_is_cut_test() {
  let body =
    "This first line is far too long to be a title and it just keeps going on"

  assert storage.display_title(None, body)
    == "This first line is far too long to be a title and it just…"
}

pub fn a_long_word_is_cut_mid_word_test() {
  assert storage.display_title(None, string.repeat("a", 70))
    == string.repeat("a", 60) <> "…"
}

pub fn title_markers_are_stripped_test() {
  assert storage.display_title(None, "## Trip **notes**") == "Trip notes"
  assert storage.display_title(None, "- [ ] buy `milk`") == "buy milk"
  assert storage.display_title(None, "* milk") == "milk"
  assert storage.display_title(None, "+ milk") == "milk"
  assert storage.display_title(None, "- [x] eggs") == "eggs"
  assert storage.display_title(None, "> 1. Pack") == "Pack"
  assert storage.display_title(None, "#\n\nreal text") == "real text"
}

pub fn typed_title_is_kept_whole_test() {
  let long = "A typed title that is well over sixty graphemes long, on purpose"

  assert storage.display_title(Some(long), "") == long
}
