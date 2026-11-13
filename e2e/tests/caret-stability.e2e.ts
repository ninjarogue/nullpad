import { expect } from 'e2e';
import { DOWN, drawnKinds, END, ENTER, everyKind, noteWithEveryBlock, report, typeAndMeasure, typed, walked } from './stability.ts';
import { test } from './nullpad.ts';

/** Moves the caret through notes, and types in a note that has every kind of block. The rule they are held to is in `stability.ts`. */

for (const walk of walked) {
  test(`moving the caret through ${walk.name} changes no row`, async ({ app, browser, disk, page }) => {
    await disk.seed([{ key: 'walk', title: null, body: walk.note }]);
    await app.open('/');
    await expect(page.text).toHaveValue(walk.note);
    await page.markdown.tap();
    await expect(page.text).toBeFocused();
    const { hits, problems } = await typeAndMeasure(browser, walk.note, walk.keys);
    const drawn = await drawnKinds({ browser, page });
    expect(walk.draws.filter((kind) => !drawn.includes(kind)), 'the note no longer draws these kinds').toEqual([]);
    expect(report(hits, problems)).toEqual([]);
  });
}

test('typing at the top of a note with every block kind leaves the rows below looking as they did', async ({ app, browser, disk, page }) => {
  await disk.seed([{ key: 'typing', title: null, body: noteWithEveryBlock }]);
  await app.open('/');
  await expect(page.text).toHaveValue(noteWithEveryBlock);
  await page.markdown.tap();
  await expect(page.text).toBeFocused();
  const keys = `abc${ENTER}${ENTER}def${DOWN}${DOWN}${DOWN}x${END}y${DOWN}${DOWN}z${DOWN}${DOWN}${DOWN}w`;
  const { hits, problems } = await typeAndMeasure(browser, noteWithEveryBlock, keys);
  expect(report(hits, problems)).toEqual([]);
});

test('the samples between them draw every kind of block and inline the parser makes', async ({ app }) => {
  await app.open('/blank');
  const claimed = new Set([...typed, ...walked].flatMap((group) => group.draws));
  expect(everyKind.filter((kind) => !claimed.has(kind))).toEqual([]);
});
