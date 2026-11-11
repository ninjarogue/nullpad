//// Test helper: runs a Lustre effect by hand. `lustre/dev/simulate` throws
//// effects away, so with only that, a test could never see what storage
//// answers.

import gleam/dynamic
import gleam/list
import gleam/option.{None}
import gleam/result
import lustre/effect.{type Effect}
import scribbl/storage.{type Backend, type Record, Backend, NotFound, Record}

/// `effect.perform` is marked internal in Lustre 5: its docs offer it for
/// testing, but it may change in a minor release. This is its only caller.
pub fn messages(effect: Effect(msg)) -> List(msg) {
  use dispatch <- collect
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
}

@external(javascript, "./harness.ffi.mjs", "collect")
fn collect(run: fn(fn(value) -> Nil) -> Nil) -> List(value)

pub fn backend_holding(records: List(Record)) -> Backend {
  Backend(
    all: fn(reply) { reply(Ok(records)) },
    get: fn(key, reply) {
      list.find(records, fn(record) { record.key == key })
      |> result.replace_error(NotFound)
      |> reply
    },
    put: fn(_key, _title, _body, reply) { reply(Ok(Nil)) },
    add: fn(reply) {
      reply(Ok(Record(key: "added", title: None, body: "", modified_ms: 0)))
    },
    remove: fn(_key, reply) { reply(Ok(Nil)) },
  )
}
