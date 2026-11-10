//// Examples that drive the real init / update / view without a browser.
////
//// Two ways in:
//// - `start` and `send` below run the app the way the runtime does, storage
////   included: every message an effect sends is fed straight back in. The
////   backend is made in the test and answers at once.
//// - `lustre/dev/simulate` sends DOM events as JSON through the real
////   decoders in `surface`, but throws effects away.
//// Timers never fire in either, so a test sends `AutosaveDue` itself.
//// See `markdown_test` for how `pending_` functions work.

import gleam/json
import gleam/list
import gleam/option.{None, Some}
import harness
import lustre/dev/query
import lustre/dev/simulate
import scribbl/app.{type Model, type Msg}
import scribbl/buffer
import scribbl/editor
import scribbl/storage.{type Backend, type Record, Backend, Record, Unavailable}

/// M2: type a heading, flip to the rendered page, find the <h1>.
pub fn pending_typing_shows_on_the_rendered_page() {
  let heading =
    query.element(matching: query.test_id("preview"))
    |> query.descendant(matching: query.tag("h1"))

  let page =
    simulate.application(app.init, app.update, app.view)
    |> simulate.start(flags(silent()))
    |> type_in_control("# Hi")
    |> simulate.message(app.UserToggledRendered)
    |> simulate.view

  let assert Ok(_) = query.find(in: page, matching: heading)
}

/// A real "input" event, through the real decoders, ends up in the model
/// and on the rendered page.
pub fn typing_reaches_the_model_test() {
  let simulation =
    simulate.application(app.init, app.update, app.view)
    |> simulate.start(flags(silent()))
    |> type_in_control("héllo 👋")
    |> simulate.message(app.UserToggledRendered)

  assert editor.text(simulate.model(simulation).editor) == "héllo 👋"
  assert shows(simulate.model(simulation), "preview", "héllo 👋")
}

/// First run: storage is empty, so a note is made and opened.
pub fn first_run_opens_a_new_note_test() {
  let model = start(holding([]))

  let assert Some(open) = model.open
  assert storage.id_text(open.id) == "added"
  assert shows(model, "save-state", "Saved")
}

/// Later runs: the newest note opens, with its text in the editor.
pub fn newest_note_opens_test() {
  let model = start(holding(two_notes()))

  let assert Some(open) = model.open
  assert storage.id_text(open.id) == "groceries"
  assert editor.text(model.editor) == "milk"
  assert list.map(model.notes, fn(row) { row.title }) == ["Groceries", "Trip"]
}

/// Typing, then the pause, then the save: Unsaved, then Saved.
pub fn autosave_test() {
  let typed = start(holding(two_notes())) |> send(typing("milk, eggs"))
  assert shows(typed, "save-state", "Unsaved")

  let saved = send(typed, app.AutosaveDue(edits: 1))
  assert shows(saved, "save-state", "Saved")
}

/// A slow autosave timer must not save after newer edits.
pub fn stale_autosave_is_ignored_test() {
  let model =
    start(holding(two_notes()))
    |> send(typing("milk, eggs"))
    |> send(typing("milk, eggs, jam"))
    |> send(app.AutosaveDue(edits: 1))

  assert shows(model, "save-state", "Unsaved")
}

/// With no note open there is nothing to save, whatever the timer says.
pub fn autosave_without_a_note_is_ignored_test() {
  let simulation =
    simulate.application(app.init, app.update, app.view)
    |> simulate.start(flags(silent()))
    |> simulate.message(app.AutosaveDue(edits: 99))

  let assert None = simulate.model(simulation).open
}

/// While storage has the text but has not answered, the state is "Saving…".
pub fn saving_shows_until_storage_answers_test() {
  let typed = start(holding(two_notes())) |> send(typing("milk, eggs"))
  // `app.update` alone: the save effect is not run, so no answer comes.
  let #(waiting, _) = app.update(typed, app.AutosaveDue(edits: 1))

  assert shows(waiting, "save-state", "Saving…")
}

/// A failed save says so and leaves the note unsaved, so the next try can
/// succeed.
pub fn failed_save_test() {
  let full =
    Backend(..holding(two_notes()), put: fn(_key, _title, _body, reply) {
      reply(Error(Unavailable("disk full")))
    })
  let model =
    start(full)
    |> send(typing("milk, eggs"))
    |> send(app.AutosaveDue(edits: 1))

  assert shows(model, "problem", "Storage is not working: disk full")
  assert shows(model, "save-state", "Unsaved")
}

/// Leaving a note with unsaved text saves it first, under its own id.
pub fn picking_a_note_saves_the_open_one_test() {
  let typed = start(holding(two_notes())) |> send(typing("milk, eggs"))
  let assert [trip] =
    list.filter(typed.notes, fn(row) { storage.id_text(row.id) == "trip" })
  let #(_, effect) = app.update(typed, app.UserPickedNote(trip.id))

  // Lustre does not promise an order for batched effects, so look for it.
  let saves =
    list.filter_map(harness.messages(effect), fn(msg) {
      case msg {
        app.StorageSaved(id:, edits:, result:) -> Ok(#(id, edits, result))
        _ -> Error(Nil)
      }
    })
  let assert [#(id, 1, Ok(Nil))] = saves
  assert storage.id_text(id) == "groceries"

  let switched = send(typed, app.UserPickedNote(trip.id))
  assert editor.text(switched.editor) == "# Trip"
  assert shows(switched, "save-state", "Saved")
}

/// A typed title wins over the first line. Clearing it brings the first
/// line back.
pub fn renaming_test() {
  let model = start(holding(two_notes())) |> send(app.UserPickedNote(trip_id()))
  assert shows(model, "note-trip", "Trip")

  let renamed = send(model, app.UserRenamedNote("Japan"))
  assert shows(renamed, "note-trip", "Japan")
  assert shows(renamed, "save-state", "Unsaved")

  let cleared = send(renamed, app.UserRenamedNote(""))
  assert shows(cleared, "note-trip", "Trip")
}

/// Delete asks first. "Keep" puts the plain button back.
pub fn delete_asks_first_test() {
  let model = start(holding(two_notes()))
  assert has(model, "delete-note")

  let asked = send(model, app.UserAskedToDelete)
  assert has(asked, "confirm-delete")
  assert !has(asked, "delete-note")

  let kept = send(asked, app.UserKeptNote)
  assert has(kept, "delete-note")
  assert kept.open == model.open
}

/// Until M4 the vim switch is not offered, and there is no mode to show.
pub fn no_vim_switch_without_a_keyboard_test() {
  let #(model, _) =
    app.init(app.Flags(
      storage: storage.new(silent()),
      vim: True,
      can_vim: False,
    ))

  assert !has(model, "toggle-vim")
  assert !has(model, "mode")
  assert editor.mode(model.editor) == editor.Plain
}

// HELPERS ---------------------------------------------------------------------

/// `init`, then every message its effects send, the way the runtime would.
fn start(backend: Backend) -> Model {
  let #(model, effect) = app.init(flags(backend))
  list.fold(harness.messages(effect), model, send)
}

/// `update`, then every message its effects send.
fn send(model: Model, msg: Msg) -> Model {
  let #(model, effect) = app.update(model, msg)
  list.fold(harness.messages(effect), model, send)
}

/// What the text field reports after the user typed `text`.
fn typing(text: String) -> Msg {
  app.EditorSent(editor.ControlChanged(shown: buffer.from_text(text)))
}

/// The same, as the browser's own "input" event.
fn type_in_control(
  simulation: simulate.Simulation(Model, Msg),
  text: String,
) -> simulate.Simulation(Model, Msg) {
  let control = query.element(matching: query.test_id("editor"))
  let target =
    json.object([
      #("value", json.string(text)),
      #("selectionStart", json.int(0)),
      #("selectionEnd", json.int(0)),
    ])
  simulate.event(simulation, on: control, name: "input", data: [
    #("target", target),
  ])
}

/// Is there an element with this test id whose text is exactly `text`?
fn shows(model: Model, test_id: String, text: String) -> Bool {
  let wanted = query.and(query.test_id(test_id), query.text(text))
  query.find(in: app.view(model), matching: query.element(matching: wanted))
  != Error(Nil)
}

fn has(model: Model, test_id: String) -> Bool {
  query.find(
    in: app.view(model),
    matching: query.element(matching: query.test_id(test_id)),
  )
  != Error(Nil)
}

fn flags(backend: Backend) -> app.Flags {
  app.Flags(storage: storage.new(backend), vim: False, can_vim: True)
}

fn two_notes() -> List(Record) {
  [
    Record(key: "trip", title: None, body: "# Trip", modified_ms: 1),
    Record(
      key: "groceries",
      title: Some("Groceries"),
      body: "milk",
      modified_ms: 2,
    ),
  ]
}

/// The id of the "trip" note, the only legitimate way: from a list.
fn trip_id() -> storage.NoteId {
  let store = storage.new(holding(two_notes()))
  let assert [Ok(rows)] =
    harness.messages(storage.list(store, fn(rows) { rows }))
  let assert [trip] =
    list.filter(rows, fn(row) { storage.id_text(row.id) == "trip" })
  trip.id
}

/// A backend that holds fixed records, answers at once and remembers
/// nothing: saving and deleting succeed, and `add` always hands out the same
/// new record.
fn holding(records: List(Record)) -> Backend {
  Backend(
    all: fn(reply) { reply(Ok(records)) },
    get: fn(key, reply) {
      case list.find(records, fn(record) { record.key == key }) {
        Ok(record) -> reply(Ok(record))
        Error(Nil) -> reply(Error(storage.NotFound))
      }
    },
    put: fn(_key, _title, _body, reply) { reply(Ok(Nil)) },
    add: fn(reply) {
      reply(Ok(Record(key: "added", title: None, body: "", modified_ms: 0)))
    },
    remove: fn(_key, reply) { reply(Ok(Nil)) },
  )
}

/// A backend that never answers: enough for tests that send replies by hand.
fn silent() -> Backend {
  Backend(
    all: fn(_reply) { Nil },
    get: fn(_key, _reply) { Nil },
    put: fn(_key, _title, _body, _reply) { Nil },
    add: fn(_reply) { Nil },
    remove: fn(_key, _reply) { Nil },
  )
}
