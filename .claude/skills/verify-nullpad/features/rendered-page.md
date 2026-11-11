# Rendered page

Ctrl+E or the Preview button swaps the text field for the note shown as a formatted page. The same key or the Edit button swaps back. Looking at the page never changes the note.

## Sub-features

- `page-toggle` both entry points flip to the page and back.
- `page-blocks` `#` to `######` are headings 1 to 6. A blank line splits paragraphs. Lines without one stay in one paragraph, each on its own line. Spaces at the start and end of a line are dropped.
- `page-inline` `**bold**`, `*italic*`, `_italic_`, `` `code` ``, `[label](url "title")`, and `\*` for a literal mark. The rules are CommonMark's, so marks may open on one line of a paragraph and close on the next, and `*[a*](url)` is a link with a star inside.
- `page-safe` typed HTML shows as text. A link renders only for http, https, mailto or a path, and opens in a new tab. Any other link shows whole, as it was typed.
- `page-fresh` the page shows the text as it is now, also after an edit.

## How to get to it (user POV)

- Press Ctrl+E while the text field has focus.
- Click the Preview button. Click Edit to go back.

## Driving it with drive.mjs

Preconditions: a fresh run. A ready journey is `journeys/rendered-page.mjs`.

- **Type markdown.** `await type('# Trip\n\nPack **light** and *early*, see [map](https://example.com/).')`.
- **Flip with the key.** `await page.keyboard.press('Control+e')`. `[data-test-id=preview]` is visible with one `h1`, one `strong`, one `em`, and a link whose `href` is the URL and `target` is `_blank`.
- **Line breaks.** Type `milk\neggs` as one paragraph. On the page, `await preview.locator('p').last().evaluate((p) => p.innerText)` is the two words with a line break between them, not a space.
- **Flip back with the button.** Click `Edit`. The text field shows the same text.
- **Edit and flip with the button.** Type more, click `Preview`. The page shows the new text.
- **Unsafe input.** Type `[x](javascript:alert(1))` and `<b>hi</b>`. The page has no link for the first and shows all of it as typed, and shows the tags of the second as text.

## Gotchas

- `_` never works inside a word (`snake_case` stays text), and a `*` beside a space is text. `gleam run -m commonmark_test` says which CommonMark examples pass.
- Nesting stops at 32 levels. Deeper pairs show their marks as text.
- Lists, quotes, fences, indented code, images, hard line breaks and `&amp;`-style entities are not built. They show as typed, as paragraph text.
- Read the DOM for checks. A screenshot cannot tell `<em>` from styled text.
- To check line breaks inside a paragraph, read the paragraph's `innerText`. `textContent` and whitespace-collapsing matchers cannot tell a line break from a space.
