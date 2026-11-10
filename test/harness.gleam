//// Test helper: runs a Lustre effect by hand. `lustre/dev/simulate` throws
//// effects away, so with only that, a test could never see what storage
//// answers.

import gleam/dynamic
import lustre/effect.{type Effect}

/// Run an effect and return the messages it sent before it finished. Works
/// for effects that answer at once, like storage on a backend made in the
/// test. A timer answers later, so its message is not in the list.
///
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
