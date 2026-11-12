import { expect } from 'e2e';
import { contrast, test } from './nullpad.ts';

const widths = [390, 1280];
const columns = Array.from({ length: 12 }, (_, i) => i + 1);
const wide = [
  `| ${columns.map((n) => `Column ${n}`).join(' | ')} |`,
  `| ${columns.map(() => '---').join(' | ')} |`,
  `| ${columns.map((n) => `Value ${n}`).join(' | ')} |`,
].join('\n');

test.beforeEach(async ({ app, page }) => {
  await app.open('/');
  await expect(page.text).toBeFocused();
});

test('a typed table shows as a table with its headings and cells', async ({ page }) => {
  await page.text.fill('| Item | Qty |\n| --- | --- |\n| Apples | 3 |\n| Pears | 12 |');
  await page.showPreview.tap();

  await expect(page.tables).toHaveCount(1);
  await expect(page.headers).toHaveText(['Item', 'Qty']);
  await expect(page.cells).toHaveText(['Apples', '3', 'Pears', '12']);
  await expect(page.paragraphs).toHaveCount(0);
});

test('the pipes at the ends of a row are not needed', async ({ page }) => {
  await page.text.fill('Item | Qty\n--- | ---\nApples | 3');
  await page.showPreview.tap();

  await expect(page.headers).toHaveText(['Item', 'Qty']);
  await expect(page.cells).toHaveText(['Apples', '3']);
});

test('a heading with no delimiter row under it stays text', async ({ page }) => {
  await page.text.fill('Item | Qty\nApples | 3');
  await page.showPreview.tap();

  await expect(page.tables).toHaveCount(0);
  await expect(page.paragraphs).toHaveText(['Item | Qty Apples | 3']);
});

test('a row with too few cells gets empty ones and a row with too many loses the extra', async ({
  page,
}) => {
  await page.text.fill('| a | b | c |\n| - | - | - |\n| 1 |\n| 2 | 3 | 4 | 5 |');
  await page.showPreview.tap();

  await expect(page.headers).toHaveText(['a', 'b', 'c']);
  await expect(page.cells).toHaveText(['1', '', '', '2', '3', '4']);
});

test('bold, italic, code, strikethrough and a link work inside a cell', async ({ page }) => {
  await page.text.fill(
    '| a | b |\n| - | - |\n| **bold** *italic* | `code` ~~gone~~ |\n| [docs](https://example.com/) | x |',
  );
  await page.showPreview.tap();

  await expect(page.strong).toHaveText(['bold']);
  await expect(page.emphasis).toHaveText(['italic']);
  await expect(page.code).toHaveText(['code']);
  await expect(page.deleted).toHaveText(['gone']);
  const link = page.preview.getByRole('link', 'docs');
  await expect(link).toHaveAttribute('href', 'https://example.com/');
  await expect(link).toHaveAttribute('target', '_blank');
});

test('an escaped pipe is a pipe in the cell, and a pipe in code still splits the cell', async ({
  page,
}) => {
  await page.text.fill('| a | b |\n| - | - |\n| x \\| y | `p|q` |');
  await page.showPreview.tap();

  await expect(page.cells).toHaveText(['x | y', '`p']);
});

test('typed HTML and an unsafe link in a cell show as the text typed', async ({ page }) => {
  await page.text.fill('| a |\n| - |\n| <b>x</b> |\n| [y](javascript:alert(1)) |');
  await page.showPreview.tap();

  await expect(page.cells).toHaveText(['<b>x</b>', '[y](javascript:alert(1))']);
  await expect(page.preview.getByRole('link')).toHaveCount(0);
  await expect(page.strong).toHaveCount(0);
});

test('a blank line ends the table and the next line is a paragraph', async ({ page }) => {
  await page.text.fill('| a |\n| - |\n| 1 |\n\nafter');
  await page.showPreview.tap();

  await expect(page.cells).toHaveText(['1']);
  await expect(page.paragraphs).toHaveText(['after']);
});

test('a table sits inside a list item and inside a quote', async ({ page }) => {
  await page.text.fill('- item\n\n  | a | b |\n  | - | - |\n  | 1 | 2 |\n\n> | c |\n> | - |\n> | 3 |');
  await page.showPreview.tap();

  await expect(page.tables).toHaveCount(2);
  await expect(page.inPreview('li table')).toHaveCount(1);
  await expect(page.inPreview('blockquote table')).toHaveCount(1);
  await expect(page.headers).toHaveText(['a', 'b', 'c']);
  await expect(page.cells).toHaveText(['1', '2', '3']);
});

test('colons in the delimiter row set each column to left, centre or right', async ({ page }) => {
  const longHeads = '| Left column | Centre column | Right column | Plain column |';
  const longCells = '| left cell text | centre cell text | right cell text | plain cell text |';
  await page.text.fill(
    `${longHeads}\n| :-- | :-: | --: | --- |\n| a | b | c | d |\n\n` +
      '| a | b | c | d |\n| :-- | :-: | --: | --- |\n' +
      longCells,
  );
  await page.showPreview.tap();
  await expect(page.tables).toHaveCount(2);

  const room = 12;
  const pixel = 1.5;
  const [left, centre, right, plain] = [
    await page.measureCell('td', 0),
    await page.measureCell('td', 1),
    await page.measureCell('td', 2),
    await page.measureCell('td', 3),
  ];
  expect(left.before).toBeLessThan(pixel);
  expect(left.after).toBeGreaterThan(room);
  expect(Math.abs(centre.before - centre.after)).toBeLessThan(pixel);
  expect(centre.before).toBeGreaterThan(room);
  expect(right.after).toBeLessThan(pixel);
  expect(right.before).toBeGreaterThan(room);
  expect(plain.before).toBeLessThan(pixel);
  expect(plain.after).toBeGreaterThan(room);

  const [headLeft, headCentre, headRight, headPlain] = [
    await page.measureCell('th', 4),
    await page.measureCell('th', 5),
    await page.measureCell('th', 6),
    await page.measureCell('th', 7),
  ];
  expect(headLeft.before).toBeLessThan(pixel);
  expect(Math.abs(headCentre.before - headCentre.after)).toBeLessThan(pixel);
  expect(headCentre.before).toBeGreaterThan(room);
  expect(headRight.after).toBeLessThan(pixel);
  expect(headRight.before).toBeGreaterThan(room);
  expect(headPlain.before).toBeLessThan(pixel);
});

test('an edit shows on the next flip', async ({ page }) => {
  await page.text.fill('| a | b |\n| - | - |\n| 1 | 2 |');
  await page.showPreview.tap();
  await expect(page.headers).toHaveText(['a', 'b']);

  await page.showSource.tap();
  await page.text.fill('| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |');
  await page.showPreview.tap();

  await expect(page.headers).toHaveText(['a', 'b', 'c']);
  await expect(page.cells).toHaveText(['1', '2', '3', '4', '5', '6']);
});

test('a note that opens with a table is listed by its first cell', async ({ page }) => {
  await page.text.fill('| **Groceries** | Qty |\n| - | - |\n| milk | 2 |');

  await expect(page.currentRow).toHaveText('Groceries');
});

for (const width of widths) {
  test(`a wide table scrolls inside its own box at ${width}px and never widens the page`, async ({
    browser,
    page,
  }) => {
    await browser.setViewport({ width, height: 844 });
    await page.text.fill(`| a | b |\n| - | - |\n| 1 | 2 |\n\n${wide}`);
    await page.showPreview.tap();
    await expect(page.tables).toHaveCount(2);
    await expect(page.tableBoxes).toHaveCount(2);

    const shown = await page.measureTables();
    expect(shown.page).toBeLessThanOrEqual(shown.window);
    expect(shown.previewScroll).toBeLessThanOrEqual(shown.previewClient);
    for (const right of shown.boxRights) expect(right).toBeLessThanOrEqual(shown.window);
    expect(shown.boxOverflow[0]).toBe(0);
    expect(shown.boxOverflow[1]).toBeGreaterThan(0);
  });
}

test('the keyboard reaches a wide table and scrolls it', async ({ browser, page }) => {
  await browser.setViewport({ width: 390, height: 844 });
  await page.text.fill(wide);
  await page.showPreview.tap();
  await expect(page.tableBoxes).toHaveCount(1);

  // Chromium focuses a box that scrolls with no tabindex, and Safari does not.
  await expect(page.tableBoxes).toHaveAttribute('tabindex', '0');
  await page.showSource.focus();
  const focused = () =>
    browser.evaluate(() => document.activeElement?.classList.contains('table-scroll') ?? false);
  for (let presses = 0; presses < 6 && !(await focused()); presses++) {
    await browser.keyboard.press('Tab');
  }
  expect(await focused()).toBe(true);
  await expect(page.tableBoxes).toBeFocused();

  expect((await page.measureTables()).boxScrolled).toEqual([0]);
  for (let presses = 0; presses < 3; presses++) await browser.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await page.measureTables()).boxScrolled[0])
    .toBeGreaterThan(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`in the ${scheme} scheme a table has a shaded heading, lines between its cells and readable text`, async ({
    browser,
    page,
  }) => {
    await browser.emulateMedia({ colorScheme: scheme });
    await page.text.fill('| a | b |\n| - | - |\n| 1 | 2 |\n| 3 | 4 |');
    await page.showPreview.tap();
    await expect(page.tables).toHaveCount(1);

    const look = await browser.evaluate(() => {
      const style = (selector: string) =>
        getComputedStyle(document.querySelector(`[data-test-id="preview"] ${selector}`)!);
      return {
        paper: getComputedStyle(document.body).backgroundColor,
        headBackground: style('th').backgroundColor,
        headInk: style('th').color,
        headWeight: Number(style('th').fontWeight),
        ink: style('td').color,
        line: style('td').borderBottomColor,
        lineWidth: parseFloat(style('td').borderBottomWidth),
        lineStyle: style('td').borderBottomStyle,
      };
    });
    const [paper, head, headInk, ink, line] = await page.luminances([
      look.paper,
      look.headBackground,
      look.headInk,
      look.ink,
      look.line,
    ]);
    expect(contrast(ink, paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(headInk, head)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(head, paper)).toBeGreaterThan(1.05);
    expect(look.headWeight).toBeGreaterThanOrEqual(600);
    expect(look.lineWidth).toBeGreaterThanOrEqual(1);
    expect(look.lineStyle).toBe('solid');
    expect(contrast(line, paper)).toBeGreaterThanOrEqual(1.2);
  });
}
