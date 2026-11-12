import gleam/dynamic
import gleam/list
import gleam/option.{type Option, None, Some}
import lustre/effect.{type Effect}
import nullpad/library.{
  type Command, type Event, type Library, type SaveState, After, CreateNote,
  DeleteNote, ListNotes, LoadDoomedNote, LoadNote, Open, OpenInEditor,
  RestoreNote, SaveDue, SaveNote, Saved, Saving, StorageCreated, StorageDeleted,
  StorageFoundDoomed, StorageListed, StorageLoaded, StorageRestored,
  StorageSaved, TextEdited, Unsaved, UserAskedForNewNote, UserDeletedNote,
  UserPickedNote, UserRenamedNote, UserUndidDelete,
}
import nullpad/storage.{
  type Failure, type Note, type NoteId, type Summary, Note, Summary,
}

const full = storage.Unavailable("the disk is full")

pub fn the_newest_note_opens_once_the_notes_are_listed_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(started, commands) = library.start()
  assert commands == [ListNotes]
  assert library.open(started) == None
  assert library.update(started, SaveDue, "").1 == []

  let #(listed, commands) =
    library.update(
      started,
      StorageListed(Ok([summary(groceries), summary(trip)])),
      "",
    )
  assert commands == [LoadNote(groceries.id)]
  assert library.notes(listed) == [summary(groceries), summary(trip)]

  let #(open, commands) =
    library.update(listed, StorageLoaded(Ok(groceries)), "")
  assert commands == [OpenInEditor("milk")]
  assert library.open(open)
    == Some(Open(groceries.id, Some("Groceries"), Saved))
}

pub fn with_no_notes_a_new_one_is_made_and_opened_test() {
  let assert [new_id] = ids(["new"])
  let #(started, _) = library.start()
  let #(listed, commands) = library.update(started, StorageListed(Ok([])), "")
  assert commands == [CreateNote]

  let new = Note(new_id, None, "")
  let #(open, commands) = library.update(listed, StorageCreated(Ok(new)), "")
  assert commands == [OpenInEditor(""), ListNotes]
  assert library.open(open) == Some(Open(new.id, None, Saved))
}

pub fn a_stale_autosave_timer_is_ignored_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(typed, commands) =
    library.update(opened([groceries, trip]), TextEdited, "milk,")
  let assert [After(800, first)] = commands
  let #(typed, commands) = library.update(typed, TextEdited, "milk, eggs")
  let assert [After(800, second)] = commands

  let #(typed, commands) = library.update(typed, first, "milk, eggs")
  assert commands == []
  assert save_state(typed) == Unsaved

  let #(saving, commands) = library.update(typed, second, "milk, eggs")
  assert saved_note(commands) == Note(..groceries, body: "milk, eggs")
  assert save_state(saving) == Saving
}

pub fn a_newer_edit_during_a_save_keeps_the_note_unsaved_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(typed, _) =
    library.update(opened([groceries, trip]), TextEdited, "milk, eggs")
  let #(saving, first_save) = library.update(typed, SaveDue, "milk, eggs")
  let #(typed_again, _) = library.update(saving, TextEdited, "milk, eggs, jam")

  let #(first_stored, commands) =
    library.update(typed_again, saved(first_save, Ok(Nil)), "milk, eggs, jam")
  assert commands == [ListNotes]
  assert save_state(first_stored) == Unsaved

  let #(saving_again, second_save) =
    library.update(first_stored, SaveDue, "milk, eggs, jam")
  let #(second_stored, _) =
    library.update(saving_again, saved(second_save, Ok(Nil)), "milk, eggs, jam")
  assert save_state(second_stored) == Saved
}

pub fn an_older_save_that_worked_does_not_mark_newer_text_saved_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(typed, _) =
    library.update(opened([groceries, trip]), TextEdited, "milk, eggs")
  let #(saving, first_save) = library.update(typed, SaveDue, "milk, eggs")
  let #(typed_again, _) = library.update(saving, TextEdited, "milk, eggs, jam")
  let #(saving_again, second_save) =
    library.update(typed_again, SaveDue, "milk, eggs, jam")

  let #(first_stored, _) =
    library.update(saving_again, saved(first_save, Ok(Nil)), "milk, eggs, jam")
  assert save_state(first_stored) == Saving

  let #(second_failed, commands) =
    library.update(first_stored, saved(second_save, Error(full)), "")
  let assert [After(5000, _)] = commands
  assert save_state(second_failed) == Unsaved
}

pub fn an_older_save_that_failed_does_not_mark_newer_text_unsaved_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(typed, _) =
    library.update(opened([groceries, trip]), TextEdited, "milk, eggs")
  let #(saving, first_save) = library.update(typed, SaveDue, "milk, eggs")
  let #(typed_again, _) = library.update(saving, TextEdited, "milk, eggs, jam")
  let #(saving_again, _) =
    library.update(typed_again, SaveDue, "milk, eggs, jam")

  let #(first_failed, commands) =
    library.update(saving_again, saved(first_save, Error(full)), "")
  assert commands == []
  assert save_state(first_failed) == Saving
  assert library.problem(first_failed) == Some(full)
}

pub fn leaving_waits_for_the_save_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(typed, _) =
    library.update(opened([groceries, trip]), TextEdited, "milk, eggs")

  let #(leaving, save) =
    library.update(typed, UserPickedNote(trip.id), "milk, eggs")
  assert saved_note(save) == Note(..groceries, body: "milk, eggs")
  assert open_id(leaving) == Some(groceries.id)

  let #(left, commands) =
    library.update(leaving, saved(save, Ok(Nil)), "milk, eggs")
  assert commands == [LoadNote(trip.id), ListNotes]
  assert save_state(left) == Saved

  let #(arrived, commands) =
    library.update(left, StorageLoaded(Ok(trip)), "milk, eggs")
  assert commands == [OpenInEditor("# Trip")]
  assert library.open(arrived) == Some(Open(trip.id, None, Saved))
}

pub fn leaving_during_a_save_waits_for_its_answer_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(typed, _) =
    library.update(opened([groceries, trip]), TextEdited, "milk, eggs")
  let #(saving, save) = library.update(typed, SaveDue, "milk, eggs")

  let #(leaving, commands) =
    library.update(saving, UserAskedForNewNote, "milk, eggs")
  assert commands == []

  let #(_, commands) =
    library.update(leaving, saved(save, Ok(Nil)), "milk, eggs")
  assert commands == [CreateNote, ListNotes]
}

pub fn picking_the_open_note_again_cancels_leaving_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(typed, _) =
    library.update(opened([groceries, trip]), TextEdited, "milk, eggs")
  let #(leaving, save) =
    library.update(typed, UserPickedNote(trip.id), "milk, eggs")

  let #(staying, commands) =
    library.update(leaving, UserPickedNote(groceries.id), "milk, eggs")
  assert commands == []

  let #(stored, commands) =
    library.update(staying, saved(save, Ok(Nil)), "milk, eggs")
  assert commands == [ListNotes]
  assert open_id(stored) == Some(groceries.id)
}

pub fn a_failed_save_stays_on_the_note_and_tries_again_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(typed, _) =
    library.update(opened([groceries, trip]), TextEdited, "milk, eggs")
  let #(leaving, save) =
    library.update(typed, UserPickedNote(trip.id), "milk, eggs")

  let #(failed, commands) =
    library.update(leaving, saved(save, Error(full)), "milk, eggs")
  let assert [After(5000, retry)] = commands
  assert save_state(failed) == Unsaved
  assert open_id(failed) == Some(groceries.id)
  assert library.problem(failed) == Some(full)

  let #(retrying, save) = library.update(failed, retry, "milk, eggs")
  assert saved_note(save) == Note(..groceries, body: "milk, eggs")

  let #(stored, commands) =
    library.update(retrying, saved(save, Ok(Nil)), "milk, eggs")
  assert commands == [ListNotes]
  assert save_state(stored) == Saved
  assert open_id(stored) == Some(groceries.id)
  assert library.problem(stored) == None
}

pub fn a_note_that_loads_while_the_user_types_opens_once_the_text_is_saved_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(loading, commands) =
    library.update(opened([groceries, trip]), UserPickedNote(trip.id), "milk")
  assert commands == [LoadNote(trip.id)]
  let #(typed, _) = library.update(loading, TextEdited, "milk, eggs")

  let #(saving, save) =
    library.update(typed, StorageLoaded(Ok(trip)), "milk, eggs")
  assert saved_note(save) == Note(..groceries, body: "milk, eggs")
  assert open_id(saving) == Some(groceries.id)

  let #(stored, commands) =
    library.update(saving, saved(save, Ok(Nil)), "milk, eggs")
  assert commands == [LoadNote(trip.id), ListNotes]

  let #(arrived, commands) =
    library.update(stored, StorageLoaded(Ok(trip)), "milk, eggs")
  assert commands == [OpenInEditor("# Trip")]
  assert open_id(arrived) == Some(trip.id)
}

pub fn a_typed_title_is_saved_and_an_empty_one_is_derived_again_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(renamed, commands) =
    library.update(
      opened([trip, groceries]),
      UserRenamedNote("Japan"),
      "# Trip",
    )
  let assert [After(800, autosave)] = commands
  assert library.open(renamed) == Some(Open(trip.id, Some("Japan"), Unsaved))

  let #(saving, save) = library.update(renamed, autosave, "# Trip")
  assert saved_note(save) == Note(..trip, title: Some("Japan"))

  let #(stored, _) = library.update(saving, saved(save, Ok(Nil)), "# Trip")
  let #(unnamed, commands) =
    library.update(stored, UserRenamedNote(""), "# Trip")
  let assert [After(800, autosave)] = commands
  let #(_, save) = library.update(unnamed, autosave, "# Trip")
  assert saved_note(save) == trip
}

pub fn deleting_the_open_note_saves_nothing_until_storage_answers_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(typed, commands) =
    library.update(opened([groceries, trip]), TextEdited, "milk, eggs")
  let assert [After(800, autosave)] = commands
  let doomed = Note(..groceries, body: "milk, eggs")

  let #(deleting, commands) =
    library.update(typed, UserDeletedNote(groceries.id), "milk, eggs")
  assert commands == [DeleteNote(doomed)]
  assert library.deleting(deleting) == Some(groceries.id)
  assert library.update(deleting, autosave, "milk, eggs").1 == []
  assert library.update(deleting, SaveDue, "milk, eggs").1 == []

  let #(deleted, commands) =
    library.update(deleting, StorageDeleted(doomed, Ok(Nil)), "milk, eggs")
  let assert [ListNotes, After(5000, _)] = commands
  assert library.open(deleted) == None
  assert library.deleting(deleted) == None
  assert library.undoable(deleted) == Some(doomed)

  let #(_, commands) =
    library.update(deleted, StorageListed(Ok([summary(trip)])), "milk, eggs")
  assert commands == [LoadNote(trip.id)]
}

pub fn deleting_another_note_keeps_the_open_one_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(finding, commands) =
    library.update(opened([groceries, trip]), UserDeletedNote(trip.id), "milk")
  assert commands == [LoadDoomedNote(trip.id)]
  assert library.deleting(finding) == Some(trip.id)

  let #(deleting, commands) =
    library.update(finding, StorageFoundDoomed(Ok(trip)), "milk")
  assert commands == [DeleteNote(trip)]

  let #(typed, _) = library.update(deleting, TextEdited, "milk, eggs")
  let #(saving, save) = library.update(typed, SaveDue, "milk, eggs")
  assert saved_note(save) == Note(..groceries, body: "milk, eggs")

  let #(deleted, commands) =
    library.update(saving, StorageDeleted(trip, Ok(Nil)), "milk, eggs")
  let assert [ListNotes, After(5000, _)] = commands
  assert open_id(deleted) == Some(groceries.id)
  assert save_state(deleted) == Saving
  assert library.undoable(deleted) == Some(trip)
}

pub fn only_one_note_is_deleted_at_a_time_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(finding, _) =
    library.update(opened([groceries, trip]), UserDeletedNote(trip.id), "milk")

  let #(still_finding, commands) =
    library.update(finding, UserDeletedNote(groceries.id), "milk")
  assert commands == []
  assert library.deleting(still_finding) == Some(trip.id)
}

pub fn undo_reopens_a_note_that_was_open_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(typed, _) =
    library.update(opened([groceries, trip]), TextEdited, "milk, eggs")
  let doomed = Note(..groceries, body: "milk, eggs")
  let #(deleting, _) =
    library.update(typed, UserDeletedNote(groceries.id), "milk, eggs")
  let #(deleted, _) =
    library.update(deleting, StorageDeleted(doomed, Ok(Nil)), "milk, eggs")
  let #(listed, _) =
    library.update(deleted, StorageListed(Ok([summary(trip)])), "milk, eggs")
  let #(moved_on, _) =
    library.update(listed, StorageLoaded(Ok(trip)), "milk, eggs")

  let #(restoring, commands) =
    library.update(moved_on, UserUndidDelete, "# Trip")
  assert commands == [RestoreNote(doomed, was_open: True)]
  assert library.undoable(restoring) == None

  let #(_, commands) =
    library.update(restoring, StorageRestored(doomed, True, Ok(Nil)), "# Trip")
  assert commands == [LoadNote(groceries.id), ListNotes]
}

pub fn undo_of_another_note_leaves_the_open_note_open_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(deleted, _) = delete_closed(opened([groceries, trip]), trip)

  let #(restoring, commands) = library.update(deleted, UserUndidDelete, "milk")
  assert commands == [RestoreNote(trip, was_open: False)]

  let #(restored, commands) =
    library.update(restoring, StorageRestored(trip, False, Ok(Nil)), "milk")
  assert commands == [ListNotes]
  assert open_id(restored) == Some(groceries.id)
}

pub fn an_old_undo_timer_does_not_clear_a_newer_undo_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(deleted, commands) = delete_closed(opened([groceries, trip]), trip)
  let assert [ListNotes, After(5000, first_expiry)] = commands
  let #(restoring, _) = library.update(deleted, UserUndidDelete, "milk")
  let #(restored, _) =
    library.update(restoring, StorageRestored(trip, False, Ok(Nil)), "milk")
  let #(deleted_again, commands) = delete_closed(restored, trip)
  let assert [ListNotes, After(5000, second_expiry)] = commands

  let #(still_undoable, _) = library.update(deleted_again, first_expiry, "milk")
  assert library.undoable(still_undoable) == Some(trip)

  let #(expired, _) = library.update(still_undoable, second_expiry, "milk")
  assert library.undoable(expired) == None
}

pub fn a_failed_restore_offers_the_undo_again_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(deleted, _) = delete_closed(opened([groceries, trip]), trip)
  let #(restoring, _) = library.update(deleted, UserUndidDelete, "milk")

  let #(failed, commands) =
    library.update(restoring, StorageRestored(trip, False, Error(full)), "milk")
  assert commands == []
  assert library.undoable(failed) == Some(trip)
  assert library.problem(failed) == Some(full)
  assert library.update(failed, UserUndidDelete, "milk").1
    == [RestoreNote(trip, was_open: False)]
}

pub fn a_failed_delete_keeps_the_open_note_and_saves_what_was_typed_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(deleting, _) =
    library.update(
      opened([groceries, trip]),
      UserDeletedNote(groceries.id),
      "milk",
    )
  let #(typed, _) = library.update(deleting, TextEdited, "milk, eggs")

  let #(failed, commands) =
    library.update(typed, StorageDeleted(groceries, Error(full)), "milk, eggs")
  let assert [After(5000, retry)] = commands
  assert open_id(failed) == Some(groceries.id)
  assert library.deleting(failed) == None
  assert library.undoable(failed) == None
  assert library.problem(failed) == Some(full)

  let #(_, save) = library.update(failed, retry, "milk, eggs")
  assert saved_note(save) == Note(..groceries, body: "milk, eggs")
}

pub fn a_failed_delete_of_another_note_keeps_it_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(finding, _) =
    library.update(opened([groceries, trip]), UserDeletedNote(trip.id), "milk")
  let #(deleting, _) =
    library.update(finding, StorageFoundDoomed(Ok(trip)), "milk")

  let #(failed, commands) =
    library.update(deleting, StorageDeleted(trip, Error(full)), "milk")
  assert commands == []
  assert library.notes(failed) == [summary(groceries), summary(trip)]
  assert library.deleting(failed) == None
  assert library.undoable(failed) == None
  assert library.problem(failed) == Some(full)
}

pub fn a_note_gone_before_its_delete_leaves_the_list_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(finding, _) =
    library.update(opened([groceries, trip]), UserDeletedNote(trip.id), "milk")

  let #(gone, commands) =
    library.update(finding, StorageFoundDoomed(Error(storage.NotFound)), "milk")
  assert commands == [ListNotes]
  assert library.deleting(gone) == None
  assert library.problem(gone) == Some(storage.NotFound)
}

pub fn a_note_gone_when_it_is_picked_leaves_the_list_and_the_open_one_stays_test() {
  let #(groceries, trip) = groceries_and_trip()
  let #(loading, _) =
    library.update(opened([groceries, trip]), UserPickedNote(trip.id), "milk")

  let #(gone, commands) =
    library.update(loading, StorageLoaded(Error(storage.NotFound)), "milk")
  assert commands == [ListNotes]
  assert library.problem(gone) == Some(storage.NotFound)

  let #(listed, commands) =
    library.update(gone, StorageListed(Ok([summary(groceries)])), "milk")
  assert commands == []
  assert open_id(listed) == Some(groceries.id)
}

/// The notes of the browser tests: Groceries, then Trip.
fn groceries_and_trip() -> #(Note, Note) {
  let assert [groceries, trip] = ids(["groceries", "trip"])
  #(Note(groceries, Some("Groceries"), "milk"), Note(trip, None, "# Trip"))
}

fn summary(note: Note) -> Summary {
  Summary(
    id: note.id,
    title: storage.display_title(note.title, note.body),
    modified_ms: 0,
  )
}

/// Where the app gets to on start: `notes` listed and the first one open.
fn opened(notes: List(Note)) -> Library {
  let assert [first, ..] = notes
  let #(started, _) = library.start()
  let #(listed, _) =
    library.update(started, StorageListed(Ok(list.map(notes, summary))), "")
  let #(open, _) = library.update(listed, StorageLoaded(Ok(first)), "")
  open
}

/// Deletes a note that is not open, with storage agreeing at each step,
/// while Groceries is open.
fn delete_closed(state: Library, note: Note) -> #(Library, List(Command)) {
  let #(finding, _) = library.update(state, UserDeletedNote(note.id), "milk")
  let #(deleting, _) =
    library.update(finding, StorageFoundDoomed(Ok(note)), "milk")
  library.update(deleting, StorageDeleted(note, Ok(Nil)), "milk")
}

fn save_state(state: Library) -> SaveState {
  let assert Some(open) = library.open(state)
  open.save_state
}

fn open_id(state: Library) -> Option(NoteId) {
  library.open(state) |> option.map(fn(open) { open.id })
}

fn saved_note(commands: List(Command)) -> Note {
  let assert [SaveNote(note:, ..)] = commands
  note
}

/// Storage's answer to the one save in `commands`.
fn saved(commands: List(Command), result: Result(Nil, Failure)) -> Event {
  let assert [SaveNote(note:, edits:)] = commands
  StorageSaved(note.id, edits, result)
}

/// `NoteId` is opaque, and storage makes one only from a key a backend
/// returned. So these come the way the app gets them: from `storage.list`
/// over a backend that holds a note under each key, newest first.
fn ids(keys: List(String)) -> List(NoteId) {
  let records =
    list.index_map(keys, fn(key, age) {
      storage.Record(key:, title: None, body: "", modified_ms: -age)
    })
  let backend =
    storage.Backend(
      all: fn(reply) { reply(Ok(records)) },
      get: fn(_, _) { Nil },
      put: fn(_, _, _, _) { Nil },
      add: fn(_) { Nil },
      remove: fn(_, _) { Nil },
    )
  let assert Ok(listed) =
    answer(storage.list(storage.new(backend), fn(listed) { listed }))
  list.map(listed, fn(summary) { summary.id })
}

/// The message `call` dispatches at once. Lustre offers `effect.perform` for
/// running an effect outside its runtime, in tests.
fn answer(call: Effect(message)) -> message {
  let answered = cell()
  effect.perform(
    call,
    put(answered, _),
    fn(_, _) { Nil },
    fn(_) { Nil },
    dynamic.nil,
    fn(_, _) { Nil },
    fn(_, _) { Nil },
    fn(_) { Nil },
  )
  let assert Ok(message) = take(answered)
  message
}

type Cell(a)

@external(javascript, "./library_test_ffi.mjs", "cell")
fn cell() -> Cell(a)

@external(javascript, "./library_test_ffi.mjs", "put")
fn put(cell: Cell(a), value: a) -> Nil

@external(javascript, "./library_test_ffi.mjs", "take")
fn take(cell: Cell(a)) -> Result(a, Nil)
