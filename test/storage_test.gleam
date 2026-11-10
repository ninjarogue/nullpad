//// Examples for the storage module. See `markdown_test` for how `pending_`
//// functions work.

import gleam/list
import gleam/option.{None, Some}
import gleam/string
import harness
import scribbl/storage.{Record}

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

pub fn list_is_newest_first_test() {
  let store =
    storage.new(
      harness.backend_holding([
        Record(key: "old", title: None, body: "# Older", modified_ms: 1),
        Record(key: "new", title: Some("Newer"), body: "", modified_ms: 2),
      ]),
    )
  let assert [Ok(rows)] =
    harness.messages(storage.list(store, fn(rows) { rows }))

  assert list.map(rows, fn(row) { row.title }) == ["Newer", "Older"]
  assert list.map(rows, fn(row) { storage.id_text(row.id) }) == ["new", "old"]
}

pub fn load_by_listed_id_test() {
  let store =
    storage.new(
      harness.backend_holding([
        Record(key: "a", title: None, body: "hello", modified_ms: 1),
      ]),
    )
  let assert [Ok([row])] =
    harness.messages(storage.list(store, fn(rows) { rows }))
  let assert [Ok(note)] =
    harness.messages(storage.load(store, row.id, fn(note) { note }))

  assert note.id == row.id
  assert note.body == "hello"
  assert note.title == None
}
