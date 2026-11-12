# Note list

The sidebar lists every note, newest save first. A person makes, opens, titles and deletes notes there.

## Sub-features

- `list-new` New note opens an empty note at the top with focus in the text field.
- `list-switch` picking a row saves the open note, then opens the picked one.
- `list-title` a row shows the typed title, or the first text the page shows, worded as the page words it (`**bold**` is "bold", an unclosed `**bold` keeps its stars, `- [ ] buy milk` is "buy milk", `> quoted` is "quoted"), or "Untitled".
- `list-delete` a note is deleted from its menu. The open note's row has a "⋯" (`aria-label` "Note actions") that opens it, a right-click on any row opens it at the pointer, and the Delete key on a focused row deletes without the menu. Nothing asks first: the note goes at once and a toast says "Deleted “title”" with Undo for five seconds. Undo puts the note back, and opens it again if it was the open one. Deleting the open note opens the newest one left. A note that is not open is deleted without opening it.

## How to get to it (user POV)

- Click `New note`.
- Click a row in the list.
- Type in the `Title` field.
- Click the "⋯" on the open note, or right-click any note, then Delete. Click Undo in the toast to bring it back.

## Driving it with drive.mjs

Preconditions: a fresh run with some text typed in the first note.

- **New.** Click `getByRole('button', { name: 'New note' })`. The text field is empty and focused, and the list has two rows.
- **Switch.** Click the other row inside `[data-test-id=note-list]`. Its text shows, and `[aria-current="true"]` is that row. The text field follows a moment after the click, so wait for the row to be current before reading the field.
- **Title.** Type into `getByLabel('Title')`. The open row shows the title. Clear it and the row shows the first line again.
- **Menu, close.** Click `[data-test-id=row-actions]`. `[data-test-id=note-menu]` shows with Delete focused. Escape or a click outside closes it and the row count is unchanged.
- **Delete.** Open the menu, click `[data-test-id=delete-note]`. The row is gone at once and `[data-test-id=undo-toast]` names the note. Reload and it is still gone.
- **Undo.** Delete, then click `[data-test-id=undo-delete]` within five seconds. The row is back with its text.
- **Delete another note.** `await page.getByRole('button', { name: 'Trip' }).click({ button: 'right' })`, then Delete. The open note is still current and its text unchanged.

## Gotchas
- A restored note is saved again, so it moves to the top of the list.
- Deleting the only note makes a new empty one. Undo then leaves both.

- Switching right after typing is the risky path: check the first note's last characters after switching back.
- With one note left, deleting it leaves an empty state. Check what the page offers then.
- The title is the first line of text the page shows, so a leading `---`, an empty fence or empty items are skipped (`---` then `after rule` is titled "after rule"). A bold that opens on line one and closes on line two is titled by its first line (`**bold` then `more** tail` is "bold"). A typed `[x](javascript:alert(1))` is titled as typed, because the page shows it as typed.
