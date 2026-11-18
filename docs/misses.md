# Bugs our checks missed

One line per bug that got past every automatic check. The weekly check review reads this with the `Caught-by:` lines on fix commits, to see which checks work and which miss classes repeat. A class that appears twice gets a check (see [PROCESS.md](PROCESS.md)).

| Date | Bug | Found by | Should have been caught by | Why it wasn't | Class |
| --- | --- | --- | --- | --- | --- |
| 2026-11-14 | PR 30 tested on a branch missing PRs 28 and 29 | review | break-it gate | the gate had no base check | stale base |
| 2026-11-14 | PR 30's agent deleted the test that caught its regression | review | gate | no check for removed or loosened tests | weakened test |
| 2026-11-16 | A skip-list entry in the robot typist hid a real bug | review | robot typist | skip entries had no reason or expiry | hidden by skip |
| 2026-11-17 | A lone `-` under a list hung by the dash's width only, so it sat between the bullets and the words and moved when the space was typed | aric | layout browser tests, and the unit test for the hang | the unit test pinned the code's output (`-` hangs as `-`) instead of the promise that typing the space moves nothing, and no browser test measured an item between its marker and its space | pinned output |
| 2026-11-17 | Keys typed for a picked note that did not open were typed into the note kept, and text an IME composed while a note switched went into neither note | a model-check review of the editor's states | unit tests of keys held while a note is chosen, and the robot typist | the unit tests covered plain keys only and pinned the stay-on-failure behaviour as intended, and the robot typist drives neither an IME nor note switching | untested combination of two states |
