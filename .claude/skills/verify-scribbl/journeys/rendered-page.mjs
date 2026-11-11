export default async ({ page, type, look, shot, check }) => {
  const text = page.getByLabel('Note text');
  const preview = page.locator('[data-test-id=preview]');

  await text.click();
  await type('# Trip\n\nPack **light** and *early*, see [map](https://example.com/).\nUse `cash`.');
  await look();
  await shot('typed');

  await page.keyboard.press('Control+e');
  await preview.waitFor();
  await look();
  await shot('page');
  await check('Ctrl+E shows the page', () => preview.waitFor());
  await check('one h1 reads Trip', async () => {
    if ((await preview.locator('h1').allTextContents()).join() !== 'Trip') throw new Error('no h1 "Trip"');
  });
  await check('bold, italic and code render', async () => {
    for (const tag of ['strong', 'em', 'code']) await preview.locator(tag).waitFor();
  });
  await check('the link opens in a new tab', async () => {
    const link = preview.getByRole('link', { name: 'map' });
    if ((await link.getAttribute('href')) !== 'https://example.com/') throw new Error('wrong href');
    if ((await link.getAttribute('target')) !== '_blank') throw new Error('no target');
  });
  await check('adjacent lines are one paragraph', async () => {
    if ((await preview.locator('p').count()) !== 1) throw new Error('expected one paragraph');
  });

  await page.getByRole('button', { name: 'Edit' }).click();
  await text.waitFor();
  await page.keyboard.press('Control+End');
  await type('\n\n[x](javascript:alert(1)) and <b>hi</b>');
  await page.getByRole('button', { name: 'Preview' }).click();
  await preview.waitFor();
  await look();
  await shot('unsafe');
  await check('the button shows the edited page', async () => {
    if ((await preview.locator('p').count()) !== 2) throw new Error('expected two paragraphs');
  });
  await check('a javascript: link is not a link and shows as typed', async () => {
    if ((await preview.getByRole('link').count()) !== 1) throw new Error('extra link');
    if (!(await preview.innerText()).includes('[x](javascript:alert(1))')) throw new Error('typed text missing');
  });
  await check('typed HTML shows as text', async () => {
    if ((await preview.locator('b').count()) !== 0) throw new Error('a <b> element was made');
    if (!(await preview.innerText()).includes('<b>hi</b>')) throw new Error('tags not shown');
  });
};
