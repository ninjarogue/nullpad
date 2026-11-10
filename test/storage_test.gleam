//// Examples for the storage module. See `markdown_test` for how `pending_`
//// functions work.

import gleam/list
import gleam/option.{None, Some}
import harness
import scribbl/storage.{Backend, NotFound, Record}

pub fn display_title_test() {
  assert storage.display_title(Some("Groceries"), "# Other") == "Groceries"
  assert storage.display_title(None, "\n# Trip notes\nmore") == "Trip notes"
  assert storage.display_title(Some("  "), "") == "Untitled"
}

/// A long first line is cut at a whole word and gets an ellipsis.
pub fn long_title_is_cut_test() {
  let body =
    "This first line is far too long to be a title and it just keeps going on"

  assert storage.display_title(None, body)
    == "This first line is far too long to be a title and it just…"
}

/// The markers that start a line are not part of a title.
pub fn title_markers_are_stripped_test() {
  assert storage.display_title(None, "## Trip **notes**") == "Trip notes"
  assert storage.display_title(None, "- [ ] buy `milk`") == "buy milk"
  assert storage.display_title(None, "> 1. Pack") == "Pack"
  assert storage.display_title(None, "#\n\nreal text") == "real text"
}

/// A typed title is never cut, however long.
pub fn typed_title_is_kept_whole_test() {
  let long = "A typed title that is well over sixty graphemes long, on purpose"

  assert storage.display_title(Some(long), "") == long
}

/// The list is newest first, and each row already has its display title.
pub fn list_is_newest_first_test() {
  let store =
    storage.new(
      backend([
        Record(key: "old", title: None, body: "# Older", modified_ms: 1),
        Record(key: "new", title: Some("Newer"), body: "", modified_ms: 2),
      ]),
    )
  let assert [Ok(rows)] =
    harness.messages(storage.list(store, fn(rows) { rows }))

  assert list.map(rows, fn(row) { row.title }) == ["Newer", "Older"]
  assert list.map(rows, fn(row) { storage.id_text(row.id) }) == ["new", "old"]
}

/// A note that is listed can be loaded by the id from its row.
pub fn load_by_listed_id_test() {
  let store =
    storage.new(
      backend([
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

/// A backend that holds fixed records, answers at once and remembers
/// nothing.
fn backend(records: List(storage.Record)) -> storage.Backend {
  Backend(
    all: fn(reply) { reply(Ok(records)) },
    get: fn(key, reply) {
      list.find(records, fn(record) { record.key == key })
      |> result_or(NotFound)
      |> reply
    },
    put: fn(_key, _title, _body, reply) { reply(Ok(Nil)) },
    add: fn(reply) {
      reply(Ok(Record(key: "added", title: None, body: "", modified_ms: 0)))
    },
    remove: fn(_key, reply) { reply(Ok(Nil)) },
  )
}

fn result_or(result: Result(a, Nil), failure: storage.Failure) {
  case result {
    Ok(value) -> Ok(value)
    Error(Nil) -> Error(failure)
  }
}
