import { expect } from 'e2e';
import { autosaveMs, groceries, newNote, pause, test, timerSlackMs, trip } from './nullpad.ts';

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

test('looking at the page never changes the stored note', async ({ app, disk, page }) => {
  const body = '#   Spaced  \n\n\n\nline one\nline two   \n\n\n';
  const note = { key: 'spaced', title: null, body };
  await disk.seed([note]);
  await app.open('/');
  await expect(page.text).toHaveValue(body);

  await page.showPage();
  await expect(page.preview.getByRole('heading', 'Spaced', { level: 1 })).toBeVisible();
  await page.showMarkdown();
  await page.pressMarkdownShortcut();
  await page.pressMarkdownShortcut();
  await expect(page.text).toHaveValue(body);

  await expect(page.saveState).toHaveText('Saved');
  await pause(autosaveMs + 200);
  await expect(page.saveState).toHaveText('Saved');
  expect(await disk.notes()).toEqual([note]);
});

test('HTML typed in a note shows as text and makes nothing', async ({ app, browser, page }) => {
  const typed = 'héllo 👋 <b>bold</b> <img src=x onerror="globalThis.ran = 1">';
  await app.open('/');
  await expect(page.text).toBeFocused();

  await page.text.fill(`${typed}\n\n<script>globalThis.ran = 1</script>`);
  await page.showPage();

  await expect(page.paragraphs).toHaveText([typed, '<script>globalThis.ran = 1</script>']);
  await expect(page.everything).toHaveCount(2);
  // An image that fails to load runs its handler a moment later.
  await pause(250);
  expect(await browser.evaluate(() => Reflect.get(globalThis, 'ran') ?? null)).toBeNull();
});

test('the page renders markdown', async ({ app, page }) => {
  await app.open('/');
  await page.text.fill('# Hi');
  await page.showPage();
  await expect(page.preview.getByRole('heading', 'Hi', { level: 1 })).toBeVisible();
});
