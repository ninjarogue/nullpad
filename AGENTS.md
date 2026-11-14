# nullpad

A markdown note editor in Gleam with Lustre. Read this before changing code.

## Architecture rules

| Rule | Checked by |
| --- | --- |
| Every module is listed as core, shell or a storage backend. `buffer`, `vim`, `editor`, `history`, `live`, `markdown` and `library` are the pure core. | `gleam test` |
| A core module imports only `gleam/*` and other core modules. | `gleam test` |
| A core module's JavaScript touches no browser. | review |
| Every function says what it takes and returns. | `gleam test` |
| Only a function that returns an `Effect` or `Nil` may change the page. Drawing and decoding code may measure it. | `gleam test` |
| A decoder takes callbacks and plain values, never app state from the last drawn frame. The editor decides what a key does. | `gleam test`, and review for the second half |
| `surface` is the only module that draws the text field. | `gleam test` |
| `surface` is the only module that writes the text field, through `surface.sync`. | review |
| The Gleam parser is the only code that looks for markdown markers. JavaScript has no regex. | review |
| Only `surface`, `platform`, `markdown` and a storage backend call JavaScript, each its own `.ffi.mjs`. | `gleam test` |
| One storage interface. Only `src/nullpad.gleam` imports a backend. | `gleam test` |
| A public editor function that changes the editor returns an `editor.Outcome`, so a write to the field cannot be forgotten. | `gleam test` |
| Nothing draws raw HTML. | `gleam test` |
| An editor event costs at most one parse of the note when it changes the note, and none when it does not. The event that ends an IME composition does the one parse the composing keys skipped. | `test/keystroke_cost.mjs` |
| JavaScript listed as a measure changes nothing on the page. | review |
| `app.gleam` routes messages. New behaviour goes in a pure module with unit tests first. | review |
| No wildcard `case` over our own variant types. | review |

The rules live in `test/architecture/rules.gleam`. It parses every Gleam file with glance, so it sees real imports, calls, constants and types. It checks JavaScript only for where it lives. What JavaScript does, and who looks for markdown markers, are review rules: checks that matched their text let 40 of 46 breaks through and flagged ordinary code such as a `"-"` key name. `test/architecture_test.gleam` runs the rules over `src`, then breaks the architecture on purpose and checks that each break is caught for the right rule, that harmless code is not flagged, and that the known escapes are still listed as escapes. Every rule needs at least one break that proves it.

- A rule that breaks twice gets a check, not a reminder: add it to `rules.gleam`, to this table, and add the break that proves it to `architecture_test.gleam`.
- New JavaScript counts as changing the page until it is listed under `measures` in `rules.gleam`. Drawing and decoding code may only call measures.
- `gleam run -m architecture_test` prints what each rule examined. A rule that examines nothing fails the test.
- A check or script that judges code reads the syntax tree, not the text. Pick the tool that can see the real code before the one that is fastest to write, and ship the check with its break cases and the score from an attacker who is not its author.
- The check was wrong three times when only its author tested it. After adding a rule, have someone who has not read the break list try to get past it, and add what they find.
- The check is there to stop honest mistakes, not a determined dodge. Change it when a real mistake gets past it in a real PR, or when a rule is added. A rule that keeps cracking moves back to review.
- `test/keystroke_cost.mjs` sends every variant of `editor.Event`, with vim off and on. A new variant with no entry there fails.

## Checks

```sh
gleam format --check src test
gleam test
node test/keystroke_cost.mjs
cd e2e && npx tsc && npm test
```

`.githooks/pre-push` runs the format check, then `node test/test_counts.mjs run`, which runs every other step and holds each to the number of tests it ran last (`test/steps.mjs` says how each is run and read).

- A step that runs no tests, or fewer than `test/test_counts.json` knows, fails. The count is read from what the runner prints or writes (the e2e `report.json`), never from the source.
- A run with more tests raises the file. Commit it. Only a hand edit lowers a count, so a removal shows in the diff.
- Every config in `e2e/` is a step. A known count whose step is gone fails.
- `node --test test/test_counts.test.mjs` plants each of these with a fake runner.
- `tools/mutants` plants a bug at a time and runs these checks on it, to find the test that is missing. Its README says how. `node --test tools/mutants/mutants.test.mjs` is a step of the gate.

## Code

- Few comments. Keep one only for behaviour forced by the browser, Lustre or a spec, or for a public contract.
- On the JavaScript target only direct self tail calls become loops, and `string.trim` is quadratic on long runs of spaces. Code that runs on user text per key must be stack-safe and linear.
- A browser test waits for the redraw (`expect.poll`) before it measures a position, because the field is written before the page is drawn.
