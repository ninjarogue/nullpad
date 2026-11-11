//// The editing session: the buffer, the key mode, and the rule for who wins
//// when the text field ("the control") and the model disagree. Pure Gleam.
////
////   control -> model  every event carries a full snapshot of the control
////                     (`shown`: text + selection), never a delta, so the two
////                     cannot drift.
////   model -> control  `update` returns a `Sync`, computed by comparing what
////                     we want with `shown`. Stateless and safe to apply twice.
////
//// Imported by: `surface`, the app shell, tests. Imports: `buffer`, `vim`.

import gleam/list
import gleam/string
import nullpad/buffer.{type Buffer, Position}
import nullpad/vim.{Step}

pub opaque type Editor {
  Editor(buffer: Buffer, keys: Keys)
}

type Keys {
  /// Vim off (phones, or the setting): the control does all the typing.
  PlainKeys
  VimKeys(vim.State)
}

/// What the view needs to know. `Plain` means vim is off.
pub type Mode {
  Plain
  Normal
  Insert
}

/// Something happened in the control. Built only by `surface`'s decoders.
pub type Event {
  /// The user typed, pasted, composed with an IME or moved the selection.
  ControlChanged(shown: Buffer)
  /// A key that `claims` accepted. Its default action was cancelled, so
  /// `shown` is the control exactly as it is now.
  KeyPressed(key: vim.Key, shown: Buffer)
}

/// What `surface.sync` must do to the control after an update.
pub type Sync {
  InSync
  Write(Buffer)
}

/// The result of every editor operation. Returning `sync` from all of them
/// means pushing a change to the control cannot be forgotten without visibly
/// ignoring a value.
pub type Outcome {
  Outcome(editor: Editor, sync: Sync, requests: List(vim.Request))
}

pub fn new(vim vim_enabled: Bool) -> Editor {
  Editor(buffer: buffer.from_text(""), keys: fresh_keys(vim_enabled))
}

fn fresh_keys(vim_enabled: Bool) -> Keys {
  case vim_enabled {
    True -> VimKeys(vim.new())
    False -> PlainKeys
  }
}

/// A note was loaded: replace the text, cursor at the start, fresh vim state.
/// Always asks for a `Write`.
pub fn open(editor: Editor, text: String) -> Outcome {
  let buffer = buffer.from_text(text)
  let keys = fresh_keys(editor.keys != PlainKeys)
  Outcome(editor: Editor(buffer:, keys:), sync: Write(buffer), requests: [])
}

/// Turn vim on or off, keeping the text.
pub fn set_vim(editor: Editor, enabled: Bool) -> Editor {
  case editor.keys, enabled {
    PlainKeys, False | VimKeys(_), True -> editor
    _, _ -> Editor(..editor, keys: fresh_keys(enabled))
  }
}

/// The whole editing rule:
/// 1. Whose text wins? Plain / Insert: the control's, `base = shown`.
///    Normal: ours, `base` = our buffer with the control's selection (the
///    control is read-only then, so its text should match anyway).
/// 2. `KeyPressed` with vim on: `vim.press(state, base, key)` gives the
///    wanted buffer and any requests. Otherwise `wanted = base`.
/// 3. `sync = case wanted == shown { True -> InSync  False -> Write(wanted) }`
///
/// Guarantee (tested): in Plain and Insert, `ControlChanged` always gives
/// `InSync`. We never answer the user's typing with a write. That is what
/// keeps IME composition, autocorrect and the phone's native undo intact.
/// Idempotent: the same event twice gives the same editor.
pub fn update(editor: Editor, event: Event) -> Outcome {
  let shown = case event {
    ControlChanged(shown:) | KeyPressed(shown:, ..) -> shown
  }
  let base = case mode(editor) {
    Plain | Insert -> shown
    Normal -> {
      let #(anchor, head) = buffer.selection(shown)
      buffer.select(editor.buffer, anchor:, head:)
    }
  }
  let #(keys, wanted, requests) = case event, editor.keys {
    KeyPressed(key:, ..), VimKeys(state) -> {
      let Step(state:, buffer:, requests:) = vim.press(state, base, key)
      #(VimKeys(state), buffer, requests)
    }
    KeyPressed(..), PlainKeys | ControlChanged(..), _ -> #(
      editor.keys,
      base,
      [],
    )
  }
  let sync = case wanted == shown {
    True -> InSync
    False -> Write(wanted)
  }
  Outcome(editor: Editor(buffer: wanted, keys:), sync:, requests:)
}

/// Replace one line from outside the control. A row that does not exist
/// changes nothing.
pub fn replace_line(editor: Editor, row: Int, with line: String) -> Outcome {
  case list.drop(buffer.lines(editor.buffer), row) {
    [old, ..] if row >= 0 -> {
      let buffer =
        editor.buffer
        |> buffer.replace(
          from: Position(row:, col: 0),
          to: Position(row:, col: string.length(old)),
          with: line,
        )
        |> with_selection_of(editor.buffer)
      Outcome(
        editor: Editor(..editor, buffer:),
        sync: Write(buffer),
        requests: [],
      )
    }
    _ -> Outcome(editor:, sync: InSync, requests: [])
  }
}

fn with_selection_of(buffer: Buffer, other: Buffer) -> Buffer {
  let #(anchor, head) = buffer.selection(other)
  buffer.select(buffer, anchor:, head:)
}

pub fn buffer(editor: Editor) -> Buffer {
  editor.buffer
}

/// What the preview and storage read.
pub fn text(editor: Editor) -> String {
  buffer.text(editor.buffer)
}

pub fn mode(editor: Editor) -> Mode {
  case editor.keys {
    PlainKeys -> Plain
    VimKeys(state) ->
      case vim.mode(state) {
        vim.Normal -> Normal
        vim.Insert -> Insert
      }
  }
}

/// Does the editor want this key instead of the browser? `surface` asks from
/// inside its keydown decoder, because a key must be cancelled before
/// `update` runs. Always False with vim off.
pub fn claims(editor: Editor, key: vim.Key) -> Bool {
  case editor.keys {
    PlainKeys -> False
    VimKeys(state) -> vim.claims(vim.mode(state), key)
  }
}
