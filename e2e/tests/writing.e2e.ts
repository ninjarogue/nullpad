import { expect } from 'e2e';
import { newNote, test } from './scribbl.ts';

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
