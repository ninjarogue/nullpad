import { expect } from 'e2e';
import type { App, Locator } from 'e2e';
import { test } from './nullpad.ts';
import type { Note } from './nullpad.ts';

const paragraph = 'Flights are **booked** and the hotel is *not*.';
const body = `# Trip\n\n${paragraph}\n\n- [ ] Passport\n- Shoes\n\nlast`;
const stored = (body: string): Note => ({ key: 'live', title: null, body });

type Fixtures = {
  app: App;
  disk: { seed(notes: Note[]): Promise<void> };
  page: { text: Locator; markdown: Locator };
};

async function openLive({ app, disk, page }: Fixtures, body: string) {
  await disk.seed([stored(body)]);
  await app.open('/');
  await expect(page.text).toHaveValue(body);
  await page.markdown.tap();
  await expect(page.text).toBeFocused();
}

test('the page draws the note and keeps only the cursor block in the text field', async ({
  app,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);

  await expect(page.text).toHaveValue('# Trip');
  await expect(page.drawn('p')).toHaveText(['Flights are booked and the hotel is not.', 'last']);
  await expect(page.drawn('strong')).toHaveText('booked');
  await expect(page.drawn('li')).toHaveText(['Passport', 'Shoes']);
  await expect(page.above).toHaveText('');
});

test('a click on drawn text opens that block with the caret at the word clicked', async ({
  app,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);

  await page.drawn('em').tap();
  await expect(page.text).toHaveValue(paragraph);
  await expect(page.text).toBeFocused();
  expect(await page.caret()).toMatch(/hotel is \*n?\|o?t\*\.$/);
  await expect(page.above.getByRole('heading')).toHaveText('Trip');
  await expect(page.below.getByRole('listitem')).toHaveText(['Passport', 'Shoes']);
});

test('typing in the field changes only its rows of the saved note', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);

  await page.drawn('em').tap();
  await browser.keyboard.press('End');
  await browser.keyboard.type(' Yet.');
  await expect(page.saveState).toHaveText('Unsaved');
  await expect(page.saveState).toHaveText('Saved');
  expect(await disk.notes()).toEqual([stored(body.replace(paragraph, `${paragraph} Yet.`))]);
});

test('arrow keys cross from block to block', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, body);

  const down = ['', paragraph, '', '- [ ] Passport', '- Shoes', '', 'last'];
  for (const rows of down) {
    await browser.keyboard.press('ArrowDown');
    await expect(page.text).toHaveValue(rows);
  }
  await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue('last');

  for (const rows of down.slice(0, -1).reverse()) {
    await browser.keyboard.press('ArrowUp');
    await expect(page.text).toHaveValue(rows);
  }
  await browser.keyboard.press('ArrowUp');
  await expect(page.text).toHaveValue('# Trip');
  await expect(page.text).toBeFocused();
});

test('arrow keys pressed faster than the page redraws leave the note as it was', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);

  for (let presses = 0; presses < 12; presses++) await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue('last');
  for (let presses = 0; presses < 12; presses++) await browser.keyboard.press('ArrowUp');
  await expect(page.text).toHaveValue('# Trip');

  await page.markdown.tap();
  await expect(page.text).toHaveValue(body);
});

test('an arrow moves inside a wrapped paragraph before it leaves it', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const long = 'word '.repeat(80).trim();
  await openLive({ app, disk, page }, `# Trip\n\n${long}\n\nlast`);

  await browser.keyboard.press('ArrowDown');
  await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue(long);
  expect(await page.caret()).toBe(`|${long}`);

  await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue(long);
  expect(await page.caret()).not.toBe(`|${long}`);

  await browser.keyboard.press('ArrowUp');
  expect(await page.caret()).toBe(`|${long}`);
  await browser.keyboard.press('ArrowUp');
  await expect(page.text).toHaveValue('');
});

test('a new paragraph takes the field and the one before it is drawn', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '# Trip');

  await browser.keyboard.press('End');
  await browser.keyboard.type('\n\nPack **light**');
  await expect(page.text).toHaveValue('Pack **light**');
  expect(await page.caret()).toBe('Pack **light**|');
  await expect(page.above.getByRole('heading')).toHaveText('Trip');

  await browser.keyboard.type('\n\nGo');
  await expect(page.text).toHaveValue('Go');
  await expect(page.drawn('strong')).toHaveText('light');
  await expect(page.saveState).toHaveText('Unsaved');
  await expect(page.saveState).toHaveText('Saved');
  expect(await disk.notes()).toEqual([stored('# Trip\n\nPack **light**\n\nGo')]);
});

test('Backspace at the start of the field joins it to the row above', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'one\n\ntwo');

  await page.drawn('p').tap();
  await expect(page.text).toHaveValue('two');
  await browser.keyboard.press('Home');
  await browser.keyboard.press('Backspace');
  await expect(page.text).toHaveValue('one\ntwo');
  expect(await page.caret()).toBe('one\n|two');
  await expect(page.saveState).toHaveText('Unsaved');
  await expect(page.saveState).toHaveText('Saved');
  expect(await disk.notes()).toEqual([stored('one\ntwo')]);
});

test('Delete at the end of the field joins the row below to it', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'one\ntwo\n\nthree');

  await browser.keyboard.press('ControlOrMeta+End');
  await browser.keyboard.press('Delete');
  await browser.keyboard.press('Delete');
  await expect(page.text).toHaveValue('one\ntwothree');
  expect(await page.caret()).toBe('one\ntwo|three');
});

test('Escape draws the whole note, and a box ticks without opening its block', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);

  await browser.keyboard.press('Escape');
  await expect(page.text).not.toBeFocused();
  await expect(page.preview.getByRole('heading')).toHaveText('Trip');
  await expect(page.preview.getByRole('listitem')).toHaveText(['Passport', 'Shoes']);

  await page.preview.getByRole('checkbox', 'Passport').tap();
  await expect(page.saveState).toHaveText('Unsaved');
  await expect(page.preview.getByRole('checkbox', 'Passport')).toBeChecked();
  await expect(page.saveState).toHaveText('Saved');
  await expect(page.text).not.toBeFocused();
  expect(await disk.notes()).toEqual([stored(body.replace('[ ]', '[x]'))]);
});

test('a box below the field ticks its own row of the note', async ({ app, disk, page }) => {
  await openLive({ app, disk, page }, '# Trip\n\n- [ ] one\n- [ ] two');

  await page.below.getByRole('checkbox', 'two').tap();
  await expect(page.saveState).toHaveText('Unsaved');
  await expect(page.saveState).toHaveText('Saved');
  expect(await disk.notes()).toEqual([stored('# Trip\n\n- [ ] one\n- [x] two')]);
});

test('Markdown shows the whole note as typed, and the choice is remembered', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);

  await browser.reload();
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'false');
  await expect(page.text).toHaveValue('# Trip');

  await page.markdown.tap();
  await expect(page.text).toHaveValue(body);
  await expect(page.above).toHaveCount(0);
});

test('Enter on an empty line makes another, and the arrows cross each one', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'hello');

  await browser.keyboard.press('End');
  const top = async () => (await page.fieldBox()).top;
  let last = await top();
  for (let line = 1; line <= 3; line++) {
    await browser.keyboard.press('Enter');
    await expect(page.text).toHaveValue('');
    await expect(page.drawnIn('live-above', '.blank')).toHaveCount(line - 1);
    expect(await top()).toBeGreaterThan(last + 10);
    last = await top();
  }
  await browser.keyboard.type('world');
  const below = await top();

  await browser.keyboard.press('ArrowUp');
  await expect(page.text).toHaveValue('');
  await expect(page.drawnIn('live-below', '.blank')).toHaveCount(0);
  expect(await top()).toBeLessThan(below - 10);
  await browser.keyboard.press('ArrowUp');
  await expect(page.drawnIn('live-below', '.blank')).toHaveCount(1);
  await expect(page.below).toHaveText('world');

  await page.markdown.tap();
  await expect(page.text).toHaveValue('hello\n\n\nworld');
});

test('the words below do not move when the cursor reaches a heading or a blank line', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'intro\n\n\n## Packing\ntext\n\n- one\n\nEND');
  const end = () => page.topOf('.part p:last-child');
  const still = await end();

  for (let row = 0; row < 7; row++) {
    await browser.keyboard.press('ArrowDown');
    expect(Math.abs((await end()) - still)).toBeLessThan(1);
  }
  await expect(page.text).toHaveValue('');
});

test('coming back from the title to the note does not scroll the page', async ({
  app,
  disk,
  page,
}) => {
  const long = Array.from({ length: 60 }, (_, line) => `paragraph ${line}`).join('\n\n');
  await openLive({ app, disk, page }, long);
  expect(await page.scrolled()).toBe(0);

  await page.title.tap();
  await expect(page.title).toBeFocused();
  await page.drawn('p').first().tap();
  await expect(page.text).toBeFocused();
  await expect(page.text).toHaveValue('paragraph 0');
  expect(await page.scrolled()).toBe(0);
});

