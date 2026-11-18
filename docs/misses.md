# Bugs our checks missed

One line per bug that got past every automatic check. The weekly check review reads this with the `Caught-by:` lines on fix commits, to see which checks work and which miss classes repeat. A class that appears twice gets a check (see [PROCESS.md](PROCESS.md)).

| Date | Bug | Found by | Should have been caught by | Why it wasn't | Class |
| --- | --- | --- | --- | --- | --- |
| 2026-11-14 | PR 30 tested on a branch missing PRs 28 and 29 | review | break-it gate | the gate had no base check | stale base |
| 2026-11-14 | PR 30's agent deleted the test that caught its regression | review | gate | no check for removed or loosened tests | weakened test |
| 2026-11-16 | A skip-list entry in the robot typist hid a real bug | review | robot typist | skip entries had no reason or expiry | hidden by skip |
| 2026-11-17 | A lone `-` under a list hung by the dash's width only, so it sat between the bullets and the words and moved when the space was typed | aric | layout browser tests, and the unit test for the hang | the unit test pinned the code's output (`-` hangs as `-`) instead of the promise that typing the space moves nothing, and no browser test measured an item between its marker and its space | pinned output |
| 2026-11-18 | Enter on an empty item in the middle of a numbered list left the items after it at their old numbers, though the list goes on | random list check | list key unit tests | they were examples, and this one was listed as a known gap instead of tested | examples only |
| 2026-11-18 | Shift+Tab on an item with numbered sub-items numbered the items that followed it from 1 again, after the sub-items | random list check | list key unit tests | no example had both sub-items and items after them | examples only |
| 2026-11-18 | Shift+Tab left the items below at their old indent when the moved item's marker got wider or narrower, so they fell out of it; and a numbered list right under its words that did not start at 1 became words | random list check | list key unit tests | examples used markers of the same width | examples only |
| 2026-11-18 | Tab under an empty item of a loose list moved the item, though CommonMark ends an empty item at a blank row, so it nested in nothing | random list check | list key unit tests | no example had an empty item in a loose list | examples only |
