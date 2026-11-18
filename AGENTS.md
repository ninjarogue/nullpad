# nullpad

A markdown note editor in Gleam with Lustre. Read this before changing code. How we work (tests first, break-it gate, failure modes, check reviews) is in [docs/PROCESS.md](docs/PROCESS.md).

## Architecture rules

| Rule | Checked by |
| --- | --- |
| Every module is listed as core, shell or a storage backend. `buffer`, `vim`, `editor`, `history`, `live`, `markdown` and `library` are the pure core. | `gleam test` |
| A core module imports only `gleam/*` and other core modules. | `gleam test` |
| A core module's JavaScript touches no browser. | review |
| Every function says what it takes and returns. | `gleam test` |
| Every test function in `test/*.gleam` is one gleeunit runs: public, no arguments, a name that ends in `_test`, no `@target(erlang)`. A private `*_test`, or a public function with no arguments and another name that asserts, panics, calls `gleeunit/should` or calls a function of its module that does, is a test that never runs. A `*_test` in a module whose name does not end in `_test` is never run either. A `*_test` that takes arguments, whose body is just `Nil`, or that reaches no `assert`, `let assert`, `panic`, `todo` or `gleeunit/should` call (through helpers of any module of `test/`), runs and checks nothing. | `gleam test` |
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
- The test rule leaves four escapes to review, each listed as `Escapes` in `architecture_test.gleam` so that the day a rule catches one the test says so: a `_test` that asserts only in a closure nobody calls, one that returns before its assert (`use <- bool.guard(True, Nil)`), one that is an `@external` function whose JavaScript checks nothing, and a misnamed function that reaches its assert through a helper of another module. A `main` that reaches an assert only through other functions is not taken for a forgotten test.
- `test/keystroke_cost.mjs` sends every variant of `editor.Event`, with vim off and on. A new variant with no entry there fails.

## Checks

```sh
gleam format --check src test
gleam test
node test/keystroke_cost.mjs
cd e2e && npx tsc && npm test
```

`.githooks/pre-push` runs the format check, then `node test/test_counts.mjs run`, which runs every other step and holds each to the number of tests it ran last (`test/steps.mjs` says how each is run and read), then the short robot typist run.

- A step that runs no tests, or fewer than `test/test_counts.json` knows, fails. The count is read from what the runner prints or writes (the e2e `report.json`), never from the source.
- A run with more tests raises the file. Commit it. Only a hand edit lowers a count, so a removal shows in the diff.
- A run that ends with `test/test_counts.json` different from HEAD (raised by the run, edited by hand, staged and not committed) fails with `commit test/test_counts.json`, so a raise nobody committed cannot pass the hook. `node test/test_counts.mjs run --no-commit-check` skips that for a run kept on one machine and warns that it did. The hook never passes it.
- Tests that are not checks are held apart, each as its own line: `"<step> expected-fail"` (e2e `test.fail`) and `"<step> todo"` (node `test.todo`, `{ todo: true }`). They still count as run, so hiding a failing test behind either does not lower the count of passes. A rise in a held count fails the gate and needs a hand edit of the file, so it shows in the diff. A fall lowers the line, and it is removed at 0.
- Every config in `e2e/` is a step. A known count whose step is gone fails. Two steps with one id fail the gate before any runs, because one count is kept for an id. A key twice in `test/test_counts.json` fails it too: `JSON.parse` keeps the last, so the other count would hold nothing.
- Every file under `e2e/` that looks like a test (a test's name, or a call, with any arguments, through a binding that is the e2e test API) is one a config discovers. A binding is `test` or `describe` from `e2e` or `@e2e-dev/*`, an alias of one, what `extend` gave back, a default, namespace or dynamic import of the module, and any of these exported from a helper under any name and imported or re-exported from there. A `x.config.ts` below the top of `e2e/` is a file like any other. `node test/e2e_discovery.mjs` reads the files with oxc-parser and what each config selects from `e2e list`, and fails on a file no config loads. Bindings are followed by name through a file, not by scope, and an in-body `test.skip(condition, reason)` is not a registration. Its break cases are `node --test test/e2e_discovery.test.mjs`.
- Every `*.test.mjs` in the repository outside `node_modules` is a step of the gate, or the gate fails and names it.
- `node --test test/serve.test.mjs` sends the e2e server (`e2e/serve.mjs`) the requests that killed it, and checks it still answers.
- `git push` runs the gate only in a clone where `core.hooksPath` is `.githooks`. When it is not, a gate run by hand prints a `!!! WARNING` line saying so, pass or fail. Run `git config core.hooksPath .githooks` once per clone.
- The gate stops what it started when it gets SIGINT, SIGTERM or SIGHUP: the commands, their process groups and the `.e2e/step-*` folders go, and it exits 128 plus the signal.
- `node --test test/test_counts.test.mjs` plants each of these with a fake runner.
- A node test makes its temp directories with `useScratch` (`test/scratch.mjs`), which removes them when the file ends. `node --test test/scratch.test.mjs` runs every node test file with a private `TMPDIR` and fails on what is left. Every `*.test.mjs` under `test/` and `tools/` is a step of the gate.
- `tools/mutants` plants a bug at a time and runs these checks on it, to find the test that is missing. Its README says how. `node --test tools/mutants/mutants.test.mjs` is a step of the gate.
- A commit that fixes a bug ends with a `Caught-by:` line naming what found it: a test file, `keystroke_cost`, `hostile_input`, the robot typist, the planted-bug harness, a blind break-it pass, a review, or `aric` for a bug found by hand. The weekly check review counts these lines to see which checks earn their keep.
- Tools that check our tests (the test-count gate, the planted-bug harness, e2e discovery) and their own tests change only when a real slip gets past them in a real PR, the same rule as the architecture check. No attack rounds for their own sake.
- No check is deleted, merged or loosened without aric's approval in the weekly check review or the PR.

The robot typist (`e2e/typist/`) types random key scripts into a plain textarea and into nullpad in Chromium and compares text, cursor and selection. `cd e2e && npm run typist` is the short run (96 random scripts, 3 block tours, and a phone pass); `npm run typist:long -- --count 3000 --seed 7` is the long one. A failure prints the seed, the shrunk script and a replay command. `e2e/typist/known.mjs` is the one list of known differences, each with its reason; an open bug's keys are left out until its repro stops differing, and then the run fails until the entry is deleted. `--no-known` types everything.

Three checks look at the browser from outside the page, over the DevTools protocol. Each was shown failing on a planted bug.

- Every error and warning the browser reports fails the e2e test or typist script that caused it (`e2e/browser-problems.mjs`, started before the page loads). `noise` there lists the only ones allowed, each with its reason. A test that provokes one on purpose takes it with `page.takeProblems()`.
- A touch in a test is a real finger on a phone (`e2e/tests/finger.ts`), never a `PointerEvent` sent from the page: the browser then sends its own trusted events in its own order.
- After every key of a typist script typed a frame at a time or slowly, the typist reads where the page paints each block (`e2e/typist/shifts.mjs`; the rule is at the top of `run.mjs`, its tests are `node --test test/typist_shifts.test.mjs`, a step of the gate) and fails when a key moved a block it had no business moving. A shift we know about is an `open` entry with a `shift` and a repro in `known.mjs`.

The typist also types seeded block tours, because random scripts rarely walk the cursor into every kind of block. A tour pastes one block of every kind (all heading levels, both setext forms, lists, tasks, quote, fence, indented code, table, rule), walks the cursor down through every row and back up, a frame at a time. A run also types shorter random scripts and two tours on a phone (390x844, mobile, touch), where `--task-pad` and the widths differ; `--phone` types a whole run there.

`e2e/tests/held-frame.e2e.ts` reads the page in the frame a key was handled in, before it draws, which the typist's settled read cannot see: it holds the page's frames back, presses the keys that make the text field another kind of block, and expects nothing to have moved.

A bug fix lands with its failing test in an earlier commit, written from the goal before the fix. A planted bug that a check missed gets a test of its own, shown failing with the plant and passing without it.

## Browser facts

`e2e/tests/browser-facts-table.ts` lists what the app assumes about Chromium that no spec promises, one fact each, and `e2e/tests/browser-facts.e2e.ts` looks at each on a plain page, not in the app. When Chromium changes one, that test fails first and says which Chromium, which fact, what it did instead and which line relies on it.

- Add a fact when code starts to rely on browser behavior, and when a comment says "Chromium" or "the browser" to explain why code is as it is. Each fact names the text of the code that relies on it (`relied`), which must be in the file exactly once, so a fact whose code is gone fails and says to update or remove it.
- `relied` must be code, and its `file` must be under `src/` or `assets/`: a test, a tool or a build output holds whether or not the app relies on it, so any other path (and one that climbs out with `..`) fails, and `problemsWithTable` says so, a pending fact included. The file is read with oxc-parser (`.mjs`, `.ts`), a Gleam scanner or a CSS scanner, and text that is only in a comment, only inside a string or a regular expression, or in CSS outside a rule is not counted. Name the code that does the relying, not the comment above it.
- Known limit: the CSS scanner reads braces and not conditions, so a rule inside `@media not all` or an `@supports` that never matches counts as a rule that applies. `e2e/tests/browser-facts-framework.e2e.ts` keeps a case for it, which fails the day the scanner stops doing that.
- `relied` must stand on name boundaries: text that starts or ends with a letter, digit, `_`, `$` or `-` is not counted inside a longer name, so `press.detail > 2` is not in `mypress.detail > 2` and `margin-top: calc(1lh);` is not in `--margin-top: calc(1lh);`. Known limits, each with a case in the framework test: code that never runs, a CSS declaration that a later rule overrides, and one inside `@media print` still count as code that relies on a fact.
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
