//// Browser storage backend (M1): one IndexedDB object store.
//// Imported by: `scribbl.main` only. Imports: `storage`.

import scribbl/storage.{type Backend}

/// Each `Backend` field adapts one function of `indexeddb.ffi.mjs`. The JS
/// side speaks plain values and callbacks; building `Result` and `Record`
/// happens here in Gleam, so JavaScript never constructs Gleam data.
pub fn backend() -> Backend {
  todo as "not implemented"
}
