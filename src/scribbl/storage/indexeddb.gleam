//// Browser storage backend (M1): one IndexedDB object store.
//// Imported by: `scribbl.main` only. Imports: `storage`.

import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode.{type Decoder}
import gleam/option.{None, Some}
import gleam/result
import scribbl/storage.{
  type Backend, type Failure, type Record, type Reply, Backend, NotFound, Record,
  Unavailable,
}

/// Each `Backend` field adapts one function of `indexeddb.ffi.mjs`. The JS
/// side speaks plain values and callbacks. What it hands back is decoded
/// here, so JavaScript never constructs Gleam data and a record of the wrong
/// shape becomes a `Failure`, not a crash later on.
pub fn backend() -> Backend {
  Backend(
    all: fn(reply) {
      let found = fn(records) {
        reply(parse(records, decode.list(record_decoder())))
      }
      all(found, failed(reply))
    },
    get: fn(key, reply) {
      let found = fn(record) { reply(parse(record, record_decoder())) }
      let missing = fn() { reply(Error(NotFound)) }
      get(key, found, missing, failed(reply))
    },
    put: fn(key, title, body, reply) {
      let done = fn() { reply(Ok(Nil)) }
      put(key, option.unwrap(title, ""), body, done, failed(reply))
    },
    add: fn(reply) {
      let added = fn(record) { reply(parse(record, record_decoder())) }
      add(added, failed(reply))
    },
    remove: fn(key, reply) {
      let done = fn() { reply(Ok(Nil)) }
      remove(key, done, failed(reply))
    },
  )
}

fn failed(reply: Reply(a)) -> fn(String) -> Nil {
  fn(detail) { reply(Error(Unavailable(detail))) }
}

fn parse(stored: Dynamic, decoder: Decoder(a)) -> Result(a, Failure) {
  decode.run(stored, decoder)
  |> result.replace_error(Unavailable("a stored note could not be read"))
}

/// A stored record is `{ key, title, body, modified }`. A note without a
/// typed title is stored with the title "".
fn record_decoder() -> Decoder(Record) {
  use key <- decode.field("key", decode.string)
  use title <- decode.field("title", decode.string)
  use body <- decode.field("body", decode.string)
  use modified_ms <- decode.field("modified", decode.int)
  let title = case title {
    "" -> None
    _ -> Some(title)
  }
  decode.success(Record(key:, title:, body:, modified_ms:))
}

@external(javascript, "./indexeddb.ffi.mjs", "all")
fn all(found: fn(Dynamic) -> Nil, fail: fn(String) -> Nil) -> Nil

@external(javascript, "./indexeddb.ffi.mjs", "get")
fn get(
  key: String,
  found: fn(Dynamic) -> Nil,
  missing: fn() -> Nil,
  fail: fn(String) -> Nil,
) -> Nil

@external(javascript, "./indexeddb.ffi.mjs", "put")
fn put(
  key: String,
  title: String,
  body: String,
  done: fn() -> Nil,
  fail: fn(String) -> Nil,
) -> Nil

@external(javascript, "./indexeddb.ffi.mjs", "add")
fn add(added: fn(Dynamic) -> Nil, fail: fn(String) -> Nil) -> Nil

@external(javascript, "./indexeddb.ffi.mjs", "remove")
fn remove(key: String, done: fn() -> Nil, fail: fn(String) -> Nil) -> Nil
