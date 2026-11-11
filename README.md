# scribbl

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

Styles live in `assets/scribbl.css`.
