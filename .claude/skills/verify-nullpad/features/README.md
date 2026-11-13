# nullpad verification map

What a person can do in nullpad, and how to prove each part works. Read this, then the matching feature file.

## Baseline

- Every run starts from an empty browser: the app makes one empty note, focuses the text field and shows the page view (Markdown off).
- Run `doctor.sh` first. Drive only the instance `drive.mjs` started.
- Act through the keyboard and visible controls. Prefer labels and roles over CSS.

## Proof

- Capture the action and the state after it.
- For anything saved, reload and read it again.
- Say which entry point was used. A skipped entry point is not verified by another one.
- A journey that cannot reach a state reports a failure with the reason. Do not weaken it to pass.

## Feature file shape

An H1, one paragraph, then four H2s in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with drive.mjs`, `Gotchas`.

## Features

- [Write a note](./write-a-note.md): typing, autosave, reload.
- [Rendered page](./rendered-page.md): the whole note drawn as a page, the Markdown toggle, and the markdown it shows.
- [Task lists](./task-lists.md): boxes on the page that tick the `[ ]` in the note.
- [Live view](./live-view.md): how the page works while you write, with the text field on one block.
- [Note list](./note-list.md): new, switch, title, delete (the × on a row).
- [Undo and redo](./undo.md): Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y across blocks, the Edit menu, Markdown mode.

Not built yet, so not mapped: vim keys (the switch is hidden), images, autolinks, link reference definitions, hard line breaks, character entities, sync.
