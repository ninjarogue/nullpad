//// The app shell: Lustre's Model / Msg / update / view. It wires the editor,
//// the parser and storage together and holds no editing, parsing or storage
//// logic. `scribbl.main` starts it. Until M1 wires it in, nothing imports
//// this.
////
//// Stable test ids (`data-test-id`), for `lustre/dev/query` and Playwright:
////   editor            the text field               (set in `surface`)
////   preview           the rendered page            (set in `preview`)
////   mode              "NORMAL" / "INSERT" (only while vim is on)
////   toggle-rendered   the source / rendered button
////   toggle-vim        the vim switch (only when `can_vim`)
////   new-note          the new note button
////   note-list         the list; each row is  note-<storage.id_text(id)>
////   title             the title field
////   save-state        "Saved" / "Saving…" / "Unsaved"
////   problem           the storage error banner

import gleam/list
import gleam/option.{type Option, None, Some}
import lustre/attribute
import lustre/effect.{type Effect}
import lustre/element.{type Element}
import lustre/element/html
import scribbl/editor.{type Editor, type Outcome, Outcome}
import scribbl/markdown
import scribbl/platform
import scribbl/preview
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
    /// Counts changes. An autosave timer carries the count it was started
    /// with, and is ignored if more changes came after it.
    edits: Int,
  )
}

pub type Showing {
  Source
  Rendered
}

pub type Msg {
  EditorSent(editor.Event)
  AutosaveDue(edits: Int)
  StorageListed(Result(List(Summary), Failure))
  StorageLoaded(Result(Note, Failure))
  StorageSaved(Result(Nil, Failure))
  StorageDeleted(Result(Nil, Failure))
  UserPickedNote(NoteId)
  UserAskedForNewNote
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
      problem: None,
    )
  let start =
    effect.batch([
      storage.list(storage, StorageListed),
      // Ctrl+E (Cmd+E on a Mac) flips between source and rendered page.
      platform.on_shortcut("e", UserToggledRendered),
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

    AutosaveDue(edits), Some(open) if edits == open.edits -> #(
      model,
      save(model, open),
    )
    // A timer that was overtaken by newer edits, or by closing the note.
    AutosaveDue(_), _ -> #(model, effect.none())

    StorageLoaded(Ok(note)), _ -> {
      let Outcome(editor:, sync:, ..) = editor.open(model.editor, note.body)
      let open = Open(id: note.id, title: note.title, edits: 0)
      #(
        Model(..model, editor:, open: Some(open), problem: None),
        surface.sync(sync),
      )
    }

    UserToggledRendered, _ ->
      case model.showing {
        Source -> #(Model(..model, showing: Rendered), effect.none())
        // Coming back: put the text, cursor and focus back in the control.
        Rendered -> #(
          Model(..model, showing: Source),
          surface.sync(editor.Write(editor.buffer(model.editor))),
        )
      }

    UserToggledVim(on), _ -> {
      let editor = editor.set_vim(model.editor, on && model.can_vim)
      #(Model(..model, editor:, vim: on), platform.remember_vim_setting(on))
    }

    // Still to write ---------------------------------------------------------
    // StorageListed(Ok(notes)): remember them. Load the newest, or create one
    //   if there are none.
    // UserPickedNote(id): save the open note first, then storage.load.
    // UserAskedForNewNote: storage.create(model.storage, StorageLoaded).
    // UserDeletedNote(id): storage.delete, then storage.list again.
    // UserRenamedNote(title): set `open.title` ("" means None), count it as
    //   an edit so autosave picks it up.
    // StorageSaved(Ok(_)): refresh the list so titles and order stay right.
    // Any Error(failure): set `problem`.
    StorageListed(_), _
    | StorageLoaded(Error(_)), _
    | StorageSaved(_), _
    | StorageDeleted(_), _
    | UserPickedNote(_), _
    | UserAskedForNewNote, _
    | UserDeletedNote(_), _
    | UserRenamedNote(_), _
    -> todo as "not implemented"
  }
}

/// Take an editor outcome and do everything it implies, in one place: keep
/// the new editor, write to the text field if asked, start an autosave timer
/// if the text changed, and carry out vim's requests.
fn apply(model: Model, outcome: Outcome) -> #(Model, Effect(Msg)) {
  let Outcome(editor:, sync:, requests:) = outcome
  let text_changed = editor.text(editor) != editor.text(model.editor)
  let #(open, autosave) = case model.open, text_changed {
    Some(open), True -> {
      let edits = open.edits + 1
      #(
        Some(Open(..open, edits:)),
        platform.after(autosave_ms, AutosaveDue(edits)),
      )
    }
    open, _ -> #(open, effect.none())
  }
  let model = Model(..model, editor:, open:)
  let asked = list.map(requests, perform(model, _))
  #(model, effect.batch([surface.sync(sync), autosave, ..asked]))
}

/// No wildcard: a new `vim.Request` fails the build here until it is handled.
fn perform(model: Model, request: vim.Request) -> Effect(Msg) {
  case request, model.open {
    vim.SaveNow, Some(open) -> save(model, open)
    vim.SaveNow, None -> effect.none()
    vim.CopyToClipboard(text), _ -> platform.copy(text)
  }
}

fn save(model: Model, open: Open) -> Effect(Msg) {
  let note =
    Note(id: open.id, title: open.title, body: editor.text(model.editor))
  storage.save(model.storage, note, StorageSaved)
}

pub fn view(model: Model) -> Element(Msg) {
  html.main([attribute.class("app")], [
    // To write: the note list, the title field, the toolbar buttons, the mode
    // indicator and the problem banner, each with its test id from the table
    // at the top of this file.
    //
    // The text field stays in the page while the rendered view shows, so its
    // cursor and the browser's undo history survive the flip.
    html.div([attribute.hidden(model.showing == Rendered)], [
      surface.view(model.editor, EditorSent),
    ]),
    // The parser runs only while the rendered page is showing.
    case model.showing {
      Source -> element.none()
      Rendered ->
        markdown.parse(editor.text(model.editor))
        |> preview.view(UserTickedTask)
    },
  ])
}
