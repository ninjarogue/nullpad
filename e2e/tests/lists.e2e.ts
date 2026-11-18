import { readFileSync } from 'node:fs';
import { expect } from 'e2e';
import type { App } from 'e2e';
import type { Browser } from '@e2e-dev/web';
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

test('ctrl with tab or enter is left to the browser', async ({ browser, page }) => {
  await browser.keyboard.type('- a');
  await browser.keyboard.press('Enter');
  await browser.keyboard.type('b');
  await browser.keyboard.press('Control+Tab');
  await browser.keyboard.press('Control+Enter');
  await expect(page.text).toHaveValue('- b');
});

type Box = { left: number; right: number; top: number; bottom: number };

/** Where ink is drawn across `box` (window pixels), read from a screenshot: its left and right edges. */
async function inkIn(app: App, browser: Browser, box: Box) {
  const png = readFileSync(await app.screenshot('ink'), 'base64');
  return browser.evaluate(
    async ({ png, box }: { png: string; box: Box }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const scale = image.width / window.innerWidth;
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const pen = canvas.getContext('2d')!;
      pen.drawImage(image, 0, 0);
      const [x0, x1] = [Math.round(box.left * scale), Math.round(box.right * scale)];
      const [y0, y1] = [Math.round(box.top * scale), Math.round(box.bottom * scale)];
      const pixels = pen.getImageData(x0, y0, x1 - x0, y1 - y0).data;
      const inked: number[] = [];
      for (let x = 0; x < x1 - x0; x++) {
        for (let y = 0; y < y1 - y0; y++) {
          const at = (y * (x1 - x0) + x) * 4;
          if (pixels[at] + pixels[at + 1] + pixels[at + 2] < 3 * 140) {
            inked.push(x);
            break;
          }
        }
      }
      return inked.length === 0 ? null : { left: (x0 + inked[0]) / scale, right: (x0 + inked[inked.length - 1] + 1) / scale };
    },
    { png, box },
  );
}

test('the dash of a new item is drawn where the dots of the items above are', async ({ app, browser, page }) => {
  await browser.keyboard.type('- yay');
  await browser.keyboard.press('Enter');
  await expect(page.text).toHaveValue('- ');
  await expect(page.drawn('li')).toHaveText(['yay']);
  const rows = await browser.evaluate(() => {
    const item = document.querySelector('.page.live .part li')!.getBoundingClientRect();
    const field = document.querySelector('[data-test-id="editor"]')!.getBoundingClientRect();
    const line = parseFloat(getComputedStyle(document.querySelector('.page.live .part li')!).lineHeight);
    const gutter = { left: item.left - 40, right: item.left - 1 };
    return {
      dot: { ...gutter, top: item.top, bottom: item.top + line },
      dash: { ...gutter, top: field.top, bottom: field.top + line },
    };
  });
  const dot = (await inkIn(app, browser, rows.dot))!;
  const dash = (await inkIn(app, browser, rows.dash))!;
  expect(dot).not.toBeNull();
  expect(dash).not.toBeNull();
  expect(Math.abs((dot.left + dot.right) / 2 - (dash.left + dash.right) / 2)).toBeLessThan(1);
});
