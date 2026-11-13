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
  let first_row = case editor.region(editor), editor.is_idle(editor) {
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
        // A touch sends `pointerup` before the mouse press that moves the
        // caret.
        event.advanced("mouseup", released_decoder(on_event)),
        event.on("keyup", moved),
        event.on("dragstart", decode.success(on_event(editor.DragStarted))),
        event.on("dragend", decode.success(on_event(editor.Released))),
        // The page cancels `dragover` to take drops beside the field, and a
        // cancelled one would stop the browser dropping on the field.
        event.advanced("dragover", refuse_file(on_event))
          |> event.stop_propagation,
        event.on("focus", focus_changed(True)),
        // Another window taking the focus blurs the field but leaves it
        // the page's active element, and the browser gives it the focus
        // back: the editor does not hear of it.
        event.on("blur", leave_decoder(on_event)),
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

/// The browser keeps a press on text the field has selected, so that a drag
/// can move it. Let go there, the browser puts the caret where it was let go
/// only after the release, with no event, so the editor puts it there.
fn released_decoder(
  on_event: fn(editor.Event) -> msg,
) -> Decoder(event.Handler(msg)) {
  use release <- decode.then(decode.dynamic)
  use shown <- decode.map(shown_decoder())
  case released_on_selection(release) {
    -1 ->
      on_event(editor.ControlChanged(shown:))
      |> event.handler(prevent_default: False, stop_propagation: False)
    offset ->
      on_event(
        editor.ControlChanged(shown: from_control(
          buffer.text(shown),
          offset,
          offset,
          False,
        )),
      )
      |> event.handler(prevent_default: True, stop_propagation: False)
  }
}

fn leave_decoder(on_event: fn(editor.Event) -> msg) -> Decoder(msg) {
  use _ <- decode.then(decode.dynamic)
  case holds_focus(control_id) {
    True ->
      decode.failure(
        on_event(editor.FocusChanged(focused: False)),
        expected: "a blur that leaves the field",
      )
    False -> decode.success(on_event(editor.FocusChanged(focused: False)))
  }
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
  case kind, editor.frame(editor), editor.is_idle(editor) {
    None, _, _ | _, None, _ -> "editor"
    Some(_), Some(_), True -> "editor part idle"
    Some(kind), Some(frame), False ->
      case rows_of(frame) == rows_of(kind) {
        True -> set_as(kind)
        False -> set_as(kind) <> " framed framed-" <> rows_of(frame)
      }
  }
}

/// What sets the height and margins of rows of a kind.
fn rows_of(kind: live.Kind) -> String {
  case kind {
    live.Body -> "body"
    live.Mono -> "mono"
    live.ListItem(task: False, ..) -> "item"
    live.ListItem(task: True, ..) -> "task"
    live.Title(markdown.H1) -> "h1"
    live.Title(markdown.H2) -> "h2"
    live.Title(markdown.H3) -> "h3"
    live.Title(markdown.H4) -> "h4"
    live.Title(markdown.H5) -> "h5"
    live.Title(markdown.H6) -> "h6"
  }
}

fn set_as(kind: live.Kind) -> String {
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

pub fn page(
  editor: Editor,
  on_event: fn(editor.Event) -> msg,
) -> List(attribute.Attribute(msg)) {
  case editor.region(editor) {
    None -> [attribute.class("page")]
    Some(_) -> [
      attribute.class("page " <> live_class),
      on_point(on_event),
      on_shift_click(on_event),
      // A drop is only allowed where `dragover` is cancelled.
      event.on("dragover", decode.failure(on_event(editor.Released), "none"))
        |> event.prevent_default,
      on_drop(on_event),
    ]
  }
}

/// Shift and a press on a link or a box select to it, so its click neither
/// follows the link nor ticks the box.
fn on_shift_click(
  on_event: fn(editor.Event) -> msg,
) -> attribute.Attribute(msg) {
  event.advanced("click", {
    use shift <- decode.field("shiftKey", decode.bool)
    let handler =
      on_event(editor.Released)
      |> event.handler(prevent_default: True, stop_propagation: False)
    case shift {
      True -> decode.success(handler)
      False -> decode.failure(handler, expected: "a click with Shift")
    }
  })
}

/// A file dragged in with no text. Dropped where nothing refuses it, the
/// browser opens it in place of the app.
fn refuse_file(
  on_event: fn(editor.Event) -> msg,
) -> Decoder(event.Handler(msg)) {
  use types <- decode.then(decode.optionally_at(
    ["dataTransfer", "types"],
    [],
    decode.list(decode.string),
  ))
  let handler =
    on_event(editor.Released)
    |> event.handler(prevent_default: True, stop_propagation: False)
  case list.contains(types, "Files") && !list.contains(types, "text/plain") {
    True -> decode.success(handler)
    False -> decode.failure(handler, expected: "a file with no text")
  }
}

/// Text dropped on the page beside the field. The browser drops what lands
/// on the field itself.
fn on_drop(on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {
  let text = {
    use drop <- decode.then(decode.dynamic)
    let shown = decode.run(find_control(control_id), control_decoder())
    case dropped(drop, live.row_mark), shown {
      #(row, visible, at_end, next, text, copy), Ok(shown) if row >= 0 ->
        on_event(editor.Dropped(
          row:,
          visible:,
          at_end:,
          next:,
          text:,
          copy:,
          shown:,
        ))
        |> event.handler(prevent_default: True, stop_propagation: False)
        |> decode.success
      _, _ ->
        on_event(editor.Released)
        |> event.handler(prevent_default: False, stop_propagation: False)
        |> decode.failure(expected: "text dropped beside the field")
    }
  }
  event.advanced("drop", decode.one_of(text, [refuse_file(on_event)]))
}

fn on_point(on_event: fn(editor.Event) -> msg) -> attribute.Attribute(msg) {
  event.advanced("mousedown", {
    use shift <- decode.field("shiftKey", decode.bool)
    use button <- decode.field("button", decode.int)
    use clicks <- decode.field("detail", decode.int)
    use target <- decode.then(decode.optionally_at(
      ["target", "id"],
      "",
      decode.string,
    ))
    use x <- decode.field("clientX", decode.float)
    use y <- decode.field("clientY", decode.float)
    use press <- decode.then(decode.dynamic)
    let shown = decode.run(find_control(control_id), control_decoder())
    let taken = fn(event) {
      on_event(event)
      |> event.handler(prevent_default: True, stop_propagation: False)
      |> decode.success
    }
    case locate(press, live.row_mark), shift, shown {
      #(row, visible, at_end, next, True), False, _ if row >= 0 ->
        taken(editor.Grabbed(row:, visible:, at_end:, next:, x:, y:))
      #(row, visible, at_end, next, False), False, _
        if row >= 0 && clicks == 2
      -> taken(editor.WordPointed(row:, visible:, at_end:, next:, x:, y:))
      #(row, visible, at_end, next, False), False, _ if row >= 0 && clicks > 2 ->
        taken(editor.LinePointed(row:, visible:, at_end:, next:, x:, y:))
      #(row, visible, at_end, next, False), False, _ if row >= 0 ->
        taken(editor.Pointed(row:, visible:, at_end:, next:, x:, y:))
      #(row, visible, at_end, next, _), True, Ok(shown) if row >= 0 ->
        taken(editor.ShiftPointed(
          row:,
          visible:,
          at_end:,
          next:,
          shown:,
          x:,
          y:,
        ))
      // A press the browser keeps also ends a press the editor took, whose
      // release the page does not hear when it happens off the page. A
      // press of another button would take the focus to the page, but
      // still opens its menu.
      _, _, _ ->
        on_event(editor.Released)
        |> event.handler(
          prevent_default: button != 0 && target != control_id,
          stop_propagation: False,
        )
        |> decode.success
    }
  })
}

pub fn sync(
  sync: editor.Sync,
  on_event: fn(editor.Event) -> msg,
) -> Effect(msg) {
  let write = fn(buffer) {
    let #(text, start, end, backward) = to_control(buffer)
    effect.from(fn(_) { write_control(control_id, text, start, end, backward) })
  }
  case sync {
    editor.InSync -> effect.none()
    editor.Write(buffer) -> effect.batch([write(buffer), focus()])
    editor.WriteQuietly(buffer) -> write(buffer)
    // Aimed at once, with the field set as it is, so that a key pressed
    // before the next paint lands where the arrow went, and again before
    // that paint, once the field is set for the rows it holds, unless a key
    // has moved the caret since.
    editor.WriteAndAim(buffer, x:, line:) -> {
      let aim = fn(dispatch, again) {
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
            again,
          )
        dispatch(
          on_event(
            editor.ControlChanged(from_control(text, start, end, backward)),
          ),
        )
      }
      effect.batch([
        write(buffer),
        effect.from(fn(dispatch) { aim(dispatch, False) }),
        effect.before_paint(fn(dispatch, _) {
          aim(dispatch, True)
          focus_control(control_id, live_class)
        }),
      ])
    }
    // Blurred at once, because a key pressed before the next paint would
    // still be typed into the field, and again before that paint, after any
    // focus an earlier key asked for.
    editor.Release(buffer) ->
      effect.batch([
        write(buffer),
        effect.from(fn(_) { blur_control(control_id) }),
        effect.before_paint(fn(_, _) { blur_control(control_id) }),
      ])
    editor.Press(write: written, x:, y:) -> {
      let placed = case written {
        Some(buffer) -> {
          let #(text, start, end, backward) = to_control(buffer)
          effect.batch([
            effect.from(fn(_) {
              write_control(control_id, text, start, end, backward)
              place_caret(control_id, x, y)
              hold_page(control_id, live_class)
            }),
            effect.before_paint(fn(_, _) { focus_in_place(control_id) }),
          ])
        }
        None -> effect.none()
      }
      let followed =
        effect.from(fn(dispatch) {
          follow(
            control_id,
            live_class,
            live.row_mark,
            x,
            y,
            drag_distance,
            fn(row, visible, at_end, next) {
              dispatch(on_event(editor.Dragged(row:, visible:, at_end:, next:)))
            },
            fn() { dispatch(on_event(editor.Released)) },
          )
        })
      effect.batch([placed, followed])
    }
  }
}

/// How far the pointer of a press moves across or down, more than which it
/// drags, in pixels.
const drag_distance = 4.0

pub fn focus() -> Effect(msg) {
  // A pane that was hidden cannot take focus until the next render puts it
  // back on screen.
  effect.before_paint(fn(_, _) { focus_control(control_id, live_class) })
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
  use code <- decode.field("code", decode.string)
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
  let bare = alone && !{ shift || ctrl || meta }
  let plain = bare && anchor == head
  let shifted = alone && shift && !{ ctrl || meta }
  let command = alone && { ctrl || meta }
  let select_all = is_key(name, code, "a")
  let wanted = case name {
    "Backspace" if plain && head == start -> Ok(editor.JoinBefore)
    "Delete" if plain && head == end -> Ok(editor.JoinAfter)
    "ArrowUp" if bare && head.row == 0 -> Ok(editor.Up)
    "ArrowDown" if bare && head.row == end.row -> Ok(editor.Down)
    "ArrowUp" if shifted && head.row == 0 -> Ok(editor.SelectUp)
    "ArrowDown" if shifted && head.row == end.row -> Ok(editor.SelectDown)
    "ArrowLeft" if shifted && head == start -> Ok(editor.SelectBefore)
    "ArrowRight" if shifted && head == end -> Ok(editor.SelectAfter)
    _ if command && !shift && select_all -> Ok(editor.SelectAll)
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
      editor.Up | editor.SelectUp ->
        case caret_line(control_id) {
          #(True, _, x) -> Ok(#(edge, x))
          _ -> Error(Nil)
        }
      editor.Down | editor.SelectDown ->
        case caret_line(control_id) {
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

/// A shortcut letter on a keyboard laid out for another alphabet is named
/// by where the key sits.
fn is_key(name: String, code: String, letter: String) -> Bool {
  let typed = string.lowercase(name)
  let latin = string.length(typed) == 1 && string.contains(letters, typed)
  typed == letter || { !latin && code == "Key" <> string.uppercase(letter) }
}

const letters = "abcdefghijklmnopqrstuvwxyz"

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
fn focus_control(id: String, live_class: String) -> Nil

@external(javascript, "./surface.ffi.mjs", "blurControl")
fn blur_control(id: String) -> Nil

@external(javascript, "./surface.ffi.mjs", "holdsFocus")
fn holds_focus(id: String) -> Bool

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
  backward: Bool,
  x: Float,
  last_line: Bool,
  again: Bool,
) -> #(String, Int, Int, Bool)

@external(javascript, "./surface.ffi.mjs", "findControl")
fn find_control(id: String) -> Dynamic

@external(javascript, "./surface.ffi.mjs", "locate")
fn locate(
  press: Dynamic,
  row_mark: String,
) -> #(Int, String, Bool, String, Bool)

@external(javascript, "./surface.ffi.mjs", "dropped")
fn dropped(
  drop: Dynamic,
  row_mark: String,
) -> #(Int, String, Bool, String, String, Bool)

@external(javascript, "./surface.ffi.mjs", "releasedOnSelection")
fn released_on_selection(release: Dynamic) -> Int

@external(javascript, "./surface.ffi.mjs", "placeCaret")
fn place_caret(id: String, x: Float, y: Float) -> Nil

@external(javascript, "./surface.ffi.mjs", "holdPage")
fn hold_page(id: String, live_class: String) -> Nil

@external(javascript, "./surface.ffi.mjs", "focusInPlace")
fn focus_in_place(id: String) -> Nil

@external(javascript, "./surface.ffi.mjs", "follow")
fn follow(
  id: String,
  live_class: String,
  row_mark: String,
  x: Float,
  y: Float,
  distance: Float,
  moved: fn(Int, String, Bool, String) -> Nil,
  released: fn() -> Nil,
) -> Nil

@external(javascript, "./surface.ffi.mjs", "utf16Split")
fn utf16_split(text: String, offset: Int) -> #(String, String)

@external(javascript, "./surface.ffi.mjs", "utf16Length")
fn utf16_length(text: String) -> Int
