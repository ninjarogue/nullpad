# nullpad

A markdown note editor in Gleam with Lustre. Read this before changing code.

## Architecture rules

| Rule | Checked by |
| --- | --- |
| Every module is listed as core, shell or a storage backend. `buffer`, `vim`, `editor`, `history`, `live`, `markdown` and `library` are the pure core. | `gleam test` |
| A core module imports only `gleam/*` and other core modules. | `gleam test` |
| A core module's JavaScript touches no browser. | review |
| Every function says what it takes and returns. | `gleam test` |
| Every test function in `test/*.gleam` is one gleeunit runs: public, no arguments, a name that ends in `_test`, no `@target(erlang)`. A private `*_test`, or a public function with no arguments and another name that asserts, panics, calls `gleeunit/should` or calls a function of its module that does, is a test that never runs. A `*_test` that takes arguments, or whose body is just `Nil`, runs and checks nothing. | `gleam test` |
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
- The test rule leaves four escapes to review, each listed as `Escapes` in `architecture_test.gleam` so that the day a rule catches one the test says so: a `_test` that asserts only in a closure nobody calls, one that returns before its assert (`use <- bool.guard(True, Nil)`), one that is an `@external` function whose JavaScript checks nothing, and a misnamed function that reaches its assert through a helper of another module. A `main` that reaches an assert only through other functions is not taken for a forgotten test.
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
- A run that ends with `test/test_counts.json` different from HEAD (raised by the run, edited by hand, staged and not committed) fails with `commit test/test_counts.json`, so a raise nobody committed cannot pass the hook. `node test/test_counts.mjs run --no-commit-check` skips that for a run kept on one machine and warns that it did. The hook never passes it.
- Tests that are not checks are held apart, each as its own line: `"<step> expected-fail"` (e2e `test.fail`) and `"<step> todo"` (node `test.todo`, `{ todo: true }`). They still count as run, so hiding a failing test behind either does not lower the count of passes. A rise in a held count fails the gate and needs a hand edit of the file, so it shows in the diff. A fall lowers the line, and it is removed at 0.
- Every config in `e2e/` is a step. A known count whose step is gone fails.
- Every file under `e2e/` that looks like a test (a test's name, or a call, with any arguments, through a binding that is the e2e test API) is one a config discovers. A binding is `test` or `describe` from `e2e` or `@e2e-dev/*`, an alias of one, what `extend` gave back, a default, namespace or dynamic import of the module, and any of these exported from a helper under any name and imported or re-exported from there. A `x.config.ts` below the top of `e2e/` is a file like any other. `node test/e2e_discovery.mjs` reads the files with oxc-parser and what each config selects from `e2e list`, and fails on a file no config loads. Bindings are followed by name through a file, not by scope, and an in-body `test.skip(condition, reason)` is not a registration. Its break cases are `node --test test/e2e_discovery.test.mjs`.
- Every `*.test.mjs` in the repository outside `node_modules` is a step of the gate, or the gate fails and names it.
- `node --test test/serve.test.mjs` sends the e2e server (`e2e/serve.mjs`) the requests that killed it, and checks it still answers.
- `git push` runs the gate only in a clone where `core.hooksPath` is `.githooks`. When it is not, a gate run by hand prints a `!!! WARNING` line saying so, pass or fail. Run `git config core.hooksPath .githooks` once per clone.
- The gate stops what it started when it gets SIGINT, SIGTERM or SIGHUP: the commands, their process groups and the `.e2e/step-*` folders go, and it exits 128 plus the signal.
- `node --test test/test_counts.test.mjs` plants each of these with a fake runner.
- A node test makes its temp directories with `useScratch` (`test/scratch.mjs`), which removes them when the file ends. `node --test test/scratch.test.mjs` runs every node test file with a private `TMPDIR` and fails on what is left. Every `*.test.mjs` under `test/` and `tools/` is a step of the gate.
- `tools/mutants` plants a bug at a time and runs these checks on it, to find the test that is missing. Its README says how. `node --test tools/mutants/mutants.test.mjs` is a step of the gate.

## Browser facts

`e2e/tests/browser-facts-table.ts` lists what the app assumes about Chromium that no spec promises, one fact each, and `e2e/tests/browser-facts.e2e.ts` looks at each on a plain page, not in the app. When Chromium changes one, that test fails first and says which Chromium, which fact, what it did instead and which line relies on it.

- Add a fact when code starts to rely on browser behavior, and when a comment says "Chromium" or "the browser" to explain why code is as it is. Each fact names the text of the code that relies on it (`relied`), which must be in the file exactly once, so a fact whose code is gone fails and says to update or remove it.
- `relied` must be code. The file is read with oxc-parser (`.mjs`, `.ts`), a Gleam scanner or a CSS scanner, and text that is only in a comment, only inside a string, or in CSS outside a rule is not counted. Name the code that does the relying, not the comment above it.
- A `pending` fact fails as soon as any of its `relied` text is code in the source: `pending fact now holds in source: un-pend it`.
- `holds` must name what it expects, and reject what no look at a page gives (`undefined`, `{}`, `[]`, `0`, `''`, and the rest of `nothingSeen`). `problemsWithTable` fails on a `holds` that takes one. So `observe` returns an object with a positive control, such as a typed key that does fire the event, and `holds` fails on a control that did not show.
- A fact that needs a secure context (the clipboard) sets `url`, and is served at that https address.
- Each fact has `breaks`, a change planted on the page that it must notice: the second test of every fact fails when the fact still holds with its sabotage planted. A fact no page can be made to break says why in `unbreakable`.
- A fact for code that is not merged yet is `pending`, with the reason.
- `e2e/tests/browser-facts-framework.e2e.ts` has the break cases for the machinery in `browser-facts.ts`.

## Code

- Few comments. Keep one only for behaviour forced by the browser, Lustre or a spec, or for a public contract.
- On the JavaScript target only direct self tail calls become loops, and `string.trim` is quadratic on long runs of spaces. Code that runs on user text per key must be stack-safe and linear.
- A browser test waits for the redraw (`expect.poll`) before it measures a position, because the field is written before the page is drawn.
