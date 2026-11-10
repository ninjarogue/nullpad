//// Examples for the storage module. See `markdown_test` for how `pending_`
//// functions work.

import gleam/list
import gleam/option.{None, Some}
import harness.{type Stored, Stored}
import scribbl/storage.{type Storage}

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

pub fn title_markers_are_stripped_test() {
  assert storage.display_title(None, "## Trip **notes**") == "Trip notes"
  assert storage.display_title(None, "- [ ] buy `milk`") == "buy milk"
  assert storage.display_title(None, "> 1. Pack") == "Pack"
  assert storage.display_title(None, "#\n\nreal text") == "real text"
}

pub fn typed_title_is_kept_whole_test() {
  let long = "A typed title that is well over sixty graphemes long, on purpose"

  assert storage.display_title(Some(long), "") == long
}

pub fn list_is_newest_first_test() {
  let store =
    storage_holding([
      Stored(key: "old", title: None, body: "# Older"),
      Stored(key: "new", title: Some("Newer"), body: ""),
    ])
  let assert [Ok(rows)] = harness.run(storage.list(store, fn(rows) { rows }))

  assert list.map(rows, fn(row) { row.title }) == ["Newer", "Older"]
  assert list.map(rows, fn(row) { storage.id_text(row.id) }) == ["new", "old"]
}

pub fn load_by_listed_id_test() {
  let store = storage_holding([Stored(key: "a", title: None, body: "hello")])
  let assert [Ok([row])] = harness.run(storage.list(store, fn(rows) { rows }))
  let assert [Ok(note)] =
    harness.run(storage.load(store, row.id, fn(note) { note }))

  assert note.id == row.id
  assert note.body == "hello"
  assert note.title == None
}

fn storage_holding(notes: List(Stored)) -> Storage {
  storage.new(harness.backend(harness.shelf(holding: notes)))
}
