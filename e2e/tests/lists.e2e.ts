import { expect } from 'e2e';
import { test } from './nullpad.ts';

test.beforeEach(async ({ app, page }) => {
  await app.open('/');
  await page.markdown.tap();
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'false');
  await expect(page.text).toBeFocused();
});

test('a lone dash under a list hangs where a dash and a space hang', async ({ browser, page }) => {
  await browser.keyboard.type('- yay');
  await browser.keyboard.press('Shift+Enter');
  await browser.keyboard.type('-');
  await expect(page.text).toHaveValue('-');
  await expect.poll(() => page.placeOf('-')).not.toBeNull();
  const lone = (await page.placeOf('-'))!;

  await browser.keyboard.type(' ');
  await expect(page.text).toHaveValue('- ');
  await expect.poll(async () => (await page.placeOf('-'))!.left).toBeCloseTo(lone.left, 0);
});

test('enter after an item starts the next one', async ({ browser, page }) => {
  await browser.keyboard.type('- yay');
  await browser.keyboard.press('Enter');
  await expect(page.text).toHaveValue('- ');
  await browser.keyboard.type('cool');
  await page.stopEditing();
  await expect(page.items).toHaveText(['yay', 'cool']);
});

test('enter on an empty item ends the list', async ({ browser, page }) => {
  await browser.keyboard.type('- yay');
  await browser.keyboard.press('Enter');
  await expect(page.text).toHaveValue('- ');
  await browser.keyboard.press('Enter');
  await browser.keyboard.type('after');
  await page.stopEditing();
  await expect(page.items).toHaveText(['yay']);
  await expect(page.paragraphs).toHaveText(['after']);
});

test('tab nests an item and shift tab brings it back', async ({ browser, page }) => {
  await browser.keyboard.type('1. one');
  await browser.keyboard.press('Enter');
  await browser.keyboard.press('Tab');
  await browser.keyboard.type('inner');
  await expect(page.text).toBeFocused();
  await page.stopEditing();
  await expect(page.inPreview('ol ol li')).toHaveText(['inner']);

  await page.drawn('li li').click();
  await browser.keyboard.press('Shift+Tab');
  await page.stopEditing();
  await expect(page.inPreview('ol ol')).toHaveCount(0);
  await expect(page.items).toHaveText(['one', 'inner']);
});
