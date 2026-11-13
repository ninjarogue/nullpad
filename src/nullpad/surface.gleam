//// Imported by: the app shell only. Imports: `editor`, `buffer`, `live`,
//// `vim` (for `Key`), `markdown`.

import gleam/dynamic.{type Dynamic}
import gleam/dynamic/decode.{type Decoder}
import gleam/float
import gleam/int
import gleam/list
import gleam/option.{type Option, None, Some}
import gleam/result
import gleam/string
import lustre/attribute
import lustre/effect.{type Effect}
import lustre/element.{type Element}
import lustre/element/html
import lustre/event
import nullpad/buffer.{type Buffer, type Position}
import nullpad/editor.{type Editor}
import nullpad/live
import nullpad/markdown
import nullpad/vim

const control_id = "nullpad-control"

const live_class = "live"

/// WARNING: never swap this for `html.textarea(attrs, text)`. In Lustre 5.7.1
/// that helper adds a `value` property, which Lustre re-assigns on the next
/// frame after any event from the element. With "" it wipes what was typed.
/// With the model's text it is a second writer beside `sync`.
pub fn view(editor: Editor, on_event: fn(editor.Event) -> msg) -> Element(msg) {
  let changed = {
    use shown <- decode.map(shown_decoder())
    on_event(editor.ControlChanged(shown:))
  }
  let typed = {
    use composing <- decode.optional_field("isComposing", False, decode.bool)
    use shown <- decode.map(shown_decoder())
    case composing {
      True -> on_event(editor.Composing(shown:))
      False -> on_event(editor.ControlChanged(shown:))
    }
  }
  let focus_changed = fn(focused) {
    decode.success(on_event(editor.FocusChanged(focused:)))
  }
  let kind = {
    use field <- option.map(editor.region(editor))
    let note = editor.buffer(editor)
    let caret_row = buffer.cursor(note).row
    live.kind(
      editor.blocks(editor),
      field:,
      caret_row:,
      lines: buffer.lines(note),
    )
  }
  html.div([attribute.class(classes(editor, kind)), marker(kind)], [
    mirror(editor),
    element.element(
      "textarea",
      [
        attribute.id(control_id),
        attribute.data("test-id", "editor"),
        attribute.aria_label("Note text"),
        attribute.readonly(editor.mode(editor) == editor.Normal),
        event.on("input", typed),
        event.on("compositionend", changed),
        event.on("select", changed),
        event.on("pointerup", changed),
        event.on("focus", focus_changed(True)),
        event.on("blur", focus_changed(False)),
        event.advanced(
          "keydown",
          decode.one_of(key_decoder(editor, on_event), [
            edge_decoder(on_event),
            escape_decoder(on_event),
          ]),
        ),
      ],
      // Child text is only the *default* value: a brand-new DOM node starts
      // with the model's text. The browser ignores it after the first edit.
      [element.text(buffer.text(editor.field_buffer(editor)))],
    ),
  ])
}

/// CSS cannot measure typed text, so the marker is measured here.
fn marker(kind: Option(live.Kind)) -> attribute.Attribute(msg) {
  case kind {
    Some(live.ListItem(marker:, ..)) ->
      attribute.style("--marker", float.to_string(text_width(marker)) <> "px")
    Some(live.Body) | Some(live.Mono) | Some(live.Title(_)) | None ->
      attribute.none()
  }
}

fn classes(editor: Editor, kind: Option(live.Kind)) -> String {
  case kind, editor.is_idle(editor) {
    None, _ -> "editor"
    Some(_), True -> "editor part idle"
    Some(kind), False ->
      case kind {
        live.Body -> "editor part"
        live.Mono -> "editor part mono"
        live.ListItem(task: False, ..) -> "editor part item"
        live.ListItem(task: True, ..) -> "editor part item task"
        live.Title(markdown.H1) -> "editor part h1"
        live.Title(markdown.H2) -> "editor part h2"
        live.Title(markdown.H3) -> "editor part h3"
        live.Title(markdown.H4) -> "editor part h4"
        live.Title(markdown.H5) -> "editor part h5"
        live.Title(markdown.H6) -> "editor part h6"
      }
  }
}

pub fn page(
  editor: Editor,
  on_event: fn(editor.Event) -> msg,
) -> List(attribute.Attribute(msg)) {
  case editor.region(editor) {
    None -> [attribute.class("page")]
    Some(_) -> [attribute.class("page " <> live_class), on_point(on_event)]
  }
}

fn on_point(on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {
  event.advanced("mousedown", {
    use press <- decode.then(decode.dynamic)
    case locate(press, live.row_mark) {
      #(row, visible, at_end) if row >= 0 ->
        on_event(editor.Pointed(row:, visible:, at_end:))
        |> event.handler(prevent_default: True, stop_propagation: False)
        |> decode.success
      _ ->
        on_event(editor.FocusChanged(False))
        |> event.handler(prevent_default: False, stop_propagation: False)
        |> decode.failure(expected: "a place on the drawn page")
    }
  })
}

pub fn sync(
  sync: editor.Sync,
  on_event: fn(editor.Event) -> msg,
) -> Effect(msg) {
  let write = fn(buffer) {
    let #(text, start, end) = to_control(buffer)
    effect.from(fn(_) { write_control(control_id, text, start, end) })
  }
  case sync {
    editor.InSync -> effect.none()
    editor.Write(buffer) -> effect.batch([write(buffer), focus()])
    editor.WriteQuietly(buffer) -> write(buffer)
    editor.WriteAndAim(buffer, x:, line:) ->
      effect.batch([
        write(buffer),
        effect.before_paint(fn(dispatch, _) {
          focus_control(control_id)
          let #(text, start, end) = to_control(buffer)
          let #(text, start, end) =
            aim_control(
              control_id,
              text,
              start,
              end,
              x,
              line == editor.LastLine,
            )
          dispatch(
            on_event(editor.ControlChanged(from_control(text, start, end))),
          )
        }),
      ])
    // Blurred at once, because a key pressed before the next paint would
    // still be typed into the field, and again before that paint, after any
    // focus an earlier key asked for.
    editor.Release(buffer) ->
      effect.batch([
        write(buffer),
        effect.from(fn(_) { blur_control(control_id) }),
        effect.before_paint(fn(_, _) { blur_control(control_id) }),
      ])
  }
}

pub fn focus() -> Effect(msg) {
  // A pane that was hidden cannot take focus until the next render puts it
  // back on screen.
  effect.before_paint(fn(_, _) { focus_control(control_id) })
}

/// `selectionStart` and `selectionEnd` are UTF-16 offsets.
fn from_control(text: String, start: Int, end: Int) -> Buffer {
  buffer.from_text(text)
  |> buffer.select(anchor: position(text, start), head: position(text, end))
}

fn position(text: String, offset: Int) -> Position {
  let #(before, _) = utf16_split(text, offset)
  buffer.end_of(before)
}

fn to_control(buffer: Buffer) -> #(String, Int, Int) {
  let #(anchor, head) = buffer.selection(buffer)
  let lines = buffer.lines(buffer)
  let anchor = offset(lines, anchor)
  let head = offset(lines, head)
  // The control always reports start <= end, whichever way it was selected.
  #(buffer.text(buffer), int.min(anchor, head), int.max(anchor, head))
}

fn offset(lines: List(String), position: Position) -> Int {
  let rows_above =
    list.take(lines, position.row)
    |> list.fold(0, fn(sum, line) { sum + utf16_length(line) + 1 })
  let in_row =
    list.drop(lines, position.row)
    |> list.first
    |> result.unwrap("")
    |> string.slice(0, position.col)
  rows_above + utf16_length(in_row)
}

fn shown_decoder() -> Decoder(Buffer) {
  use text <- decode.subfield(["target", "value"], decode.string)
  use start <- decode.subfield(["target", "selectionStart"], decode.int)
  use end <- decode.subfield(["target", "selectionEnd"], decode.int)
  decode.success(from_control(text, start, end))
}

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

fn edge_decoder(
  on_event: fn(editor.Event) -> msg,
) -> Decoder(event.Handler(msg)) {
  use name <- decode.field("key", decode.string)
  use shift <- decode.field("shiftKey", decode.bool)
  use ctrl <- decode.field("ctrlKey", decode.bool)
  use meta <- decode.field("metaKey", decode.bool)
  use alt <- decode.field("altKey", decode.bool)
  use composing <- decode.field("isComposing", decode.bool)
  use shown <- decode.then(shown_decoder())
  let #(anchor, head) = buffer.selection(shown)
  let plain = !{ shift || ctrl || meta || alt || composing } && anchor == head
  let end = buffer.end_of(buffer.text(shown))
  let in_edge_row = case name {
    "Backspace" -> head == buffer.Position(row: 0, col: 0)
    "Delete" -> head == end
    "ArrowUp" -> head.row == 0
    "ArrowDown" -> head.row == end.row
    _ -> False
  }
  let edge = case
    plain && in_edge_row && drawn_in_page(control_id, live_class),
    name
  {
    False, _ -> Error(Nil)
    True, "Backspace" -> Ok(#(editor.JoinBefore, 0.0))
    True, "Delete" -> Ok(#(editor.JoinAfter, 0.0))
    True, "ArrowUp" ->
      case caret_line(control_id) {
        #(True, _, x) -> Ok(#(editor.Up, x))
        _ -> Error(Nil)
      }
    True, "ArrowDown" ->
      case caret_line(control_id) {
        #(_, True, x) -> Ok(#(editor.Down, x))
        _ -> Error(Nil)
      }
    True, _ -> Error(Nil)
  }
  case edge {
    Ok(#(edge, x)) ->
      on_event(editor.EdgePressed(edge:, x:, shown:))
      |> event.handler(prevent_default: True, stop_propagation: False)
      |> decode.success
    Error(Nil) ->
      on_event(editor.ControlChanged(shown:))
      |> event.handler(prevent_default: False, stop_propagation: False)
      |> decode.failure(expected: "a key at the edge of the field")
  }
}

fn escape_decoder(
  on_event: fn(editor.Event) -> msg,
) -> Decoder(event.Handler(msg)) {
  use name <- decode.field("key", decode.string)
  use composing <- decode.field("isComposing", decode.bool)
  use shown <- decode.then(shown_decoder())
  let handler =
    on_event(editor.EscapePressed(shown:))
    |> event.handler(prevent_default: False, stop_propagation: False)
  case name, composing {
    "Escape", False -> decode.success(handler)
    _, _ -> decode.failure(handler, expected: "Escape")
  }
}

fn parse_key(name: String, ctrl: Bool, ignore: Bool) -> Result(vim.Key, Nil) {
  case ignore, name, string.length(name) {
    True, _, _ -> Error(Nil)
    False, "Escape", _ -> Ok(vim.Escape)
    False, "Enter", _ -> Ok(vim.Enter)
    False, _, 1 if ctrl -> Ok(vim.Ctrl(name))
    False, _, 1 -> Ok(vim.Char(name))
    False, _, _ -> Error(Nil)
  }
}

fn mirror(editor: Editor) -> Element(msg) {
  let text = case editor.region(editor) {
    None -> ""
    // The zero-width space gives an empty last row its height.
    Some(_) -> buffer.text(editor.field_buffer(editor)) <> "\u{200b}"
  }
  html.pre([attribute.class("mirror"), attribute.aria_hidden(True)], [
    element.text(text),
  ])
}

@external(javascript, "./surface.ffi.mjs", "writeControl")
fn write_control(id: String, text: String, start: Int, end: Int) -> Nil

@external(javascript, "./surface.ffi.mjs", "textWidth")
fn text_width(text: String) -> Float

@external(javascript, "./surface.ffi.mjs", "focusControl")
fn focus_control(id: String) -> Nil

@external(javascript, "./surface.ffi.mjs", "blurControl")
fn blur_control(id: String) -> Nil

@external(javascript, "./surface.ffi.mjs", "drawnInPage")
fn drawn_in_page(id: String, live_class: String) -> Bool

@external(javascript, "./surface.ffi.mjs", "caretLine")
fn caret_line(id: String) -> #(Bool, Bool, Float)

@external(javascript, "./surface.ffi.mjs", "aimControl")
fn aim_control(
  id: String,
  text: String,
  start: Int,
  end: Int,
  x: Float,
  last_line: Bool,
) -> #(String, Int, Int)

@external(javascript, "./surface.ffi.mjs", "locate")
fn locate(press: Dynamic, row_mark: String) -> #(Int, String, Bool)

@external(javascript, "./surface.ffi.mjs", "utf16Split")
fn utf16_split(text: String, offset: Int) -> #(String, String)

@external(javascript, "./surface.ffi.mjs", "utf16Length")
fn utf16_length(text: String) -> Int
