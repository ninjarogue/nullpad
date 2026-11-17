# Bugs our checks missed

One line per bug that got past every automatic check. The weekly check review reads this with the `Caught-by:` lines on fix commits, to see which checks work and which miss classes repeat. A class that appears twice gets a check (see [PROCESS.md](PROCESS.md)).

| Date | Bug | Found by | Should have been caught by | Why it wasn't | Class |
| --- | --- | --- | --- | --- | --- |
| 2026-11-14 | PR 30 tested on a branch missing PRs 28 and 29 | review | break-it gate | the gate had no base check | stale base |
| 2026-11-14 | PR 30's agent deleted the test that caught its regression | review | gate | no check for removed or loosened tests | weakened test |
| 2026-11-16 | A skip-list entry in the robot typist hid a real bug | review | robot typist | skip entries had no reason or expiry | hidden by skip |
