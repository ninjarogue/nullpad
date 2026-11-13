//// Stable test ids (`data-test-id`), for the browser tests in `e2e/`:
////   editor            the text field               (set in `surface`)
////   preview           the whole note drawn, while nothing is being edited
////   mode              "NORMAL" / "INSERT" (only while vim is on)
////   toggle-markdown   the Markdown button
////   toggle-vim        the vim switch (only when `can_vim`)
////   live-above        the note drawn above the text field
////   live-below        the note drawn below it
////   new-note          the new note button
////   note-list         the list; each row is  note-<storage.id_text(id)>
////   title             the title field
////   save-state        "Saved" / "Saving…" / "Unsaved"
////   row-actions       the ⋯ on the open note's row; opens the note menu
////   note-menu         the menu, also opened by a right-click on any row
////   delete-note       Delete in the menu
////   undo-toast        "Deleted …" for a few seconds; undo-delete undoes it
////   problem           the storage error banner

import gleam/dynamic/decode
import gleam/float
import gleam/list
import gleam/option.{type Option, None, Some}
import lustre/attribute
import lustre/effect.{type Effect}
import lustre/element.{type Element}
import lustre/element/html
import lustre/element/keyed
import lustre/event
import nullpad/editor.{type Editor, type Outcome, Outcome}
import nullpad/library.{type Library}
import nullpad/markdown
import nullpad/platform
import nullpad/preview
import nullpad/storage.{type Failure, type NoteId, type Storage, type Summary}
import nullpad/surface
import nullpad/vim

const delete_id = "nullpad-delete-note"

pub type Flags {
  Flags(
    storage: Storage,
    vim: Bool,
    can_vim: Bool,
    markdown: Bool,
    can_paint: Bool,
  )
}

pub type Model {
  Model(
    storage: Storage,
    library: Library,
    editor: Editor,
    showing: Showing,
    vim: Bool,
    can_vim: Bool,
    menu: Option(Menu),
  )
}

pub type Menu {
  Menu(id: NoteId, x: Float, y: Float)
}

pub type Showing {
  Page
  Markdown
}

pub type Msg {
  EditorSent(editor.Event)
  ToLibrary(library.Event)
  UserOpenedMenu(Menu)
  UserClosedMenu
  UserDeletedNote(NoteId)
  UserToggledMarkdown
  UserToggledVim(on: Bool)
  UserTickedTask(task: markdown.Task, checked: Bool)
}

pub fn init(flags: Flags) -> #(Model, Effect(Msg)) {
  let Flags(storage:, vim:, can_vim:, markdown:, can_paint:) = flags
  let #(started, listing) = library.start()
  let model =
    Model(
      storage:,
      library: started,
      editor: editor.new(vim: vim && can_vim, live: !markdown, paint: can_paint),
      showing: case markdown {
        True -> Markdown
        False -> Page
      },
      vim:,
      can_vim:,
      menu: None,
    )
  let #(model, listed) = obey(model, listing)
  let start =
    effect.batch([
      listed,
      platform.on_shortcut("e", UserToggledMarkdown),
      platform.on_hide(ToLibrary(library.SaveDue)),
    ])
  #(model, start)
}

pub fn update(model: Model, msg: Msg) -> #(Model, Effect(Msg)) {
  case msg {
    EditorSent(event) -> apply(model, editor.update(model.editor, event))
    UserTickedTask(task:, checked:) ->
      case markdown.set_task(editor.text(model.editor), task, checked) {
        Ok(line) ->
          apply(model, editor.replace_line(model.editor, task.row, with: line))
        Error(Nil) -> #(model, effect.none())
      }

    ToLibrary(event) -> tell_library(model, event)

    UserOpenedMenu(menu) -> #(
      Model(..model, menu: Some(menu)),
      platform.focus(delete_id),
    )
    UserClosedMenu -> #(Model(..model, menu: None), effect.none())
    UserDeletedNote(id) ->
      tell_library(Model(..model, menu: None), library.UserDeletedNote(id))

    UserToggledMarkdown -> {
      let showing = case model.showing {
        Page -> Markdown
        Markdown -> Page
      }
      let #(model, synced) =
        Model(..model, showing:)
        |> apply(editor.set_live(model.editor, showing == Page))
      let remembered = platform.remember_markdown_setting(showing == Markdown)
      #(model, effect.batch([synced, remembered]))
    }

    UserToggledVim(on) -> {
      let #(model, synced) =
        Model(..model, vim: on)
        |> apply(editor.set_vim(model.editor, on && model.can_vim))
      #(model, effect.batch([synced, platform.remember_vim_setting(on)]))
    }
  }
}

fn apply(model: Model, outcome: Outcome) -> #(Model, Effect(Msg)) {
  let Outcome(editor:, sync:, requests:) = outcome
  let text_changed = editor.text(editor) != editor.text(model.editor)
  let model = Model(..model, editor:)
  let #(model, autosave) = case text_changed {
    True -> tell_library(model, library.TextEdited)
    False -> #(model, effect.none())
  }
  let #(model, asked) = {
    use #(model, effects), request <- list.fold(requests, #(model, []))
    let #(model, effect) = perform(model, request)
    #(model, [effect, ..effects])
  }
  #(
    model,
    effect.batch([surface.sync(editor, sync, EditorSent), autosave, ..asked]),
  )
}

fn perform(model: Model, request: vim.Request) -> #(Model, Effect(Msg)) {
  case request {
    vim.SaveNow -> tell_library(model, library.SaveDue)
    vim.CopyToClipboard(text) -> #(model, platform.copy(text))
  }
}

fn tell_library(model: Model, event: library.Event) -> #(Model, Effect(Msg)) {
  let #(told, commands) =
    library.update(model.library, event, editor.text(model.editor))
  obey(Model(..model, library: told), commands)
}

fn obey(
  model: Model,
  commands: List(library.Command),
) -> #(Model, Effect(Msg)) {
  let #(model, effects) = list.map_fold(commands, model, run)
  #(model, effect.batch(effects))
}

fn run(model: Model, command: library.Command) -> #(Model, Effect(Msg)) {
  case command {
    library.ListNotes -> #(
      model,
      storage.list(model.storage, answer(library.StorageListed)),
    )
    library.LoadNote(id) -> #(
      model,
      storage.load(model.storage, id, answer(library.StorageLoaded)),
    )
    library.LoadDoomedNote(id) -> #(
      model,
      storage.load(model.storage, id, answer(library.StorageFoundDoomed)),
    )
    library.CreateNote -> #(
      model,
      storage.create(model.storage, answer(library.StorageCreated)),
    )
    library.SaveNote(note:, edits:) -> #(
      model,
      storage.save(
        model.storage,
        note,
        answer(library.StorageSaved(note.id, edits, _)),
      ),
    )
    library.DeleteNote(note) -> #(
      model,
      storage.delete(
        model.storage,
        note.id,
        answer(library.StorageDeleted(note, _)),
      ),
    )
    library.RestoreNote(note:, was_open:) -> #(
      model,
      storage.save(
        model.storage,
        note,
        answer(library.StorageRestored(note, was_open, _)),
      ),
    )
    library.After(ms:, event:) -> #(model, platform.after(ms, ToLibrary(event)))
    library.OpenInEditor(text) -> {
      let Outcome(editor:, sync:, ..) = editor.open(model.editor, text)
      #(Model(..model, editor:), surface.sync(editor, sync, EditorSent))
    }
  }
}

fn answer(event: fn(result) -> library.Event) -> fn(result) -> Msg {
  fn(result) { ToLibrary(event(result)) }
}

fn describe(failure: Failure) -> String {
  case failure {
    storage.NotFound -> "That note is no longer in storage."
    storage.Unavailable(detail) -> "Storage is not working: " <> detail
  }
}

pub fn view(model: Model) -> Element(Msg) {
  html.main([attribute.class("app")], [
    sidebar(model),
    html.section([attribute.class("note")], [
      toolbar(model),
      case library.problem(model.library) {
        Some(problem) ->
          html.p(
            [
              attribute.class("problem"),
              attribute.role("alert"),
              attribute.data("test-id", "problem"),
            ],
            [element.text(describe(problem))],
          )
        None -> element.none()
      },
      page(model),
    ]),
    note_menu(model),
    undo_toast(model),
  ])
}

fn page(model: Model) -> Element(Msg) {
  let field = #("field", surface.view(model.editor, EditorSent))
  case editor.region(model.editor) {
    None -> keyed.div(surface.page(model.editor, EditorSent), [field])
    Some(region) -> {
      let row_count = editor.row_count(model.editor)
      let blocks = editor.blocks(model.editor)
      let part = fn(rows, first_row, test_id) {
        preview.part(
          blocks,
          rows:,
          first_row:,
          test_id:,
          on_task: UserTickedTask,
        )
      }
      let #(above, below) = case
        editor.is_idle(model.editor),
        editor.is_painted(model.editor)
      {
        True, _ -> #(
          part(row_count, 0, "preview"),
          part(0, row_count, "live-below"),
        )
        False, True -> #(
          part(row_count, 0, "live-above"),
          part(0, row_count, "live-below"),
        )
        False, False -> {
          let after = region.last_row + 1
          #(
            part(region.first_row, 0, "live-above"),
            part(row_count - after, after, "live-below"),
          )
        }
      }
      keyed.div(surface.page(model.editor, EditorSent), [
        #("above", above),
        field,
        #("below", below),
      ])
    }
  }
}

fn sidebar(model: Model) -> Element(Msg) {
  html.nav([attribute.class("sidebar"), attribute.aria_label("Notes")], [
    html.button(
      [
        attribute.class("new-note"),
        attribute.data("test-id", "new-note"),
        event.on_click(ToLibrary(library.UserAskedForNewNote)),
      ],
      [element.text("New note")],
    ),
    keyed.ul(
      [attribute.class("note-list"), attribute.data("test-id", "note-list")],
      list.map(library.notes(model.library), fn(summary) {
        let key = storage.id_text(summary.id)
        let row = case library.is_open(model.library, summary.id) {
          True -> [note_row(model, summary), more_button(model, summary.id)]
          False -> [note_row(model, summary)]
        }
        #(key, html.li([], row))
      }),
    ),
  ])
}

fn note_row(model: Model, summary: Summary) -> Element(Msg) {
  let #(title, current) = case library.open(model.library) {
    Some(open) if open.id == summary.id -> #(
      storage.display_title(open.title, editor.text(model.editor)),
      "true",
    )
    _ -> #(summary.title, "false")
  }
  html.button(
    [
      attribute.data("test-id", "note-" <> storage.id_text(summary.id)),
      attribute.aria_current(current),
      event.on_click(ToLibrary(library.UserPickedNote(summary.id))),
      // The text field keeps the focus, so that keys typed while the note
      // loads are typed into a note and not lost on the button.
      event.prevent_default(event.on(
        "mousedown",
        decode.failure(UserClosedMenu, expected: ""),
      )),
      // A right-click, a long press where the browser makes it one, and the
      // keyboard's menu key.
      event.advanced("contextmenu", {
        use x <- decode.field("clientX", decode.float)
        use y <- decode.field("clientY", decode.float)
        UserOpenedMenu(Menu(id: summary.id, x:, y:))
        |> event.handler(prevent_default: True, stop_propagation: False)
        |> decode.success
      }),
      event.on("keydown", {
        use key <- decode.field("key", decode.string)
        case key {
          "Delete" | "Backspace" -> decode.success(UserDeletedNote(summary.id))
          _ -> decode.failure(UserClosedMenu, expected: "the Delete key")
        }
      }),
    ],
    [element.text(title)],
  )
}

fn toolbar(model: Model) -> Element(Msg) {
  html.header([attribute.class("toolbar")], case library.open(model.library) {
    None -> [toggles(model)]
    Some(open) -> [
      html.input([
        attribute.class("title"),
        attribute.data("test-id", "title"),
        attribute.type_("text"),
        attribute.aria_label("Title"),
        attribute.autocomplete("off"),
        attribute.placeholder(storage.display_title(
          None,
          editor.text(model.editor),
        )),
        attribute.value(option.unwrap(open.title, "")),
        event.on_input(fn(title) { ToLibrary(library.UserRenamedNote(title)) }),
      ]),
      html.span(
        [
          attribute.class("save-state"),
          attribute.data("test-id", "save-state"),
          attribute.role("status"),
        ],
        [element.text(save_state_label(open.save_state))],
      ),
      toggles(model),
    ]
  })
}

fn save_state_label(save_state: library.SaveState) -> String {
  case save_state {
    library.Saved -> "Saved"
    library.Saving -> "Saving…"
    library.Unsaved -> "Unsaved"
  }
}

fn toggles(model: Model) -> Element(Msg) {
  element.fragment([
    case editor.mode(model.editor) {
      editor.Plain -> element.none()
      editor.Normal -> mode_label("NORMAL")
      editor.Insert -> mode_label("INSERT")
    },
    html.button(
      [
        attribute.data("test-id", "toggle-markdown"),
        attribute.title("Show the note as markdown (Ctrl+E)"),
        attribute.aria_pressed(case model.showing {
          Page -> "false"
          Markdown -> "true"
        }),
        event.on_click(UserToggledMarkdown),
      ],
      [element.text("Markdown")],
    ),
    case model.can_vim {
      True ->
        html.label([attribute.class("vim-switch")], [
          html.input([
            attribute.data("test-id", "toggle-vim"),
            attribute.type_("checkbox"),
            attribute.checked(model.vim),
            event.on_check(UserToggledVim),
          ]),
          element.text("Vim"),
        ])
      False -> element.none()
    },
  ])
}

fn mode_label(mode: String) -> Element(Msg) {
  html.span([attribute.class("mode"), attribute.data("test-id", "mode")], [
    element.text(mode),
  ])
}

fn more_button(model: Model, id: NoteId) -> Element(Msg) {
  html.button(
    [
      attribute.class("more"),
      attribute.data("test-id", "row-actions"),
      attribute.aria_label("Note actions"),
      attribute.aria_haspopup("menu"),
      attribute.aria_expanded(model.menu != None),
      attribute.disabled(library.deleting(model.library) == Some(id)),
      event.on("click", {
        use press <- decode.then(decode.dynamic)
        let #(x, y) = platform.below(press)
        decode.success(UserOpenedMenu(Menu(id:, x:, y:)))
      }),
    ],
    [element.text("⋯")],
  )
}

fn note_menu(model: Model) -> Element(Msg) {
  case model.menu {
    None -> element.none()
    Some(Menu(id:, x:, y:)) ->
      html.div(
        [
          attribute.class("menu-backdrop"),
          event.on_click(UserClosedMenu),
          event.advanced(
            "contextmenu",
            UserClosedMenu
              |> event.handler(prevent_default: True, stop_propagation: False)
              |> decode.success,
          ),
          event.on("keydown", {
            use key <- decode.field("key", decode.string)
            case key {
              "Escape" -> decode.success(UserClosedMenu)
              _ -> decode.failure(UserClosedMenu, expected: "Escape")
            }
          }),
        ],
        [
          html.div(
            [
              attribute.class("menu"),
              attribute.role("menu"),
              attribute.data("test-id", "note-menu"),
              attribute.style("--x", float.to_string(x) <> "px"),
              attribute.style("--y", float.to_string(y) <> "px"),
            ],
            [
              html.button(
                [
                  attribute.class("danger"),
                  attribute.role("menuitem"),
                  attribute.id(delete_id),
                  attribute.data("test-id", "delete-note"),
                  event.on_click(UserDeletedNote(id)),
                ],
                [element.text("Delete")],
              ),
            ],
          ),
        ],
      )
  }
}

fn undo_toast(model: Model) -> Element(Msg) {
  case library.undoable(model.library) {
    None -> element.none()
    Some(note) ->
      html.div(
        [
          attribute.class("toast"),
          attribute.aria_live("polite"),
          attribute.data("test-id", "undo-toast"),
        ],
        [
          html.span([], [
            element.text(
              "Deleted “" <> storage.display_title(note.title, note.body) <> "”",
            ),
          ]),
          html.button(
            [
              attribute.data("test-id", "undo-delete"),
              event.on_click(ToLibrary(library.UserUndidDelete)),
            ],
            [element.text("Undo")],
          ),
        ],
      )
  }
}
