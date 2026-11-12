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
import nullpad/markdown
import nullpad/platform
import nullpad/preview
import nullpad/storage.{
  type Failure, type Note, type NoteId, type Storage, type Summary, Note,
}
import nullpad/surface
import nullpad/vim

/// How long after the last edit the note is saved.
const autosave_ms = 800

const retry_save_ms = 5000

/// How long a deleted note can be brought back.
const undo_ms = 5000

/// What `main` hands to `init`.
pub type Flags {
  Flags(
    storage: Storage,
    /// The remembered vim switch. Off for a new user.
    vim: Bool,
    /// False on phones: the vim switch is not offered at all.
    can_vim: Bool,
    /// The remembered Markdown button. Off for a new user.
    markdown: Bool,
  )
}

pub type Model {
  Model(
    storage: Storage,
    notes: List(Summary),
    /// The note the editor's text belongs to.
    open: Option(Open),
    /// The text lives here and nowhere else in the model.
    editor: Editor,
    edits: Int,
    leaving_for: Option(Destination),
    showing: Showing,
    vim: Bool,
    can_vim: Bool,
    /// The note menu, when it is open.
    menu: Option(Menu),
    deletion: Deletion,
    /// The note deleted last, while it can still be brought back.
    undo: Option(Undo),
    /// Counts deletes, so an old timer cannot clear a newer undo.
    deletes: Int,
    /// Last storage failure, shown in a banner.
    problem: Option(Failure),
  )
}

/// Set only when a load finishes, so text is never saved under another
/// note's id.
pub type Open {
  Open(
    id: NoteId,
    /// The title the user typed. `None` means "derive it from the text".
    title: Option(String),
    save_state: SaveState,
  )
}

pub type Destination {
  ExistingNote(NoteId)
  NewNote
}

pub type SaveState {
  Unsaved
  Saving
  Saved
}

/// A note's menu and where it is drawn, in pixels from the window's corner.
pub type Menu {
  Menu(id: NoteId, x: Float, y: Float)
}

/// Any note in the list can be deleted, open or not, one at a time.
pub type Deletion {
  NotDeleting
  /// Storage has the request. If it is for the open note, nothing is saved
  /// until storage answers, or the save would bring the note back.
  Deleting(NoteId)
}

/// A delete is not asked about. It can be undone for a few seconds instead.
pub type Undo {
  Undo(note: Note, was_open: Bool)
}

pub type Showing {
  /// The note is drawn as a page, and the text field holds only the block
  /// being edited.
  Page
  /// The text field holds the whole note as typed.
  Markdown
}

pub type Msg {
  EditorSent(editor.Event)
  AutosaveDue(edits: Int)
  PageHidden
  StorageListed(Result(List(Summary), Failure))
  StorageLoaded(Result(Note, Failure))
  StorageCreated(Result(Note, Failure))
  StorageSaved(id: NoteId, edits: Int, result: Result(Nil, Failure))
  /// The body of a note that is not open, read so its delete can be undone.
  StorageFoundDoomed(Result(Note, Failure))
  StorageDeleted(note: Note, result: Result(Nil, Failure))
  StorageRestored(note: Note, was_open: Bool, result: Result(Nil, Failure))
  UndoExpired(deletes: Int)
  UserPickedNote(NoteId)
  UserAskedForNewNote
  UserOpenedMenu(Menu)
  UserClosedMenu
  UserDeletedNote(NoteId)
  UserUndidDelete
  UserRenamedNote(title: String)
  UserToggledMarkdown
  UserToggledVim(on: Bool)
  UserTickedTask(task: markdown.Task, checked: Bool)
}

pub fn init(flags: Flags) -> #(Model, Effect(Msg)) {
  let Flags(storage:, vim:, can_vim:, markdown:) = flags
  let model =
    Model(
      storage:,
      notes: [],
      open: None,
      editor: editor.set_live(editor.new(vim: vim && can_vim), !markdown).editor,
      edits: 0,
      leaving_for: None,
      showing: case markdown {
        True -> Markdown
        False -> Page
      },
      vim:,
      can_vim:,
      menu: None,
      deletion: NotDeleting,
      undo: None,
      deletes: 0,
      problem: None,
    )
  let start =
    effect.batch([
      list_notes(model),
      // Ctrl+E (Cmd+E on a Mac) flips between the page and its markdown.
      platform.on_shortcut("e", UserToggledMarkdown),
      platform.on_hide(PageHidden),
    ])
  #(model, start)
}

pub fn update(model: Model, msg: Msg) -> #(Model, Effect(Msg)) {
  case msg, model.open {
    // The editing loop: everything that can change the text ends in `apply`.
    EditorSent(event), _ -> apply(model, editor.update(model.editor, event))
    UserTickedTask(task:, checked:), _ ->
      case markdown.set_task(editor.text(model.editor), task, checked) {
        Ok(line) ->
          apply(model, editor.replace_line(model.editor, task.row, with: line))
        Error(Nil) -> #(model, effect.none())
      }

    UserRenamedNote(title), Some(open) -> {
      let title = case title {
        "" -> None
        _ -> Some(title)
      }
      let model = count_edit(Model(..model, open: Some(Open(..open, title:))))
      #(model, start_autosave_timer(model))
    }
    UserRenamedNote(_), None -> #(model, effect.none())

    AutosaveDue(edits), _ if edits == model.edits -> save(model)
    AutosaveDue(_), _ -> #(model, effect.none())
    PageHidden, _ -> save(model)

    StorageSaved(id:, edits:, result: Ok(_)), _ -> {
      let model = case is_awaited_answer(model, id, edits) {
        True -> with_save_state(model, Saved)
        False -> model
      }
      let #(model, left) = leave_when_saved(Model(..model, problem: None))
      #(model, effect.batch([left, list_notes(model)]))
    }
    StorageSaved(id:, edits:, result: Error(failure)), _ -> {
      let model = Model(..model, problem: Some(failure))
      case is_awaited_answer(model, id, edits) {
        True -> #(
          Model(..with_save_state(model, Unsaved), leaving_for: None),
          platform.after(retry_save_ms, AutosaveDue(model.edits)),
        )
        False -> #(model, effect.none())
      }
    }

    StorageListed(Ok(notes)), _ -> {
      let model = Model(..model, notes:)
      #(model, keep_a_note_open(model))
    }

    StorageLoaded(Ok(note)), _ -> open_when_saved(model, note)
    StorageCreated(Ok(note)), _ -> {
      let #(model, opened) = open_when_saved(model, note)
      #(model, effect.batch([opened, list_notes(model)]))
    }

    UserPickedNote(id), Some(open) if id == open.id -> #(
      Model(..model, leaving_for: None),
      effect.none(),
    )
    UserPickedNote(id), _ ->
      leave_when_saved(Model(..model, leaving_for: Some(ExistingNote(id))))

    UserAskedForNewNote, _ ->
      leave_when_saved(Model(..model, leaving_for: Some(NewNote)))

    UserOpenedMenu(menu), _ -> #(
      Model(..model, menu: Some(menu)),
      platform.focus("delete-note"),
    )
    UserClosedMenu, _ -> #(Model(..model, menu: None), effect.none())

    UserDeletedNote(_), _ if model.deletion != NotDeleting -> #(
      Model(..model, menu: None),
      effect.none(),
    )
    UserDeletedNote(id), Some(open) if open.id == id -> {
      let note = Note(id:, title: open.title, body: editor.text(model.editor))
      #(
        Model(..model, menu: None, deletion: Deleting(id), leaving_for: None),
        storage.delete(model.storage, id, StorageDeleted(note, _)),
      )
    }
    UserDeletedNote(id), _ -> #(
      Model(..model, menu: None, deletion: Deleting(id)),
      storage.load(model.storage, id, StorageFoundDoomed),
    )
    StorageFoundDoomed(Ok(note)), _ -> #(
      model,
      storage.delete(model.storage, note.id, StorageDeleted(note, _)),
    )
    StorageFoundDoomed(Error(failure)), _ -> #(
      Model(..model, deletion: NotDeleting, problem: Some(failure)),
      list_notes(model),
    )

    StorageDeleted(note:, result: Ok(_)), _ -> {
      let was_open = is_open(model, note.id)
      let deletes = model.deletes + 1
      let model =
        Model(
          ..model,
          deletion: NotDeleting,
          undo: Some(Undo(note:, was_open:)),
          deletes:,
        )
      let model = case was_open {
        True -> Model(..model, open: None)
        False -> model
      }
      let expire = platform.after(undo_ms, UndoExpired(deletes))
      #(model, effect.batch([list_notes(model), expire]))
    }
    StorageDeleted(note:, result: Error(failure)), _ -> {
      let model = Model(..model, deletion: NotDeleting, problem: Some(failure))
      case is_open(model, note.id) {
        True -> #(
          model,
          platform.after(retry_save_ms, AutosaveDue(model.edits)),
        )
        False -> #(model, effect.none())
      }
    }

    UserUndidDelete, _ ->
      case model.undo {
        Some(Undo(note:, was_open:)) -> #(
          Model(..model, undo: None),
          storage.save(model.storage, note, StorageRestored(note, was_open, _)),
        )
        None -> #(model, effect.none())
      }
    StorageRestored(note:, was_open: True, result: Ok(_)), _ -> {
      let #(model, left) =
        Model(..model, leaving_for: Some(ExistingNote(note.id)))
        |> leave_when_saved
      #(model, effect.batch([left, list_notes(model)]))
    }
    StorageRestored(was_open: False, result: Ok(_), ..), _ -> #(
      model,
      list_notes(model),
    )
    StorageRestored(note:, was_open:, result: Error(failure)), _ -> #(
      Model(..model, undo: Some(Undo(note:, was_open:)), problem: Some(failure)),
      effect.none(),
    )
    UndoExpired(deletes), _ if deletes == model.deletes -> #(
      Model(..model, undo: None),
      effect.none(),
    )
    UndoExpired(_), _ -> #(model, effect.none())

    UserToggledMarkdown, _ -> {
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

    UserToggledVim(on), _ -> {
      let editor = editor.set_vim(model.editor, on && model.can_vim)
      #(Model(..model, editor:, vim: on), platform.remember_vim_setting(on))
    }

    StorageLoaded(Error(storage.NotFound as failure)), _ -> #(
      Model(..model, problem: Some(failure)),
      list_notes(model),
    )
    StorageListed(Error(failure)), _
    | StorageLoaded(Error(failure)), _
    | StorageCreated(Error(failure)), _
    -> #(Model(..model, problem: Some(failure)), effect.none())
  }
}

fn apply(model: Model, outcome: Outcome) -> #(Model, Effect(Msg)) {
  let Outcome(editor:, sync:, requests:) = outcome
  let text_changed = editor.text(editor) != editor.text(model.editor)
  let model = Model(..model, editor:)
  let #(model, autosave) = case text_changed {
    True -> {
      let model = count_edit(model)
      #(model, start_autosave_timer(model))
    }
    False -> #(model, effect.none())
  }
  let #(model, asked) = {
    use #(model, effects), request <- list.fold(requests, #(model, []))
    let #(model, effect) = perform(model, request)
    #(model, [effect, ..effects])
  }
  #(model, effect.batch([surface.sync(sync, EditorSent), autosave, ..asked]))
}

fn perform(model: Model, request: vim.Request) -> #(Model, Effect(Msg)) {
  case request {
    vim.SaveNow -> save(model)
    vim.CopyToClipboard(text) -> #(model, platform.copy(text))
  }
}

fn count_edit(model: Model) -> Model {
  Model(..with_save_state(model, Unsaved), edits: model.edits + 1)
}

fn with_save_state(model: Model, save_state: SaveState) -> Model {
  let open = option.map(model.open, fn(open) { Open(..open, save_state:) })
  Model(..model, open:)
}

fn is_awaited_answer(model: Model, id: NoteId, edits: Int) -> Bool {
  case model.open {
    Some(Open(save_state: Saving, ..) as open) ->
      open.id == id && edits == model.edits
    _ -> False
  }
}

fn leave_when_saved(model: Model) -> #(Model, Effect(Msg)) {
  case model.leaving_for, model.open {
    None, _ -> #(model, effect.none())
    Some(_), Some(Open(save_state: Unsaved, ..)) -> save(model)
    Some(_), Some(Open(save_state: Saving, ..)) -> #(model, effect.none())
    Some(destination), Some(Open(save_state: Saved, ..))
    | Some(destination), None
    -> #(Model(..model, leaving_for: None), case destination {
      ExistingNote(id) -> load(model, id)
      NewNote -> create(model)
    })
  }
}

fn start_autosave_timer(model: Model) -> Effect(Msg) {
  platform.after(autosave_ms, AutosaveDue(model.edits))
}

fn save(model: Model) -> #(Model, Effect(Msg)) {
  case model.open, model.deletion {
    Some(open), Deleting(deleting) if open.id == deleting -> #(
      model,
      effect.none(),
    )
    Some(Open(id:, title:, save_state: Unsaved) as open), _ -> {
      let note = Note(id:, title:, body: editor.text(model.editor))
      #(
        Model(..model, open: Some(Open(..open, save_state: Saving))),
        storage.save(model.storage, note, StorageSaved(id, model.edits, _)),
      )
    }
    _, _ -> #(model, effect.none())
  }
}

fn open_when_saved(model: Model, note: Note) -> #(Model, Effect(Msg)) {
  let typed_while_it_was_loading = case model.open {
    Some(Open(save_state: Unsaved, ..)) | Some(Open(save_state: Saving, ..)) ->
      True
    Some(Open(save_state: Saved, ..)) | None -> False
  }
  case typed_while_it_was_loading {
    True ->
      Model(..model, leaving_for: Some(ExistingNote(note.id)))
      |> leave_when_saved
    False -> open_note(model, note)
  }
}

fn open_note(model: Model, note: Note) -> #(Model, Effect(Msg)) {
  let Outcome(editor:, sync:, ..) = editor.open(model.editor, note.body)
  let open = Open(id: note.id, title: note.title, save_state: Saved)
  #(
    Model(..model, editor:, open: Some(open), leaving_for: None, problem: None),
    surface.sync(sync, EditorSent),
  )
}

fn keep_a_note_open(model: Model) -> Effect(Msg) {
  case model.open, model.notes {
    Some(_), _ -> effect.none()
    None, [newest, ..] -> load(model, newest.id)
    None, [] -> create(model)
  }
}

fn list_notes(model: Model) -> Effect(Msg) {
  storage.list(model.storage, StorageListed)
}

fn load(model: Model, id: NoteId) -> Effect(Msg) {
  storage.load(model.storage, id, StorageLoaded)
}

fn create(model: Model) -> Effect(Msg) {
  storage.create(model.storage, StorageCreated)
}

fn is_open(model: Model, id: NoteId) -> Bool {
  case model.open {
    Some(open) -> open.id == id
    None -> False
  }
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
      case model.problem {
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

/// The editing page. The text field is the same element in every state, so
/// it keeps its focus when the drawn parts around it change.
fn page(model: Model) -> Element(Msg) {
  let field = #("field", surface.view(model.editor, EditorSent))
  case editor.region(model.editor) {
    None -> keyed.div([attribute.class("page")], [field])
    Some(region) -> {
      let row_count = editor.row_count(model.editor)
      let part = fn(text, rows, first_row, test_id) {
        markdown.parse(text)
        |> preview.part(rows:, first_row:, test_id:, on_task: UserTickedTask)
      }
      let #(above, below) = case editor.is_idle(model.editor) {
        True -> #(
          part(editor.text(model.editor), row_count, 0, "preview"),
          part("", 0, row_count, "live-below"),
        )
        False -> {
          let #(above, below) = editor.around(model.editor)
          let after = region.last_row + 1
          #(
            part(above, region.first_row, 0, "live-above"),
            part(below, row_count - after, after, "live-below"),
          )
        }
      }
      keyed.div([attribute.class("page live"), surface.on_point(EditorSent)], [
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
        event.on_click(UserAskedForNewNote),
      ],
      [element.text("New note")],
    ),
    keyed.ul(
      [attribute.class("note-list"), attribute.data("test-id", "note-list")],
      list.map(model.notes, fn(summary) {
        let key = storage.id_text(summary.id)
        let row = case is_open(model, summary.id) {
          True -> [note_row(model, summary), more_button(model, summary.id)]
          False -> [note_row(model, summary)]
        }
        #(key, html.li([], row))
      }),
    ),
  ])
}

fn note_row(model: Model, summary: Summary) -> Element(Msg) {
  let #(title, current) = case model.open {
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
      event.on_click(UserPickedNote(summary.id)),
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
  html.header([attribute.class("toolbar")], case model.open {
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
        event.on_input(UserRenamedNote),
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

fn save_state_label(save_state: SaveState) -> String {
  case save_state {
    Saved -> "Saved"
    Saving -> "Saving…"
    Unsaved -> "Unsaved"
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

/// The visible way to the note menu, for a phone and for the keyboard. Only
/// the open note has it, so the other rows stay plain text.
fn more_button(model: Model, id: NoteId) -> Element(Msg) {
  html.button(
    [
      attribute.class("more"),
      attribute.data("test-id", "row-actions"),
      attribute.aria_label("Note actions"),
      attribute.aria_haspopup("menu"),
      attribute.aria_expanded(model.menu != None),
      attribute.disabled(model.deletion == Deleting(id)),
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
  case model.undo {
    None -> element.none()
    Some(Undo(note:, ..)) ->
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
              event.on_click(UserUndidDelete),
            ],
            [element.text("Undo")],
          ),
        ],
      )
  }
}
