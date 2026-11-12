# Note list

The sidebar lists every note, newest save first. A person makes, opens, titles and deletes notes there.

## Sub-features

- `list-new` New note opens an empty note at the top with focus in the text field.
- `list-switch` picking a row saves the open note, then opens the picked one.
- `list-title` a row shows the typed title, or the first text the page shows, worded as the page words it (`**bold**` is "bold", an unclosed `**bold` keeps its stars, `- [ ] buy milk` is "buy milk", `> quoted` is "quoted"), or "Untitled".
- `list-delete` each row has a "×" button (`aria-label` "Delete note"). It asks "Delete?" in the row. `Keep` cancels. `Delete` removes the note. Deleting the open note opens the newest one left. A note that is not open can be deleted without opening it, and the open note stays open.

## How to get to it (user POV)

- Click `New note`.
- Click a row in the list.
- Type in the `Title` field.
- Click the "×" on a row, then Delete or Keep. On rows that are not open the "×" shows only when the pointer is over the row.

## Driving it with drive.mjs

Preconditions: a fresh run with some text typed in the first note.

- **New.** Click `getByRole('button', { name: 'New note' })`. The text field is empty and focused, and the list has two rows.
- **Switch.** Click the other row inside `[data-test-id=note-list]`. Its text shows, and `[aria-current="true"]` is that row. The text field follows a moment after the click, so wait for the row to be current before reading the field.
- **Title.** Type into `getByLabel('Title')`. The open row shows the title. Clear it and the row shows the first line again.
- **Delete, keep.** Click `[data-test-id=delete-note]` (the open note's row), then `[data-test-id=cancel-delete]`. The row count is unchanged.
- **Delete, confirm.** Click `[data-test-id=delete-note]`, then `[data-test-id=confirm-delete]`. The row is gone. Reload and it is still gone.
- **Delete another note.** Hover its row, click its `[data-test-id=delete-other]`, then `[data-test-id=confirm-delete]`. The open note is still current and its text unchanged.

## Gotchas
- `delete-other` is hidden until the mouse is over its row, so hover first. A touch screen shows it always.

- Switching right after typing is the risky path: check the first note's last characters after switching back.
- With one note left, deleting it leaves an empty state. Check what the page offers then.
- The title is the first line of text the page shows, so a leading `---`, an empty fence or empty items are skipped (`---` then `after rule` is titled "after rule"). A bold that opens on line one and closes on line two is titled by its first line (`**bold` then `more** tail` is "bold"). A typed `[x](javascript:alert(1))` is titled as typed, because the page shows it as typed.
