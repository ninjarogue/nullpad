# nullpad

A markdown editor written in [Gleam](https://gleam.run) with
[Lustre](https://lustre.build). It runs in the browser and keeps its notes in
the browser's own storage.

## Development

```sh
gleam run -m lustre/dev start         # Serve the app at http://localhost:1234 and reload on change
gleam test                            # Run the unit tests
cd e2e && npm install && npm test     # Run the browser tests
gleam format src test                 # Format the code
```

`gleam test` covers the pure modules: the text buffer, the editor's rules,
markdown and note titles. The browser tests build the app and use it in
Chromium through [e2e](https://www.npmjs.com/package/e2e), so they cover
what a person does with it: writing, saving, switching and deleting notes,
ticking task boxes on the rendered page, what the page shows for each markdown
block, and what it shows when storage is slow or fails.

Both suites run before every `git push`, and a failure stops the push. Turn
that on once per clone:

```sh
git config core.hooksPath .githooks
cd e2e && npm install && npx @e2e-dev/web install chromium
```

The hook tests the files in your working folder, so commit or stash first.
`git push --no-verify` skips it.

## Markdown

The parser is hand-written and follows [CommonMark](https://spec.commonmark.org/0.31.2/)
for what nullpad supports: headings (`#` and underlined with `===` or `---`),
paragraphs, thematic breaks, block quotes with lazy lines, bullet and ordered
lists (nested, tight or loose), fenced and indented code blocks, emphasis,
code spans, inline links and backslash escapes. From GitHub Flavored Markdown
it adds strikethrough (`~one~` and `~~two~~`) and task lists (`- [ ]` and
`- [x]`). Tables, images, autolinks, link reference definitions, hard line
breaks and character entities are not read, and raw HTML shows as text.

On the rendered page a task's box is live. Ticking it changes `[ ]` to `[x]`
(or back) on that line of the note and nowhere else, and the note saves as it
does after any edit.

`gleam test` runs the spec's 652 examples and prints how many pass, 458 on
this commit. An example may fail only when it is listed in
`test/commonmark_test.gleam` under the feature it needs and nullpad lacks, and
a listed example that starts to pass fails the suite until it is taken off the
list. The GFM strikethrough and task list examples in `test/commonmark/gfm.json`
run the same way, and all 7 must pass.

The page differs from the spec's own HTML in two ways. A line break inside a
paragraph, a list item or a heading shows as a line break, not as a space: the
parser keeps the break in the text, and the page's style sheet decides how it
looks. A task's checkbox is not disabled, so it can be ticked.

```sh
gleam run -m commonmark_test                 # Pass count for each section of the spec
gleam run -m commonmark_test -- HardBreaks   # The listed examples of one missing feature
gleam build && node test/hostile_input.mjs   # Time the parser on inputs built to be slow
```

`gleam run -m commonmark_test` names the features that can be listed. The
browser tests in `e2e/tests/blocks.e2e.ts`, `tasks.e2e.ts` and `layout.e2e.ts`
check what the page shows for these blocks and where the task boxes sit at 390
and 1280 px, in light and dark.

Styles live in `assets/nullpad.css`.
