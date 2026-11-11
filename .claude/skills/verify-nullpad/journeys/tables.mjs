const typed = [
  '| Item | Qty | Price |',
  '| :--- | :-: | ----: |',
  '| **Apples** | 3 | 1.20 |',
  '| `pears` | 12 | 10.50 |',
  '| [map](https://example.com/) | a \\| b |',
  '',
  'A line between the two tables.',
  '',
  '| Name | Role | City | Team | Started | Manager | Phone | Notes |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| Ada Lovelace | Analyst | London | Engines | 1843-01-01 | Charles Babbage | 555-0100 | Wrote the first program |',
].join('\n');

export default async ({ page, type, look, shot, check }) => {
  const text = page.getByLabel('Note text');
  const preview = page.locator('[data-test-id=preview]');
  const tables = preview.locator('table');
  const first = tables.first();
  const second = tables.nth(1);
  const expectEqual = (have, want) => {
    if (JSON.stringify(have) !== JSON.stringify(want)) {
      throw new Error(`${JSON.stringify(have)} is not ${JSON.stringify(want)}`);
    }
  };
  const aligns = (table, selector) =>
    table.locator(selector).evaluateAll((cells) =>
      cells.map((cell) => getComputedStyle(cell).textAlign),
    );

  await text.click();
  await type(typed);
  await look();
  await page.keyboard.press('Control+e');
  await preview.waitFor();
  await look();
  await shot('wide-light');

  await check('two tables show, with a paragraph between them', async () => {
    expectEqual(await tables.count(), 2);
    expectEqual(await preview.locator('p').allTextContents(), ['A line between the two tables.']);
  });
  await check('the first table has its headers and rows as cells', async () => {
    expectEqual(await first.locator('th').allTextContents(), ['Item', 'Qty', 'Price']);
    expectEqual(await first.locator('tbody tr').count(), 3);
    expectEqual(await first.locator('tbody tr:nth-child(2) td').allTextContents(), ['pears', '12', '10.50']);
  });
  await check('a column is left, centre or right as the colons say', async () => {
    expectEqual(await aligns(first, 'th'), ['left', 'center', 'right']);
    expectEqual(await aligns(first, 'tbody tr:first-child td'), ['left', 'center', 'right']);
  });
  await check('bold, code and a link work in a cell', async () => {
    expectEqual(await first.locator('td strong').allTextContents(), ['Apples']);
    expectEqual(await first.locator('td code').allTextContents(), ['pears']);
    expectEqual(await first.locator('td a').getAttribute('href'), 'https://example.com/');
  });
  await check('a row with too few cells gets empty ones, and an escaped pipe is text', async () => {
    expectEqual(await first.locator('tbody tr:last-child td').allTextContents(), ['map', 'a | b', '']);
  });
  await check('the header row is bold on a different background from the page', async () => {
    const look = await first.evaluate((table) => {
      const th = getComputedStyle(table.querySelector('th'));
      const td = getComputedStyle(table.querySelector('td'));
      return { weight: Number(th.fontWeight), head: th.backgroundColor, body: td.backgroundColor };
    });
    if (look.weight < 600) throw new Error(`the header weight is ${look.weight}`);
    if (look.head === look.body) throw new Error(`header and body are both ${look.head}`);
  });

  await page.emulateMedia({ colorScheme: 'dark' });
  await look(600);
  await shot('wide-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  await page.setViewportSize({ width: 390, height: 844 });
  await look(600);
  await shot('phone-light');
  await check('on a phone the wide table scrolls inside its box and the page does not', async () => {
    const widths = await page.evaluate(() => {
      const box = document.querySelectorAll('[data-test-id=preview] .table-scroll')[1];
      const preview = document.querySelector('[data-test-id=preview]');
      return {
        window: innerWidth,
        page: document.documentElement.scrollWidth,
        previewOverflow: preview.scrollWidth - preview.clientWidth,
        boxOverflow: box.scrollWidth - box.clientWidth,
        boxRight: box.getBoundingClientRect().right,
      };
    });
    if (widths.page > widths.window) throw new Error(`the page is ${widths.page}px wide`);
    if (widths.previewOverflow > 0) throw new Error('the rendered page scrolls sideways');
    if (widths.boxRight > widths.window) throw new Error('the box runs off the screen');
    if (widths.boxOverflow <= 0) throw new Error('the wide table does not scroll in its box');
  });
  await check('the narrow table fits on a phone without scrolling', async () => {
    const overflow = await page.evaluate(() => {
      const box = document.querySelector('[data-test-id=preview] .table-scroll');
      return box.scrollWidth - box.clientWidth;
    });
    if (overflow > 0) throw new Error(`the narrow table overflows by ${overflow}px`);
  });
  await check('the keyboard reaches the wide table and scrolls it', async () => {
    const box = preview.locator('.table-scroll').nth(1);
    await box.scrollIntoViewIfNeeded();
    for (let tabs = 0; tabs < 12; tabs++) {
      if (await box.evaluate((node) => node === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    if (!(await box.evaluate((node) => node === document.activeElement))) {
      throw new Error('Tab never reached the table');
    }
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await look(300);
    const scrolled = await box.evaluate((node) => node.scrollLeft);
    if (scrolled <= 0) throw new Error('the arrow keys did not scroll the table');
  });
  await shot('phone-scrolled');

  await page.emulateMedia({ colorScheme: 'dark' });
  await look(600);
  await shot('phone-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  await page.getByRole('button', { name: 'Edit' }).click();
  await text.waitFor();
  await check('flipping back shows the note exactly as typed', async () => {
    expectEqual(await text.inputValue(), typed);
  });

  await text.click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Shift+End');
  await type('| Thing | Qty | Price |');
  await page.keyboard.press('Control+e');
  await preview.waitFor();
  await check('an edit shows on the next flip', async () => {
    expectEqual(await first.locator('th').allTextContents(), ['Thing', 'Qty', 'Price']);
  });
  await shot('phone-edited');
};
