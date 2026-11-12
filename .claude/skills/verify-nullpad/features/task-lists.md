# Task lists

A `- [ ]` or `- [x]` item shows on the page as a box, also while the field has focus. Ticking the box changes that one line of the note, and the note saves like any other edit.

## Sub-features

- `task-box` `- [ ]` is an unticked box and `- [x]` or `- [X]` a ticked one, named by the item's text. An item with no marker has no box. `- [ ] buy **fresh** milk` is named "buy fresh milk", and an item with no words is named "Task".
- `task-click` a mouse click ticks the box without giving the text field focus, and changes `[ ]` to `[x]` on that line. A click on a ticked box changes `[x]` back to `[ ]`.
- `task-key` Tab reaches a box and Space ticks or unticks it. Focus stays on the box, so Space again undoes it.
- `task-source` a tick changes the box on its own line and no other character of the note, trailing spaces and blank lines included.
- `task-save` after a tick the status reads "Unsaved", then "Saved". After a reload the text field and the boxes agree with the tick.
- `task-nest` a task in a nested list, in a quote or in an ordered list ticks its own line. A task below a setext heading, a code block and a quote ticks its own line. Of two tasks with the same words, the one clicked ticks.
- `task-text` `[ ]` is text, not a box, inside a code block (fenced or indented), at the start of a paragraph outside a list, after other words in an item (`- foo [ ] bar`), glued to the word after it (`- [ ]x`), and in `- [@] foo`.
- `task-title` the note list titles a note that starts with `- [ ] buy milk` as "buy milk".
- `task-layout` the box sits where a bullet would, level with the first line of the item, with room before the text. An ordered task keeps its number before the box. At a 390 px window, and on a touch screen, the box is 24px square and rows are at least 44px apart. At 1280 px with a mouse it is 20px. The style sheet's rule is `max-width: 40rem` or `pointer: coarse`.

## How to get to it (user POV)

- Open a note that has task items and press Escape in the text field, so the whole note is drawn.
- Click a box with the mouse, or tap it on a phone.
- Press Tab until a box has the focus ring, then press Space.

## Driving it with drive.mjs

Preconditions: a fresh run. A ready journey is `journeys/tasks.mjs`.

- **Type.** Click the Markdown button and wait for the field to have focus. `await type('# Shopping\n\n- [ ] buy milk\n- [ ] call mom\n- [x] pay rent')`. The text field has exactly that text, with nothing added after Enter.
- **Show the page.** Click `Markdown` again, then press Escape. The box handle is `preview.getByRole('checkbox', { name: 'buy milk' })`, with `preview = page.locator('[data-test-id=preview]')`. Scope to the page, because the Vim switch, when the app offers it, is a checkbox too. `isChecked()` is false for `buy milk` and true for `pay rent`.
- **Tick with the mouse.** `await box.click()`. The box is ticked and the others are as they were.
- **Tick with the keyboard.** Press `Tab` and read `document.activeElement.getAttribute('aria-label')` after each press until it is the box's name, then press `Space`. Loop with a cap, because the starting point differs after a click.
- **Back to markdown.** Click `Markdown`. The text field shows `[x]` on the lines that were ticked and every other character as typed.
- **Reload.** The status still reads "Saved" for a moment after a tick, so wait for "Unsaved" first, then for "Saved", then `await page.reload()`. A reload less than a second after a tick loses it. The text field has the ticks. The Markdown choice is remembered, so the field holds the note; click `Markdown` and press Escape: the same boxes are ticked.
- **Untick.** Click a ticked box. Turn Markdown on and `[x]` is `[ ]` on that line only.
- **Phone.** `await page.setViewportSize({ width: 390, height: 844 })`. `await box.boundingBox()` is at least 24 by 24.

## Gotchas

- Read the source to prove a tick: the line in the text field is the note. A reload proves it was saved.
- Two tasks with the same words have two boxes with the same name. Pick with `.nth(i)`.
- Only the box ticks. A click or tap on the words of a task does nothing.
- A pointer resting on a ticked box makes Chromium draw it darker (green `rgb(47, 111, 94)` becomes `rgb(30, 72, 61)` in the light scheme). A screenshot taken right after a click shows that, not a different state.
- `1. [ ] first` shows "1." and then the box. A bullet task shows no dot.
- The note list titles by the words of the task, not the marker. `- [x] already done` is "already done".
