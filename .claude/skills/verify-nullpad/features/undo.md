# Undo and redo

A person takes back what they wrote and puts it back, in the page view and with Markdown on. The editor keeps the history, so it reaches across blocks, joins, pastes and cuts, and a switch to Markdown and back.

## Sub-features

- `undo-keys` Ctrl+Z (Cmd+Z) undoes; Ctrl+Shift+Z (Cmd+Shift+Z) and Ctrl+Y redo.
- `undo-steps` a run of typing is one step until the caret moves some other way; a space after a word starts a new step; a pause of more than a second since the last character typed or erased starts one too (the browser's `timeStamp` comes in with the event); a line break, a join, a paste and a cut are a step each.
- `undo-caret` undo puts the caret where the step began, redo where it ended, and the page is laid out around it.
- `undo-blocks` an undo after the caret left a block takes back what was typed there.
- `undo-redo-cleared` an edit after an undo ends what can be redone.
- `undo-menu` an undo from the Edit menu or the field's menu goes through the same history.
- `undo-markdown` with Markdown on, the same keys step through the same history.
- `undo-fresh` a note opened from the list starts with nothing to undo.

## How to get to it (user POV)

- Type in a note, then press Ctrl+Z or Ctrl+Shift+Z or Ctrl+Y, in the page view or with Markdown on.
- Right-click the text field and choose Undo, or use the browser's Edit menu.

## Driving it with drive.mjs

Preconditions: a fresh run (one empty note). `journeys/undo.mjs` covers the keys, blocks, a join, a paste and Markdown.

- **Undo after leaving a block.** Type in one block, click another, `Control+z`. The first block is back as it was, and the field holds it with the caret where the typing began.
- **Redo.** `Control+y` or `Control+Shift+z`. The text is back and the caret is at its end.
- **Read the whole note.** Turn Markdown on and read `getByLabel('Note text')`, then turn it off.
- **Menu.** Playwright cannot open the browser's menus. `document.execCommand('undo')` sends what the menu sends.

## Gotchas

- Chromium offers Undo in its menus only while its own history has something in it, and that history is emptied whenever the field is written. So a menu undo works for typing in the block the caret is in, and the keys work everywhere.
- The screenshots do not show the caret. Read the field's `selectionStart` to say where it is.
- `navigator.clipboard.writeText` is refused in a drive.mjs browser. Copy with `Shift+End` and `Control+c` instead.
