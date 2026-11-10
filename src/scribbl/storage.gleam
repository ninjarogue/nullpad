//// THE storage interface: a library of notes, wherever they live. The shell
//// calls the functions below and nothing else. Each returns a Lustre
//// `Effect` that later delivers one message built by `then`.
//// Hidden here so a backend stays five small functions: `NoteId`s, titles,
//// ordering, and wrapping callbacks as effects.
//// Imported by: the app shell, and `scribbl/storage/*` backends (for
//// `Backend`, `Record`, `Reply`, `Failure`). Imports: lustre/effect.

import gleam/option.{type Option}
import lustre/effect.{type Effect}

/// Names one note for its whole life. Opaque: only this module makes one,
/// from a key a backend returned, so an id always points at a stored note.
pub opaque type NoteId {
  NoteId(String)
}

/// The id as text, for element keys and test ids. Not for storing.
pub fn id_text(id: NoteId) -> String {
  let NoteId(key) = id
  key
}

/// `title` is the one the user typed. `None` means "derive it from the body".
pub type Note {
  Note(id: NoteId, title: Option(String), body: String)
}

/// A row in the note list. `title` is already `display_title`.
pub type Summary {
  Summary(id: NoteId, title: String, modified_ms: Int)
}

pub type Failure {
  NotFound
  /// Storage refused or is missing (private mode, quota, permission).
  Unavailable(detail: String)
}

/// The title to show for a note, and the only place the rule lives:
/// 1. the typed title, if there is one and it is not blank;
/// 2. else the first non-blank line of the body with markdown markers
///    stripped ("# Trip notes" -> "Trip notes"), cut at the last whole word
///    before 60 graphemes with "…" added;
/// 3. else "Untitled".
/// The folder backend (M6) names files with this too.
pub fn display_title(title: Option(String), body: String) -> String {
  let _ = #(title, body)
  todo as "not implemented"
}

/// What a backend stores: plain data, no domain types.
pub type Record {
  Record(key: String, title: Option(String), body: String, modified_ms: Int)
}

pub type Reply(a) =
  fn(Result(a, Failure)) -> Nil

/// Everything a backend must do. The backend owns keys and time stamps (a
/// folder backend gets both from the file system). `put` is a whole-note
/// upsert, so repeating it is harmless. Implementations: `indexeddb` (M1), a
/// folder of .md files (M6). Sync fits later as a `Backend` wrapping a local
/// and a remote one and comparing `modified_ms`. Nothing above this changes.
/// A record of functions is also easy to fake in a test.
pub type Backend {
  Backend(
    all: fn(Reply(List(Record))) -> Nil,
    get: fn(String, Reply(Record)) -> Nil,
    /// key, title, body
    put: fn(String, Option(String), String, Reply(Nil)) -> Nil,
    /// Store a new empty record under a fresh key and reply with it.
    add: fn(Reply(Record)) -> Nil,
    remove: fn(String, Reply(Nil)) -> Nil,
  )
}

pub opaque type Storage {
  Storage(backend: Backend)
}

pub fn new(backend: Backend) -> Storage {
  Storage(backend:)
}

/// Newest first.
pub fn list(
  storage: Storage,
  then: fn(Result(List(Summary), Failure)) -> msg,
) -> Effect(msg) {
  let _ = #(storage, then)
  todo as "not implemented"
}

pub fn load(
  storage: Storage,
  id: NoteId,
  then: fn(Result(Note, Failure)) -> msg,
) -> Effect(msg) {
  let _ = #(storage, id, then)
  todo as "not implemented"
}

/// Store the note's current title and body.
pub fn save(
  storage: Storage,
  note: Note,
  then: fn(Result(Nil, Failure)) -> msg,
) -> Effect(msg) {
  // let Note(id: NoteId(key), title:, body:) = note
  // effect.from(fn(dispatch) {
  //   storage.backend.put(key, title, body, fn(result) {
  //     dispatch(then(result))
  //   })
  // })
  let _ = #(storage, note, then)
  todo as "not implemented"
}

/// Add an empty note and reply with it.
pub fn create(
  storage: Storage,
  then: fn(Result(Note, Failure)) -> msg,
) -> Effect(msg) {
  let _ = #(storage, then)
  todo as "not implemented"
}

pub fn delete(
  storage: Storage,
  id: NoteId,
  then: fn(Result(Nil, Failure)) -> msg,
) -> Effect(msg) {
  let _ = #(storage, id, then)
  todo as "not implemented"
}
