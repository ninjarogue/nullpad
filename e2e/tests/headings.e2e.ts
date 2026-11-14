import type { Browser } from '@e2e-dev/web';
import { expect } from 'e2e';
import type { App } from 'e2e';
import { test } from './nullpad.ts';
import type { Disk, Note, Page } from './nullpad.ts';

const stored = (body: string): Note => ({ key: 'live', title: null, body });

/** Root font sizes and a second font: the page must hold still under each. */
const settings = [
  { root: '16px', font: null },
  { root: '12px', font: null },
  { root: '20px', font: null },
  { root: '16px', font: 'serif' },
] as const;

async function set(browser: Browser, setting: (typeof settings)[number]) {
  await browser.evaluate((setting: (typeof settings)[number]) => {
    let style = document.getElementById('test-setting');
    if (!style) {
      style = document.createElement('style');
      style.id = 'test-setting';
      document.head.append(style);
    }
    style.textContent = `html { font-size: ${setting.root}; }${setting.font ? ` :root { --ui-font: ${setting.font}; }` : ''}`;
    return null;
  }, setting);
}

/**
 * Opens `top`, a blank row, `block`, a blank row and `below words`, with the
 * caret on `top`.
 */
async function open({ app, disk, page }: { app: App; disk: Disk; page: Page }, block: string) {
  const body = `top\n\n${block}\n\nbelow words`;
  await disk.seed([stored(body)]);
  await app.open('/');
  await expect(page.text).toHaveValue(body);
  await page.markdown.tap();
  await expect(page.text).toBeFocused();
  await expect(page.text).toHaveValue('top');
}

/** Where `word` is: in the text field while the caret is in its block, drawn after. */
async function at(page: Page, word: string) {
  const place = await page.placeOf(word);
  expect(place, `${word} is on the page`).not.toBeNull();
  return place!;
}

/**
 * Puts the caret in the block on row 2, then moves it to the blank row below,
 * and gives where `word`, the first character of `typed` and the row below
 * were each time, with the field's font size and the drawn heading's.
 */
async function arriveAndLeave(page: Page, browser: Browser, block: string, word: string | null, typed: string) {
  await browser.keyboard.press('ArrowDown');
  await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue(block);
  await page.nextFrame();
  const field = {
    word: word === null ? null : await at(page, word),
    typed: await at(page, typed),
    below: (await at(page, 'below')).top,
    size: (await page.sizesOf('[data-test-id="editor"]')).size,
  };
  for (const _ of block.split('\n')) await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue('');
  await page.nextFrame();
  const drawn = {
    word: word === null ? null : await at(page, word),
    below: (await at(page, 'below')).top,
  };
  for (const _ of ['', '', ...block.split('\n')]) await browser.keyboard.press('ArrowUp');
  await expect(page.text).toHaveValue('top');
  return { field, drawn };
}

const containers = [
  { what: 'on its own line', prefix: '', hangs: true },
  { what: 'in a list item', prefix: '- ', hangs: true },
  { what: 'in an ordered item', prefix: '1. ', hangs: true },
  { what: 'in an item numbered 10', prefix: '10. ', hangs: true },
  { what: 'in a nested item', prefix: '- - ', hangs: false },
  { what: 'in a quote', prefix: '> ', hangs: false },
  { what: 'in a quoted item', prefix: '> - ', hangs: false },
  { what: 'in a quote in an item', prefix: '- > ', hangs: false },
] as const;

for (const { what, prefix, hangs } of containers) {
  for (const level of [1, 2, 3, 4, 5, 6]) {
    const marks = '#'.repeat(level);
    test(`a heading ${level} ${what} is the same size in the field and drawn, and leaving it moves no word, at 12, 16 and 20px and in a second font`, async ({
      app,
      browser,
      disk,
      page,
    }) => {
      await open({ app, disk, page }, `${prefix}${marks} Hello world`);
      for (const setting of settings) {
        await set(browser, setting);
        const { field, drawn } = await arriveAndLeave(page, browser, `${prefix}${marks} Hello world`, 'Hello', marks);
        const drawnSize = (await page.sizesOf(`[data-test-id^="live-"] h${level}`)).size;
        expect({ setting, size: field.size, below: field.below, top: field.word!.top }).toEqual({
          setting,
          size: drawnSize,
          below: drawn.below,
          top: drawn.word!.top,
        });
        if (hangs) expect({ setting, left: field.typed.left }).toEqual({ setting, left: drawn.word!.left });
      }
    });
  }
}

for (const block of ['#', '# ', '###### ', '- #', '1. ## ', '> #', '> - #']) {
  test(`a heading with no text, ${JSON.stringify(block)}, is one line of body text in the field and drawn, and leaving it moves nothing`, async ({
    app,
    browser,
    disk,
    page,
  }) => {
    await open({ app, disk, page }, block);
    for (const setting of settings) {
      await set(browser, setting);
      const { field, drawn } = await arriveAndLeave(page, browser, block, null, '#');
      expect({ setting, size: field.size, below: field.below }).toEqual({
        setting,
        size: setting.root,
        below: drawn.below,
      });
    }
  });
}

for (const block of [
  '- a\n  - b\n  - c',
  '1. a\n   1. b',
  '- a\n  > b',
  '> - a\n>   - b',
  '> - b',
  '> 1. b',
  '- > b',
]) {
  test(`arriving at and leaving a list item of several rows, or one in a quote, ${JSON.stringify(block)}, moves nothing`, async ({
    app,
    browser,
    disk,
    page,
  }) => {
    await open({ app, disk, page }, block);
    for (const setting of settings) {
      await set(browser, setting);
      const { field, drawn } = await arriveAndLeave(page, browser, block, 'b', 'b');
      expect({ setting, below: field.below, b: field.word!.top }).toEqual({
        setting,
        below: drawn.below,
        b: drawn.word!.top,
      });
    }
  });
}

for (const block of ['- Hello\n  ===', '> Hello\n> ---']) {
  test(`a setext heading of two rows, ${JSON.stringify(block)}, is set as body text in the field`, async ({
    app,
    browser,
    disk,
    page,
  }) => {
    await open({ app, disk, page }, block);
    await expect(page.drawnIn('live-below', 'h1, h2')).toHaveText('Hello');
    await browser.keyboard.press('ArrowDown');
    await browser.keyboard.press('ArrowDown');
    await expect(page.text).toHaveValue(block);
    expect((await page.fieldFont()).size).toBe('16px');
  });
}
