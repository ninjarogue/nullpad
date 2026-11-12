const note = [
  '# Trip to Lisbon',
  '',
  'Flights are **booked** and the hotel is *not*.',
  '',
  '- [ ] Passport',
  '- Walking shoes',
  '',
  '> Lisbon is hilly.',
].join('\n');

export default async ({ page, type, look, shot, check }) => {
  const text = page.getByLabel('Note text');
  const above = page.locator('[data-test-id=live-above]');
  const below = page.locator('[data-test-id=live-below]');
  const field = async (want) => {
    const have = await text.inputValue();
    if (have !== want) throw new Error(`the field holds ${JSON.stringify(have)}`);
  };

  // The page view is the default, and Markdown is off.
  await text.click();
  await type(note);
  await look();
  await shot('typed');
  await check('the field holds only the block being typed', () => field('> Lisbon is hilly.'));
  await check('the blocks above are drawn without their marks', async () => {
    const drawn = await above.innerText();
    if (drawn.includes('**') || drawn.includes('#')) throw new Error(`drawn: ${drawn}`);
    if ((await above.locator('strong').innerText()) !== 'booked') throw new Error('no bold word');
  });

  for (const want of ['', '- Walking shoes', '- [ ] Passport', '', 'Flights are **booked** and the hotel is *not*.']) {
    await page.keyboard.press('ArrowUp');
    await look(350);
    await check(`ArrowUp reaches ${JSON.stringify(want)}`, () => field(want));
  }
  await shot('paragraph');
  await check('the list is drawn below the field', async () => {
    if ((await below.getByRole('listitem').count()) !== 2) throw new Error('two items expected');
  });

  await above.locator('h1').click();
  await look();
  await check('a click on the heading opens it', () => field('# Trip to Lisbon'));
  await shot('heading');

  await below.locator('em').click();
  await look();
  await check('a click on a word opens its paragraph at that word', async () => {
    await field('Flights are **booked** and the hotel is *not*.');
    const caret = await text.evaluate((control) => control.selectionStart);
    if (caret < 40 || caret > 45) throw new Error(`caret at ${caret}`);
  });

  await page.keyboard.press('Escape');
  await look();
  await shot('idle');
  await check('Escape draws the whole note in the preview', async () => {
    if ((await above.count()) !== 0) throw new Error('live-above is still there');
    if ((await page.locator('[data-test-id=preview]').locator('blockquote').count()) !== 1) throw new Error('the quote is not drawn');
    if (await text.evaluate((control) => control === document.activeElement)) throw new Error('still focused');
  });

  await page.locator('[data-test-id=preview]').getByRole('checkbox', { name: 'Passport' }).click();
  // Long enough for the autosave that follows the tick.
  await look(1500);
  await check('a drawn box ticks without opening its block', async () => {
    if (await text.evaluate((control) => control === document.activeElement)) throw new Error('the field took focus');
  });

  await page.getByText('Saved', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: 'Markdown' }).click();
  await look();
  await shot('source');
  await check('the saved note is the whole note with the tick', () => field(note.replace('[ ]', '[x]')));

  await text.press('Control+a');
  await type('1. Pack\n1. Leave\n1. Arrive\n1. Rest');
  await page.getByRole('button', { name: 'Markdown' }).click();
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Note text');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await look();
  await shot('split-list');
  await check('the items below the field are numbered on from the items above it', async () => {
    await field('1. Leave');
    const start = await below.locator('ol').getAttribute('start');
    if (start !== '3') throw new Error(`the list below starts at ${start ?? 1}`);
  });
};
