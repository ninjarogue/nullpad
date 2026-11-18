import { readFileSync } from 'node:fs';
import { expect } from 'e2e';
import type { App } from 'e2e';
import type { Browser } from '@e2e-dev/web';
import { test } from './nullpad.ts';
import type { Page } from './nullpad.ts';

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

type Marked = { typed: string; field: string; whole: string; left: string };

const bullets: Marked = { typed: '- a', field: '- b\n  - ', whole: '- a\n- b\n  - ', left: '- a\n- b' };
const numbers: Marked = { typed: '1. a', field: '2. b\n   1. ', whole: '1. a\n2. b\n   1. ', left: '1. a\n2. b' };

async function typeEmptySubItem(browser: Browser, page: Page, marked: Marked) {
  await browser.keyboard.type(marked.typed);
  await browser.keyboard.press('Enter');
  await browser.keyboard.type('b');
  await browser.keyboard.press('Enter');
  await browser.keyboard.press('Tab');
  await expect(page.text).toHaveValue(marked.field);
}

const headings = (browser: Browser) => browser.locator('.page h2');

const leavings: [string, (browser: Browser, page: Page) => Promise<void>][] = [
  ['clicking another item', async (_, page) => page.drawn('li').first().click()],
  ['an arrow up', (browser) => browser.keyboard.press('ArrowUp')],
];

for (const [kind, marked] of [['bullet', bullets], ['numbered', numbers]] as const) {
  for (const [how, leave] of leavings) {
    test(`an empty ${kind} sub-item goes when the caret leaves it by ${how}, and is not drawn as part of the item above`, async ({ browser, page }) => {
      await typeEmptySubItem(browser, page, marked);
      await leave(browser, page);
      await expect(page.text).toBeFocused();
      await expect(headings(browser)).toHaveCount(0);
      await page.showMarkdown();
      await expect(page.text).toHaveValue(marked.left);
    });

    test(`one Ctrl+Z brings an empty ${kind} sub-item back that ${how} took out, with the caret in it`, async ({ browser, page }) => {
      await typeEmptySubItem(browser, page, marked);
      await leave(browser, page);
      await expect(headings(browser)).toHaveCount(0);
      await browser.keyboard.press('Control+z');
      await expect(page.text).toHaveValue(marked.field);
      await browser.keyboard.type('c');
      await page.showMarkdown();
      await expect(page.text).toHaveValue(`${marked.whole}c`);
    });
  }
}

test('an empty sub-item goes when Escape leaves the field, and one Ctrl+Z brings it back', async ({ browser, page }) => {
  await typeEmptySubItem(browser, page, bullets);
  await browser.keyboard.press('Escape');
  await expect(page.preview).toBeVisible();
  await expect(page.inPreview('h2')).toHaveCount(0);
  await expect(page.items).toHaveText(['a', 'b']);
  await page.items.first().click();
  await expect(page.text).toBeFocused();
  await browser.keyboard.press('Control+z');
  await expect(page.text).toHaveValue(bullets.field);
  await browser.keyboard.type('c');
  await page.showMarkdown();
  await expect(page.text).toHaveValue(`${bullets.whole}c`);
});

test('an empty sub-item goes when the field loses the focus to the title', async ({ browser, page }) => {
  await typeEmptySubItem(browser, page, bullets);
  await page.title.click();
  await expect(page.title).toBeFocused();
  await expect(headings(browser)).toHaveCount(0);
  await expect(page.items).toHaveText(['a', 'b']);
  await page.showMarkdown();
  await expect(page.text).toHaveValue(bullets.left);
});

test('a click below an empty sub-item puts the caret where it was clicked, though the rows move up', async ({ browser, page }) => {
  await browser.keyboard.type('- a');
  await browser.keyboard.press('Enter');
  await browser.keyboard.type('b');
  await browser.keyboard.press('Enter');
  await browser.keyboard.press('Enter');
  await browser.keyboard.type('after');
  await page.drawn('li').nth(1).click();
  await browser.keyboard.press('End');
  await browser.keyboard.press('Enter');
  await browser.keyboard.press('Tab');
  await expect(page.text).toHaveValue(bullets.field);
  await expect.poll(() => page.placeOf('after')).not.toBeNull();
  const at = await page.pointAt('after');
  await browser.mouse.move(at.x, at.y);
  await browser.mouse.down();
  await browser.mouse.up();
  await browser.keyboard.type('Z');
  await expect(headings(browser)).toHaveCount(0);
  await page.showMarkdown();
  await expect(page.text).toHaveValue('- a\n- b\n\nZafter');
});

test('an empty item with no words over it stays when the caret leaves it', async ({ browser, page }) => {
  await browser.keyboard.type('- a');
  await browser.keyboard.press('Enter');
  await expect(page.text).toHaveValue('- ');
  await page.drawn('li').first().click();
  await expect(page.text).toBeFocused();
  await page.showMarkdown();
  await expect(page.text).toHaveValue('- a\n- ');
});

test('the markdown view keeps an empty sub-item when the caret leaves it', async ({ browser, page }) => {
  await page.markdown.tap();
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'true');
  await browser.keyboard.type('- a');
  await browser.keyboard.press('Enter');
  await browser.keyboard.type('b');
  await browser.keyboard.press('Enter');
  await browser.keyboard.press('Tab');
  await browser.keyboard.press('ArrowUp');
  await browser.keyboard.press('ArrowUp');
  await expect(page.text).toHaveValue(bullets.whole);
});
