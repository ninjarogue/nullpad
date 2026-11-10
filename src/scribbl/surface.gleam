//// The only module that touches the on-screen text control (a <textarea>).
//// Hides: DOM event decoding, UTF-16 offsets, which keys get cancelled, the
//// block-cursor / highlighting mirror, and all editor JavaScript.
//// - READ: every listener decodes a full snapshot of the control.
//// - WRITE: `sync` is the only code that sets the control's value or
////   selection. Lustre's virtual DOM never sets `value` (see `view`).
//// Imported by: the app shell only. Imports: `editor`, `buffer`, `vim` (for
//// `Key`), and from M6 `markdown` (for `highlight`).

import gleam/dynamic/decode.{type Decoder}
import gleam/result
import lustre/attribute
import lustre/effect.{type Effect}
import lustre/element.{type Element}
import lustre/element/html
import lustre/event
import scribbl/buffer.{type Buffer}
import scribbl/editor.{type Editor}
import scribbl/vim

const control_id = "scribbl-control"

/// The editing pane. Render it once, unconditionally. To show the rendered
/// page instead, hide this with CSS; do not remove it from the view.
///
/// WARNING: never swap this for `html.textarea(attrs, text)`. In Lustre 5.7.1
/// that helper adds a `value` property, which Lustre re-assigns on the next
/// frame after any event from the element. With "" it wipes what was typed.
/// With the model's text it is a second writer beside `sync`.
pub fn view(editor: Editor, on_event: fn(editor.Event) -> msg) -> Element(msg) {
  let changed = {
    use shown <- decode.map(shown_decoder())
    on_event(editor.ControlChanged(shown:))
  }
  html.div([attribute.class("editor")], [
    mirror(editor),
    element.element(
      "textarea",
      [
        attribute.id(control_id),
        // `lustre/dev/query.test_id` matches `data-test-id`.
        attribute.data("test-id", "editor"),
        attribute.aria_label("Note text"),
        // Normal mode locks the control: no typing, paste, drop or IME.
        attribute.readonly(editor.mode(editor) == editor.Normal),
        event.on("input", changed),
        event.on("select", changed),
        event.on("pointerup", changed),
        event.advanced("keydown", key_decoder(editor, on_event)),
      ],
      // Child text is only the *default* value: a brand-new DOM node starts
      // with the model's text. The browser ignores it after the first edit.
      [element.text(editor.text(editor))],
    ),
  ])
}

/// Carry out the `sync` of an `editor.Outcome`. The shell calls this for
/// every outcome.
pub fn sync(sync: editor.Sync) -> Effect(msg) {
  case sync {
    editor.InSync -> effect.none()
    editor.Write(buffer) -> {
      let #(text, start, end) = to_control(buffer)
      effect.batch([
        // Runs right after `update`, before any other browser event, so the
        // next event's snapshot already includes this write.
        effect.from(fn(_) { write_control(control_id, text, start, end) }),
        // After the mirror re-rendered: scroll its cursor mark into view.
        effect.before_paint(fn(_, _) { reveal_cursor(control_id) }),
      ])
    }
  }
}

/// Boundary parse, browser -> domain: the control's `value` and its
/// `selectionStart` / `selectionEnd` (UTF-16 offsets) become a `Buffer`.
/// Public only so gleeunit can test it with emoji.
pub fn from_control(text: String, start: Int, end: Int) -> Buffer {
  // position(offset): #(before, _) = utf16_split(text, offset)
  //   row = count of "\n" in before; col = graphemes after the last "\n"
  // buffer.from_text(text)
  // |> buffer.select(anchor: position(start), head: position(end))
  let _ = #(text, start, end, utf16_split)
  todo as "not implemented"
}

/// Domain -> browser: `#(value, selectionStart, selectionEnd)`.
/// Law: `to_control(from_control(t, s, e)) == #(t, s, e)`.
pub fn to_control(buffer: Buffer) -> #(String, Int, Int) {
  // offset(position) = utf16_length(the text before that position)
  let _ = #(buffer, utf16_length)
  todo as "not implemented"
}

fn shown_decoder() -> Decoder(Buffer) {
  use text <- decode.subfield(["target", "value"], decode.string)
  use start <- decode.subfield(["target", "selectionStart"], decode.int)
  use end <- decode.subfield(["target", "selectionEnd"], decode.int)
  decode.success(from_control(text, start, end))
}

/// keydown: succeed, and cancel the key's default action, only if the editor
/// claims the key. A failed decoder sends no message and the key stays
/// native, so plain typing costs no `update` here.
///
/// Known gap: `editor` is the one from the last *rendered* frame (Lustre
/// renders on requestAnimationFrame), so for one frame after a mode switch
/// the old mode decides. Cost: at most one lost key press, never lost text
/// (`vim.press` types it in insert; `editor.update` step 1 restores normal).
fn key_decoder(
  editor: Editor,
  on_event: fn(editor.Event) -> msg,
) -> Decoder(event.Handler(msg)) {
  use name <- decode.field("key", decode.string)
  use ctrl <- decode.field("ctrlKey", decode.bool)
  use meta <- decode.field("metaKey", decode.bool)
  use alt <- decode.field("altKey", decode.bool)
  use composing <- decode.field("isComposing", decode.bool)
  let key = parse_key(name, ctrl, meta || alt || composing)
  case key, result.map(key, editor.claims(editor, _)) {
    Ok(key), Ok(True) -> {
      use shown <- decode.map(shown_decoder())
      on_event(editor.KeyPressed(key:, shown:))
      |> event.handler(prevent_default: True, stop_propagation: False)
    }
    _, _ -> {
      // `decode.failure` wants a placeholder value. It is never used.
      let unused = on_event(editor.ControlChanged(buffer.from_text("")))
      event.handler(unused, prevent_default: False, stop_propagation: False)
      |> decode.failure(expected: "a key the editor claims")
    }
  }
}

/// Boundary parse of `KeyboardEvent.key`: "Escape" -> Escape; "Enter" ->
/// Enter; one grapheme -> Char or Ctrl. Error for everything else ("Shift",
/// "Process", "Dead"...) and whenever `ignore` is true (Meta/Alt chord, IME
/// composing).
fn parse_key(name: String, ctrl: Bool, ignore: Bool) -> Result(vim.Key, Nil) {
  let _ = #(name, ctrl, ignore)
  todo as "not implemented"
}

/// The picture layer: drawn by Lustre from the model, stacked exactly under
/// the textarea (same CSS grid cell, font, padding, wrapping), whose own text
/// is transparent. The browser keeps caret, selection, touch and IME. We
/// choose the glyphs. The mirror also sizes the cell, so the pane scrolls.
/// - Vim off, M1 to M5: `element.none()`. The textarea shows its own text.
/// - M4, vim on: <pre aria-hidden> = text before the cursor,
///   <span data-cursor>grapheme or " "</span>, text after. CSS paints
///   `[data-cursor]` as a block in normal mode.
/// - M6: one keyed row per line, spans from `markdown.highlight`.
fn mirror(editor: Editor) -> Element(msg) {
  let _ = editor
  todo as "not implemented"
}

@external(javascript, "./surface.ffi.mjs", "writeControl")
fn write_control(id: String, text: String, start: Int, end: Int) -> Nil

@external(javascript, "./surface.ffi.mjs", "revealCursor")
fn reveal_cursor(id: String) -> Nil

/// `#(before, after)` around a UTF-16 offset. Pure.
@external(javascript, "./surface.ffi.mjs", "utf16Split")
fn utf16_split(text: String, offset: Int) -> #(String, String)

/// JavaScript's `.length`. Pure.
@external(javascript, "./surface.ffi.mjs", "utf16Length")
fn utf16_length(text: String) -> Int
