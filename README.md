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
and what the page shows when storage is slow or fails.

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
for what nullpad supports: headings, paragraphs, emphasis, code spans, inline
links and backslash escapes. `gleam test` runs the spec's 652 examples and
prints how many pass. An example may fail only when it is listed in
`test/commonmark_test.gleam` under the feature it needs and nullpad lacks, and
a listed example that starts to pass fails the suite until it is taken off the
list.

The page differs from the spec's own HTML in one way: a line break inside a
paragraph shows as a line break, not as a space. The parser keeps the break in
the text, and the page's style sheet decides how it looks.

```sh
gleam run -m commonmark_test            # Pass count for each section of the spec
gleam run -m commonmark_test -- Lists   # The listed examples of one missing feature
gleam build && node test/hostile_input.mjs   # Time the parser on inputs built to be slow
```

Styles live in `assets/nullpad.css`.
