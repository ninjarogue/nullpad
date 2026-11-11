//// Examples for the storage module.

import gleam/option.{None, Some}
import gleam/string
import nullpad/storage

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

pub fn a_title_is_the_first_line_of_text_the_page_shows_test() {
  assert storage.display_title(None, "---\n\n> - [x] **done** thing")
    == "done thing"
  assert storage.display_title(None, "**bold\nmore**") == "bold"
  assert storage.display_title(None, "Title\n===") == "Title"
  assert storage.display_title(None, "```js\nlet x = 1\n```") == "let x = 1"
  assert storage.display_title(None, "-\n\n> \n- [ ]\n\n  late") == "late"
}

pub fn a_title_reads_markup_the_way_the_page_does_test() {
  assert storage.display_title(None, "**bold") == "**bold"
  assert storage.display_title(None, "#hashtag") == "#hashtag"
  assert storage.display_title(None, "# Title #") == "Title"
  assert storage.display_title(None, "[docs](https://x.y)") == "docs"
  assert storage.display_title(None, "\\*literal\\*") == "*literal*"
  assert storage.display_title(None, "    # indented") == "# indented"
}

pub fn a_typed_title_loses_only_the_spaces_around_it_test() {
  let gap = string.repeat(" ", 1000)

  assert storage.display_title(Some(" \t Groceries \n"), "") == "Groceries"
  assert storage.display_title(Some(gap <> "a" <> gap <> "b" <> gap), "")
    == "a" <> gap <> "b"
}

pub fn typed_title_is_kept_whole_test() {
  let long = "A typed title that is well over sixty graphemes long, on purpose"

  assert storage.display_title(Some(long), "") == long
}

pub fn a_link_that_stays_text_on_the_page_stays_text_in_the_title_test() {
  assert storage.display_title(None, "[x](javascript:alert(1))")
    == "[x](javascript:alert(1))"
}
