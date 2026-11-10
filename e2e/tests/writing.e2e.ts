import { expect } from 'e2e';
import { autosaveMs, groceries, newNote, pause, test, timerSlackMs, trip } from './scribbl.ts';

test('the first visit makes one empty note', async ({ app, disk, page }) => {
  await app.open('/');

  await expect(page.saveState).toHaveText('Saved');
  await expect(page.rows).toHaveText(['Untitled']);
  await expect(page.currentRow).toHaveText('Untitled');
  await expect(page.text).toHaveValue('');
  await expect(page.text).toBeFocused();
  await expect(page.title).toHaveValue('');
  await expect(page.title).toHaveAttribute('placeholder', 'Untitled');
  expect(await disk.notes()).toEqual([newNote]);
});

test('typed text is stored exactly and survives a reload', async ({ app, browser, disk, page }) => {
  await app.open('/');
  await expect(page.text).toBeFocused();

  await browser.keyboard.type('héllo 👋\nwörld');
  await expect(page.saveState).toHaveText('Saved');
  expect(await disk.notes()).toEqual([{ ...newNote, body: 'héllo 👋\nwörld' }]);

  await browser.reload();
  await expect(page.text).toHaveValue('héllo 👋\nwörld');
});

test('typing goes in where the note opened, at its start', async ({ app, browser, disk, page }) => {
  await disk.seed([trip, groceries]);
  await app.open('/');
  await expect(page.text).toHaveValue('milk');

  await browser.keyboard.type('eggs, ');
  await expect(page.text).toHaveValue('eggs, milk');
});

test('typing is saved after a pause', async ({ app, disk, page }) => {
  await disk.seed([trip, groceries]);
  await app.open('/');
  await expect(page.text).toHaveValue('milk');

  const typed = performance.now();
  await page.text.fill('milk, eggs');
  await expect(page.saveState).toHaveText('Unsaved');
  await expect(page.saveState).toHaveText('Saved');
  expect(performance.now() - typed).toBeGreaterThan(autosaveMs - timerSlackMs);
  expect(await disk.notes()).toEqual([trip, { ...groceries, body: 'milk, eggs' }]);
});

test('typing again restarts the pause', async ({ app, disk, page }) => {
  await disk.seed([trip, groceries]);
  await app.open('/');
  await expect(page.text).toHaveValue('milk');

  await page.text.fill('milk, eggs');
  await pause(autosaveMs - 300);
  const typedAgain = performance.now();
  await page.text.pressSequentially(', jam');
  await expect(page.saveState).toHaveText('Unsaved');
  await expect(page.saveState).toHaveText('Saved');
  expect(performance.now() - typedAgain).toBeGreaterThan(autosaveMs - timerSlackMs);
  expect(await disk.notes()).toEqual([trip, { ...groceries, body: 'milk, eggs, jam' }]);
});

test('hiding the page saves at once', async ({ app, browser, disk, page }) => {
  await disk.seed([trip, groceries]);
  await app.open('/');
  await expect(page.text).toHaveValue('milk');

  await page.text.fill('milk, eggs');
  await page.hide();
  // Only a save that began before this line can succeed, and the pause
  // that would save anyway is not over yet.
  await disk.fail();
  await expect(page.saveState).toHaveText('Saved');

  await disk.recover();
  await browser.reload();
  await expect(page.text).toHaveValue('milk, eggs');
});

test('Saving… shows while the disk is slow', async ({ app, disk, page }) => {
  await disk.seed([trip, groceries]);
  await app.open('/');
  await expect(page.text).toHaveValue('milk');

  await disk.hold();
  await page.text.fill('milk, eggs');
  await expect(page.saveState).toHaveText('Saving…');

  await disk.release();
  await expect(page.saveState).toHaveText('Saved');
  expect(await disk.notes()).toEqual([trip, { ...groceries, body: 'milk, eggs' }]);
});

test('the preview shows the typed text as it is', async ({ app, page }) => {
  await app.open('/');
  await expect(page.text).toBeFocused();

  await page.text.fill('héllo 👋 <b>');
  await page.showPreview.tap();
  await expect(page.preview).toHaveText('héllo 👋 <b>');
});

test(
  'the preview renders markdown',
  { skip: 'M2: the preview still shows the source text' },
  async ({ app, page }) => {
    await app.open('/');
    await page.text.fill('# Hi');
    await page.showPreview.tap();
    await expect(page.preview.getByRole('heading', 'Hi', { level: 1 })).toBeVisible();
  },
);
