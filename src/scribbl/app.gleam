//// Stable test ids (`data-test-id`), for `lustre/dev/query` and Playwright:
////   editor            the text field               (set in `surface`)
////   preview           the rendered page
////   mode              "NORMAL" / "INSERT" (only while vim is on)
////   toggle-rendered   the source / rendered button
////   toggle-vim        the vim switch (only when `can_vim`)
////   new-note          the new note button
////   note-list         the list; each row is  note-<storage.id_text(id)>
////   title             the title field
////   save-state        "Saved" / "Saving…" / "Unsaved"
////   delete-note       asks; then confirm-delete / cancel-delete answer
////   problem           the storage error banner

import gleam/list
import gleam/option.{type Option, None, Some}
import lustre/attribute
import lustre/effect.{type Effect}
import lustre/element.{type Element}
import lustre/element/html
import lustre/element/keyed
import lustre/event
import scribbl/editor.{type Editor, type Outcome, Outcome}
import scribbl/markdown
import scribbl/platform
import scribbl/storage.{
  type Failure, type Note, type NoteId, type Storage, type Summary, Note,
}
import scribbl/surface
import scribbl/vim

/// How long after the last edit the note is saved.
const autosave_ms = 800

/// What `main` hands to `init`. Tests build this by hand.
pub type Flags {
  Flags(
    storage: Storage,
    /// The remembered vim switch. Off for a new user.
    vim: Bool,
    /// False on phones: the vim switch is not offered at all.
    can_vim: Bool,
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
    showing: Showing,
    vim: Bool,
    can_vim: Bool,
    asked_to_delete: Bool,
    /// Last storage failure, shown in a banner.
    problem: Option(String),
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

pub type SaveState {
  Unsaved
  Saving
  Saved
}

pub type Showing {
  Source
  Rendered
}

pub type Msg {
  EditorSent(editor.Event)
  AutosaveDue(edits: Int)
  PageHidden
  StorageListed(Result(List(Summary), Failure))
  StorageLoaded(Result(Note, Failure))
  StorageCreated(Result(Note, Failure))
  StorageSaved(id: NoteId, edits: Int, result: Result(Nil, Failure))
  StorageDeleted(Result(Nil, Failure))
  UserPickedNote(NoteId)
  UserAskedForNewNote
  UserAskedToDelete
  UserKeptNote
  UserDeletedNote(NoteId)
  UserRenamedNote(title: String)
  UserToggledRendered
  UserToggledVim(on: Bool)
  /// A task checkbox on the rendered page, by source row.
  UserTickedTask(row: Int)
}

pub fn init(flags: Flags) -> #(Model, Effect(Msg)) {
  let Flags(storage:, vim:, can_vim:) = flags
  let model =
    Model(
      storage:,
      notes: [],
      open: None,
      editor: editor.new(vim: vim && can_vim),
      edits: 0,
      showing: Source,
      vim:,
      can_vim:,
      asked_to_delete: False,
      problem: None,
    )
  let start =
    effect.batch([
      list_notes(model),
      // Ctrl+E (Cmd+E on a Mac) flips between source and rendered page.
      platform.on_shortcut("e", UserToggledRendered),
      platform.on_hide(PageHidden),
    ])
  #(model, start)
}

pub fn update(model: Model, msg: Msg) -> #(Model, Effect(Msg)) {
  case msg, model.open {
    // The editing loop: everything that can change the text ends in `apply`.
    EditorSent(event), _ -> apply(model, editor.update(model.editor, event))
    UserTickedTask(row), _ ->
      editor.change_line(model.editor, row, markdown.toggle_task)
      |> apply(model, _)

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

    StorageSaved(id:, edits:, result:), open -> {
      let is_about_the_text_on_screen = edits == model.edits
      let open = case open, is_about_the_text_on_screen, result {
        Some(Open(save_state: Saving, ..) as open), True, Ok(_)
          if open.id == id
        -> Some(Open(..open, save_state: Saved))
        Some(Open(save_state: Saving, ..) as open), True, Error(_)
          if open.id == id
        -> Some(Open(..open, save_state: Unsaved))
        open, _, _ -> open
      }
      case result {
        Ok(_) -> #(Model(..model, open:, problem: None), list_notes(model))
        Error(failure) -> #(
          Model(..model, open:, problem: Some(describe(failure))),
          effect.none(),
        )
      }
    }

    StorageListed(Ok(notes)), _ -> {
      let model = Model(..model, notes:)
      #(model, keep_a_note_open(model))
    }

    StorageLoaded(Ok(note)), _ -> open_note(model, note)
    StorageCreated(Ok(note)), _ -> {
      let #(model, opened) = open_note(model, note)
      #(model, effect.batch([opened, list_notes(model)]))
    }

    UserPickedNote(id), Some(open) if id == open.id -> #(model, effect.none())
    UserPickedNote(id), _ -> {
      let #(model, saved) = save(model)
      #(model, effect.batch([saved, load(model, id)]))
    }

    UserAskedForNewNote, _ -> {
      let #(model, saved) = save(model)
      #(Model(..model, showing: Source), effect.batch([saved, create(model)]))
    }

    UserAskedToDelete, _ -> #(
      Model(..model, asked_to_delete: True),
      effect.none(),
    )
    UserKeptNote, _ -> #(Model(..model, asked_to_delete: False), effect.none())
    UserDeletedNote(id), open -> {
      let open = case open {
        Some(open) if open.id == id -> None
        other -> other
      }
      #(
        Model(..model, open:, asked_to_delete: False),
        storage.delete(model.storage, id, StorageDeleted),
      )
    }
    StorageDeleted(Ok(_)), _ -> #(model, list_notes(model))

    UserToggledRendered, _ ->
      case model.showing {
        Source -> #(Model(..model, showing: Rendered), effect.none())
        Rendered -> #(Model(..model, showing: Source), surface.focus())
      }

    UserToggledVim(on), _ -> {
      let editor = editor.set_vim(model.editor, on && model.can_vim)
      #(Model(..model, editor:, vim: on), platform.remember_vim_setting(on))
    }

    StorageLoaded(Error(storage.NotFound as failure)), _ -> #(
      Model(..model, problem: Some(describe(failure))),
      list_notes(model),
    )
    StorageListed(Error(failure)), _
    | StorageLoaded(Error(failure)), _
    | StorageCreated(Error(failure)), _
    | StorageDeleted(Error(failure)), _
    -> #(Model(..model, problem: Some(describe(failure))), effect.none())
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
  #(model, effect.batch([surface.sync(sync), autosave, ..asked]))
}

fn perform(model: Model, request: vim.Request) -> #(Model, Effect(Msg)) {
  case request {
    vim.SaveNow -> save(model)
    vim.CopyToClipboard(text) -> #(model, platform.copy(text))
  }
}

fn count_edit(model: Model) -> Model {
  let unsaved = fn(open) { Open(..open, save_state: Unsaved) }
  Model(..model, edits: model.edits + 1, open: option.map(model.open, unsaved))
}

fn start_autosave_timer(model: Model) -> Effect(Msg) {
  platform.after(autosave_ms, AutosaveDue(model.edits))
}

fn save(model: Model) -> #(Model, Effect(Msg)) {
  case model.open {
    Some(Open(id:, title:, save_state: Unsaved) as open) -> {
      let note = Note(id:, title:, body: editor.text(model.editor))
      #(
        Model(..model, open: Some(Open(..open, save_state: Saving))),
        storage.save(model.storage, note, StorageSaved(id, model.edits, _)),
      )
    }
    _ -> #(model, effect.none())
  }
}

fn open_note(model: Model, note: Note) -> #(Model, Effect(Msg)) {
  let Outcome(editor:, sync:, ..) = editor.open(model.editor, note.body)
  let open = Open(id: note.id, title: note.title, save_state: Saved)
  #(
    Model(
      ..model,
      editor:,
      open: Some(open),
      asked_to_delete: False,
      problem: None,
    ),
    surface.sync(sync),
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
            [element.text(problem)],
          )
        None -> element.none()
      },
      // The text field stays in the page while the rendered view shows, so
      // its cursor and the browser's undo history survive the flip.
      html.div(
        [attribute.class("page"), attribute.hidden(model.showing == Rendered)],
        [surface.view(model.editor, EditorSent)],
      ),
      case model.showing {
        Source -> element.none()
        Rendered -> rendered(model)
      },
    ]),
  ])
}

fn rendered(model: Model) -> Element(Msg) {
  html.pre([attribute.class("preview"), attribute.data("test-id", "preview")], [
    element.text(editor.text(model.editor)),
  ])
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
        #(key, html.li([], [note_row(model, summary)]))
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
      delete_buttons(model, open),
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
        attribute.data("test-id", "toggle-rendered"),
        attribute.title("Ctrl+E"),
        event.on_click(UserToggledRendered),
      ],
      [
        element.text(case model.showing {
          Source -> "Preview"
          Rendered -> "Edit"
        }),
      ],
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

fn delete_buttons(model: Model, open: Open) -> Element(Msg) {
  case model.asked_to_delete {
    False ->
      html.button(
        [
          attribute.data("test-id", "delete-note"),
          event.on_click(UserAskedToDelete),
        ],
        [element.text("Delete")],
      )
    True ->
      html.span([attribute.class("confirm")], [
        element.text("Delete this note?"),
        html.button(
          [
            attribute.class("danger"),
            attribute.data("test-id", "confirm-delete"),
            event.on_click(UserDeletedNote(open.id)),
          ],
          [element.text("Delete")],
        ),
        html.button(
          [
            attribute.data("test-id", "cancel-delete"),
            event.on_click(UserKeptNote),
          ],
          [element.text("Keep")],
        ),
      ])
  }
}
