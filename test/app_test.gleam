import gleam/option.{None, Some}
import harness.{
  type Stored, Creating, Failing, Listing, Loading, Newest, Oldest, OnRequest,
  Promptly, Row, Saving, Stored, TextField,
}

fn trip() -> Stored {
  Stored(key: "trip", title: None, body: "# Trip")
}

fn groceries() -> Stored {
  Stored(key: "groceries", title: Some("Groceries"), body: "milk")
}

fn groceries_with(body: String) -> Stored {
  Stored(..groceries(), body:)
}

fn two_notes() -> List(Stored) {
  [trip(), groceries()]
}

/// M2: type a heading, flip to the rendered page, find the <h1>.
pub fn pending_typing_shows_on_the_rendered_page() {
  let app =
    harness.start(holding: [])
    |> harness.type_text("# Hi")
    |> harness.click("toggle-rendered")

  assert harness.shown_inside(app, "preview", tag: "h1") == Ok("Hi")
}

pub fn typed_text_shows_on_the_rendered_page_test() {
  let app =
    harness.start(holding: [])
    |> harness.type_text("héllo 👋 <b>")
    |> harness.click("toggle-rendered")

  assert harness.shown(app, "preview") == Ok("héllo 👋 <b>")
}

pub fn typed_text_is_stored_exactly_test() {
  let app =
    harness.start(holding: [])
    |> harness.type_text("héllo 👋\nwörld")
    |> harness.wait(ms: 800)

  assert harness.stored(app) == [Stored("new-1", None, "héllo 👋\nwörld")]
}

pub fn first_run_creates_one_note_test() {
  let app = harness.start(holding: [])

  assert harness.stored(app) == [Stored(key: "new-1", title: None, body: "")]
  assert harness.note_list(app) == [Row("Untitled", current: True)]
  assert harness.shown(app, "note-new-1") == Ok("Untitled")
  assert harness.shown(app, "save-state") == Ok("Saved")
  assert harness.text_field(app) == TextField("", #(0, 0), True)
}

pub fn the_newest_note_opens_test() {
  let app = harness.start(holding: two_notes())

  assert harness.text_field(app) == TextField("milk", #(0, 0), True)
  assert harness.note_list(app)
    == [Row("Groceries", current: True), Row("Trip", current: False)]
  assert harness.has(app, "title", attribute: "value", of: "Groceries")
  assert harness.shown(app, "save-state") == Ok("Saved")
}

pub fn an_untitled_note_offers_its_first_line_as_the_title_test() {
  let app = harness.start(holding: two_notes()) |> harness.click("note-trip")

  assert harness.has(app, "title", attribute: "value", of: "")
  assert harness.has(app, "title", attribute: "placeholder", of: "Trip")
}

pub fn typing_goes_in_at_the_caret_test() {
  let app = harness.start(holding: two_notes()) |> harness.type_text("eggs, ")

  assert harness.text_field(app).text == "eggs, milk"
}

pub fn typing_is_saved_after_a_pause_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.replace_text(with: "milk, eggs")
    |> harness.wait(ms: 799)
  assert harness.shown(app, "save-state") == Ok("Unsaved")
  assert harness.stored(app) == two_notes()

  let app = harness.wait(app, ms: 1)
  assert harness.shown(app, "save-state") == Ok("Saved")
  assert harness.stored(app) == [trip(), groceries_with("milk, eggs")]
}

pub fn typing_again_restarts_the_pause_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.replace_text(with: "milk, eggs")
    |> harness.wait(ms: 500)
    |> harness.type_text(", jam")
    |> harness.wait(ms: 799)
  assert harness.shown(app, "save-state") == Ok("Unsaved")
  assert harness.stored(app) == two_notes()

  let app = harness.wait(app, ms: 1)
  assert harness.shown(app, "save-state") == Ok("Saved")
  assert harness.stored(app) == [trip(), groceries_with("milk, eggs, jam")]
}

pub fn saving_shows_until_storage_answers_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.storage_becomes(OnRequest)
    |> harness.replace_text(with: "milk, eggs")
    |> harness.wait(ms: 800)
  assert harness.waiting(app) == [Saving]
  assert harness.shown(app, "save-state") == Ok("Saving…")

  let app = harness.answer(app, Oldest(Saving))
  assert harness.shown(app, "save-state") == Ok("Saved")
}

pub fn hiding_the_page_saves_at_once_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.replace_text(with: "milk, eggs")
    |> harness.hide_page
  assert harness.stored(app) == [trip(), groceries_with("milk, eggs")]

  let app = harness.reload(app)
  assert harness.text_field(app).text == "milk, eggs"
}

pub fn hiding_the_page_before_a_note_is_open_asks_nothing_test() {
  let app =
    harness.start_with(holding: [], storage: OnRequest) |> harness.hide_page

  assert harness.waiting(app) == [Listing]
  assert harness.stored(app) == []
}

pub fn a_failed_save_is_retried_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.storage_becomes(Failing("disk full"))
    |> harness.replace_text(with: "milk, eggs")
    |> harness.wait(ms: 800)
  assert harness.shown(app, "problem")
    == Ok("Storage is not working: disk full")
  assert harness.shown(app, "save-state") == Ok("Unsaved")

  let app = app |> harness.storage_becomes(Promptly) |> harness.wait(ms: 4999)
  assert harness.stored(app) == two_notes()

  let app = harness.wait(app, ms: 1)
  assert harness.shown(app, "problem") == Error(Nil)
  assert harness.shown(app, "save-state") == Ok("Saved")
  assert harness.stored(app) == [trip(), groceries_with("milk, eggs")]
}

pub fn picking_another_note_saves_this_one_first_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.replace_text(with: "milk, eggs")
    |> harness.storage_becomes(OnRequest)
    |> harness.click("note-trip")
  assert harness.waiting(app) == [Saving]
  assert harness.text_field(app).text == "milk, eggs"
  assert harness.shown(app, "save-state") == Ok("Saving…")

  let app = harness.answer_all(app)
  assert harness.text_field(app) == TextField("# Trip", #(0, 0), True)
  assert harness.shown(app, "save-state") == Ok("Saved")
  assert harness.stored(app) == [trip(), groceries_with("milk, eggs")]
  assert harness.note_list(app)
    == [Row("Groceries", current: False), Row("Trip", current: True)]
}

pub fn a_failed_save_keeps_you_on_the_note_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.storage_becomes(Failing("disk full"))
    |> harness.replace_text(with: "milk, eggs")
    |> harness.click("note-trip")
  assert harness.text_field(app).text == "milk, eggs"
  assert harness.shown(app, "problem")
    == Ok("Storage is not working: disk full")
  assert harness.shown(app, "save-state") == Ok("Unsaved")

  let app = harness.click(app, "new-note")
  assert harness.text_field(app).text == "milk, eggs"

  let app = app |> harness.storage_becomes(Promptly) |> harness.wait(ms: 5000)
  assert harness.shown(app, "save-state") == Ok("Saved")
  assert harness.text_field(app).text == "milk, eggs"
  assert harness.stored(app) == [trip(), groceries_with("milk, eggs")]
}

pub fn text_typed_while_the_next_note_loads_is_saved_before_it_opens_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.storage_becomes(OnRequest)
    |> harness.click("note-trip")
  assert harness.waiting(app) == [Loading]

  let app =
    app
    |> harness.replace_text(with: "milk, eggs")
    |> harness.answer(Oldest(Loading))
  assert harness.waiting(app) == [Saving]
  assert harness.text_field(app).text == "milk, eggs"

  let app = harness.answer_all(app)
  assert harness.text_field(app).text == "# Trip"
  assert harness.stored(app) == [trip(), groceries_with("milk, eggs")]
}

pub fn text_typed_while_a_new_note_is_made_is_saved_before_it_opens_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.storage_becomes(OnRequest)
    |> harness.click("new-note")
  assert harness.waiting(app) == [Creating]

  let app =
    app
    |> harness.replace_text(with: "milk, eggs")
    |> harness.answer(Oldest(Creating))
  assert harness.text_field(app).text == "milk, eggs"

  let app = harness.answer_all(app)
  assert harness.text_field(app).text == ""
  assert harness.stored(app)
    == [trip(), Stored("new-1", None, ""), groceries_with("milk, eggs")]
  assert harness.shown(app, "note-new-1") == Ok("Untitled")
}

pub fn picking_the_open_note_again_cancels_leaving_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.replace_text(with: "milk, eggs")
    |> harness.storage_becomes(OnRequest)
    |> harness.click("note-trip")
    |> harness.click("note-groceries")
    |> harness.answer_all

  assert harness.text_field(app).text == "milk, eggs"
  assert harness.shown(app, "save-state") == Ok("Saved")
  assert harness.note_list(app)
    == [Row("Groceries", current: True), Row("Trip", current: False)]
}

fn two_saves_waiting() -> harness.App {
  let app =
    harness.start(holding: two_notes())
    |> harness.storage_becomes(OnRequest)
    |> harness.replace_text(with: "milk, eggs")
    |> harness.wait(ms: 800)
    |> harness.type_text(", jam")
    |> harness.hide_page
  assert harness.waiting(app) == [Saving, Saving]
  assert harness.shown(app, "save-state") == Ok("Saving…")
  app
}

pub fn an_older_answer_does_not_mark_newer_text_saved_test() {
  let app = two_saves_waiting() |> harness.answer(Oldest(Saving))
  assert harness.shown(app, "save-state") == Ok("Saving…")

  let app = harness.refuse(app, Newest(Saving), because: "disk full")
  assert harness.shown(app, "save-state") == Ok("Unsaved")
  assert harness.shown(app, "problem")
    == Ok("Storage is not working: disk full")
}

pub fn an_older_failure_does_not_mark_newer_text_unsaved_test() {
  let app =
    two_saves_waiting()
    |> harness.refuse(Oldest(Saving), because: "disk full")
  assert harness.shown(app, "problem")
    == Ok("Storage is not working: disk full")
  assert harness.shown(app, "save-state") == Ok("Saving…")

  let app = harness.answer(app, Newest(Saving))
  assert harness.shown(app, "save-state") == Ok("Saved")
  assert harness.shown(app, "problem") == Error(Nil)
}

pub fn a_late_older_answer_leaves_saved_alone_test() {
  let app = two_saves_waiting() |> harness.answer(Newest(Saving))
  assert harness.shown(app, "save-state") == Ok("Saved")

  let app = harness.refuse(app, Oldest(Saving), because: "disk full")
  assert harness.shown(app, "save-state") == Ok("Saved")
}

pub fn an_answer_from_before_the_note_was_reopened_is_ignored_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.storage_becomes(OnRequest)
    |> harness.replace_text(with: "milk, eggs")
    |> harness.wait(ms: 800)
    |> harness.storage_becomes(Promptly)
    |> harness.type_text(", jam")
    |> harness.click("note-trip")
    |> harness.click("note-groceries")
    |> harness.replace_text(with: "milk and jam")
  assert harness.waiting(app) == [Saving]
  assert harness.shown(app, "save-state") == Ok("Unsaved")

  let app = harness.answer(app, Oldest(Saving))
  assert harness.shown(app, "save-state") == Ok("Unsaved")
}

pub fn a_saved_note_moves_to_the_top_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.click("note-trip")
    |> harness.replace_text(with: "# Trip to Oslo")
  assert harness.note_list(app)
    == [Row("Groceries", current: False), Row("Trip to Oslo", current: True)]

  let app = harness.wait(app, ms: 800)
  assert harness.note_list(app)
    == [Row("Trip to Oslo", current: True), Row("Groceries", current: False)]
}

pub fn a_new_note_opens_empty_at_the_top_of_the_list_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.click("toggle-rendered")
    |> harness.click("new-note")

  assert harness.text_field(app) == TextField("", #(0, 0), True)
  assert harness.shown(app, "preview") == Error(Nil)
  assert harness.stored(app) == [trip(), groceries(), Stored("new-1", None, "")]
  assert harness.note_list(app)
    == [
      Row("Untitled", current: True),
      Row("Groceries", current: False),
      Row("Trip", current: False),
    ]
}

pub fn renaming_test() {
  let app = harness.start(holding: two_notes()) |> harness.click("note-trip")
  assert harness.shown(app, "note-trip") == Ok("Trip")

  let app = harness.fill(app, "title", with: "Japan")
  assert harness.shown(app, "note-trip") == Ok("Japan")
  assert harness.shown(app, "save-state") == Ok("Unsaved")

  let app = harness.wait(app, ms: 800)
  assert harness.stored(app)
    == [groceries(), Stored("trip", Some("Japan"), "# Trip")]
  assert harness.has(app, "title", attribute: "value", of: "Japan")

  let app = harness.fill(app, "title", with: "") |> harness.wait(ms: 800)
  assert harness.shown(app, "note-trip") == Ok("Trip")
  assert harness.stored(app) == [groceries(), trip()]
}

pub fn delete_asks_first_test() {
  let app = harness.start(holding: two_notes())
  assert harness.shown(app, "delete-note") == Ok("Delete")

  let app = harness.click(app, "delete-note")
  assert harness.shown(app, "confirm-delete") == Ok("Delete")
  assert harness.shown(app, "delete-note") == Error(Nil)
  assert harness.stored(app) == two_notes()

  let app = harness.click(app, "cancel-delete")
  assert harness.shown(app, "delete-note") == Ok("Delete")
  assert harness.shown(app, "confirm-delete") == Error(Nil)
  assert harness.stored(app) == two_notes()
  assert harness.text_field(app).text == "milk"
}

pub fn confirming_delete_removes_the_note_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.click("delete-note")
    |> harness.click("confirm-delete")

  assert harness.stored(app) == [trip()]
  assert harness.note_list(app) == [Row("Trip", current: True)]
  assert harness.text_field(app).text == "# Trip"
  assert harness.shown(app, "delete-note") == Ok("Delete")
}

pub fn the_delete_question_stays_with_its_note_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.click("delete-note")
    |> harness.click("note-trip")

  assert harness.shown(app, "confirm-delete") == Error(Nil)
  assert harness.shown(app, "delete-note") == Ok("Delete")
  assert harness.stored(app) == two_notes()
}

pub fn the_button_flips_to_the_rendered_page_and_back_test() {
  let app =
    harness.start(holding: two_notes()) |> harness.click("toggle-rendered")
  assert harness.shown(app, "preview") == Ok("milk")
  assert harness.shown(app, "toggle-rendered") == Ok("Edit")
  assert !harness.text_field(app).focused

  let app = harness.click(app, "toggle-rendered")
  assert harness.shown(app, "preview") == Error(Nil)
  assert harness.shown(app, "toggle-rendered") == Ok("Preview")
  assert harness.text_field(app).focused
}

pub fn ctrl_e_flips_to_the_rendered_page_and_back_test() {
  let app = harness.start(holding: two_notes()) |> harness.press_shortcut("e")
  assert harness.shown(app, "preview") == Ok("milk")

  let app = harness.press_shortcut(app, "e")
  assert harness.shown(app, "preview") == Error(Nil)
}

pub fn storage_that_cannot_list_says_so_test() {
  let app =
    harness.start_with(holding: two_notes(), storage: Failing("blocked"))

  assert harness.shown(app, "problem") == Ok("Storage is not working: blocked")
  assert harness.note_list(app) == []
}

pub fn a_note_that_cannot_be_made_says_so_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.storage_becomes(Failing("quota"))
    |> harness.click("new-note")

  assert harness.shown(app, "problem") == Ok("Storage is not working: quota")
  assert harness.stored(app) == two_notes()
  assert harness.text_field(app).text == "milk"
}

pub fn a_delete_that_fails_says_so_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.storage_becomes(Failing("read only"))
    |> harness.click("delete-note")
    |> harness.click("confirm-delete")

  assert harness.shown(app, "problem")
    == Ok("Storage is not working: read only")
  assert harness.stored(app) == two_notes()
}

pub fn a_note_deleted_elsewhere_leaves_the_list_test() {
  let app =
    harness.start(holding: two_notes())
    |> harness.deleted_elsewhere("trip")
    |> harness.click("note-trip")

  assert harness.shown(app, "problem")
    == Ok("That note is no longer in storage.")
  assert harness.note_list(app) == [Row("Groceries", current: True)]
  assert harness.text_field(app).text == "milk"
}

pub fn the_vim_switch_is_remembered_test() {
  let app = harness.start(holding: two_notes())
  assert harness.checked(app, "toggle-vim") == Ok(False)
  assert harness.shown(app, "mode") == Error(Nil)

  let app = harness.set_checked(app, "toggle-vim", to: True)
  assert harness.shown(app, "mode") == Ok("NORMAL")

  let app = harness.reload(app)
  assert harness.checked(app, "toggle-vim") == Ok(True)
  assert harness.shown(app, "mode") == Ok("NORMAL")

  let app =
    app |> harness.set_checked("toggle-vim", to: False) |> harness.reload
  assert harness.checked(app, "toggle-vim") == Ok(False)
  assert harness.shown(app, "mode") == Error(Nil)
}

pub fn a_phone_gets_no_vim_test() {
  let app = harness.start_on_phone(holding: two_notes(), vim_remembered: True)

  assert harness.checked(app, "toggle-vim") == Error(Nil)
  assert harness.shown(app, "mode") == Error(Nil)
  assert harness.text_field(app).text == "milk"
}
