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
| A handler is never handed app state. A function that makes a handler or decoder takes only message callbacks and plain values: no `Editor`, `History`, `Library`, vim `State` or type that holds one, such as the `Model`, and no callback that hands back more than a message. It reads the editor the last message left through a record, `current_editor()`, when the event comes: in a closure, a capture, the rest of a decoder's `use` or the callback of `effect.from`, `before_paint` or `after_paint`. A function that makes handlers, or calls one that does, reads no record while it runs, and no function hands one a closure over app state. The app notes its first editor before any event can come, and each `sync` notes the next. A buffer is not app state: the field reports one with each event. No measure hands back app state. The editor decides what a key does. | `gleam test`. Review covers a plain value, or a record of plain values, read from app state and handed to a maker; a message built from app state and sent later; a closure that a helper hands back or calls at once; what a measure's JavaScript reads; and the last sentence |
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
- JavaScript that hands back app state an effect noted there, such as the editor the last message left, is listed under `records`. A record takes no argument: the app notes the editor before any event and in every `sync`, so there is always one to read, and a handler reads it when its event comes. A measure whose Gleam type hands back app state fails until it is listed as a record.
- The handler rule is structural on purpose. It looks at what a maker takes, at when a record is read, and at closures handed to a maker, to Lustre's `element.map` or `effect.map`, or to our JavaScript that takes a callback. Types are matched by module and name. It follows a name only inside one function, through `let`, `case` and `use`, and a name the function binds stands for a local only inside the scope that binds it and after it is bound. What it lets through is listed as `Escapes` in `architecture_test.gleam`, and review catches it.
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

`.githooks/pre-push` runs all of them, then the short robot typist run.

The robot typist (`e2e/typist/`) types random key scripts into a plain textarea and into nullpad in Chromium and compares text, cursor and selection. `cd e2e && npm run typist` is the short run (120 scripts); `npm run typist:long -- --count 3000 --seed 7` is the long one. A failure prints the seed, the shrunk script and a replay command. `e2e/typist/known.mjs` is the one list of known differences, each with its reason; an open bug's keys are left out until its repro stops differing, and then the run fails until the entry is deleted. `--no-known` types everything.

A bug fix lands with its failing test in an earlier commit, written from the goal before the fix.

## Code

- Few comments. Keep one only for behaviour forced by the browser, Lustre or a spec, or for a public contract.
- On the JavaScript target only direct self tail calls become loops, and `string.trim` is quadratic on long runs of spaces. Code that runs on user text per key must be stack-safe and linear.
- A browser test waits for the redraw (`expect.poll`) before it measures a position, because the field is written before the page is drawn.
