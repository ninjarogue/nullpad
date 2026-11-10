//// The app under a fake browser. While one harness call runs, stand-ins for
//// `setTimeout`, `document`, `localStorage` and friends sit on `globalThis`,
//// so the real FFI files run against them. Storage is a `Shelf` behind
//// `storage.Backend`. Notes in a `List(Stored)` are oldest change first.

import gleam/dynamic
import gleam/int
import gleam/json
import gleam/list
import gleam/option.{type Option, None}
import gleam/result
import gleam/string
import lustre/dev/query
import lustre/dev/simulate.{type Simulation}
import lustre/effect.{type Effect}
import lustre/element.{type Element}
import scribbl/app
import scribbl/platform
import scribbl/storage.{type Backend, type Failure, Backend, Record}

pub type Stored {
  Stored(key: String, title: Option(String), body: String)
}

pub type Answering {
  Promptly
  Failing(detail: String)
  OnRequest
}

pub type Call {
  Listing
  Loading
  Saving
  Creating
  Deleting
}

pub type Waiting {
  Oldest(Call)
  Newest(Call)
}

pub type TextField {
  TextField(text: String, selection: #(Int, Int), focused: Bool)
}

pub type Row {
  Row(title: String, current: Bool)
}

pub opaque type Shelf {
  Shelf(state: Cell(ShelfState))
}

type ShelfState {
  ShelfState(
    notes: List(Stored),
    created: Int,
    answering: Answering,
    waiting: List(Held),
  )
}

type Held {
  Held(call: Call, answer: fn(Result(Nil, Failure)) -> Nil)
}

pub opaque type App {
  App(
    running: Cell(Simulation(app.Model, app.Msg)),
    inbox: Cell(List(app.Msg)),
    browser: Browser,
    shelf: Shelf,
  )
}

type Browser

type Cell(a)

pub fn shelf(holding notes: List(Stored)) -> Shelf {
  Shelf(
    new_cell(ShelfState(notes:, created: 0, answering: Promptly, waiting: [])),
  )
}

pub fn on_shelf(shelf: Shelf) -> List(Stored) {
  read(shelf.state).notes
}

pub fn backend(shelf: Shelf) -> Backend {
  let Shelf(state) = shelf
  let change = fn(f) { write(state, f(read(state))) }
  let find = fn(key) {
    list.find(read(state).notes, fn(note: Stored) { note.key == key })
    |> result.replace_error(storage.NotFound)
  }
  let record = fn(note: Stored, at) {
    Record(key: note.key, title: note.title, body: note.body, modified_ms: at)
  }
  let ask = fn(call, work: fn() -> Result(a, Failure), reply: storage.Reply(a)) {
    let answer = fn(allowed) { reply(result.try(allowed, fn(_) { work() })) }
    case read(state).answering {
      Promptly -> answer(Ok(Nil))
      Failing(detail) -> answer(Error(storage.Unavailable(detail)))
      OnRequest ->
        change(fn(s) {
          ShelfState(..s, waiting: list.append(s.waiting, [Held(call, answer)]))
        })
    }
  }
  Backend(
    all: fn(reply) {
      ask(
        Listing,
        fn() { Ok(list.index_map(read(state).notes, record)) },
        reply,
      )
    },
    get: fn(key, reply) {
      ask(Loading, fn() { find(key) |> result.map(record(_, 0)) }, reply)
    },
    put: fn(key, title, body, reply) {
      ask(
        Saving,
        fn() {
          use _ <- result.map(find(key))
          change(fn(s) {
            let others = list.filter(s.notes, fn(note) { note.key != key })
            ShelfState(
              ..s,
              notes: list.append(others, [Stored(key:, title:, body:)]),
            )
          })
        },
        reply,
      )
    },
    add: fn(reply) {
      ask(
        Creating,
        fn() {
          let s = read(state)
          let created = s.created + 1
          let note =
            Stored(key: "new-" <> int.to_string(created), title: None, body: "")
          write(
            state,
            ShelfState(..s, created:, notes: list.append(s.notes, [note])),
          )
          Ok(record(note, list.length(s.notes)))
        },
        reply,
      )
    },
    remove: fn(key, reply) {
      ask(
        Deleting,
        fn() {
          Ok(
            change(fn(s) {
              ShelfState(
                ..s,
                notes: list.filter(s.notes, fn(note) { note.key != key }),
              )
            }),
          )
        },
        reply,
      )
    },
  )
}

pub fn run(effect: Effect(msg)) -> List(msg) {
  use dispatch <- collect
  perform(effect, dispatch)
}

/// `effect.perform` is marked internal in Lustre 5 and skips paint effects,
/// which is where `surface.focus` runs.
fn perform(effect: Effect(msg), dispatch: fn(msg) -> Nil) -> Nil {
  effect.perform(
    effect,
    dispatch,
    fn(_, _) { Nil },
    fn(_) { Nil },
    dynamic.nil,
    fn(_, _) { Nil },
    fn(_, _) { Nil },
    fn(_) { Nil },
  )
  perform_paint(effect, dispatch)
}

pub fn start(holding notes: List(Stored)) -> App {
  start_with(notes, Promptly)
}

pub fn start_with(
  holding notes: List(Stored),
  storage answering: Answering,
) -> App {
  let shelf = shelf(notes)
  write(shelf.state, ShelfState(..read(shelf.state), answering:))
  boot(shelf, new_browser(True))
}

pub fn start_on_phone(
  holding notes: List(Stored),
  vim_remembered vim: Bool,
) -> App {
  let phone = new_browser(False)
  in_browser(phone, fn() { perform(platform.remember_vim_setting(vim), drop) })
  boot(shelf(notes), phone)
}

fn drop(_msg: msg) -> Nil {
  Nil
}

pub fn reload(app: App) -> App {
  unload(app.browser)
  boot(app.shelf, app.browser)
}

fn boot(shelf: Shelf, browser: Browser) -> App {
  let inbox = new_cell([])
  let post = fn(msg) { write(inbox, list.append(read(inbox), [msg])) }
  let quiet = fn(step: #(app.Model, Effect(app.Msg))) {
    perform(step.1, post)
    #(step.0, effect.none())
  }
  use <- in_browser(browser)
  let flags =
    app.Flags(
      storage: storage.new(backend(shelf)),
      vim: platform.read_vim_setting(),
      can_vim: platform.has_hardware_keyboard(),
    )
  let simulation =
    simulate.application(
      fn(flags) { quiet(app.init(flags)) },
      fn(model, msg) { quiet(app.update(model, msg)) },
      app.view,
    )
    |> simulate.start(flags)
  let app = App(running: new_cell(simulation), inbox:, browser:, shelf:)
  deliver(app)
  app
}

fn deliver(app: App) -> Nil {
  case read(app.inbox) {
    [] -> Nil
    [msg, ..rest] -> {
      write(app.inbox, rest)
      write(app.running, simulate.message(read(app.running), msg))
      deliver(app)
    }
  }
}

fn act(app: App, action: fn() -> Nil) -> App {
  use <- in_browser(app.browser)
  action()
  deliver(app)
  app
}

fn on_screen(
  app: App,
  test_id: String,
  event: String,
  data: List(#(String, json.Json)),
) -> Nil {
  let target = query.element(matching: query.test_id(test_id))
  let simulation =
    simulate.event(read(app.running), on: target, name: event, data:)
  case simulate.history(simulation) {
    [simulate.Problem(name:, message:), ..] ->
      panic as { name <> ": " <> message }
    _ -> write(app.running, simulation)
  }
}

pub fn click(app: App, test_id: String) -> App {
  use <- act(app)
  blur(app.browser)
  on_screen(app, test_id, "click", [])
}

pub fn fill(app: App, test_id: String, with text: String) -> App {
  use <- act(app)
  on_screen(app, test_id, "input", [
    #("target", json.object([#("value", json.string(text))])),
  ])
}

pub fn set_checked(app: App, test_id: String, to checked: Bool) -> App {
  use <- act(app)
  on_screen(app, test_id, "change", [
    #("target", json.object([#("checked", json.bool(checked))])),
  ])
}

pub fn type_text(app: App, text: String) -> App {
  use <- act(app)
  type_at_caret(app.browser, text)
  let #(value, start, end, _) = control(app.browser)
  on_screen(app, "editor", "input", [
    #(
      "target",
      json.object([
        #("value", json.string(value)),
        #("selectionStart", json.int(start)),
        #("selectionEnd", json.int(end)),
      ]),
    ),
  ])
}

pub fn replace_text(app: App, with text: String) -> App {
  select_all(app.browser)
  type_text(app, text)
}

pub fn wait(app: App, ms ms: Int) -> App {
  use <- act(app)
  fire_until(app, now(app.browser) + ms)
}

fn fire_until(app: App, deadline: Int) -> Nil {
  case next_timer(app.browser, deadline) {
    Error(Nil) -> Nil
    Ok(fire) -> {
      fire()
      deliver(app)
      fire_until(app, deadline)
    }
  }
}

pub fn hide_page(app: App) -> App {
  use <- act(app)
  hide(app.browser)
}

pub fn press_shortcut(app: App, key: String) -> App {
  use <- act(app)
  shortcut(app.browser, key)
}

pub fn storage_becomes(app: App, answering: Answering) -> App {
  let state = app.shelf.state
  write(state, ShelfState(..read(state), answering:))
  app
}

pub fn deleted_elsewhere(app: App, key: String) -> App {
  let state = app.shelf.state
  let s = read(state)
  write(
    state,
    ShelfState(..s, notes: list.filter(s.notes, fn(note) { note.key != key })),
  )
  app
}

pub fn answer(app: App, which: Waiting) -> App {
  settle(app, which, Ok(Nil))
}

pub fn refuse(app: App, which: Waiting, because detail: String) -> App {
  settle(app, which, Error(storage.Unavailable(detail)))
}

fn settle(app: App, which: Waiting, outcome: Result(Nil, Failure)) -> App {
  use <- act(app)
  let state = app.shelf.state
  let waiting = read(state).waiting
  let #(call, candidates) = case which {
    Oldest(call) -> #(call, waiting)
    Newest(call) -> #(call, list.reverse(waiting))
  }
  let assert Ok(held) = list.find(candidates, fn(held) { held.call == call })
    as "storage has no such call waiting"
  write(
    state,
    ShelfState(
      ..read(state),
      waiting: list.filter(waiting, fn(other) { other != held }),
    ),
  )
  held.answer(outcome)
}

pub fn answer_all(app: App) -> App {
  case read(app.shelf.state).waiting {
    [] -> app
    [held, ..] -> answer(app, Oldest(held.call)) |> answer_all
  }
}

pub fn waiting(app: App) -> List(Call) {
  list.map(read(app.shelf.state).waiting, fn(held) { held.call })
}

pub fn stored(app: App) -> List(Stored) {
  on_shelf(app.shelf)
}

pub fn text_field(app: App) -> TextField {
  let #(text, start, end, focused) = control(app.browser)
  TextField(text:, selection: #(start, end), focused:)
}

pub fn shown(app: App, test_id: String) -> Result(String, Nil) {
  find(app, query.element(matching: query.test_id(test_id)))
  |> result.map(text_of)
}

pub fn shown_inside(
  app: App,
  test_id: String,
  tag tag: String,
) -> Result(String, Nil) {
  query.element(matching: query.test_id(test_id))
  |> query.descendant(matching: query.tag(tag))
  |> find(app, _)
  |> result.map(text_of)
}

pub fn has(
  app: App,
  test_id: String,
  attribute name: String,
  of value: String,
) -> Bool {
  query.element(matching: query.and(
    query.test_id(test_id),
    query.attribute(name, value),
  ))
  |> find(app, _)
  |> result.is_ok
}

pub fn checked(app: App, test_id: String) -> Result(Bool, Nil) {
  find(app, query.element(matching: query.test_id(test_id)))
  |> result.map(query.has(_, query.attribute("checked", "")))
}

pub fn note_list(app: App) -> List(Row) {
  let rows =
    query.element(matching: query.test_id("note-list"))
    |> query.descendant(matching: query.tag("button"))
  query.find_all(in: simulate.view(read(app.running)), matching: rows)
  |> list.map(fn(row) {
    Row(
      title: text_of(row),
      current: query.has(row, query.aria("current", "true")),
    )
  })
}

fn find(app: App, wanted: query.Query) -> Result(Element(app.Msg), Nil) {
  query.find(in: simulate.view(read(app.running)), matching: wanted)
}

fn text_of(found: Element(msg)) -> String {
  element.to_string(found)
  |> strip_tags("")
  |> string.replace("&lt;", "<")
  |> string.replace("&gt;", ">")
  |> string.replace("&quot;", "\"")
  |> string.replace("&#39;", "'")
  |> string.replace("&amp;", "&")
}

fn strip_tags(html: String, text: String) -> String {
  case string.split_once(html, "<") {
    Error(Nil) -> text <> html
    Ok(#(before, rest)) ->
      case string.split_once(rest, ">") {
        Ok(#(_, after)) -> strip_tags(after, text <> before)
        Error(Nil) -> text <> before
      }
  }
}

@external(javascript, "./harness.ffi.mjs", "newCell")
fn new_cell(value: a) -> Cell(a)

@external(javascript, "./harness.ffi.mjs", "read")
fn read(cell: Cell(a)) -> a

@external(javascript, "./harness.ffi.mjs", "write")
fn write(cell: Cell(a), value: a) -> Nil

@external(javascript, "./harness.ffi.mjs", "collect")
fn collect(run: fn(fn(value) -> Nil) -> Nil) -> List(value)

@external(javascript, "./harness.ffi.mjs", "newBrowser")
fn new_browser(keyboard: Bool) -> Browser

@external(javascript, "./harness.ffi.mjs", "inBrowser")
fn in_browser(browser: Browser, run: fn() -> a) -> a

@external(javascript, "./harness.ffi.mjs", "unload")
fn unload(browser: Browser) -> Nil

@external(javascript, "./harness.ffi.mjs", "nextTimer")
fn next_timer(browser: Browser, deadline: Int) -> Result(fn() -> Nil, Nil)

@external(javascript, "./harness.ffi.mjs", "now")
fn now(browser: Browser) -> Int

@external(javascript, "./harness.ffi.mjs", "hide")
fn hide(browser: Browser) -> Nil

@external(javascript, "./harness.ffi.mjs", "shortcut")
fn shortcut(browser: Browser, key: String) -> Nil

@external(javascript, "./harness.ffi.mjs", "typeAtCaret")
fn type_at_caret(browser: Browser, text: String) -> Nil

@external(javascript, "./harness.ffi.mjs", "selectAll")
fn select_all(browser: Browser) -> Nil

@external(javascript, "./harness.ffi.mjs", "control")
fn control(browser: Browser) -> #(String, Int, Int, Bool)

@external(javascript, "./harness.ffi.mjs", "blur")
fn blur(browser: Browser) -> Nil

@external(javascript, "./harness.ffi.mjs", "performPaint")
fn perform_paint(effect: Effect(msg), dispatch: fn(msg) -> Nil) -> Nil
