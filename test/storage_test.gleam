//// Examples for the storage module. See `markdown_test` for how `pending_`
//// functions work.

import gleam/list
import gleam/option.{None, Some}
import gleam/string
import harness.{type Stored, Stored}
import scribbl/storage.{type Storage, Note}

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

pub fn save_stores_the_note_under_its_own_key_test() {
  let shelf =
    harness.shelf(holding: [Stored("a", None, "one"), Stored("b", None, "two")])
  let store = storage.new(harness.backend(shelf))
  let assert [Ok([_, a])] = harness.run(storage.list(store, fn(rows) { rows }))

  let note = Note(id: a.id, title: Some("First"), body: "uno")
  assert harness.run(storage.save(store, note, fn(saved) { saved }))
    == [Ok(Nil)]
  assert harness.on_shelf(shelf)
    == [Stored("b", None, "two"), Stored("a", Some("First"), "uno")]
  assert harness.run(storage.load(store, a.id, fn(found) { found }))
    == [Ok(note)]
}

pub fn create_adds_one_empty_note_test() {
  let shelf = harness.shelf(holding: [Stored("a", None, "one")])
  let store = storage.new(harness.backend(shelf))
  let assert [Ok(note)] = harness.run(storage.create(store, fn(made) { made }))

  assert note.title == None
  assert note.body == ""
  assert harness.on_shelf(shelf)
    == [Stored("a", None, "one"), Stored(storage.id_text(note.id), None, "")]
  assert harness.run(storage.load(store, note.id, fn(found) { found }))
    == [Ok(note)]
}

pub fn delete_removes_only_that_note_test() {
  let shelf =
    harness.shelf(holding: [Stored("a", None, "one"), Stored("b", None, "two")])
  let store = storage.new(harness.backend(shelf))
  let assert [Ok([b, _])] = harness.run(storage.list(store, fn(rows) { rows }))

  assert harness.run(storage.delete(store, b.id, fn(gone) { gone }))
    == [Ok(Nil)]
  assert harness.on_shelf(shelf) == [Stored("a", None, "one")]
  assert harness.run(storage.load(store, b.id, fn(found) { found }))
    == [Error(storage.NotFound)]
}

fn storage_holding(notes: List(Stored)) -> Storage {
  storage.new(harness.backend(harness.shelf(holding: notes)))
}
