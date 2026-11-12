const typed = [
  'Trip plan',
  '=========',
  '',
  'A ~~long~~ short trip, ~one~ day.',
  'Second typed line',
  '',
  'Packing',
  '-------',
  '',
  '- socks',
  '- shirts',
  '  - blue',
  '  - white',
  '- hat',
  '  with a brim',
  '',
  '3. third',
  '4. fourth',
  '',
  '> Remember to book.',
  'lazy second line',
  '> - a list in a quote',
  '',
  '***',
  '',
  '```gleam',
  'io.println("a very long line that runs past the edge of a phone and has to scroll inside its block")',
  '```',
].join('\n');

export default async ({ page, type, look, shot, check }) => {
  const text = page.getByLabel('Note text');
  const preview = page.locator('[data-test-id=preview]');
  const count = (selector) => preview.locator(selector).count();
  const shown = (selector) => preview.locator(selector).first().evaluate((node) => node.innerText);
  const expectEqual = (have, want) => {
    if (JSON.stringify(have) !== JSON.stringify(want)) {
      throw new Error(`${JSON.stringify(have)} is not ${JSON.stringify(want)}`);
    }
  };

  const markdown = page.getByRole('button', { name: 'Markdown' });
  // The button gives the field focus a moment after the click. Keys typed sooner are lost.
  const focused = () => page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Note text');

  await markdown.click();
  await text.waitFor();
  await focused();
  await type(typed);
  await look();
  await markdown.click();
  await focused();
  await page.keyboard.press('Escape');
  await preview.waitFor();
  await look();
  await shot('wide-light');

  await check('= and - under a line make a level 1 and a level 2 heading', async () => {
    expectEqual(await preview.locator('h1').allTextContents(), ['Trip plan']);
    expectEqual(await preview.locator('h2').allTextContents(), ['Packing']);
  });
  await check('one and two tildes strike text through', async () => {
    expectEqual(await preview.locator('del').allTextContents(), ['long', 'one']);
  });
  await check('a tight list has no paragraphs and a nested list sits inside its item', async () => {
    expectEqual(await count('ul > li > ul > li'), 2);
    expectEqual(await count('ul:first-of-type li > p'), 0);
  });
  await check('each typed line of a tight item shows on its own line', async () => {
    const item = preview.locator('li', { hasText: 'with a brim' });
    expectEqual(await item.evaluate((node) => node.innerText), 'hat\nwith a brim');
  });
  await check('an ordered list that starts at 3 starts at 3', async () => {
    expectEqual(await preview.locator('ol').getAttribute('start'), '3');
  });
  await check('a lazy line stays in the quote and a list nests inside it', async () => {
    expectEqual(await count('blockquote'), 1);
    expectEqual(await shown('blockquote > p'), 'Remember to book.\nlazy second line');
    expectEqual(await count('blockquote > ul > li'), 1);
  });
  await check('*** is a thematic break', async () => {
    expectEqual(await count('hr'), 1);
  });
  await check('the fence is a code block with its language as a class', async () => {
    expectEqual(await preview.locator('pre > code').getAttribute('class'), 'language-gleam');
  });

  await page.emulateMedia({ colorScheme: 'dark' });
  await look(600);
  await shot('wide-dark');

  await page.setViewportSize({ width: 390, height: 844 });
  await look(600);
  await shot('phone-dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await look(600);
  await shot('phone-light');
  await check('on a phone-wide window the page does not scroll sideways, the code block does', async () => {
    const widths = await page.evaluate(() => ({
      window: innerWidth,
      page: document.documentElement.scrollWidth,
      overflow: (() => {
        const block = document.querySelector('[data-test-id=preview] pre');
        return block.scrollWidth - block.clientWidth;
      })(),
    }));
    if (widths.page > widths.window) throw new Error(`the page is ${widths.page}px wide`);
    if (widths.overflow <= 0) throw new Error('the code line does not scroll');
  });

  await markdown.click();
  await focused();
  await text.waitFor();
  await check('Markdown shows the note exactly as typed', async () => {
    expectEqual(await text.inputValue(), typed);
  });
};
