//// Examples that drive the real init / update / view without a browser,
//// using `lustre/dev/simulate`. Effects do not run there, so storage replies
//// are sent as messages, and DOM events are JSON payloads that go through
//// the real decoders in `surface`. See `markdown_test` for how `pending_`
//// functions work.

import gleam/json
import gleam/option.{None}
import lustre/dev/query
import lustre/dev/simulate
import scribbl/app
import scribbl/storage

/// M2: type a heading, flip to the rendered page, find the <h1>.
pub fn pending_typing_shows_on_the_rendered_page() {
  let control = query.element(matching: query.test_id("editor"))
  let typed =
    json.object([
      #("value", json.string("# Hi")),
      #("selectionStart", json.int(4)),
      #("selectionEnd", json.int(4)),
    ])
  let heading =
    query.element(matching: query.test_id("preview"))
    |> query.descendant(matching: query.tag("h1"))

  let page =
    simulate.application(app.init, app.update, app.view)
    |> simulate.start(flags())
    |> simulate.event(on: control, name: "input", data: [#("target", typed)])
    |> simulate.message(app.UserToggledRendered)
    |> simulate.view

  let assert Ok(_) = query.find(in: page, matching: heading)
}

/// M1: a slow autosave timer must not save after newer edits.
pub fn pending_stale_autosave_is_ignored() {
  let simulation =
    simulate.application(app.init, app.update, app.view)
    |> simulate.start(flags())
    |> simulate.message(app.AutosaveDue(edits: 99))

  let assert None = simulate.model(simulation).open
}

fn flags() -> app.Flags {
  app.Flags(storage: storage.new(silent_backend()), vim: False, can_vim: True)
}

/// A backend that never answers: enough for tests that send replies by hand.
fn silent_backend() -> storage.Backend {
  storage.Backend(
    all: fn(_reply) { Nil },
    get: fn(_key, _reply) { Nil },
    put: fn(_key, _title, _body, _reply) { Nil },
    add: fn(_reply) { Nil },
    remove: fn(_key, _reply) { Nil },
  )
}
