import { expect } from 'e2e';
import { groceries, newNote, pause, test, trip } from './nullpad.ts';

test.beforeEach(async ({ app, disk, page }) => {
  await disk.seed([trip, groceries]);
  await app.open('/');
  await expect(page.text).toHaveValue('milk');
});

test('the newest note opens', async ({ page }) => {
  await expect(page.text).toBeFocused();
  await expect(page.rows).toHaveText(['Groceries', 'Trip']);
  await expect(page.currentRow).toHaveText('Groceries');
  await expect(page.title).toHaveValue('Groceries');
  await expect(page.saveState).toHaveText('Saved');
});

test('picking a note opens it', async ({ page }) => {
  await page.row('Trip').tap();

  await expect(page.text).toHaveValue('# Trip');
  await expect(page.text).toBeFocused();
  await expect(page.currentRow).toHaveText('Trip');
  await expect(page.saveState).toHaveText('Saved');
});

test('a note without a title offers its first line as one', async ({ page }) => {
  await page.row('Trip').tap();

  await expect(page.title).toHaveValue('');
  await expect(page.title).toHaveAttribute('placeholder', 'Trip');
});

test('picking another note saves this one first', async ({ disk, page }) => {
  await page.text.fill('milk, eggs');
  await disk.hold();
  await page.row('Trip').tap();
  await expect(page.saveState).toHaveText('Saving…');
  await expect(page.text).toHaveValue('milk, eggs');

  await disk.release();
  await expect(page.text).toHaveValue('# Trip');
  await expect(page.text).toBeFocused();
  await expect(page.saveState).toHaveText('Saved');
  await expect(page.rows).toHaveText(['Groceries', 'Trip']);
  await expect(page.currentRow).toHaveText('Trip');
  expect(await disk.notes()).toEqual([trip, { ...groceries, body: 'milk, eggs' }]);
});

test('text typed while the next note loads is saved before it opens', async ({ disk, page }) => {
  await disk.hold();
  await page.row('Trip').tap();
  await page.text.fill('milk, eggs');

  await disk.release();
  await expect(page.text).toHaveValue('# Trip');
  expect(await disk.notes()).toEqual([trip, { ...groceries, body: 'milk, eggs' }]);
});

test('text typed while a new note is made is saved before it opens', async ({ disk, page }) => {
  await disk.hold();
  await page.newNote.tap();
  await page.text.fill('milk, eggs');

  await disk.release();
  await expect(page.text).toHaveValue('');
  await expect(page.currentRow).toHaveText('Untitled');
  expect(await disk.notes()).toEqual([trip, newNote, { ...groceries, body: 'milk, eggs' }]);
});

test('picking the open note again cancels leaving it', async ({ disk, page }) => {
  await page.text.fill('milk, eggs');
  await disk.hold();
  await page.row('Trip').tap();
  await page.row('Groceries').tap();

  await disk.release();
  await expect(page.saveState).toHaveText('Saved');
  await expect(page.text).not.toHaveValue('# Trip');
  await expect(page.text).toHaveValue('milk, eggs');
  await expect(page.currentRow).toHaveText('Groceries');
});

test('a saved note moves to the top of the list', async ({ disk, page }) => {
  await page.row('Trip').tap();
  await expect(page.text).toHaveValue('# Trip');

  await disk.hold();
  await page.text.fill('# Trip to Oslo');
  await expect(page.rows).toHaveText(['Groceries', 'Trip to Oslo']);

  await disk.release();
  await expect(page.rows).toHaveText(['Trip to Oslo', 'Groceries']);
  await expect(page.currentRow).toHaveText('Trip to Oslo');
});

test('a new note opens empty, at the top, ready to type in', async ({ disk, page }) => {
  await page.showPage();
  await page.newNote.tap();

  await expect(page.text).toHaveValue('');
  await expect(page.text).toBeFocused();
  await expect(page.preview).toBeHidden();
  await expect(page.rows).toHaveText(['Untitled', 'Groceries', 'Trip']);
  await expect(page.currentRow).toHaveText('Untitled');
  expect(await disk.notes()).toEqual([trip, groceries, newNote]);
});

test('a note takes the title typed for it, and its first line again without one', async ({
  browser,
  disk,
  page,
}) => {
  await page.row('Trip').tap();
  await expect(page.text).toHaveValue('# Trip');

  await page.title.fill('Japan');
  await expect(page.currentRow).toHaveText('Japan');
  await expect(page.saveState).toHaveText('Saved');
  expect(await disk.notes()).toEqual([groceries, { ...trip, title: 'Japan' }]);

  await browser.reload();
  await expect(page.title).toHaveValue('Japan');

  await page.title.fill('');
  await expect(page.currentRow).toHaveText('Trip');
  await expect(page.saveState).toHaveText('Saved');
  expect(await disk.notes()).toEqual([groceries, trip]);
});

test('the ⋯ on the open note opens its menu, and Escape or a click outside closes it', async ({
  browser,
  disk,
  page,
}) => {
  await expect(page.noteActions).toHaveCount(1);
  await page.noteActions.tap();
  await expect(page.noteMenu).toBeVisible();
  await expect(page.delete).toBeFocused();

  await browser.keyboard.press('Escape');
  await expect(page.noteMenu).toBeHidden();

  await page.noteActions.tap();
  await browser.locator('.menu-backdrop').tap();
  await expect(page.noteMenu).toBeHidden();
  expect(await disk.notes()).toEqual([trip, groceries]);
});

test('Delete in the menu removes the note at once and opens the newest one left', async ({
  disk,
  page,
}) => {
  await page.noteActions.tap();
  await page.delete.tap();

  await expect(page.text).toHaveValue('# Trip');
  await expect(page.rows).toHaveText(['Trip']);
  await expect(page.currentRow).toHaveText('Trip');
  await expect(page.undoToast).toContainText('Deleted “Groceries”');
  expect(await disk.notes()).toEqual([trip]);
});

test('Undo brings the deleted note back and opens it again', async ({ disk, page }) => {
  await page.text.fill('milk, eggs');
  await page.noteActions.tap();
  await page.delete.tap();
  await expect(page.rows).toHaveText(['Trip']);

  await page.undo.tap();
  await expect(page.undoToast).toBeHidden();
  await expect(page.rows).toHaveText(['Groceries', 'Trip']);
  await expect(page.currentRow).toHaveText('Groceries');
  await expect(page.text).toHaveValue('milk, eggs');
  expect(await disk.notes()).toEqual([trip, { ...groceries, body: 'milk, eggs' }]);
});

test('a right-click deletes a note that is not open, and the open note stays', async ({
  disk,
  page,
}) => {
  await page.text.fill('milk, eggs');
  await page.rightClick('Trip');
  await expect(page.noteMenu).toBeVisible();
  await page.delete.tap();

  await expect(page.rows).toHaveText(['Groceries']);
  await expect(page.text).toHaveValue('milk, eggs');
  await expect(page.saveState).toHaveText('Saved');
  expect(await disk.notes()).toEqual([{ ...groceries, body: 'milk, eggs' }]);

  await page.undo.tap();
  await expect(page.rows).toHaveText(['Trip', 'Groceries']);
  await expect(page.currentRow).toHaveText('Groceries');
  expect(await disk.notes()).toEqual([{ ...groceries, body: 'milk, eggs' }, trip]);
});

test('the Delete key on a focused note deletes it', async ({ browser, disk, page }) => {
  await page.row('Trip').focus();
  await browser.keyboard.press('Delete');

  await expect(page.rows).toHaveText(['Groceries']);
  await expect(page.undoToast).toContainText('Deleted “Trip”');
  expect(await disk.notes()).toEqual([groceries]);
});

test('the offer to undo goes away by itself', async ({ page }) => {
  await page.rightClick('Trip');
  await page.delete.tap();
  await expect(page.undoToast).toBeVisible();
  await pause(5200);
  await expect(page.undoToast).toBeHidden();
});

test('the Markdown button flips between the page and its markdown', async ({
  browser,
  page,
}) => {
  await page.row('Trip').tap();
  await expect(page.text).toHaveValue('# Trip');

  await page.markdown.tap();
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'false');
  await expect(page.text).toBeFocused();
  await expect(page.text).toHaveValue('# Trip');
  await browser.keyboard.press('Escape');
  await expect(page.preview.getByRole('heading', 'Trip', { level: 1 })).toBeVisible();

  await page.markdown.tap();
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'true');
  await expect(page.preview).toBeHidden();
  await expect(page.text).toBeFocused();
  await expect(page.text).toHaveValue('# Trip');
});

test('Ctrl+E flips between the page and its markdown', async ({ page }) => {
  await page.pressMarkdownShortcut();
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'false');
  await expect(page.text).toBeFocused();

  await page.pressMarkdownShortcut();
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'true');
  await expect(page.text).toBeFocused();
  await expect(page.text).toHaveValue('milk');
});

test('the Markdown button is remembered', async ({ app, browser, page }) => {
  await browser.evaluate(() => {
    localStorage.setItem('nullpad.markdown', 'off');
    return null;
  });
  await app.open('/');
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'false');

  await page.markdown.tap();
  await browser.reload();
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'true');
});

test('vim keys are not offered yet', async ({ page }) => {
  await expect(page.vimSwitch).toBeHidden();
  await expect(page.vimMode).toBeHidden();
});
