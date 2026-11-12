# nullpad

A markdown note editor in Gleam with Lustre. Read this before changing code.

## Architecture rules

| Rule | Checked by |
| --- | --- |
| `buffer`, `vim`, `editor`, `live`, `markdown` and `library` are the pure core. They import no Lustre and no shell module, and their JavaScript touches no browser. | `gleam test` |
| `surface` is the only module that writes the text field, through `surface.sync`. | `gleam test` |
| An event decoder may measure the page but never changes it. The editor decides what a key does. | `gleam test` |
| The Gleam parser is the only code that knows markdown syntax. JavaScript parses no text. | `gleam test` |
| Only `surface`, `platform`, `markdown` and a storage backend call JavaScript. | `gleam test` |
| One storage interface. Only `src/nullpad.gleam` imports a backend. | `gleam test` |
| A typed key costs at most one parse, and a caret move costs none. | `test/keystroke_cost.mjs` |
| Every editor operation returns an `editor.Outcome`, so a write to the field cannot be forgotten. | the compiler |
| `app.gleam` routes messages. New behaviour goes in a pure module with unit tests first. | review |
| No wildcard `case` over our own variant types. | review |

The rules live in `test/architecture/rules.gleam`. It parses every Gleam file with glance, so it sees real imports, calls and string literals, and it reads the JavaScript line by line. `test/architecture_test.gleam` runs it over `src`, then breaks the architecture on purpose about fifty ways and checks that each break is caught for the right rule, that harmless code is not flagged, and that the known escapes are still listed as escapes.

- A rule that breaks twice gets a check, not a reminder: add it to `rules.gleam`, to this table, and add the break that proves it to `architecture_test.gleam`.
- New JavaScript counts as changing the page until it is listed under `measures` in `rules.gleam`. Drawing and decoding code may only call measures.
- `gleam run -m architecture_test` prints what each rule examined. A rule that examines nothing fails the test.

## Checks

```sh
gleam format --check src test
gleam test
node test/keystroke_cost.mjs
cd e2e && npx tsc && npm test
```

`.githooks/pre-push` runs all of them.

## Code

- Few comments. Keep one only for behaviour forced by the browser, Lustre or a spec, or for a public contract.
- On the JavaScript target only direct self tail calls become loops, and `string.trim` is quadratic on long runs of spaces. Code that runs on user text per key must be stack-safe and linear.
- A browser test waits for the redraw (`expect.poll`) before it measures a position, because the field is written before the page is drawn.
