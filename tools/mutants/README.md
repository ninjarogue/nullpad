# Planted bugs

`mutants.mjs` plants one bug at a time in the source, runs the project's checks, and reports which bug no check noticed. A bug nobody notices is a test that is missing.

```sh
node tools/mutants/mutants.mjs --calibrate                      # only prove the checks can be trusted
node tools/mutants/mutants.mjs mutants.json                     # calibrate, then run every mutant
node tools/mutants/mutants.mjs mutants.json --only M03,M07      # some of them
node tools/mutants/mutants.mjs mutants.json --checks gleam-test # only some checks (build always runs)
```

A mutants file is a list of exact string replacements:

```json
[{ "id": "M01", "file": "src/nullpad/history.gleam", "desc": "a pause of 1 ms", "old": "pub const pause = 1000", "new": "pub const pause = 1" }]
```

## What it does

- Every `old` must match its file exactly once. Any that matches 0 or 2 or more times, changes nothing, or names a file that is not there stops the run before anything is planted.
- The git tree must be clean, at the start and after every mutant. A mutant is written back byte for byte after each run, and when the tool is stopped with Ctrl+C or killed with SIGTERM. A tool killed with SIGKILL leaves its bug planted, and the next run refuses to start: look at `git diff` and `git checkout -- <file>`.
- The checks run in the order `gleam build`, `gleam test`, `keystroke_cost`, then each e2e config (`npm test` with `--max-failures 1`). They are the gate's own steps (`test/steps.mjs`), so a runner is called and read one way. A mutant stops at the first check that fails.
- The full output of every check goes to `.mutants/<time>/<id>.<check>.txt`, with `results.jsonl` and `summary.md` beside them. The folder is ignored by git.

## What a result means

| Result | Meaning |
| --- | --- |
| CAUGHT | A check ran tests, reported a failed test, and exited non-zero. |
| MISSED | Every check passed. Write the test that fails on this bug. |
| INVALID | The bug does not build (`gleam build`, or `gleam test` failing to compile). It says nothing about the tests. |
| ERROR | The tool cannot say. A check printed "No tests found", ran 0 tests, crashed, printed no summary, was killed, timed out, or exited 0 with failures or non-zero without any. The run stops. It is never counted as CAUGHT. |

Exit codes: 0 when nothing was MISSED, 1 when something was, 2 when the run stopped (ERROR, a dirty tree, a bad mutant, a failed calibration).

## Calibration

A run of real mutants is refused until `calibration.json` comes out as it says, on the checks being run:

- each mutant under `caught` is CAUGHT by the check named in its `by`, and by no check before it. A check with no mutant of its own cannot be run.
- the `noop` is MISSED by every check. It is a change that cannot alter behavior, such as the wording of a comment.

A check that finds nothing in the known-caught mutant, or that fails on the no-op, cannot be trusted with the real ones. The calibration costs one run of every check, about five minutes with e2e.

If the source around a calibration mutant changes, its `old` stops matching and `node --test tools/mutants/mutants.test.mjs` fails. Change the mutant to match.

## Tests

`node --test tools/mutants/mutants.test.mjs` runs the tool on a toy git repository whose checks misbehave, and is a step of the gate.
