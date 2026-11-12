# Rendered page

The note is drawn as a formatted page. With the text field out of focus (Escape), the whole note is drawn in `[data-test-id=preview]`. The Markdown button or Ctrl+E makes the field hold the whole note as raw markdown, and the same again goes back to the page. Looking at the page never changes the note.

## Sub-features

- `page-toggle` the Markdown button and Ctrl+E both turn raw markdown on and off, and each gives the text field focus. `aria-pressed` is "true" while it is on. The choice is remembered in localStorage `nullpad.markdown`, and a fresh browser starts with it off.
- `page-blocks` `#` to `######` are headings 1 to 6. A line of text with `===` under it is a level 1 heading, and with `---` under it a level 2 heading. A blank line splits paragraphs. Lines without one stay in one paragraph, each on its own line, and each line of a setext heading is on its own line too. Spaces at the start and end of a line are dropped.
- `page-inline` `**bold**`, `*italic*`, `_italic_`, `` `code` ``, `[label](url "title")`, and `\*` for a literal mark. The rules are CommonMark's, so marks may open on one line of a paragraph and close on the next, and `*[a*](url)` is a link with a star inside.
- `page-strike` `~one~` and `~~two~~` strike text through, and `~~~three~~~` stays text. Strikethrough does not reach across a blank line.
- `page-lists` `-`, `*` and `+` make bullet lists, `1.` makes an ordered list. An ordered list that starts at `3.` shows 3, 4, and one that starts at `0.` shows 0. A line indented two spaces under an item is a list inside it. A different bullet character starts a new list. Items with no blank line between them have no paragraph. A blank line between items puts a paragraph in each item. Each typed line of an item is on its own line.
- `page-quote` `>` makes a block quote. A line with no `>` right after a quoted line stays in the quote. A blank line ends the quote. A list may sit inside a quote.
- `page-code` a fence of three backticks or three tildes, or lines indented four spaces, make a code block. Markdown and HTML inside it show as text. The word after the fence is the block's language, as a class `language-<word>` on the `code`. A long line scrolls inside the block.
- `page-rule` `***`, `---` and `___` on a line of their own make a thematic break.
- `page-tables` a line of `|` separated cells, then a delimiter row of dashes, then more rows, is a table. The pipes at the ends of a row are optional. A colon at the left, the right or both ends of a column's dashes aligns that column's heading and cells left, right or in the centre. A row with too few cells gets empty ones and a row with too many loses the extra. `\|` is a pipe inside a cell. A cell takes inline markup and links. A blank line ends the table. A table may sit in a list item or a quote. A wide table scrolls sideways inside its own box, the box takes the keyboard, and the page never scrolls sideways.
- `page-safe` typed HTML shows as text. A link renders only for http, https, mailto or a path, and opens in a new tab. Any other link shows whole, as it was typed.
- `page-fresh` the page shows the text as it is now, also after an edit made with Markdown on.
- `page-tasks` `- [ ]` and `- [x]` items are boxes that tick the note. See [Task lists](./task-lists.md).

## How to get to it (user POV)

- The page is the default view. Press Escape in the text field to draw the whole note.
- Click the Markdown button, or press Ctrl+E, to see and edit the whole note as markdown. Do the same again to go back.

## Driving it with drive.mjs

Preconditions: a fresh run. Ready journeys are `journeys/rendered-page.mjs` for text, links and unsafe input, `journeys/blocks.mjs` for the blocks and how they look, `journeys/tasks.mjs` for task boxes, `journeys/tables.mjs` for tables and `journeys/live-view.mjs` for the field on one block.

- **Type markdown.** Click the Markdown button, wait until the text field has focus, then `await type('# Trip\n\nPack **light** and *early*, see [map](https://example.com/).')`.
- **Show the page.** `await page.keyboard.press('Control+e')`, wait for the field to take focus, then `await page.keyboard.press('Escape')`. `[data-test-id=preview]` is visible with one `h1`, one `strong`, one `em`, and a link whose `href` is the URL and `target` is `_blank`.
- **Line breaks.** Type `milk\neggs` as one paragraph. On the page, `await preview.locator('p').last().evaluate((p) => p.innerText)` is the two words with a line break between them, not a space. The same read on an `li` or an `h1` works for a list item and a setext heading.
- **Back to markdown with the button.** Click `Markdown`. The text field shows the whole note as typed.
- **Edit and show the page.** Type more, click `Markdown` again, press Escape. The page shows the new text.
- **Unsafe input.** Type `[x](javascript:alert(1))` and `<b>hi</b>`. The page has no link for the first and shows all of it as typed, and shows the tags of the second as text.
- **Blocks.** Type a note with `~~long~~`, a nested `-` list, `3.` and `4.` items, a `>` line followed by a line without one, `***`, and a fence of ```` ```gleam ````. The page has `del`, `ul > li > ul > li`, `ol[start="3"]`, one `blockquote` holding both quote lines, one `hr` and `pre > code.language-gleam`.
- **Tables.** Type `| Item | Qty | Price |`, `| :--- | :-: | ----: |` and two rows on their own lines, one with `**bold**`, a code span and `[map](https://example.com/)` in its cells. The page has one `table` in a `.table-scroll` box, `th` cells `Item`, `Qty`, `Price`, and `td` cells in the rows. `getComputedStyle(cell).textAlign` is `left`, `center`, `right` for the three columns. Type a second table with eight columns of long words and set `await page.setViewportSize({ width: 390, height: 844 })`: `.table-scroll` has `scrollWidth > clientWidth` and `document.documentElement.scrollWidth <= innerWidth`. Press Tab until the box has focus (its `activeElement` has class `table-scroll`), press ArrowRight, and its `scrollLeft` grows. Turn Markdown on, change a cell, turn it off and press Escape: the page shows it.
- **Looks.** `await page.emulateMedia({ colorScheme: 'dark' })` and `await page.setViewportSize({ width: 390, height: 844 })` give the dark page and a phone-wide window. Take a `shot` of each and look at them.

## Gotchas
- The Markdown button and Ctrl+E give the text field focus a moment after they act. Wait until `document.activeElement` is the field before typing or pressing Escape, or the key is lost.
- The page is only in `[data-test-id=preview]` when the field is out of focus. With the field focused it is split into `live-above` and `live-below`.
- `_` never works inside a word (`snake_case` stays text), and a `*` beside a space is text. `gleam run -m commonmark_test` says which CommonMark examples pass.
- Nesting stops at 32 levels. Deeper pairs show their marks as text. A line of 10,000 `>` and then `end` shows 32 nested quotes with the rest of the marks as text, and 10,000 `- ` and then `end` shows 32 nested lists.
- A line of only `- ` repeated is a thematic break, not a list.
- `---` right under a line of text makes that line a level 2 heading. Leave a blank line before it for a rule.
- A code block's text ends with a newline, so read it with `textContent`, not a whitespace-collapsing matcher.
- Images, autolinks, reference links, hard line breaks, `&amp;`-style entities and raw HTML are not built. They show as typed, as paragraph text. `![alt](https://x.test/a.png)` shows as a `!` followed by a link named alt.
- A heading row with no delimiter row under it is paragraph text, and so is a delimiter row whose cell count differs from the heading's. `a | b` then `-|-` is a table, and `a | b | c` then `-|-` is not.
- A table's rows are read as cells, not as lines: a line without a pipe right under a table is a row of one cell, and only a blank line (or another block, such as `>` or `#`) ends it. The line right above the delimiter row is the heading row. Lines above it with no blank line between stay a paragraph of their own.
- Every table box is a tab stop, also when its table fits. Chromium focuses a box that scrolls without being told to, so a check that Tab reaches it passes without the `tabindex` that Safari needs: read the attribute too.
- Showing the page again rebuilds it, so a table scrolled to the right is back at the left after Markdown on and off.
- The first cell of a table with words names a note that starts with one, in the list and as the title offered.
- Past 65,536 empty padded cells (1,000 columns over rows of one cell is 66 rows) the next line starts a paragraph. cmark-gfm stops at 524,288, which took Chromium four seconds to show.
- Alignment is the `align` attribute on the `th` and `td`, and the style sheet turns it into `text-align`. Measure it with `getComputedStyle`, or from where the cell's text sits inside the cell.
- Read the DOM for checks. A screenshot cannot tell `<em>` from styled text.
- To check line breaks inside a paragraph, a list item or a heading, read the element's `innerText`. `textContent` and whitespace-collapsing matchers cannot tell a line break from a space.
- A pointer resting on a ticked box makes Chromium draw it darker. A screenshot taken just after a click shows that, not a different state.
