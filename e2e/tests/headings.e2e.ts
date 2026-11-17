import type { Browser } from '@e2e-dev/web';
import { expect } from 'e2e';
import { chromium } from 'playwright-core';
import type { App } from 'e2e';
import { test } from './nullpad.ts';
import type { Disk, Note, Page } from './nullpad.ts';

const stored = (body: string): Note => ({ key: 'live', title: null, body });

type Setting = { width: number; root: string; font: string | null };

const settings: readonly Setting[] = [
  { width: 1280, root: '16px', font: null },
  { width: 1280, root: '12px', font: null },
  { width: 1280, root: '20px', font: null },
  { width: 1280, root: '16px', font: 'serif' },
  { width: 1024, root: '16px', font: null },
  { width: 1024, root: '20px', font: null },
  { width: 412, root: '16px', font: null },
];

const roots = ['12px', '16px', '20px', '24px'];
const sweep: readonly Setting[] = [
  ...[320, 412, 768, 900, 1024, 1280, 1600].flatMap((width) => roots.map((root) => ({ width, root, font: null }))),
  { width: 1280, root: '16px', font: 'serif' },
];

async function set(browser: Browser, setting: Setting) {
  await browser.setViewport({ width: setting.width, height: 720 });
  await browser.evaluate((setting: Setting) => {
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

async function open({ app, disk, page }: { app: App; disk: Disk; page: Page }, block: string) {
  const body = `top\n\n${block}\n\nbelow words`;
  await disk.seed([stored(body)]);
  await app.open('/');
  await expect(page.text).toHaveValue(body);
  await page.markdown.tap();
  await expect(page.text).toBeFocused();
  await expect(page.text).toHaveValue('top');
}

async function expectPlaceOf(page: Page, word: string) {
  const place = await page.placeOf(word);
  expect(place, `${word} is on the page`).not.toBeNull();
  return place!;
}

async function pressUntil(page: Page, browser: Browser, key: string, value: string) {
  for (let pressed = 0; pressed < 20 && (await page.text.inputValue()) !== value; pressed++) {
    await browser.keyboard.press(key);
  }
  await expect(page.text).toHaveValue(value);
}

async function arriveAndLeave(page: Page, browser: Browser, block: string, word: string | null, typed: string) {
  await browser.keyboard.press('ArrowDown');
  await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue(block);
  await page.nextFrame();
  const field = {
    word: word === null ? null : await expectPlaceOf(page, word),
    typed: await expectPlaceOf(page, typed),
    below: (await expectPlaceOf(page, 'below')).top,
    size: (await page.sizesOf('[data-test-id="editor"]')).size,
  };
  await pressUntil(page, browser, 'ArrowDown', '');
  await page.nextFrame();
  const drawn = {
    word: word === null ? null : await expectPlaceOf(page, word),
    below: (await expectPlaceOf(page, 'below')).top,
    ...(await browser.evaluate(() => {
      const sheet = document.querySelector('.page')!;
      const style = getComputedStyle(sheet);
      return {
        pageLeft: sheet.getBoundingClientRect().left + sheet.clientLeft,
        area: sheet.clientWidth,
        column: sheet.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      };
    })),
  };
  await pressUntil(page, browser, 'ArrowUp', 'top');
  return { field, drawn };
}

const containers = [
  { what: 'on its own line', prefix: '', hangs: 'marks' },
  { what: 'in a list item', prefix: '- ', hangs: 'item marker' },
  { what: 'in an ordered item', prefix: '1. ', hangs: 'item marker' },
  { what: 'in an item numbered 10', prefix: '10. ', hangs: 'item marker' },
  { what: 'in a nested item', prefix: '- - ', hangs: null },
  { what: 'in a quote', prefix: '> ', hangs: null },
  { what: 'in a quoted item', prefix: '> - ', hangs: null },
  { what: 'in a quote in an item', prefix: '- > ', hangs: null },
] as const;

for (const { what, prefix, hangs } of containers) {
  for (const level of [1, 2, 3, 4, 5, 6]) {
    const marks = '#'.repeat(level);
    const sizes = hangs === 'marks' ? sweep : settings;
    test(`a heading ${level} ${what} is the same size in the field and drawn, and leaving it moves no row and moves its words only by what its marks need past the margin, ${hangs === 'marks' ? 'from 320 to 1600px wide at 12 to 24px' : 'at 12, 16 and 20px, in a second font, 1024px wide and on a phone'}`, async ({
      app,
      browser,
      disk,
      page,
    }) => {
      await open({ app, disk, page }, `${prefix}${marks} Hello world`);
      for (const setting of sizes) {
        await set(browser, setting);
        const { field, drawn } = await arriveAndLeave(page, browser, `${prefix}${marks} Hello world`, 'Hello', marks);
        const heading = `[data-test-id^="live-"] h${level}`;
        await expect(browser.locator(heading)).toHaveCount(1);
        const drawnSize = (await page.sizesOf(heading)).size;
        expect({ setting, size: field.size, below: field.below, top: field.word!.top }).toEqual({
          setting,
          size: drawnSize,
          below: drawn.below,
          top: drawn.word!.top,
        });
        if (hangs === 'item marker') {
          expect({ setting, left: field.typed.left }).toEqual({ setting, left: drawn.word!.left });
        }
        if (hangs === 'marks') {
          expect({ setting, marksEndBeforeWords: field.typed.right <= field.word!.left + 0.5 }).toEqual({
            setting,
            marksEndBeforeWords: true,
          });
          expect({ setting, marksOnThePage: field.typed.left >= drawn.pageLeft - 0.5 }).toEqual({
            setting,
            marksOnThePage: true,
          });
          const rem = parseFloat(setting.root);
          const room = drawn.word!.left - drawn.pageLeft;
          const marksWide = field.word!.left - field.typed.left;
          const shift = field.word!.left - drawn.word!.left;
          const measured = JSON.stringify({ setting, room, marksWide, shift, area: drawn.area, column: drawn.column });
          expect(
            Math.abs(shift - Math.max(0, marksWide - room)),
            `words move by what the marks need past the margin: ${measured}`,
          ).toBeLessThanOrEqual(1);
          // A column of 27rem holds about 45 characters of body text.
          if (drawn.area >= 1.25 * rem + 27 * rem + marksWide) {
            expect(Math.abs(shift), `the marks fit beside a 45 character column, so the words stay: ${measured}`).toBeLessThanOrEqual(0.5);
          }
          expect(
            drawn.column >= 27 * rem - 0.5 || Math.abs(room - 1.25 * rem) <= 0.5,
            `the margin takes room for marks only from beside a 45 character column: ${measured}`,
          ).toBe(true);
        }
      }
    });
  }
}

for (const block of [
  '#',
  '# ',
  '###### ',
  '- #',
  '1. ## ',
  '> #',
  '> - #',
  '- > #',
  '- > ## ',
  '- > ###### ',
  '- > # #',
  '> - > #',
  '1. > ### ',
]) {
  test(`a heading with no text, ${JSON.stringify(block)}, is set at its heading size in the field and drawn, and leaving it moves nothing`, async ({
    app,
    browser,
    disk,
    page,
  }) => {
    const level = block.match(/#+/)![0].length;
    await open({ app, disk, page }, block);
    for (const setting of settings) {
      await set(browser, setting);
      const { field, drawn } = await arriveAndLeave(page, browser, block, null, '#');
      const heading = `[data-test-id^="live-"] h${level}`;
      await expect(browser.locator(heading)).toHaveCount(1);
      const drawnSize = (await page.sizesOf(heading)).size;
      expect({ setting, size: field.size, below: field.below }).toEqual({
        setting,
        size: drawnSize,
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
  '> a\n>\n> b',
  '> > b\n>\n> c',
  '> - a\n>\n> b',
  '> a\n>\n> > b\n>\n> c',
  '> a\n> > b',
  '> a\n> - b',
  '> ---\n> ---\n> b',
]) {
  test(`arriving at and leaving a list item or a quote of several rows, or an item in a quote, ${JSON.stringify(block)}, moves nothing`, async ({
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

for (const block of [
  '> # h\n>\n> b',
  '> ## h\n>\n> b',
  '> b\n>\n> # h',
  '> b\n>\n> > # h',
  '> > # h\n>\n> b',
  '> - # h\n>\n> b',
  '> > - # h\n>\n> b',
  '> b\n>\n> - # h',
  '> ###### h\n> b',
  '> - #### h\n> - b',
  '> b\n> ---\n> c',
  '> b\n> c\n> ===\n>\n> d',
  '> a\n>\n> > # h\n> >\n> > b',
  '> - a\n>\n> - # h\n>\n>   b',
]) {
  test(`a heading in a quote of several rows, ${JSON.stringify(block)}, set over two rows or next to a blank row or smaller than body text, takes the rows it takes in the field`, async ({
    app,
    browser,
    disk,
    page,
  }) => {
    await open({ app, disk, page }, block);
    for (const setting of settings) {
      await set(browser, setting);
      const { field, drawn } = await arriveAndLeave(page, browser, block, 'b', 'b');
      // Blocks of other sizes round to the 1/64px the browser lays out in.
      const moved = Math.round(Math.abs(field.below - drawn.below) * 10) / 10;
      expect({ setting, moved }).toEqual({ setting, moved: 0 });
    }
  });
}

for (const block of ['Hello\n===', 'Hello\n---', 'Hello\nworld\n===']) {
  test(`a setext heading on its own, ${JSON.stringify(block)}, takes the rows it takes in the field, and arriving at it and leaving it moves nothing`, async ({
    app,
    browser,
    disk,
    page,
  }) => {
    await open({ app, disk, page }, block);
    for (const setting of settings) {
      await set(browser, setting);
      const { field, drawn } = await arriveAndLeave(page, browser, block, null, 'Hello');
      const moved = Math.round(Math.abs(field.below - drawn.below) * 10) / 10;
      expect({ setting, moved }).toEqual({ setting, moved: 0 });
    }
  });
}

for (const block of [
  '> ```\n> code\n> ```\n> b',
  '> b\n> ```\n> code\n> ```',
  '>     code\n>     code\n>\n> b',
  '> b\n>\n>     code',
  '> b\n> ```\n> ```',
  '> b\n> ```\n> code',
]) {
  test(`a code block in a quote of several rows, ${JSON.stringify(block)}, takes the rows it takes in the field, and arriving at it and leaving it moves nothing`, async ({
    app,
    browser,
    disk,
    page,
  }) => {
    await open({ app, disk, page }, block);
    for (const setting of settings) {
      await set(browser, setting);
      const { field, drawn } = await arriveAndLeave(page, browser, block, null, 'b');
      const moved = Math.round(Math.abs(field.below - drawn.below) * 10) / 10;
      expect({ setting, moved }).toEqual({ setting, moved: 0 });
    }
  });
}

test('a rule in a quote is drawn as a line in forced colors and in print', async ({ app }) => {
  await app.open('/');
  const own = await chromium.launch();
  try {
    const lines = [];
    for (const media of [{ forcedColors: 'active' }, { media: 'print' }] as const) {
      const tab = await (await own.newContext()).newPage();
      await tab.emulateMedia(media);
      await tab.goto(`${app.baseUrl}/`);
      const text = tab.getByLabel('Note text');
      await text.fill('top\n\n> a\n>\n> ---\n>\n> b\n\nbelow');
      await tab.keyboard.press('Control+Home');
      await expect.poll(() => tab.locator('.page.live .part blockquote > hr').count()).toBe(1);
      lines.push({
        media,
        line: await tab.evaluate(() => {
          const rule = document.querySelector('.page.live .part blockquote > hr')!;
          const drawn = (pseudo: string | null) => {
            const style = getComputedStyle(rule, pseudo);
            const shown = pseudo === null || (style.content !== 'none' && style.display !== 'none');
            const inked = !/^rgba\(.*, 0\)$|^transparent$/.test(style.borderTopColor);
            return shown && style.borderTopStyle === 'solid' && parseFloat(style.borderTopWidth) >= 1 && inked;
          };
          return rule.getBoundingClientRect().width > 0 && (drawn(null) || drawn('::before'));
        }),
      });
    }
    expect(lines).toEqual([
      { media: { forcedColors: 'active' }, line: true },
      { media: { media: 'print' }, line: true },
    ]);
  } finally {
    await own.close();
  }
});

for (const block of ['# []()', '## [](x)', '- ### []()', '> # []()', '- > ## []()']) {
  test(`a heading whose text draws nothing, ${JSON.stringify(block)}, keeps the height it has in the field when drawn, and leaving it moves nothing`, async ({
    app,
    browser,
    disk,
    page,
  }) => {
    await open({ app, disk, page }, block);
    for (const setting of settings) {
      await set(browser, setting);
      const { field, drawn } = await arriveAndLeave(page, browser, block, null, '#');
      expect({ setting, below: field.below }).toEqual({ setting, below: drawn.below });
    }
  });
}

for (const [block, words] of [
  ['- one\n  - two\n  - six', ['one', 'two', 'six']],
  ['1. one\n   1. two\n   2. six', ['one', 'two', 'six']],
  ['- one\n  > two\n  > six', ['one', 'two', 'six']],
  ['> - one\n> - two\n>   - six', ['one', 'two', 'six']],
  ['> one\n> > two\n> > six', ['one', 'two', 'six']],
] as const) {
  test(`the rows of nested items and quotes, ${JSON.stringify(block)}, are drawn one line of body text apart, as the field sets them`, async ({
    app,
    browser,
    disk,
    page,
  }) => {
    await open({ app, disk, page }, block);
    for (const setting of settings) {
      await set(browser, setting);
      await page.nextFrame();
      const line = 1.7 * parseFloat(setting.root);
      const tops: number[] = [];
      for (const word of words) tops.push((await expectPlaceOf(page, word)).top);
      const gaps = tops.slice(1).map((top, index) => Math.round((top - tops[index] - line) * 10) / 10 + 0);
      expect({ setting, gaps }).toEqual({ setting, gaps: gaps.map(() => 0) });
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
