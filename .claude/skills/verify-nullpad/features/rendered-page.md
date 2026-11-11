# Rendered page

Ctrl+E or the Preview button swaps the text field for the note shown as a formatted page. The same key or the Edit button swaps back. Looking at the page never changes the note.

## Sub-features

- `page-toggle` both entry points flip to the page and back.
- `page-blocks` `#` to `######` are headings 1 to 6. A line of text with `===` under it is a level 1 heading, and with `---` under it a level 2 heading. A blank line splits paragraphs. Lines without one stay in one paragraph, each on its own line, and each line of a setext heading is on its own line too. Spaces at the start and end of a line are dropped.
- `page-inline` `**bold**`, `*italic*`, `_italic_`, `` `code` ``, `[label](url "title")`, and `\*` for a literal mark. The rules are CommonMark's, so marks may open on one line of a paragraph and close on the next, and `*[a*](url)` is a link with a star inside.
- `page-strike` `~one~` and `~~two~~` strike text through, and `~~~three~~~` stays text. Strikethrough does not reach across a blank line.
- `page-lists` `-`, `*` and `+` make bullet lists, `1.` makes an ordered list. An ordered list that starts at `3.` shows 3, 4, and one that starts at `0.` shows 0. A line indented two spaces under an item is a list inside it. A different bullet character starts a new list. Items with no blank line between them have no paragraph. A blank line between items puts a paragraph in each item. Each typed line of an item is on its own line.
- `page-quote` `>` makes a block quote. A line with no `>` right after a quoted line stays in the quote. A blank line ends the quote. A list may sit inside a quote.
- `page-code` a fence of three backticks or three tildes, or lines indented four spaces, make a code block. Markdown and HTML inside it show as text. The word after the fence is the block's language, as a class `language-<word>` on the `code`. A long line scrolls inside the block.
- `page-rule` `***`, `---` and `___` on a line of their own make a thematic break.
- `page-safe` typed HTML shows as text. A link renders only for http, https, mailto or a path, and opens in a new tab. Any other link shows whole, as it was typed.
- `page-fresh` the page shows the text as it is now, also after an edit.
- `page-tasks` `- [ ]` and `- [x]` items are boxes that tick the note. See [Task lists](./task-lists.md).

## How to get to it (user POV)

- Press Ctrl+E while the text field has focus.
- Click the Preview button. Click Edit to go back.

## Driving it with drive.mjs

Preconditions: a fresh run. Ready journeys are `journeys/rendered-page.mjs` for text, links and unsafe input, `journeys/blocks.mjs` for the blocks and how they look, and `journeys/tasks.mjs` for task boxes.

- **Type markdown.** `await type('# Trip\n\nPack **light** and *early*, see [map](https://example.com/).')`.
- **Flip with the key.** `await page.keyboard.press('Control+e')`. `[data-test-id=preview]` is visible with one `h1`, one `strong`, one `em`, and a link whose `href` is the URL and `target` is `_blank`.
- **Line breaks.** Type `milk\neggs` as one paragraph. On the page, `await preview.locator('p').last().evaluate((p) => p.innerText)` is the two words with a line break between them, not a space. The same read on an `li` or an `h1` works for a list item and a setext heading.
- **Flip back with the button.** Click `Edit`. The text field shows the same text.
- **Edit and flip with the button.** Type more, click `Preview`. The page shows the new text.
- **Unsafe input.** Type `[x](javascript:alert(1))` and `<b>hi</b>`. The page has no link for the first and shows all of it as typed, and shows the tags of the second as text.
- **Blocks.** Type a note with `~~long~~`, a nested `-` list, `3.` and `4.` items, a `>` line followed by a line without one, `***`, and a fence of ```` ```gleam ````. The page has `del`, `ul > li > ul > li`, `ol[start="3"]`, one `blockquote` holding both quote lines, one `hr` and `pre > code.language-gleam`.
- **Looks.** `await page.emulateMedia({ colorScheme: 'dark' })` and `await page.setViewportSize({ width: 390, height: 844 })` give the dark page and a phone-wide window. Take a `shot` of each and look at them.

## Gotchas

- `_` never works inside a word (`snake_case` stays text), and a `*` beside a space is text. `gleam run -m commonmark_test` says which CommonMark examples pass.
- Nesting stops at 32 levels. Deeper pairs show their marks as text. A line of 10,000 `>` and then `end` shows 32 nested quotes with the rest of the marks as text, and 10,000 `- ` and then `end` shows 32 nested lists.
- A line of only `- ` repeated is a thematic break, not a list.
- `---` right under a line of text makes that line a level 2 heading. Leave a blank line before it for a rule.
- A code block's text ends with a newline, so read it with `textContent`, not a whitespace-collapsing matcher.
- Tables, images, autolinks, reference links, hard line breaks, `&amp;`-style entities and raw HTML are not built. They show as typed, as paragraph text. `![alt](https://x.test/a.png)` shows as a `!` followed by a link named alt.
- Read the DOM for checks. A screenshot cannot tell `<em>` from styled text.
- To check line breaks inside a paragraph, a list item or a heading, read the element's `innerText`. `textContent` and whitespace-collapsing matchers cannot tell a line break from a space.
- A pointer resting on a ticked box makes Chromium draw it darker. A screenshot taken just after a click shows that, not a different state.
