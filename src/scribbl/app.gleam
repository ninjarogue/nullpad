//// The app shell: Lustre's Model / Msg / update / view. It wires the editor
//// and storage together and holds no editing, parsing or storage logic.
//// `scribbl.main` starts it.
////
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

import gleam/int
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
    showing: Showing,
    vim: Bool,
    can_vim: Bool,
    /// True between pressing Delete and answering "Delete this note?".
    asked_to_delete: Bool,
    /// Last storage failure, shown in a banner.
    problem: Option(String),
  )
}

/// Set only when a load finishes, so text is never saved under another
/// note's id.
///
/// The three counters say how far saving has got. `edits` goes up by one on
/// every change. `sent` is the count that was last handed to storage and
/// `saved` the count storage last confirmed, so `saved <= sent <= edits`.
pub type Open {
  Open(
    id: NoteId,
    /// The title the user typed. `None` means "derive it from the text".
    title: Option(String),
    /// An autosave timer carries the count it was started with, and is
    /// ignored if more changes came after it.
    edits: Int,
    sent: Int,
    saved: Int,
  )
}

pub type Showing {
  Source
  Rendered
}

pub type Msg {
  EditorSent(editor.Event)
  AutosaveDue(edits: Int)
  /// The tab was switched or closed, or the phone left the browser.
  PageHidden
  StorageListed(Result(List(Summary), Failure))
  StorageLoaded(Result(Note, Failure))
  /// Which note and which edit count the answer is about: by the time it
  /// arrives another note may be open.
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
      showing: Source,
      vim:,
      can_vim:,
      asked_to_delete: False,
      problem: None,
    )
  let start =
    effect.batch([
      storage.list(storage, StorageListed),
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
      touch(Model(..model, open: Some(Open(..open, title:))))
    }
    UserRenamedNote(_), None -> #(model, effect.none())

    // Saving ----------------------------------------------------------------
    AutosaveDue(edits), Some(open) if edits == open.edits -> save(model)
    // A timer that was overtaken by newer edits, or by closing the note.
    AutosaveDue(_), _ -> #(model, effect.none())
    PageHidden, _ -> save(model)

    StorageSaved(id:, edits:, result: Ok(_)), open -> {
      let open = case open {
        Some(open) if open.id == id ->
          Some(Open(..open, saved: int.max(open.saved, edits)))
        other -> other
      }
      // The list again, so the saved note's title and place are right.
      #(Model(..model, open:, problem: None), list_notes(model))
    }
    StorageSaved(id:, result: Error(failure), ..), open -> {
      let open = case open {
        // Forget that it was sent, so the next save tries again.
        Some(open) if open.id == id -> Some(Open(..open, sent: open.saved))
        other -> other
      }
      #(Model(..model, open:, problem: Some(describe(failure))), effect.none())
    }

    // Opening ---------------------------------------------------------------
    StorageListed(Ok(notes)), open -> {
      let model = Model(..model, notes:)
      case open, notes {
        Some(_), _ -> #(model, effect.none())
        None, [newest, ..] -> #(model, load(model, newest.id))
        None, [] -> #(model, create(model))
      }
    }

    StorageLoaded(Ok(note)), _ -> {
      let Outcome(editor:, sync:, ..) = editor.open(model.editor, note.body)
      let open =
        Open(id: note.id, title: note.title, edits: 0, sent: 0, saved: 0)
      let listed = list.any(model.notes, fn(summary) { summary.id == note.id })
      let relist = case listed {
        True -> effect.none()
        // A note that was just created.
        False -> list_notes(model)
      }
      #(
        Model(
          ..model,
          editor:,
          open: Some(open),
          asked_to_delete: False,
          problem: None,
        ),
        effect.batch([surface.sync(sync), relist]),
      )
    }

    UserPickedNote(id), Some(open) if id == open.id -> #(model, effect.none())
    UserPickedNote(id), _ -> {
      let #(model, saved) = save(model)
      #(model, effect.batch([saved, load(model, id)]))
    }

    UserAskedForNewNote, _ -> {
      let #(model, saved) = save(model)
      // A new note is for typing in, so show the source.
      #(Model(..model, showing: Source), effect.batch([saved, create(model)]))
    }

    // Deleting --------------------------------------------------------------
    UserAskedToDelete, _ -> #(
      Model(..model, asked_to_delete: True),
      effect.none(),
    )
    UserKeptNote, _ -> #(Model(..model, asked_to_delete: False), effect.none())
    UserDeletedNote(id), open -> {
      let open = case open {
        // Closed at once, so nothing can save it back into storage.
        Some(open) if open.id == id -> None
        other -> other
      }
      #(
        Model(..model, open:, asked_to_delete: False),
        storage.delete(model.storage, id, StorageDeleted),
      )
    }
    // With no note open, the fresh list opens the newest one that is left.
    StorageDeleted(Ok(_)), _ -> #(model, list_notes(model))

    // Settings --------------------------------------------------------------
    UserToggledRendered, _ ->
      case model.showing {
        Source -> #(Model(..model, showing: Rendered), effect.none())
        // Coming back: the control kept its text, so this only returns focus.
        Rendered -> #(
          Model(..model, showing: Source),
          surface.sync(editor.Write(editor.buffer(model.editor))),
        )
      }

    UserToggledVim(on), _ -> {
      let editor = editor.set_vim(model.editor, on && model.can_vim)
      #(Model(..model, editor:, vim: on), platform.remember_vim_setting(on))
    }

    // Failures --------------------------------------------------------------
    // The note is gone, so the list on screen is out of date too.
    StorageLoaded(Error(storage.NotFound as failure)), _ -> #(
      Model(..model, problem: Some(describe(failure))),
      list_notes(model),
    )
    StorageListed(Error(failure)), _
    | StorageLoaded(Error(failure)), _
    | StorageDeleted(Error(failure)), _
    -> #(Model(..model, problem: Some(describe(failure))), effect.none())
  }
}

/// Take an editor outcome and do everything it implies, in one place: keep
/// the new editor, write to the text field if asked, count the change and
/// start an autosave timer if the text changed, and carry out vim's requests.
fn apply(model: Model, outcome: Outcome) -> #(Model, Effect(Msg)) {
  let Outcome(editor:, sync:, requests:) = outcome
  let text_changed = editor.text(editor) != editor.text(model.editor)
  let model = Model(..model, editor:)
  let #(model, autosave) = case text_changed {
    True -> touch(model)
    False -> #(model, effect.none())
  }
  let #(model, asked) = {
    use #(model, effects), request <- list.fold(requests, #(model, []))
    let #(model, effect) = perform(model, request)
    #(model, [effect, ..effects])
  }
  #(model, effect.batch([surface.sync(sync), autosave, ..asked]))
}

/// No wildcard: a new `vim.Request` fails the build here until it is handled.
fn perform(model: Model, request: vim.Request) -> #(Model, Effect(Msg)) {
  case request {
    vim.SaveNow -> save(model)
    vim.CopyToClipboard(text) -> #(model, platform.copy(text))
  }
}

/// The open note changed: count it and start an autosave timer.
fn touch(model: Model) -> #(Model, Effect(Msg)) {
  case model.open {
    Some(open) -> {
      let edits = open.edits + 1
      #(
        Model(..model, open: Some(Open(..open, edits:))),
        platform.after(autosave_ms, AutosaveDue(edits)),
      )
    }
    None -> #(model, effect.none())
  }
}

/// Hand the open note to storage, unless storage already has these edits.
fn save(model: Model) -> #(Model, Effect(Msg)) {
  case model.open {
    Some(Open(id:, title:, edits:, sent:, ..) as open) if edits > sent -> {
      let note = Note(id:, title:, body: editor.text(model.editor))
      #(
        Model(..model, open: Some(Open(..open, sent: edits))),
        storage.save(model.storage, note, StorageSaved(id, edits, _)),
      )
    }
    _ -> #(model, effect.none())
  }
}

fn list_notes(model: Model) -> Effect(Msg) {
  storage.list(model.storage, StorageListed)
}

fn load(model: Model, id: NoteId) -> Effect(Msg) {
  storage.load(model.storage, id, StorageLoaded)
}

fn create(model: Model) -> Effect(Msg) {
  storage.create(model.storage, StorageLoaded)
}

fn describe(failure: Failure) -> String {
  case failure {
    storage.NotFound -> "That note is no longer in storage."
    storage.Unavailable(detail) -> "Storage is not working: " <> detail
  }
}

// VIEW ------------------------------------------------------------------------

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

/// M1 stand-in for the rendered page: the note's text exactly as typed.
/// M2 replaces the body with
/// `markdown.parse(editor.text(model.editor)) |> preview.view(UserTickedTask)`,
/// so the parser runs only while the rendered page is showing.
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
    // The open note shows its title as it is right now, not as last saved.
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
        // What the title will be if this stays empty.
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
        [element.text(save_state(open))],
      ),
      toggles(model),
      delete_buttons(model, open),
    ]
  })
}

fn save_state(open: Open) -> String {
  case open.edits == open.saved, open.edits == open.sent {
    True, _ -> "Saved"
    False, True -> "Saving…"
    False, False -> "Unsaved"
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

/// Deleting takes two presses, because a deleted note cannot be brought back.
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
