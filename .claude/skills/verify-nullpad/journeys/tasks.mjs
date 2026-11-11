const typed = [
  '# Shopping',
  '',
  '- [ ] buy milk',
  '- [ ] call mom',
  '- [x] pay rent',
  '',
  '> - [ ] quoted task',
].join('\n');
const ticked = typed
  .replace('- [ ] buy milk', '- [x] buy milk')
  .replace('- [ ] call mom', '- [x] call mom')
  .replace('> - [ ] quoted task', '> - [x] quoted task');
const unticked = ticked.replace('- [x] pay rent', '- [ ] pay rent');

export default async ({ page, type, look, shot, check }) => {
  const text = page.getByLabel('Note text');
  const preview = page.locator('[data-test-id=preview]');
  const box = (name) => preview.getByRole('checkbox', { name });
  const isChecked = async (name) => box(name).isChecked();
  const expectBoxes = async (checked) => {
    for (const [name, want] of Object.entries(checked)) {
      if ((await isChecked(name)) !== want) throw new Error(`"${name}" should be ${want ? 'ticked' : 'unticked'}`);
    }
  };
  const expectSource = async (want) => {
    const have = await text.inputValue();
    if (have !== want) throw new Error(`source is ${JSON.stringify(have)}`);
  };
  const tabTo = async (name) => {
    for (let presses = 0; presses < 20; presses++) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);
      if (label === name) return;
    }
    throw new Error(`Tab never reached the box "${name}"`);
  };

  await text.click();
  await type(typed);
  await look();
  await shot('typed');
  await check('the typed note is in the text field exactly', () => expectSource(typed));

  await page.keyboard.press('Control+e');
  await preview.waitFor();
  await look();
  await shot('page');
  await check('the page shows four boxes named by their text', async () => {
    const count = await preview.getByRole('checkbox').count();
    if (count !== 4) throw new Error(`${count} boxes`);
    await expectBoxes({ 'buy milk': false, 'call mom': false, 'pay rent': true, 'quoted task': false });
  });

  await box('buy milk').click();
  await look(600);
  await shot('ticked-with-mouse');
  await check('a click ticks the box and no other', () =>
    expectBoxes({ 'buy milk': true, 'call mom': false, 'pay rent': true, 'quoted task': false }),
  );

  await tabTo('call mom');
  await shot('box-focused');
  await page.keyboard.press('Space');
  await look(600);
  await shot('ticked-with-keyboard');
  await check('Space on the focused box ticks it', () =>
    expectBoxes({ 'buy milk': true, 'call mom': true, 'pay rent': true, 'quoted task': false }),
  );

  await tabTo('quoted task');
  await page.keyboard.press('Space');
  await check('Space ticks a task inside a quote', () =>
    expectBoxes({ 'buy milk': true, 'call mom': true, 'pay rent': true, 'quoted task': true }),
  );

  await page.getByRole('button', { name: 'Edit' }).click();
  await text.waitFor();
  await look();
  await shot('source-after-ticks');
  await check('the source changed on those three lines and nowhere else', () =>
    expectSource(ticked),
  );

  await page.getByRole('status').filter({ hasText: 'Saved' }).waitFor();
  await page.reload();
  await text.waitFor();
  await look();
  await check('after a reload the source holds the ticks', () =>
    expectSource(ticked),
  );
  await page.getByRole('button', { name: 'Preview' }).click();
  await preview.waitFor();
  await look();
  await shot('page-after-reload');
  await check('after a reload the boxes agree with the source', () =>
    expectBoxes({ 'buy milk': true, 'call mom': true, 'pay rent': true, 'quoted task': true }),
  );

  await box('pay rent').click();
  await look(600);
  await check('a click on a ticked box unticks it', () =>
    expectBoxes({ 'buy milk': true, 'call mom': true, 'pay rent': false, 'quoted task': true }),
  );
  await page.getByRole('button', { name: 'Edit' }).click();
  await check('the source shows the untick on that line only', () =>
    expectSource(unticked),
  );

  await page.getByRole('button', { name: 'Preview' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await look();
  await shot('phone-dark');
  await check('on a phone-wide window the boxes are at least 24px square', async () => {
    const size = await box('buy milk').boundingBox();
    if (size.width < 24 || size.height < 24) throw new Error(`${size.width} x ${size.height}`);
  });
};
