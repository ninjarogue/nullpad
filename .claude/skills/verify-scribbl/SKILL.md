---
name: verify-scribbl
description: Drive scribbl, the markdown note editor web app, in real Chromium the way a person uses it, and record proof (video, screenshots, checks). Use after changing anything a user can see or do, before saying it works.
---

# Verify scribbl

scribbl is one web page. A person types markdown into a text field, flips to a rendered page with Ctrl+E, and keeps notes in a list. Notes live in the browser's IndexedDB, so every new browser context starts empty and two runs never share state.

Read [features/README.md](features/README.md) first. It lists each feature and the proof it needs.

## Launch

`drive.mjs` launches the app for you on a free port and stops it afterwards. It needs these once per checkout:

```sh
gleam deps download
cd e2e && npm ci && npx @e2e-dev/web install chromium
```

In a Claude cloud session Gleam is at `$HOME/bin`, and Chromium is preinstalled for the machine's own Playwright, not for the one in `e2e/`. Do not install browsers. Use this instead:

```sh
export PATH=$HOME/bin:$PATH
export VERIFY_PLAYWRIGHT=$(node -p "require.resolve('playwright')")
```

`VERIFY_PLAYWRIGHT` makes `drive.mjs` use that Playwright with the session's own `PLAYWRIGHT_BROWSERS_PATH`. Leave that variable alone for `drive.mjs`.

The regression suite needs links from the build numbers it wants to the ones installed. Set the path for that one command only, because the linked ffmpeg writes no video:

```sh
links=/tmp/scribbl-browsers
mkdir -p $links
for kind in chromium chromium-headless-shell; do
  want=$(node -p "require('./e2e/node_modules/playwright-core/browsers.json').browsers.find(b => b.name === '$kind').revision")
  dir=$(echo $kind | tr - _)
  ln -sfn "$(ls -d /opt/pw-browsers/${dir}-[0-9]* | head -1)" "$links/${dir}-${want}"
done
(cd e2e && PLAYWRIGHT_BROWSERS_PATH=$links npm test)
```

To look at the app by hand, run `node e2e/serve.mjs 4173`. It runs `gleam build` first and is ready when `http://127.0.0.1:4173/scribbl/scribbl.mjs` answers 200. Stop it with Ctrl+C. `gleam run -m lustre/dev start` needs Erlang and does not work in the cloud.

## Doctor

```sh
sh .claude/skills/verify-scribbl/doctor.sh
```

It changes nothing. Every line must start with `ok`. A `MISSING` line names the command that fixes it.

## Drive

Write a journey: a module whose default export gets the tools and acts like a person.

```js
// journey.mjs
export default async ({ page, type, look, shot, check }) => {
  await page.getByLabel('Note text').click();
  await type('# Trip\n\nPack **light**.');
  await page.keyboard.press('Control+e');
  await look();
  await check('the heading shows', async () => {
    await page.locator('[data-test-id=preview] h1').waitFor();
  });
  await shot('preview');
};
```

```sh
node .claude/skills/verify-scribbl/drive.mjs journey.mjs trip
```

`page` is a Playwright page already on the app. `type(text)` types key by key. `look(ms)` pauses so the video can be followed. `shot(label)` saves a screenshot. `check(label, run)` records pass or fail and keeps going. The exit code is 0 only when every check passed and the page logged no error.

Keep journeys in a scratch folder, not in the repo. Two ready ones are in `journeys/`.

Handles that do not change:

| What | Handle |
| --- | --- |
| Text field | `getByLabel('Note text')` |
| Title field | `getByLabel('Title')` |
| Save state ("Saved", "Saving…") | `getByRole('status')` |
| Problem banner | `getByRole('alert')` |
| Note list, its rows | `[data-test-id=note-list]`, `getByRole('button')` inside it |
| Open note's row | `[aria-current="true"]` |
| New note | `getByRole('button', { name: 'New note' })` |
| To rendered page, and back | `getByRole('button', { name: 'Preview' })`, `{ name: 'Edit' }`, or Ctrl+E |
| Rendered page | `[data-test-id=preview]` |
| Delete, confirm, keep | `[data-test-id=delete-note]`, `[data-test-id=confirm-delete]`, `getByRole('button', { name: 'Keep' })` |

`e2e/tests/scribbl.ts` holds the same handles for the regression suite. Run that suite with `cd e2e && npm test`. It answers "did anything break". A journey answers "does this feature work for a person" and leaves proof.

## Evidence

Everything lands in `.verify/<name>/` (ignored by git): `session.webm` is the whole session, `shots/` the screenshots, `report.json` the checks and page errors. For a file phones can play: `ffmpeg -i session.webm -c:v libx264 -pix_fmt yuv420p session.mp4`.

A proof is good when:

- The journey types and clicks. It never uses `fill`, `evaluate` or the test disk to set state.
- It shows the action and the result, not only the last screen.
- A saved note is proved by reloading the page and reading it again, not by the "Saved" label.
- It visits every entry point the feature file lists (button and Ctrl+E are two).

## Cleanup

`drive.mjs` stops the server and browser it started, also when the journey throws. It never kills by name. Evidence stays until the next run with the same name replaces it. Delete `.verify/` by hand when done.

## Keeping this current

When a feature is added or a handle changes, update `features/` in the same pull request. `/pstack:maintain-verification-skill` checks the map against the app.
