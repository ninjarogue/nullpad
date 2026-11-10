//// Small browser facilities that are neither the editor nor storage: a
//// timer, one remembered setting, a global shortcut, the page being hidden,
//// the clipboard.
//// Imported by: the app shell and `scribbl.main`. Imports: lustre/effect.

import lustre/effect.{type Effect}

/// Deliver `msg` after `ms` milliseconds. There is no cancel: the receiver
/// checks whether the message is still current (see `app.AutosaveDue`).
pub fn after(ms: Int, msg: msg) -> Effect(msg) {
  use dispatch <- effect.from
  set_timeout(ms, fn() { dispatch(msg) })
}

/// Deliver `msg` whenever Ctrl plus `key` (Cmd plus `key` on Apple devices)
/// is pressed anywhere on the page. `key` is a lowercase letter. Start it once, from `init`.
pub fn on_shortcut(key: String, msg: msg) -> Effect(msg) {
  use dispatch <- effect.from
  listen_for_shortcut(key, fn() { dispatch(msg) })
}

/// Deliver `msg` each time the page is hidden: the tab is switched or closed,
/// or a phone sends the browser to the background. Start it once, from
/// `init`. This is the moment to save, because a hidden page can be thrown
/// away without another warning.
pub fn on_hide(msg: msg) -> Effect(msg) {
  use dispatch <- effect.from
  listen_for_hide(fn() { dispatch(msg) })
}

/// Write text to the system clipboard (vim's `"+y`, later).
pub fn copy(text: String) -> Effect(msg) {
  use _ <- effect.from
  write_clipboard(text)
}

/// Is there a real keyboard? True for a device with hover and a fine pointer.
/// Vim is only offered when this is True, so phones never get it.
@external(javascript, "./platform.ffi.mjs", "hasHardwareKeyboard")
pub fn has_hardware_keyboard() -> Bool

/// The remembered vim switch. False if it was never set: vim is off by
/// default.
@external(javascript, "./platform.ffi.mjs", "readVimSetting")
pub fn read_vim_setting() -> Bool

pub fn remember_vim_setting(on: Bool) -> Effect(msg) {
  use _ <- effect.from
  write_vim_setting(on)
}

@external(javascript, "./platform.ffi.mjs", "setTimeout")
fn set_timeout(ms: Int, run: fn() -> Nil) -> Nil

@external(javascript, "./platform.ffi.mjs", "listenForShortcut")
fn listen_for_shortcut(key: String, run: fn() -> Nil) -> Nil

@external(javascript, "./platform.ffi.mjs", "listenForHide")
fn listen_for_hide(run: fn() -> Nil) -> Nil

@external(javascript, "./platform.ffi.mjs", "writeClipboard")
fn write_clipboard(text: String) -> Nil

@external(javascript, "./platform.ffi.mjs", "writeVimSetting")
fn write_vim_setting(on: Bool) -> Nil
