//// Vim as a pure state machine: one key in, a new buffer out. It never sees
//// the browser, so every command is a gleeunit test.
////
//// Two private steps, so the grammar can grow without touching callers:
////   parse(pending, key) -> Parsed    keys become a `Command` (plain data)
////   run(state, buffer, command)      the `Command` edits the buffer
//// Because a `Command` is data, a count is a field, `.` is "run the last
//// command again", and the compiler lists every `case` a new command needs.
////
//// Imported by: `editor`; `surface` (for `Key`); the shell (for `Request`).
//// Imports: `buffer`.

import gleam/option.{type Option, None}
import scribbl/buffer.{type Buffer}

/// A key press, already parsed from the browser's key name by `surface`.
/// Keys vim has no use for (Shift, F5, IME keys) never become a `Key`.
pub type Key {
  /// One printable grapheme: Char("j"), Char("D"), Char("$").
  Char(String)
  Escape
  Enter
  /// Control plus a letter: Ctrl("r").
  Ctrl(String)
}

/// M4 has two modes. Visual and the `:` command line are added here later.
pub type Mode {
  Normal
  Insert
}

/// Something vim wants that is not a text edit. The shell carries these out.
/// M4 returns none. `:w` and `"+y` use them later.
pub type Request {
  SaveNow
  CopyToClipboard(String)
}

/// The result of one key press.
pub type Step {
  Step(state: State, buffer: Buffer, requests: List(Request))
}

/// Illegal states cannot be built: a half-typed command exists only in normal
/// mode, and the "text before this insert" checkpoint only in insert mode.
/// Undo lives here because it is vim's undo. With vim off the browser's own
/// undo keeps working, since nothing writes to the text field while you type.
pub opaque type State {
  State(
    mode: ModeState,
    undo: List(Buffer),
    redo: List(Buffer),
    /// What `d` and `y` last took, for `p`.
    register: String,
    /// The last command that changed text, for `.`.
    last_change: Option(Command),
  )
}

type ModeState {
  InNormal(pending: Pending)
  InInsert(before: Buffer)
}

/// What has been typed toward a command so far: `3` then `d` is
/// `Pending(count: Some(3), operator: Some(Delete))`.
type Pending {
  Pending(count: Option(Int), operator: Option(Operator))
}

/// The vim grammar as data. M4 builds the variants below. Each later feature
/// is a new variant plus the `case` branches the compiler then asks for.
type Command {
  Move(count: Int, motion: Motion)
  /// An operator applied to a target: `dd`, and later `dw`, `ciw`, `y$`.
  Operate(operator: Operator, count: Int, target: Target)
  StartInsert(at: InsertAt)
  Undo
  Redo
}

type Motion {
  Left
  Right
  Up
  Down
  WordForward
  WordBackward
}

type Operator {
  Delete
}

type Target {
  /// The operator key typed twice (`dd`): whole lines.
  WholeLines
  /// The text a motion crosses (`dw`). Text objects (`iw`) are added here.
  Across(Motion)
}

type InsertAt {
  /// `i`
  BeforeCursor
  /// `a`
  AfterCursor
  /// `o`
  NewLineBelow
}

type Parsed {
  /// More keys are needed.
  Incomplete(Pending)
  Complete(Command)
  /// Not a command. Forget whatever was pending.
  Unmapped
}

/// Normal mode, empty undo. Make a new one per opened note.
pub fn new() -> State {
  State(
    mode: InNormal(Pending(None, None)),
    undo: [],
    redo: [],
    register: "",
    last_change: None,
  )
}

pub fn mode(state: State) -> Mode {
  case state.mode {
    InNormal(..) -> Normal
    InInsert(..) -> Insert
  }
}

/// Should the browser's own handling of this key be cancelled and the key go
/// to `press`? Depends on the mode only.
/// Insert: only Escape (everything else must reach the text field natively,
/// for IME and autocorrect). Normal: every plain key, so nothing reaches the
/// text, but a Ctrl chord only if the keymap maps it (Ctrl+R is redo, while
/// Ctrl+C stays the browser's copy). Asking `parse` keeps one list of keys.
pub fn claims(mode: Mode, key: Key) -> Bool {
  case mode, key {
    Insert, Escape -> True
    Insert, _ -> False
    Normal, Ctrl(_) -> parse(Pending(None, None), key) != Unmapped
    Normal, _ -> True
  }
}

/// Feed one key. Total: an unmapped key returns the buffer unchanged.
pub fn press(state: State, buffer: Buffer, key: Key) -> Step {
  // Insert, Escape -> if the text differs from `before`, push `before` on
  //                   undo (one insert session = ONE undo step); move the
  //                   cursor one left; back to InNormal.
  // Insert, other  -> buffer.replace(cursor, cursor, char). Normally the text
  //                   field types and we never get here. This covers the one
  //                   stale frame described in surface.key_decoder.
  // Normal         -> case parse(pending, key) {
  //                     Incomplete(p) -> remember p
  //                     Unmapped      -> forget pending
  //                     Complete(c)   -> run(state, buffer, c)
  //                   }
  let _ = #(state, buffer, key, run)
  todo as "not implemented"
}

/// THE keymap, the only place key names appear.
/// M4: h j k l w b -> Move. i a o -> StartInsert. u -> Undo. Ctrl("r") -> Redo.
/// d -> Incomplete(operator: Delete), then d -> Operate(Delete, n, WholeLines).
/// Later: digits build `count`; a motion after an operator -> Across(motion).
fn parse(pending: Pending, key: Key) -> Parsed {
  let _ = #(pending, key)
  todo as "not implemented"
}

/// Carry out one command using `buffer.select` and `buffer.replace` only.
/// A command that changes text first pushes the old buffer on `undo`, clears
/// `redo`, and is remembered in `last_change`.
fn run(state: State, buffer: Buffer, command: Command) -> Step {
  let _ = #(state, buffer, command, land)
  todo as "not implemented"
}

/// Where a motion lands from the cursor. Motions are vim's knowledge, so they
/// live here and not in `buffer`. No wildcard: a new `Motion` fails the build
/// until it is handled.
fn land(buffer: Buffer, motion: Motion) -> buffer.Position {
  case motion {
    Left | Right | Up | Down | WordForward | WordBackward -> {
      let _ = buffer
      todo as "not implemented"
    }
  }
}
