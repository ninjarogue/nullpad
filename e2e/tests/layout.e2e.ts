import { expect } from 'e2e';
import { test } from './nullpad.ts';

const widths = [390, 1280];
const long = 'long '.repeat(80);

test.beforeEach(async ({ app, page }) => {
  await app.open('/');
  await expect(page.text).toBeFocused();
});

for (const width of widths) {
  test(`a long line of code scrolls inside its block at ${width}px and never widens the page`, async ({
    browser,
    page,
  }) => {
    await browser.setViewport({ width, height: 844 });
    const fence = '```\n' + long + '\n```';
    const inList = '- item\n\n  ```\n  ' + long + '\n  ```';
    const inQuote = '> ```\n> ' + long + '\n> ```';
    await page.text.fill([fence, inList, inQuote, '    ' + long].join('\n\n'));
    await page.showPage();
    await expect(page.codeBlocks).toHaveCount(4);

    const shown = await browser.evaluate(() => {
      const preview = document.querySelector('[data-test-id="preview"]')!;
      const blocks = [...preview.querySelectorAll('pre')];
      return {
        window: innerWidth,
        page: document.documentElement.scrollWidth,
        previewClient: preview.clientWidth,
        previewScroll: preview.scrollWidth,
        blockRights: blocks.map((block) => block.getBoundingClientRect().right),
        blockOverflow: blocks.map((block) => block.scrollWidth - block.clientWidth),
      };
    });
    expect(shown.page).toBeLessThanOrEqual(shown.window);
    expect(shown.previewScroll).toBeLessThanOrEqual(shown.previewClient);
    for (const right of shown.blockRights) expect(right).toBeLessThanOrEqual(shown.window);
    for (const overflow of shown.blockOverflow) expect(overflow).toBeGreaterThan(0);
  });
}

test('a word too long for the line wraps inside a list and a quote instead of widening the page', async ({
  browser,
  page,
}) => {
  await browser.setViewport({ width: 390, height: 844 });
  const word = 'x'.repeat(200);
  await page.text.fill(`- ${word}\n  - ${word}\n\n> ${word}\n\n- [ ] ${word}`);
  await page.showPage();
  await expect(page.items).toHaveCount(3);

  const shown = await browser.evaluate(() => {
    const preview = document.querySelector('[data-test-id="preview"]')!;
    return {
      window: innerWidth,
      page: document.documentElement.scrollWidth,
      previewClient: preview.clientWidth,
      previewScroll: preview.scrollWidth,
    };
  });
  expect(shown.page).toBeLessThanOrEqual(shown.window);
  expect(shown.previewScroll).toBeLessThanOrEqual(shown.previewClient);
});

for (const width of widths) {
  test(`a task box sits level with the first line of its text, with room before it, at ${width}px`, async ({
    browser,
    page,
  }) => {
    await browser.setViewport({ width, height: 844 });
    await page.text.fill(
      '- [ ] tight one\n- [x] tight two\n\n* [ ] loose one\n\n* [x] loose two\n\n1. [ ] ordered one\n\n- [ ] ' +
        'a task with enough words to need more than one line on a phone, so the box stays by the first',
    );
    await page.showPage();
    await expect(page.boxes).toHaveCount(6);

    const measured = [];
    for (let nth = 0; nth < 6; nth++) measured.push(await page.measureTask(nth));
    for (const task of measured) {
      expect(task.gap).toBeGreaterThanOrEqual(4);
      expect(task.boxMiddle).toBeGreaterThan(task.lineTop);
      expect(task.boxMiddle).toBeLessThan(task.lineBottom);
    }
  });
}

test('a task item shows no bullet, and an ordered task keeps its number', async ({
  browser,
  page,
}) => {
  await page.text.fill('- [ ] a\n- b\n\n1. [ ] c');
  await page.showPage();
  await expect(page.boxes).toHaveCount(2);

  expect((await page.measureTask(0)).marker).toBe('none');
  expect((await page.measureTask(1)).marker).toBe('decimal');
  const plain = await browser.evaluate(
    () =>
      getComputedStyle(document.querySelector('[data-test-id="preview"] li:not(.task)')!)
        .listStyleType,
  );
  expect(plain).toBe('disc');
});

test('on a phone a task box is at least 24px square and rows are 44px apart', async ({
  browser,
  page,
}) => {
  await browser.setViewport({ width: 390, height: 844 });
  await page.text.fill('- [ ] one\n- [ ] two\n- [ ] three');
  await page.showPage();
  await expect(page.boxes).toHaveCount(3);

  const [one, two, three] = [
    await page.measureTask(0),
    await page.measureTask(1),
    await page.measureTask(2),
  ];
  for (const task of [one, two, three]) {
    expect(task.width).toBeGreaterThanOrEqual(24);
    expect(task.height).toBeGreaterThanOrEqual(24);
  }
  expect(two.boxMiddle - one.boxMiddle).toBeGreaterThanOrEqual(44);
  expect(three.boxMiddle - two.boxMiddle).toBeGreaterThanOrEqual(44);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`in the ${scheme} scheme a quote has a bar and quieter text, and a code block is a panel`, async ({
    browser,
    page,
  }) => {
    await browser.emulateMedia({ colorScheme: scheme });
    await page.text.fill('plain\n\n> quoted\n\n```\ncode\n```');
    await page.showPage();
    await expect(page.quotes).toHaveCount(1);
    await expect(page.codeBlocks).toHaveCount(1);

    const look = await browser.evaluate(() => {
      const style = (selector: string) =>
        getComputedStyle(document.querySelector(`[data-test-id="preview"] ${selector}`)!);
      const linear = (color: string) => {
        const canvas = document.createElement('canvas').getContext('2d')!;
        canvas.fillStyle = color;
        canvas.fillRect(0, 0, 1, 1);
        return [...canvas.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((channel) => {
          const unit = channel / 255;
          return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
        });
      };
      const luminance = (color: string) => {
        const [r, g, b] = linear(color);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const contrast = (a: string, b: string) => {
        const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (high + 0.05) / (low + 0.05);
      };
      const paper = getComputedStyle(document.body).backgroundColor;
      const quote = style('blockquote');
      const panel = style('pre');
      return {
        inkContrast: contrast(style('p').color, paper),
        quoteContrast: contrast(style('blockquote p').color, paper),
        barWidth: parseFloat(quote.borderLeftWidth),
        barStyle: quote.borderLeftStyle,
        barContrast: contrast(quote.borderLeftColor, paper),
        panelContrast: contrast(panel.backgroundColor, paper),
        codeBackground: style('pre code').backgroundColor,
      };
    });
    expect(look.quoteContrast).toBeLessThan(look.inkContrast);
    expect(look.quoteContrast).toBeGreaterThanOrEqual(4.5);
    expect(look.barWidth).toBeGreaterThanOrEqual(2);
    expect(look.barStyle).toBe('solid');
    expect(look.barContrast).toBeGreaterThanOrEqual(1.5);
    expect(look.panelContrast).toBeGreaterThan(1.05);
    expect(look.codeBackground).toBe('rgba(0, 0, 0, 0)');
  });
}

test('struck text has a line through it', async ({ browser, page }) => {
  await page.text.fill('a ~~gone~~ b');
  await page.showPage();

  const line = await browser.evaluate(
    () =>
      getComputedStyle(document.querySelector('[data-test-id="preview"] del')!).textDecorationLine,
  );
  expect(line).toBe('line-through');
});

test('marks such as === and ~~ show as the characters typed, in the source and in code', async ({
  browser,
  page,
}) => {
  await page.text.fill('Title\n===\n\n`a != b`\n\n```\n--- ~~ ===\n```');
  const ligatures = (selector: string) =>
    browser.evaluate(
      (selector) =>
        [...document.querySelectorAll(selector)].map(
          (element) => getComputedStyle(element).fontVariantLigatures,
        ),
      selector,
    );

  expect(await ligatures('.editor > *')).toEqual(['none', 'none']);
  await page.showPage();
  expect(await ligatures('[data-test-id="preview"] code')).toEqual(['none', 'none']);
});
