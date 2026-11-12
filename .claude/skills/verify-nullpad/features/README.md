# nullpad verification map

What a person can do in nullpad, and how to prove each part works. Read this, then the matching feature file.

## Baseline

- Every run starts from an empty browser: the app makes one empty note and focuses the text field.
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
- [Rendered page](./rendered-page.md): the Ctrl+E page and the markdown it shows.
- [Task lists](./task-lists.md): boxes on the page that tick the `[ ]` in the note.
- [Note list](./note-list.md): new, switch, title, delete.

Not built yet, so not mapped: vim keys (the switch is hidden), images, autolinks, link reference definitions, hard line breaks, character entities, sync.
