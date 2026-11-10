import { expect } from 'e2e';
import { autosaveMs, groceries, pause, retryMs, test, timerSlackMs, trip } from './scribbl.ts';

const notWorking = /^Storage is not working: /;

test.beforeEach(async ({ disk }) => {
  await disk.seed([trip, groceries]);
});

test('a failed save says so and is tried again by itself', async ({ app, disk, page }) => {
  await app.open('/');
  await expect(page.text).toHaveValue('milk');

  await disk.fail();
  const typed = performance.now();
  await page.text.fill('milk, eggs');
  await expect(page.problem).toHaveText(notWorking);
  await expect(page.saveState).toHaveText('Unsaved');
  expect(await disk.notes()).toEqual([trip, groceries]);

  await disk.recover();
  await expect(page.saveState).toHaveText('Saved', { timeout: retryMs + 3000 });
  expect(performance.now() - typed).toBeGreaterThan(autosaveMs + retryMs - timerSlackMs);
  await expect(page.problem).toBeHidden();
  expect(await disk.notes()).toEqual([trip, { ...groceries, body: 'milk, eggs' }]);
});

test('a failed save keeps you on the note, also once it is saved', async ({ app, disk, page }) => {
  await app.open('/');
  await expect(page.text).toHaveValue('milk');

  await disk.fail();
  await page.text.fill('milk, eggs');
  await page.row('Trip').tap();
  await expect(page.problem).toHaveText(notWorking);
  await expect(page.saveState).toHaveText('Unsaved');
  await expect(page.text).toHaveValue('milk, eggs');

  await page.newNote.tap();
  await expect(page.text).toHaveValue('milk, eggs');

  await disk.recover();
  await expect(page.saveState).toHaveText('Saved', { timeout: retryMs + 3000 });
  await expect(page.text).not.toHaveValue('');
  await expect(page.text).toHaveValue('milk, eggs');
  await expect(page.currentRow).toHaveText('Groceries');
  expect(await disk.notes()).toEqual([trip, { ...groceries, body: 'milk, eggs' }]);
});

test('an older save that worked does not mark newer text saved', async ({ app, disk, page }) => {
  await app.open('/');
  await expect(page.text).toHaveValue('milk');

  await disk.hold();
  await page.text.fill('milk, eggs');
  await expect(page.saveState).toHaveText('Saving…');
  await disk.fail();
  await page.text.pressSequentially(', jam');
  await page.hide();

  await disk.release();
  await expect(page.problem).toHaveText(notWorking);
  await expect(page.saveState).toHaveText('Unsaved');
  expect(await disk.notes()).toEqual([trip, { ...groceries, body: 'milk, eggs' }]);
});

test('an older save that failed does not mark newer text unsaved', async ({ app, disk, page }) => {
  await app.open('/');
  await expect(page.text).toHaveValue('milk');

  await disk.hold();
  await disk.fail();
  await page.text.fill('milk, eggs');
  await expect(page.saveState).toHaveText('Saving…');
  await disk.recover();
  await page.text.pressSequentially(', jam');
  await page.hide();
  // Past this the page has no save of its own left to try, so only the
  // answers to the two saves above can change what it shows.
  await pause(autosaveMs + 300);

  await disk.release();
  await expect(page.saveState).toHaveText('Saved', { timeout: retryMs - 2000 });
  await expect(page.problem).toBeHidden();
  expect(await disk.notes()).toEqual([trip, { ...groceries, body: 'milk, eggs, jam' }]);
});

test('storage that cannot list the notes says so', async ({ app, disk, page }) => {
  await disk.fail();
  await app.open('/');

  await expect(page.problem).toHaveText(notWorking);
  await expect(page.rows).toHaveCount(0);
});

test('with no note open, hiding the page stores nothing', async ({ app, disk, page }) => {
  await disk.fail();
  await app.open('/');
  await expect(page.problem).toHaveText(notWorking);

  await disk.recover();
  await page.hide();
  await expect(page.saveState).not.toBeVisible();
  expect(await disk.notes()).toEqual([trip, groceries]);
});

test('a note that cannot be made says so', async ({ app, disk, page }) => {
  await app.open('/');
  await expect(page.text).toHaveValue('milk');

  await disk.fail();
  await page.newNote.tap();
  await expect(page.problem).toHaveText(notWorking);
  await expect(page.text).toHaveValue('milk');
  expect(await disk.notes()).toEqual([trip, groceries]);
});

test('a delete that fails says so and keeps the note open', async ({ app, disk, page }) => {
  await app.open('/');
  await expect(page.text).toHaveValue('milk');

  await disk.fail();
  await page.delete.tap();
  await page.confirmDelete.tap();
  await expect(page.problem).toHaveText(notWorking);
  await expect(page.currentRow).toHaveText('Groceries');
  await expect(page.text).toHaveValue('milk');
  await expect(page.saveState).toHaveText('Saved');

  await disk.recover();
  await page.text.fill('milk, eggs');
  await expect(page.saveState).toHaveText('Saved');
  expect(await disk.notes()).toEqual([trip, { ...groceries, body: 'milk, eggs' }]);
});

test('typing while a delete is under way does not bring the note back', async ({
  app,
  disk,
  page,
}) => {
  await app.open('/');
  await expect(page.text).toHaveValue('milk');

  await disk.hold();
  await page.delete.tap();
  await page.confirmDelete.tap();
  await page.text.fill('milk, eggs');
  await pause(autosaveMs + timerSlackMs);
  await disk.release();

  await expect(page.rows).toHaveText(['Trip']);
  await expect(page.text).toHaveValue('# Trip');
  expect(await disk.notes()).toEqual([trip]);
});

test('a note deleted in another tab leaves the list', async ({ app, disk, page }) => {
  await app.open('/');
  await expect(page.text).toHaveValue('milk');

  await disk.remove('trip');
  await page.row('Trip').tap();
  await expect(page.problem).toHaveText('That note is no longer in storage.');
  await expect(page.rows).toHaveText(['Groceries']);
  await expect(page.currentRow).toHaveText('Groceries');
  await expect(page.text).toHaveValue('milk');
});
