//// Examples for the storage module. See `markdown_test` for how `pending_`
//// functions work.

import gleam/option.{None, Some}
import scribbl/storage

/// M1
pub fn pending_display_title() {
  assert storage.display_title(Some("Groceries"), "# Other") == "Groceries"
  assert storage.display_title(None, "\n# Trip notes\nmore") == "Trip notes"
  assert storage.display_title(Some("  "), "") == "Untitled"
}

/// M1: a long first line is cut at a whole word and gets an ellipsis.
pub fn pending_long_title_is_cut() {
  let body =
    "This first line is far too long to be a title and it just keeps going on"

  assert storage.display_title(None, body)
    == "This first line is far too long to be a title and it just…"
}
