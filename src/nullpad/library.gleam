//// The notes as the user meets them: which exist, which one is open,
//// whether its text is saved, and which note is being deleted or can still
//// be brought back. Pure Gleam.
////
//// `update` does nothing itself. It returns `Command`s, plain data that the
//// app shell turns into storage calls, timers and editor changes, and each
//// answer comes back in as an `Event`. The editor holds the text, so the
//// shell passes it in.
////
//// Imported by: the app shell, tests. Imports: `storage`, for notes and
//// their ids.

import gleam/list
import gleam/option.{type Option, None, Some}
import nullpad/storage.{type Failure, type Note, type NoteId, type Summary, Note}

/// How long after the last edit the note is saved.
const autosave_ms = 800

const retry_save_ms = 5000

/// How long a deleted note can be brought back.
const undo_ms = 5000

pub opaque type Library {
  Library(
    notes: List(Summary),
    open: Option(Open),
    edits: Int,
    leaving_for: Option(Destination),
    /// Any note can be deleted, open or not, one at a time. While storage
    /// has the request for the open note nothing is saved, or the save would
    /// bring the note back.
    deleting: Option(NoteId),
    undo: Option(Undo),
    /// Counts deletes, so an old timer cannot clear a newer undo.
    deletes: Int,
    problem: Option(Failure),
  )
}

/// The note the editor's text belongs to. Set only when a load finishes, so
/// text is never saved under another note's id.
pub type Open {
  Open(
    id: NoteId,
    /// The title the user typed. `None` means "derive it from the text".
    title: Option(String),
    save_state: SaveState,
  )
}

pub type SaveState {
  Unsaved
  Saving
  Saved
}

type Destination {
  ExistingNote(NoteId)
  NewNote
}

/// A delete is not asked about. It can be undone for a few seconds instead.
type Undo {
  Undo(note: Note, was_open: Bool)
}

pub type Event {
  /// The editor's text changed.
  TextEdited
  UserRenamedNote(title: String)
  UserPickedNote(NoteId)
  UserAskedForNewNote
  UserDeletedNote(NoteId)
  UserUndidDelete
  /// Save now if anything is unsaved: the page was hidden, or vim's `:w`.
  SaveDue
  AutosaveDue(edits: Int)
  UndoExpired(deletes: Int)
  StorageListed(Result(List(Summary), Failure))
  StorageLoaded(Result(Note, Failure))
  StorageCreated(Result(Note, Failure))
  StorageSaved(id: NoteId, edits: Int, result: Result(Nil, Failure))
  /// The body of a note that is not open, read so its delete can be undone.
  StorageFoundDoomed(Result(Note, Failure))
  StorageDeleted(note: Note, result: Result(Nil, Failure))
  StorageRestored(note: Note, was_open: Bool, result: Result(Nil, Failure))
}

/// What the shell must do. Storage answers each storage command with one
/// event:
///   ListNotes       StorageListed
///   LoadNote        StorageLoaded
///   LoadDoomedNote  StorageFoundDoomed
///   CreateNote      StorageCreated
///   SaveNote        StorageSaved, with the note's id and `edits`
///   DeleteNote      StorageDeleted, with the note
///   RestoreNote     StorageRestored, with the note and `was_open`
pub type Command {
  ListNotes
  LoadNote(NoteId)
  LoadDoomedNote(NoteId)
  CreateNote
  SaveNote(note: Note, edits: Int)
  DeleteNote(Note)
  RestoreNote(note: Note, was_open: Bool)
  /// Send `event` back after `ms` milliseconds.
  After(ms: Int, event: Event)
  /// Replace the editor's text with a note that was just opened.
  OpenInEditor(text: String)
}

/// Nothing is open until the notes are listed.
pub fn start() -> #(Library, List(Command)) {
  let library =
    Library(
      notes: [],
      open: None,
      edits: 0,
      leaving_for: None,
      deleting: None,
      undo: None,
      deletes: 0,
      problem: None,
    )
  #(library, [ListNotes])
}

/// Newest first.
pub fn notes(library: Library) -> List(Summary) {
  library.notes
}

pub fn open(library: Library) -> Option(Open) {
  library.open
}

pub fn is_open(library: Library, id: NoteId) -> Bool {
  case library.open {
    Some(open) -> open.id == id
    None -> False
  }
}

pub fn deleting(library: Library) -> Option(NoteId) {
  library.deleting
}

/// The note deleted last, while it can still be brought back.
pub fn undoable(library: Library) -> Option(Note) {
  option.map(library.undo, fn(undo) { undo.note })
}

/// The last storage failure, until a save works or a note opens.
pub fn problem(library: Library) -> Option(Failure) {
  library.problem
}

/// `text` is the editor's text now, the body a save stores.
pub fn update(
  library: Library,
  event: Event,
  text: String,
) -> #(Library, List(Command)) {
  case event {
    TextEdited -> edited(library)
    UserRenamedNote(title) ->
      case library.open {
        Some(open) -> {
          let title = case title {
            "" -> None
            _ -> Some(title)
          }
          edited(Library(..library, open: Some(Open(..open, title:))))
        }
        None -> #(library, [])
      }

    AutosaveDue(edits) if edits == library.edits -> save(library, text)
    AutosaveDue(_) -> #(library, [])
    SaveDue -> save(library, text)

    StorageSaved(id:, edits:, result: Ok(_)) -> {
      let library = case is_awaited_answer(library, id, edits) {
        True -> with_save_state(library, Saved)
        False -> library
      }
      let #(library, left) =
        leave_when_saved(Library(..library, problem: None), text)
      #(library, list.append(left, [ListNotes]))
    }
    StorageSaved(id:, edits:, result: Error(failure)) -> {
      let library = Library(..library, problem: Some(failure))
      case is_awaited_answer(library, id, edits) {
        True -> #(
          Library(..with_save_state(library, Unsaved), leaving_for: None),
          [After(retry_save_ms, AutosaveDue(library.edits))],
        )
        False -> #(library, [])
      }
    }

    StorageListed(Ok(notes)) -> {
      let library = Library(..library, notes:)
      #(library, keep_a_note_open(library))
    }

    StorageLoaded(Ok(note)) -> open_when_saved(library, note, text)
    StorageCreated(Ok(note)) -> {
      let #(library, opened) = open_when_saved(library, note, text)
      #(library, list.append(opened, [ListNotes]))
    }

    UserPickedNote(id) ->
      case library.open {
        Some(open) if open.id == id -> #(
          Library(..library, leaving_for: None),
          [],
        )
        Some(_) | None ->
          Library(..library, leaving_for: Some(ExistingNote(id)))
          |> leave_when_saved(text)
      }

    UserAskedForNewNote ->
      Library(..library, leaving_for: Some(NewNote))
      |> leave_when_saved(text)

    UserDeletedNote(id) ->
      case library.deleting, library.open {
        Some(_), _ -> #(library, [])
        None, Some(open) if open.id == id -> {
          let note = Note(id:, title: open.title, body: text)
          #(Library(..library, deleting: Some(id), leaving_for: None), [
            DeleteNote(note),
          ])
        }
        None, Some(_) | None, None -> #(Library(..library, deleting: Some(id)), [
          LoadDoomedNote(id),
        ])
      }
    StorageFoundDoomed(Ok(note)) -> #(library, [DeleteNote(note)])
    StorageFoundDoomed(Error(failure)) -> #(
      Library(..library, deleting: None, problem: Some(failure)),
      [ListNotes],
    )

    StorageDeleted(note:, result: Ok(_)) -> {
      let was_open = is_open(library, note.id)
      let deletes = library.deletes + 1
      let library =
        Library(
          ..library,
          deleting: None,
          undo: Some(Undo(note:, was_open:)),
          deletes:,
        )
      let library = case was_open {
        True -> Library(..library, open: None)
        False -> library
      }
      #(library, [ListNotes, After(undo_ms, UndoExpired(deletes))])
    }
    StorageDeleted(note:, result: Error(failure)) -> {
      let library = Library(..library, deleting: None, problem: Some(failure))
      case is_open(library, note.id) {
        True -> #(library, [After(retry_save_ms, AutosaveDue(library.edits))])
        False -> #(library, [])
      }
    }

    UserUndidDelete ->
      case library.undo {
        Some(Undo(note:, was_open:)) -> #(Library(..library, undo: None), [
          RestoreNote(note:, was_open:),
        ])
        None -> #(library, [])
      }
    StorageRestored(note:, was_open: True, result: Ok(_)) -> {
      let #(library, left) =
        Library(..library, leaving_for: Some(ExistingNote(note.id)))
        |> leave_when_saved(text)
      #(library, list.append(left, [ListNotes]))
    }
    StorageRestored(was_open: False, result: Ok(_), ..) -> #(library, [
      ListNotes,
    ])
    StorageRestored(note:, was_open:, result: Error(failure)) -> #(
      Library(
        ..library,
        undo: Some(Undo(note:, was_open:)),
        problem: Some(failure),
      ),
      [],
    )
    UndoExpired(deletes) if deletes == library.deletes -> #(
      Library(..library, undo: None),
      [],
    )
    UndoExpired(_) -> #(library, [])

    StorageLoaded(Error(storage.NotFound as failure)) -> #(
      Library(..library, problem: Some(failure)),
      [ListNotes],
    )
    StorageListed(Error(failure))
    | StorageLoaded(Error(failure))
    | StorageCreated(Error(failure)) -> #(
      Library(..library, problem: Some(failure)),
      [],
    )
  }
}

fn edited(library: Library) -> #(Library, List(Command)) {
  let edits = library.edits + 1
  #(Library(..with_save_state(library, Unsaved), edits:), [
    After(autosave_ms, AutosaveDue(edits)),
  ])
}

fn with_save_state(library: Library, save_state: SaveState) -> Library {
  let open = option.map(library.open, fn(open) { Open(..open, save_state:) })
  Library(..library, open:)
}

fn is_awaited_answer(library: Library, id: NoteId, edits: Int) -> Bool {
  case library.open {
    Some(Open(save_state: Saving, ..) as open) ->
      open.id == id && edits == library.edits
    Some(Open(save_state: Unsaved, ..))
    | Some(Open(save_state: Saved, ..))
    | None -> False
  }
}

fn leave_when_saved(
  library: Library,
  text: String,
) -> #(Library, List(Command)) {
  case library.leaving_for, library.open {
    None, _ -> #(library, [])
    Some(_), Some(Open(save_state: Unsaved, ..)) -> save(library, text)
    Some(_), Some(Open(save_state: Saving, ..)) -> #(library, [])
    Some(destination), Some(Open(save_state: Saved, ..))
    | Some(destination), None
    -> #(Library(..library, leaving_for: None), [
      case destination {
        ExistingNote(id) -> LoadNote(id)
        NewNote -> CreateNote
      },
    ])
  }
}

fn save(library: Library, text: String) -> #(Library, List(Command)) {
  case library.open {
    Some(Open(id:, title:, save_state: Unsaved) as open) ->
      case library.deleting == Some(id) {
        True -> #(library, [])
        False -> #(
          Library(..library, open: Some(Open(..open, save_state: Saving))),
          [SaveNote(Note(id:, title:, body: text), library.edits)],
        )
      }
    Some(Open(save_state: Saving, ..))
    | Some(Open(save_state: Saved, ..))
    | None -> #(library, [])
  }
}

fn open_when_saved(
  library: Library,
  note: Note,
  text: String,
) -> #(Library, List(Command)) {
  let typed_while_it_was_loading = case library.open {
    Some(Open(save_state: Unsaved, ..)) | Some(Open(save_state: Saving, ..)) ->
      True
    Some(Open(save_state: Saved, ..)) | None -> False
  }
  case typed_while_it_was_loading {
    True ->
      Library(..library, leaving_for: Some(ExistingNote(note.id)))
      |> leave_when_saved(text)
    False -> {
      let open = Open(id: note.id, title: note.title, save_state: Saved)
      #(Library(..library, open: Some(open), leaving_for: None, problem: None), [
        OpenInEditor(note.body),
      ])
    }
  }
}

fn keep_a_note_open(library: Library) -> List(Command) {
  case library.open, library.notes {
    Some(_), _ -> []
    None, [newest, ..] -> [LoadNote(newest.id)]
    None, [] -> [CreateNote]
  }
}
