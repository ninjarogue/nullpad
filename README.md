# scribbl

A markdown editor written in [Gleam](https://gleam.run) with
[Lustre](https://lustre.build). It runs in the browser and keeps its notes in
the browser's own storage.

## Development

```sh
gleam run -m lustre/dev start   # Serve the app at http://localhost:1234 and reload on change
gleam test                      # Run the tests (no browser needed)
gleam format src test           # Format the code
```

Styles live in `assets/scribbl.css`.
