# scribbl

A markdown editor written in [Gleam](https://gleam.run) with
[Lustre](https://lustre.build). It runs in the browser and keeps its notes in
the browser's own storage.

## Development

```sh
gleam run -m lustre/dev start         # Serve the app at http://localhost:1234 and reload on change
gleam test                            # Run the unit tests
cd e2e && npm install && npx e2e run  # Run the browser tests
gleam format src test                 # Format the code
```

`gleam test` covers the pure modules: the text buffer, the editor's rules,
markdown and note titles. The browser tests build the app and use it in
Chromium through [e2e](https://www.npmjs.com/package/e2e), so they cover
what a person does with it: writing, saving, switching and deleting notes,
and what the page shows when storage is slow or fails.

Styles live in `assets/scribbl.css`.
