# Live view

The note is always drawn as a page while you write it, unless Markdown is on. The text field holds only the block the cursor is in, showing that block's markdown. Every other block is drawn with its marks hidden.

## Sub-features

- `live-markdown` the Markdown button (`aria-pressed`) or Ctrl+E turns the page off: the text field then holds the whole note as raw markdown, with no drawn parts and no `preview`. It is remembered across reloads in localStorage `nullpad.markdown`. A fresh browser starts with it off.
- `live-block` the field holds one unit: a top-level block (heading, paragraph, quote, code block, table), or one item of a top-level list. A blank row between blocks is a unit of its own.
- `live-type` typing changes only those rows of the note. A blank line and then text starts a new block: the field moves to it and the block before is drawn. Text typed on a blank row between two paragraphs joins them, and the field then holds all three rows.
- `live-arrows` ArrowUp on the field's first drawn line moves to the row above, ArrowDown on its last drawn line to the row below. Inside a wrapped paragraph the arrows move by drawn line first.
- `live-join` Backspace at the start of the field joins it to the row above. Delete at its end joins the row below to it.
- `live-click` a click on drawn text puts the field on that block with the caret at the word clicked. A click beside or between blocks goes to the end of the nearest one.
- `live-idle` Escape, or focus anywhere else, draws the whole note in one element, `[data-test-id=preview]`, with no field and no `live-above`. A click on the page brings the field back.
- `live-tasks` a drawn box ticks its line without opening its block. A link opens in a new tab.
- `live-font` the field is set like its block: heading sizes for a heading, the code font for a code block or table, an indent for a list item.

## How to get to it (user POV)

- Open the app. The field holds only the block the cursor is in.
- Move with the arrow keys, or click any drawn text.
- Press Escape to read the note with nothing revealed.
- Click Markdown, or press Ctrl+E, to see the whole source.

## Driving it with drive.mjs

Preconditions: a fresh run. A ready journey is `journeys/live-view.mjs`.

- **Page view.** A fresh run is in it. `page.getByLabel('Note text')` holds one block. Read it with `inputValue()`.
- **The drawn parts.** `[data-test-id=live-above]` and `[data-test-id=live-below]` hold the note above and below the field. Each drawn element has `data-row`, its first row in the note counted from 0. Out of focus there is no `live-above`: `[data-test-id=preview]` holds the whole note.
- **Type a note.** `await type('# Trip\n\nPack **light**\n\n- [ ] Passport')`. After each blank line the field holds only the newest block, and `live-above` shows the earlier ones drawn.
- **Arrows.** `await page.keyboard.press('ArrowUp')` and read `inputValue()` after each press. It walks `- [ ] Passport`, an empty string for the blank row, `Pack **light**`, and so on.
- **Click.** `await page.locator('.part strong').click()`. The field holds that paragraph and is focused. `selectionStart` is inside the bold word's source.
- **Idle.** `await page.keyboard.press('Escape')`. The field is no longer `document.activeElement`, `.editor` has the class `idle` and `[data-test-id=preview]` is visible.
- **Drawn box.** In `preview`, click a task box. It ticks and the field stays out of focus.
- **Saved.** The note in storage is always the whole note. Wait for "Saved", reload, click Markdown and read the field.

## Gotchas

- The field's value is a slice. To check the whole note, turn Markdown on or read storage.
- `page.locator('.part p')` matches every drawn paragraph in both parts.
- A click on a block element lands where its box is, which for a heading is often past the end of the words. Click an inline element (`strong`, `em`) to land inside a line.
- Arrow keys keep the caret's distance from the left edge when they cross into a block, but a blank row resets it to the start.
- Ctrl+Z only undoes typing done since the field last moved. There is no undo across blocks yet.
- Shift with an arrow does not select past the field. Turn Markdown on to select across blocks.
- The caret after a click on a table cell lands near the cell, not exactly at the character.
