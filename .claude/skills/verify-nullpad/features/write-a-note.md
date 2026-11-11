# Write a note

A person types into the text field and the note saves itself. It is still there after a reload.

## Sub-features

- `write-type` text appears where the caret is, starting at the top of an empty note.
- `write-autosave` the status reads "Saved" about 0.8 s after typing stops.
- `write-reload` a reload shows the same text.

## How to get to it (user POV)

- Open the app. The text field has focus.
- Click the text field of any open note.

## Driving it with drive.mjs

Preconditions: a fresh run (one empty note).

- **Type.** `await type('Buy milk\nand bread')`. `getByLabel('Note text')` has that value.
- **Wait for the save.** `await page.getByRole('status').filter({ hasText: 'Saved' }).waitFor()`.
- **Reload.** `await page.reload()`. The text field has the same value and the list row reads "Buy milk".

## Gotchas

- The "Saved" label alone is not proof. Reload.
- Typing restarts the 0.8 s pause, so do not assert "Saved" between keystrokes.
- Emoji and long lines are worth typing. Caret offsets for them are not fully tested until M4.
