import { expect } from 'e2e';
import type { App, Locator } from 'e2e';
import { test } from './nullpad.ts';
import type { Note } from './nullpad.ts';

const stored = (body: string): Note => ({ key: 'tasks', title: null, body });

type Fixtures = {
  app: App;
  disk: { seed(notes: Note[]): Promise<void> };
  page: { text: Locator; showPreview: Locator };
};

async function showTasks({ app, disk, page }: Fixtures, body: string) {
  await disk.seed([stored(body)]);
  await app.open('/');
  await expect(page.text).toHaveValue(body);
  await page.showPreview.tap();
}

const shopping = '# Shopping\n\n- [ ] buy milk  \n- [ ] call mom\n\nend\n\n';

test('tasks show as boxes named by their text, ticked or not', async ({ app, disk, page }) => {
  await showTasks({ app, disk, page }, '- [ ] buy milk\n- [x] call mom\n- [X] pay rent\n- plain');

  await expect(page.boxes).toHaveCount(3);
  await expect(page.box('buy milk')).not.toBeChecked();
  await expect(page.box('call mom')).toBeChecked();
  await expect(page.box('pay rent')).toBeChecked();
  await expect(page.items).toHaveText(['buy milk', 'call mom', 'pay rent', 'plain']);
});

test('a box is named by the words of its own item, not by a nested item', async ({
  app,
  disk,
  page,
}) => {
  await showTasks({ app, disk, page }, '- [ ] buy **fresh** milk\n  - [x] from the farm');

  await expect(page.boxes).toHaveCount(2);
  await expect(page.box('buy fresh milk')).not.toBeChecked();
  await expect(page.box('from the farm')).toBeChecked();
});

test('clicking a box ticks it and changes that line of the note and nothing else', async ({
  app,
  disk,
  page,
}) => {
  await showTasks({ app, disk, page }, shopping);

  await page.box('call mom').tap();
  await expect(page.box('call mom')).toBeChecked();
  await expect(page.box('buy milk')).not.toBeChecked();

  await page.showSource.tap();
  await expect(page.text).toHaveValue(shopping.replace('- [ ] call mom', '- [x] call mom'));
});

test('pressing Space on a focused box ticks it and changes that line of the note', async ({
  app,
  disk,
  page,
}) => {
  await showTasks({ app, disk, page }, shopping);

  await page.box('buy milk').focus();
  await expect(page.box('buy milk')).toBeFocused();
  await page.box('buy milk').press('Space');
  await expect(page.box('buy milk')).toBeChecked();
  await expect(page.box('call mom')).not.toBeChecked();

  await page.showSource.tap();
  await expect(page.text).toHaveValue(shopping.replace('- [ ] buy milk', '- [x] buy milk'));
});

test('clicking a ticked box unticks it and changes that line of the note', async ({
  app,
  disk,
  page,
}) => {
  const body = '- [x] done\n- [x] also done\n';
  await showTasks({ app, disk, page }, body);

  await page.box('done').tap();
  await expect(page.box('done')).not.toBeChecked();
  await expect(page.box('also done')).toBeChecked();

  await page.showSource.tap();
  await expect(page.text).toHaveValue('- [ ] done\n- [x] also done\n');
});

test('Space unticks a ticked box', async ({ app, disk, page }) => {
  await showTasks({ app, disk, page }, '- [x] done');

  await page.box('done').focus();
  await page.box('done').press('Space');
  await expect(page.box('done')).not.toBeChecked();

  await page.showSource.tap();
  await expect(page.text).toHaveValue('- [ ] done');
});

test('ticking and unticking a box gives back the note as it was', async ({ app, disk, page }) => {
  await showTasks({ app, disk, page }, shopping);

  await page.box('buy milk').tap();
  await expect(page.box('buy milk')).toBeChecked();
  await page.box('buy milk').tap();
  await expect(page.box('buy milk')).not.toBeChecked();

  await page.showSource.tap();
  await expect(page.text).toHaveValue(shopping);
});

test('a ticked box is saved and is still ticked after a reload', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await disk.seed([stored(shopping)]);
  await app.open('/');
  await expect(page.text).toHaveValue(shopping);
  await page.showPreview.tap();
  const ticked = shopping.replace('- [ ] call mom', '- [x] call mom');

  await page.box('call mom').tap();
  await expect(page.saveState).toHaveText('Unsaved');
  await expect(page.saveState).toHaveText('Saved');
  expect(await disk.notes()).toEqual([stored(ticked)]);

  await browser.reload();
  await expect(page.text).toHaveValue(ticked);
  await page.showPreview.tap();
  await expect(page.box('call mom')).toBeChecked();
  await expect(page.box('buy milk')).not.toBeChecked();
});

test('an unticked box is saved and is still unticked after a reload', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const body = '- [x] done\n- [ ] not yet';
  await disk.seed([stored(body)]);
  await app.open('/');
  await expect(page.text).toHaveValue(body);
  await page.showPreview.tap();

  await page.box('done').tap();
  await expect(page.saveState).toHaveText('Unsaved');
  await expect(page.saveState).toHaveText('Saved');
  expect(await disk.notes()).toEqual([stored('- [ ] done\n- [ ] not yet')]);

  await browser.reload();
  await page.showPreview.tap();
  await expect(page.box('done')).not.toBeChecked();
});

test('a task in a nested list ticks its own line', async ({ app, disk, page }) => {
  const body = '- [ ] one\n  - [ ] one a\n  - [ ] one b\n- [ ] two';
  await showTasks({ app, disk, page }, body);

  await page.box('one b').tap();
  await expect(page.box('one b')).toBeChecked();
  await expect(page.box('one a')).not.toBeChecked();
  await expect(page.box('one')).not.toBeChecked();

  await page.showSource.tap();
  await expect(page.text).toHaveValue('- [ ] one\n  - [ ] one a\n  - [x] one b\n- [ ] two');
});

test('a task in a quote ticks its own line', async ({ app, disk, page }) => {
  const body = '- [ ] outside\n\n> - [ ] quoted a\n> - [ ] quoted b';
  await showTasks({ app, disk, page }, body);

  await page.box('quoted b').tap();
  await expect(page.box('quoted b')).toBeChecked();
  await expect(page.box('quoted a')).not.toBeChecked();
  await expect(page.box('outside')).not.toBeChecked();

  await page.showSource.tap();
  await expect(page.text).toHaveValue('- [ ] outside\n\n> - [ ] quoted a\n> - [x] quoted b');
});

test('a task in an ordered list ticks its own line', async ({ app, disk, page }) => {
  await showTasks({ app, disk, page }, '1. [ ] first\n2. [ ] second');

  await page.box('second').tap();
  await expect(page.box('second')).toBeChecked();

  await page.showSource.tap();
  await expect(page.text).toHaveValue('1. [ ] first\n2. [x] second');
});

test('of two tasks with the same words, the one clicked is ticked', async ({
  app,
  disk,
  page,
}) => {
  await showTasks({ app, disk, page }, '- [ ] milk\n- [ ] milk\n- [ ] milk');

  await page.box('milk').nth(1).tap();
  await expect(page.box('milk').nth(0)).not.toBeChecked();
  await expect(page.box('milk').nth(1)).toBeChecked();
  await expect(page.box('milk').nth(2)).not.toBeChecked();

  await page.showSource.tap();
  await expect(page.text).toHaveValue('- [ ] milk\n- [x] milk\n- [ ] milk');
});

test('a task below blocks of many lines ticks its own line', async ({ app, disk, page }) => {
  const body =
    'Title\n=====\n\n```\n- [ ] in code\n```\n\n> quoted\nlazy\n\nplain\ntext\n\n- [ ] first\n- [ ] second';
  await showTasks({ app, disk, page }, body);

  await expect(page.boxes).toHaveCount(2);
  await page.box('second').tap();
  await expect(page.box('second')).toBeChecked();
  await expect(page.box('first')).not.toBeChecked();

  await page.showSource.tap();
  await expect(page.text).toHaveValue(body.replace('- [ ] second', '- [x] second'));
});

test('a [ ] inside a fenced code block is not a box', async ({ app, disk, page }) => {
  await showTasks({ app, disk, page }, '```\n- [ ] not a task\n- [x] not either\n```');

  await expect(page.boxes).toHaveCount(0);
  await expect.poll(() => page.raw('pre > code')).toBe('- [ ] not a task\n- [x] not either\n');
});

test('a [ ] inside an indented code block is not a box', async ({ app, disk, page }) => {
  await showTasks({ app, disk, page }, '    - [ ] not a task');

  await expect(page.boxes).toHaveCount(0);
  await expect.poll(() => page.raw('pre > code')).toBe('- [ ] not a task\n');
});

test('a [ ] inside a code block in a list is not a box', async ({ app, disk, page }) => {
  await showTasks({ app, disk, page }, '- [ ] real\n\n  ```\n  - [ ] not a task\n  ```');

  await expect(page.boxes).toHaveCount(1);
  await expect(page.box('real')).toBeVisible();
});

test('text that only looks like a task stays text', async ({ app, disk, page }) => {
  const body = '[ ] outside a list\n\n- [@] foo\n- [ ]x\n- foo [ ] bar\n- [] empty';
  await showTasks({ app, disk, page }, body);

  await expect(page.boxes).toHaveCount(0);
  await expect(page.paragraphs).toHaveText(['[ ] outside a list']);
  await expect(page.items).toHaveText(['[@] foo', '[ ]x', 'foo [ ] bar', '[] empty']);
});

test('the list titles a note by the words of a task, not its marker', async ({ disk, app, page }) => {
  await disk.seed([
    { key: 'quote', title: null, body: '> quoted' },
    { key: 'task', title: null, body: '- [ ] buy milk\n- [x] call mom' },
    { key: 'done', title: null, body: '- [x] already done' },
  ]);
  await app.open('/');

  await expect(page.rows).toHaveText(['already done', 'buy milk', 'quoted']);
});
