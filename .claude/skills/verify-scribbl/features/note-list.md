# Note list

The sidebar lists every note, newest save first. A person makes, opens, titles and deletes notes there.

## Sub-features

- `list-new` New note opens an empty note at the top with focus in the text field.
- `list-switch` picking a row saves the open note, then opens the picked one.
- `list-title` a row shows the typed title, or the first line without its marks, or "Untitled".
- `list-delete` Delete asks first. Keep cancels. Confirm removes the note and opens the newest one left.

## How to get to it (user POV)

- Click `New note`.
- Click a row in the list.
- Type in the `Title` field.
- Click the delete control of the open note, then confirm or Keep.

## Driving it with drive.mjs

Preconditions: a fresh run with some text typed in the first note.

- **New.** Click `getByRole('button', { name: 'New note' })`. The text field is empty and focused, and the list has two rows.
- **Switch.** Click the other row inside `[data-test-id=note-list]`. Its text shows, and `[aria-current="true"]` is that row.
- **Title.** Type into `getByLabel('Title')`. The open row shows the title. Clear it and the row shows the first line again.
- **Delete, keep.** Click `[data-test-id=delete-note]`, then `Keep`. The row count is unchanged.
- **Delete, confirm.** Click `[data-test-id=delete-note]`, then `[data-test-id=confirm-delete]`. The row is gone. Reload and it is still gone.

## Gotchas

- Switching right after typing is the risky path: check the first note's last characters after switching back.
- With one note left, deleting it leaves an empty state. Check what the page offers then.
- Known bug, to be fixed in M2b: the title is worked out by its own rules in `storage.gleam`, not by the parser, so it can disagree with the page. `**unclosed bold` loses its stars in the title and `#hashtag notes` loses its `#`, while the page keeps both. Do not assert these as correct.
