# How we work on nullpad

nullpad is built by Claude agents, with aric deciding direction. This page is the process. `AGENTS.md` holds the code rules and the checks that enforce them.

## Who does what

- **aric** picks direction, approves anything that cannot be undone, and picks which new checks get built.
- **Agents** write the code, the tests and the reports. Model per job: Sonnet for code, Opus (high) for bug fixes, Haiku for swarms and users-trying-the-app, Fable for architecture, Opus for judgment.
- Testing work (driving Chromium, running suites) goes to Sonnet or Haiku, not the main model.

## Before a big decision

Research how others solve it first (Haiku subagents), then put our option next to theirs and say which is better and why. We don't have to follow the research.

## Making a change

1. **Failing test first.** Write the test that shows the goal, watch it fail, then fix. The test checks the goal, not the fix.
2. **Pure core first.** New behaviour goes in a pure Gleam module with unit tests; `app.gleam` only routes.
3. **Real browser for behaviour.** App behaviour is tested in real Chromium (`e2e/`), reading only what the page paints or what is stored.
4. **Few comments.** Only for behaviour forced by the browser, Lustre or a spec.

## Before a PR is ready

1. **Checks pass.** `.githooks/pre-push` runs format, unit and spec tests, the architecture check, keystroke cost and the browser suite. The gate fails if a step runs zero tests or fewer than last time.
2. **Break-it gate.** An agent that has not seen the code or tests uses the app at desktop and phone sizes and tries to break the change. Not ready until that pass is clean.
3. **Planted bugs.** An agent that has not seen the tests plants bugs and reports which ones the tests caught and missed. Missed ones get a test.
4. **Base check.** Test on a branch that contains the current tip of `main`, and name the commit tested.

## When a bug gets past our checks

1. Name the failure mode: which check should have caught it, and why it didn't.
2. Propose counter-measures in plain language. aric picks; nothing is built before that.
3. A fix commit says what caught the bug: `Caught-by: <check>`.
4. A mistake that happens twice becomes a check (lint, test or architecture rule), not a reminder.
5. "Flaky" is never the answer. A test that fails once gets a repro before anything lands.

## Checks on checks

- A new check is attacked by someone who did not write it, and the miss count is reported plainly.
- After two attack rounds, a check changes only when a real mistake gets past it in a real PR.
- Weekly pruning review: every check is listed with what it caught lately; quiet or duplicate checks are proposed for removal. Nothing is removed without aric's OK.
