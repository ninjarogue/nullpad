//// Imported by: the app shell only. Imports: `editor`, `buffer`, `live`,
//// `vim` (for `Key`), `markdown`.

import gleam/bool
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

const painted_class = "painted"

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
  // The browser moves the caret for these keys and says nothing, so the
  // editor reads it when the key is let go.
  let moved = {
    use name <- decode.field("key", decode.string)
    use composing <- decode.field("isComposing", decode.bool)
    case name {
      "ArrowUp"
        | "ArrowDown"
        | "ArrowLeft"
        | "ArrowRight"
        | "Home"
        | "End"
        | "PageUp"
        | "PageDown"
        if !composing
      -> changed
      _ -> decode.failure(on_event(editor.Released), expected: "a caret move")
    }
  }
  let focus_changed = fn(focused) {
    decode.success(on_event(editor.FocusChanged(focused:)))
  }
  let kind = editor.kind(editor)
  let drawn_whole = editor.is_idle(editor) || editor.is_painted(editor)
  let first_row = case editor.region(editor), drawn_whole {
    Some(live.Region(first_row:, ..)), False ->
      attribute.data(live.row_mark, int.to_string(first_row))
    Some(_), True | None, _ -> attribute.none()
  }
  html.div([attribute.class(classes(editor, kind)), marker(kind)], [
    mirror(editor),
    element.element(
      "textarea",
      [
        attribute.id(control_id),
        attribute.data("test-id", "editor"),
        first_row,
        attribute.aria_label("Note text"),
        attribute.readonly(editor.mode(editor) == editor.Normal),
        event.on("input", typed),
        event.on("compositionend", changed),
        event.on("select", changed),
        event.on("pointerup", changed),
        event.on("keyup", moved),
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
  case kind, editor.is_idle(editor), editor.is_painted(editor) {
    None, _, _ -> "editor"
    Some(_), True, _ -> "editor part idle"
    Some(_), False, True -> "editor part " <> painted_class
    Some(kind), False, False ->
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
    Some(_) -> [
      attribute.class("page " <> live_class),
      on_point(on_event),
      on_drag(on_event),
      event.on("mouseup", {
        use button <- decode.field("button", decode.int)
        case button {
          0 -> decode.success(on_event(editor.Released))
          _ ->
            decode.failure(
              on_event(editor.Released),
              expected: "the left button",
            )
        }
      }),
    ]
  }
}

fn on_point(on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {
  event.advanced("mousedown", {
    use shift <- decode.field("shiftKey", decode.bool)
    use press <- decode.then(decode.dynamic)
    let shown = decode.run(find_control(control_id), control_decoder())
    case locate(press, live.row_mark), shift, shown {
      #(row, visible, at_end), False, _ if row >= 0 ->
        on_event(editor.Pointed(row:, visible:, at_end:))
        |> event.handler(prevent_default: True, stop_propagation: False)
        |> decode.success
      #(row, visible, at_end), True, Ok(shown) if row >= 0 ->
        on_event(editor.ShiftPointed(row:, visible:, at_end:, shown:))
        |> event.handler(prevent_default: True, stop_propagation: False)
        |> decode.success
      // A press the browser keeps also ends a press the editor took, whose
      // release the page does not hear when it happens off the page.
      _, _, _ ->
        on_event(editor.Released)
        |> event.handler(prevent_default: False, stop_propagation: False)
        |> decode.success
    }
  })
}

fn on_drag(on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {
  event.on("mousemove", {
    use buttons <- decode.field("buttons", decode.int)
    use move <- decode.then(decode.dynamic)
    let place = case int.bitwise_and(buttons, 1) {
      1 -> locate(move, live.row_mark)
      _ -> #(-1, "", False)
    }
    case place {
      #(row, visible, at_end) if row >= 0 ->
        decode.success(on_event(editor.Dragged(row:, visible:, at_end:)))
      _ ->
        decode.failure(
          on_event(editor.Released),
          expected: "a move with the left button held",
        )
    }
  })
}

/// Brings the field and the page to what `editor` says, and paints its
/// selection when it is painted.
pub fn sync(
  editor: Editor,
  sync: editor.Sync,
  on_event: fn(editor.Event) -> msg,
) -> Effect(msg) {
  let write = fn(buffer) {
    let #(text, start, end, backward) = to_control(buffer)
    effect.from(fn(_) { write_control(control_id, text, start, end, backward) })
  }
  let painted = effect.before_paint(fn(_, _) { paint(editor) })
  case sync {
    editor.InSync -> painted
    editor.Write(buffer) -> effect.batch([write(buffer), focus(), painted])
    editor.WriteQuietly(buffer) -> effect.batch([write(buffer), painted])
    editor.WriteAndStep(buffer, x:, up:) ->
      effect.batch([
        write(buffer),
        effect.before_paint(fn(dispatch, _) {
          paint(editor)
          let place =
            step_head(
              control_id,
              live_class,
              live.row_mark,
              painted_class,
              x,
              up,
            )
          case place {
            #(row, visible, at_end) if row >= 0 ->
              dispatch(on_event(editor.Stepped(row:, visible:, at_end:, x:)))
            _ -> Nil
          }
        }),
      ])
    editor.WriteAndAim(buffer, x:, line:) ->
      effect.batch([
        write(buffer),
        effect.before_paint(fn(dispatch, _) {
          focus_control(control_id)
          let #(text, start, end, backward) = to_control(buffer)
          let #(text, start, end, backward) =
            aim_control(
              control_id,
              text,
              start,
              end,
              backward,
              x,
              line == editor.LastLine,
            )
          dispatch(
            on_event(
              editor.ControlChanged(from_control(text, start, end, backward)),
            ),
          )
        }),
        painted,
      ])
    // Blurred at once, because a key pressed before the next paint would
    // still be typed into the field, and again before that paint, after any
    // focus an earlier key asked for.
    editor.Release(buffer) ->
      effect.batch([
        write(buffer),
        effect.from(fn(_) { blur_control(control_id) }),
        effect.before_paint(fn(_, _) { blur_control(control_id) }),
        painted,
      ])
  }
}

/// The selection is painted from where each of its ends is drawn, and a
/// blank line counts as selected when its line break is.
fn paint(editor: Editor) -> Nil {
  case editor.is_painted(editor) {
    False -> clear_paint()
    True -> {
      let buffer = editor.buffer(editor)
      let lines = buffer.lines(buffer)
      let #(anchor, head) = buffer.selection(buffer)
      let place = fn(at: Position) {
        let #(row, visible) =
          holder_text(control_id, live_class, live.row_mark, at.row)
        #(row, utf16_length(live.drawn(lines, row:, visible:, at:)))
      }
      let #(start, end) = case
        anchor.row < head.row || anchor.row == head.row && anchor.col < head.col
      {
        True -> #(anchor, head)
        False -> #(head, anchor)
      }
      let first_blank = case start.col {
        0 -> start.row
        _ -> start.row + 1
      }
      let #(anchor_row, anchor_offset) = place(anchor)
      let #(head_row, head_offset) = place(head)
      paint_selection(
        control_id,
        live_class,
        live.row_mark,
        anchor_row,
        anchor_offset,
        head_row,
        head_offset,
        first_blank,
        end.row - 1,
      )
    }
  }
}

pub fn focus() -> Effect(msg) {
  // A pane that was hidden cannot take focus until the next render puts it
  // back on screen.
  effect.before_paint(fn(_, _) { focus_control(control_id) })
}

/// `selectionStart` and `selectionEnd` are UTF-16 offsets, and the head is
/// at the start of a selection made backwards.
fn from_control(text: String, start: Int, end: Int, backward: Bool) -> Buffer {
  let #(anchor, head) = case backward {
    True -> #(end, start)
    False -> #(start, end)
  }
  buffer.from_text(text)
  |> buffer.select(anchor: position(text, anchor), head: position(text, head))
}

fn position(text: String, offset: Int) -> Position {
  let #(before, _) = utf16_split(text, offset)
  buffer.end_of(before)
}

fn to_control(buffer: Buffer) -> #(String, Int, Int, Bool) {
  let #(anchor, head) = buffer.selection(buffer)
  let lines = buffer.lines(buffer)
  let anchor = offset(lines, anchor)
  let head = offset(lines, head)
  // The control always reports start <= end, whichever way it was selected.
  #(
    buffer.text(buffer),
    int.min(anchor, head),
    int.max(anchor, head),
    head < anchor,
  )
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
  decode.at(["target"], control_decoder())
}

fn control_decoder() -> Decoder(Buffer) {
  use text <- decode.field("value", decode.string)
  use start <- decode.field("selectionStart", decode.int)
  use end <- decode.field("selectionEnd", decode.int)
  use direction <- decode.field("selectionDirection", decode.string)
  decode.success(from_control(text, start, end, direction == "backward"))
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
  let start = buffer.Position(row: 0, col: 0)
  let end = buffer.end_of(buffer.text(shown))
  let alone = !{ alt || composing }
  let plain = alone && !{ shift || ctrl || meta } && anchor == head
  let shifted = alone && shift && !{ ctrl || meta }
  let command = alone && { ctrl || meta }
  let wanted = case name {
    "Backspace" if plain && head == start -> Ok(editor.JoinBefore)
    "Delete" if plain && head == end -> Ok(editor.JoinAfter)
    "ArrowUp" if plain && head.row == 0 -> Ok(editor.Up)
    "ArrowDown" if plain && head.row == end.row -> Ok(editor.Down)
    "ArrowUp" if shifted -> Ok(editor.SelectUp)
    "ArrowDown" if shifted -> Ok(editor.SelectDown)
    "ArrowLeft" if shifted && head == start -> Ok(editor.SelectBefore)
    "ArrowRight" if shifted && head == end -> Ok(editor.SelectAfter)
    "a" | "A" if command && !shift -> Ok(editor.SelectAll)
    "Home" if command && shift -> Ok(editor.SelectToStart)
    "End" if command && shift -> Ok(editor.SelectToEnd)
    "ArrowUp" if meta && shift && alone -> Ok(editor.SelectToStart)
    "ArrowDown" if meta && shift && alone -> Ok(editor.SelectToEnd)
    _ -> Error(Nil)
  }
  let edge = {
    use edge <- result.try(wanted)
    use <- bool.guard(!drawn_in_page(control_id, live_class), Error(Nil))
    case edge {
      editor.Up ->
        case caret_line(control_id) {
          #(True, _, x) -> Ok(#(edge, x))
          _ -> Error(Nil)
        }
      editor.Down ->
        case caret_line(control_id) {
          #(_, True, x) -> Ok(#(edge, x))
          _ -> Error(Nil)
        }
      editor.SelectUp ->
        case head_line(control_id, live_class, painted_class) {
          #(True, _, x) -> Ok(#(edge, x))
          _ -> Error(Nil)
        }
      editor.SelectDown ->
        case head_line(control_id, live_class, painted_class) {
          #(_, True, x) -> Ok(#(edge, x))
          _ -> Error(Nil)
        }
      editor.JoinBefore
      | editor.JoinAfter
      | editor.SelectBefore
      | editor.SelectAfter
      | editor.SelectToStart
      | editor.SelectToEnd
      | editor.SelectAll -> Ok(#(edge, 0.0))
    }
  }
  let pressed = case edge, name {
    Ok(#(edge, x)), _ -> Ok(editor.EdgePressed(edge:, x:, shown:))
    Error(Nil), "ArrowLeft" if shifted -> nudged(False, shown)
    Error(Nil), "ArrowRight" if shifted -> nudged(True, shown)
    Error(Nil), _ -> Error(Nil)
  }
  case pressed {
    Ok(pressed) ->
      on_event(pressed)
      |> event.handler(prevent_default: True, stop_propagation: False)
      |> decode.success
    Error(Nil) ->
      on_event(editor.ControlChanged(shown:))
      |> event.handler(prevent_default: False, stop_propagation: False)
      |> decode.failure(expected: "a key at the edge of the field")
  }
}

/// Shift and an arrow left or right over a painted selection go through
/// the editor, which knows what the page draws of the markdown.
fn nudged(forward: Bool, shown: Buffer) -> Result(editor.Event, Nil) {
  case painted_head(control_id, live.row_mark, painted_class) {
    #(row, visible) if row >= 0 ->
      Ok(editor.Nudged(forward:, row:, visible:, shown:))
    _ -> Error(Nil)
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
fn write_control(
  id: String,
  text: String,
  start: Int,
  end: Int,
  backward: Bool,
) -> Nil

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

@external(javascript, "./surface.ffi.mjs", "headLine")
fn head_line(
  id: String,
  live_class: String,
  painted_class: String,
) -> #(Bool, Bool, Float)

@external(javascript, "./surface.ffi.mjs", "stepHead")
fn step_head(
  id: String,
  live_class: String,
  row_mark: String,
  painted_class: String,
  x: Float,
  up: Bool,
) -> #(Int, String, Bool)

@external(javascript, "./surface.ffi.mjs", "paintedHead")
fn painted_head(
  id: String,
  row_mark: String,
  painted_class: String,
) -> #(Int, String)

@external(javascript, "./surface.ffi.mjs", "holderText")
fn holder_text(
  id: String,
  live_class: String,
  row_mark: String,
  row: Int,
) -> #(Int, String)

@external(javascript, "./surface.ffi.mjs", "paintSelection")
fn paint_selection(
  id: String,
  live_class: String,
  row_mark: String,
  anchor_row: Int,
  anchor_offset: Int,
  head_row: Int,
  head_offset: Int,
  first_blank: Int,
  last_blank: Int,
) -> Nil

@external(javascript, "./surface.ffi.mjs", "clearPaint")
fn clear_paint() -> Nil

@external(javascript, "./surface.ffi.mjs", "aimControl")
fn aim_control(
  id: String,
  text: String,
  start: Int,
  end: Int,
  backward: Bool,
  x: Float,
  last_line: Bool,
) -> #(String, Int, Int, Bool)

@external(javascript, "./surface.ffi.mjs", "findControl")
fn find_control(id: String) -> Dynamic

@external(javascript, "./surface.ffi.mjs", "locate")
fn locate(press: Dynamic, row_mark: String) -> #(Int, String, Bool)

@external(javascript, "./surface.ffi.mjs", "utf16Split")
fn utf16_split(text: String, offset: Int) -> #(String, String)

@external(javascript, "./surface.ffi.mjs", "utf16Length")
fn utf16_length(text: String) -> Int
