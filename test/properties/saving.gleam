//// A note saved through the library and storage as the app does it, with
//// the storage commands carried out against a store in memory: the library
//// says what to save, and `storage.save` hands it to the backend.

import gleam/dict.{type Dict}
import gleam/dynamic
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import lustre/effect.{type Effect}
import nullpad/library.{
  type Event, type Library, SaveDue, SaveNote, StorageLoaded, StorageSaved,
  TextEdited, UserRenamedNote,
}
import nullpad/storage
import properties/gen
import qcheck.{type Generator}

pub type Again {
  SaveAgain
  AutosaveAgain
  Acknowledged
}

pub fn again() -> Generator(Again) {
  gen.element(SaveAgain, [AutosaveAgain, Acknowledged])
}

pub type Saved {
  Saved(
    stored: Dict(String, storage.Record),
    library: Library,
    saves_asked: Int,
  )
}

pub fn stored(title: Option(String), body: String) -> storage.Record {
  storage.Record(key: "k", title:, body:, modified_ms: 0)
}

/// A note that is opened, edited to `title` and `body`, and saved, then
/// asked to save again and answered as `extras` say, and finally answered.
pub fn saved_then(
  title: Option(String),
  body: String,
  extras: List(Again),
) -> Saved {
  let held = cell()
  fill(held, dict.from_list([#("k", stored(None, ""))]))
  let storage = storage.new(in_memory(held))
  let assert Ok([summary]) =
    answer(storage.list(storage, fn(listed) { listed }))
  let assert Ok(loaded) =
    answer(storage.load(storage, summary.id, fn(loaded) { loaded }))
  let #(started, _) = library.start()
  let #(opened, _) = library.update(started, StorageLoaded(Ok(loaded)), "")
  let #(opened, _) = case title {
    Some(title) -> library.update(opened, UserRenamedNote(title), body)
    None -> #(opened, [])
  }
  let #(opened, _) = library.update(opened, TextEdited, body)
  let assert [SaveNote(edits:, ..)] = library.update(opened, SaveDue, body).1
  let answered = StorageSaved(id: summary.id, edits:, result: Ok(Nil))
  let deliver = fn(state: #(Library, Int), event: Event) {
    let #(library, asked) = state
    let #(library, commands) = library.update(library, event, body)
    let notes = notes_to_save(commands)
    list.each(notes, fn(note) {
      let assert Ok(Nil) =
        answer(storage.save(storage, note, fn(saved) { saved }))
      Nil
    })
    #(library, asked + list.length(notes))
  }
  let #(library, asked) =
    list.fold(extras, deliver(#(opened, 0), SaveDue), fn(state, extra) {
      case extra {
        SaveAgain -> deliver(state, SaveDue)
        AutosaveAgain -> deliver(state, library.AutosaveDue(edits))
        Acknowledged -> deliver(state, answered)
      }
    })
    |> deliver(answered)
  Saved(stored: records(held), library:, saves_asked: asked)
}

fn notes_to_save(commands: List(library.Command)) -> List(storage.Note) {
  use command <- list.filter_map(commands)
  case command {
    SaveNote(note:, ..) -> Ok(note)
    library.ListNotes
    | library.LoadNote(_)
    | library.LoadDoomedNote(_)
    | library.CreateNote
    | library.DeleteNote(_)
    | library.RestoreNote(..)
    | library.After(..)
    | library.OpenInEditor(_) -> Error(Nil)
  }
}

fn in_memory(held: Cell(Dict(String, storage.Record))) -> storage.Backend {
  storage.Backend(
    all: fn(reply) { reply(Ok(dict.values(records(held)))) },
    get: fn(key, reply) {
      reply(
        dict.get(records(held), key)
        |> result.replace_error(storage.NotFound),
      )
    },
    put: fn(key, title, body, reply) {
      let record = storage.Record(key:, title:, body:, modified_ms: 0)
      fill(held, dict.insert(records(held), key, record))
      reply(Ok(Nil))
    },
    add: fn(_) { Nil },
    remove: fn(key, reply) {
      fill(held, dict.delete(records(held), key))
      reply(Ok(Nil))
    },
  )
}

fn records(
  held: Cell(Dict(String, storage.Record)),
) -> Dict(String, storage.Record) {
  let assert Ok(records) = read(held)
  records
}

/// The message `call` dispatches at once.
fn answer(call: Effect(message)) -> message {
  let answered = cell()
  effect.perform(
    call,
    fill(answered, _),
    fn(_, _) { Nil },
    fn(_) { Nil },
    dynamic.nil,
    fn(_, _) { Nil },
    fn(_, _) { Nil },
    fn(_) { Nil },
  )
  let assert Ok(message) = read(answered)
  message
}

type Cell(a)

@external(javascript, "../library_test_ffi.mjs", "cell")
fn cell() -> Cell(a)

@external(javascript, "../library_test_ffi.mjs", "put")
fn fill(cell: Cell(a), value: a) -> Nil

@external(javascript, "../library_test_ffi.mjs", "take")
fn read(cell: Cell(a)) -> Result(a, Nil)
