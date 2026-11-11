# Rendered page

Ctrl+E or the Preview button swaps the text field for the note shown as a formatted page. The same key or the Edit button swaps back. Looking at the page never changes the note.

## Sub-features

- `page-toggle` both entry points flip to the page and back.
- `page-blocks` `#` to `######` are headings 1 to 6. A blank line splits paragraphs. Lines without one join with a space.
- `page-inline` `**bold**`, `*italic*`, `_italic_`, `` `code` ``, `[label](url)`, and `\*` for a literal mark.
- `page-safe` typed HTML shows as text. A link renders only for http, https, mailto or a path, and opens in a new tab.
- `page-fresh` the page shows the text as it is now, also after an edit.

## How to get to it (user POV)

- Press Ctrl+E while the text field has focus.
- Click the Preview button. Click Edit to go back.

## Driving it with drive.mjs

Preconditions: a fresh run. A ready journey is `journeys/rendered-page.mjs`.

- **Type markdown.** `await type('# Trip\n\nPack **light** and *early*, see [map](https://example.com/).')`.
- **Flip with the key.** `await page.keyboard.press('Control+e')`. `[data-test-id=preview]` is visible with one `h1`, one `strong`, one `em`, and a link whose `href` is the URL and `target` is `_blank`.
- **Flip back with the button.** Click `Edit`. The text field shows the same text.
- **Edit and flip with the button.** Type more, click `Preview`. The page shows the new text.
- **Unsafe input.** Type `[x](javascript:alert(1))` and `<b>hi</b>`. The page has no link for the first and shows the tags of the second as text.

## Gotchas

- Rules are simpler than CommonMark until M2b: a mark closes only a run of the same symbol and length, and `_` never works inside a word (`snake_case` stays text).
- Nesting stops at 32 levels. Deeper pairs show their marks as text.
- Lists, quotes and fences are not built. They render as paragraphs or nothing.
- Read the DOM for checks. A screenshot cannot tell `<em>` from styled text.
