import { expect } from 'e2e';
import type { App, Locator } from 'e2e';
import { pause, test } from './nullpad.ts';
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

test('a click on a fence with no code opens that fence and no other row', async ({ app, disk, page }) => {
  await openLive({ app, disk, page }, 'top\n\n> ```\n\n- ```\n- last');

  await page.drawn('blockquote pre').tap();
  await expect(page.text).toHaveValue('> ```');
  await expect(page.text).toBeFocused();

  await page.drawn('li pre').tap();
  await expect(page.text).toHaveValue('- ```');
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

test('an arrow pressed before the page redraws still moves inside the paragraph it reached', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const long = 'word '.repeat(80).trim();
  await openLive({ app, disk, page }, `# Trip\n\n${long}\n\nlast`);
  await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue('');

  await page.pressBeforeRedraw('ArrowDown', 'ArrowDown');
  await expect(page.text).toHaveValue(long);
  expect(await page.caret()).not.toBe(`|${long}`);

  await browser.keyboard.press('ArrowUp');
  expect(await page.caret()).toBe(`|${long}`);
});

test('an arrow pressed before the page redraws crosses back to the block it left', async ({
  app,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);

  await page.pressBeforeRedraw('ArrowDown', 'ArrowUp');
  await expect(page.text).toHaveValue('# Trip');
  await page.pressBeforeRedraw('ArrowDown', 'ArrowDown', 'ArrowUp');
  await expect(page.text).toHaveValue('');
});

test('Escape pressed before the page redraws after Ctrl+E draws the whole note', async ({
  app,
  disk,
  page,
}) => {
  await disk.seed([stored(body)]);
  await app.open('/');
  await expect(page.text).toHaveValue(body);
  await expect(page.text).toBeFocused();

  await page.pressBeforeRedraw('ControlOrMeta+e', 'Escape');
  await expect(page.preview.getByRole('heading')).toHaveText('Trip');
  await expect(page.text).not.toBeFocused();
});

test('in the markdown, an arrow past the first or last line keeps the column it came from', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const rows = 'abcdef\nabcdef\nabcdef';
  await disk.seed([stored(rows)]);
  await app.open('/');
  await expect(page.text).toHaveValue(rows);

  await browser.keyboard.press('ArrowDown');
  for (let presses = 0; presses < 3; presses++) await browser.keyboard.press('ArrowRight');
  await browser.keyboard.press('ArrowUp');
  await browser.keyboard.press('ArrowUp');
  expect(await page.caret()).toBe(`|${rows}`);
  await browser.keyboard.press('ArrowDown');
  expect(await page.caret()).toBe('abcdef\nabc|def\nabcdef');

  await browser.keyboard.press('ArrowDown');
  await browser.keyboard.press('ArrowDown');
  expect(await page.caret()).toBe(`${rows}|`);
  await browser.keyboard.press('ArrowUp');
  expect(await page.caret()).toBe('abcdef\nabc|def\nabcdef');
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

test('the items below the field are numbered on from the items above it', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '1. pack\n1. leave\n1. arrive\n1. rest');

  await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue('1. leave');
  await expect(page.drawnIn('live-above', 'ol')).not.toHaveAttribute('start');
  await expect(page.drawnIn('live-below', 'ol')).toHaveAttribute('start', '3');
  await expect(page.below.getByRole('listitem')).toHaveText(['arrive', 'rest']);
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
    const before = last;
    await expect.poll(top).toBeGreaterThan(before + 10);
    last = await top();
  }
  await browser.keyboard.type('world');
  const below = await top();

  await browser.keyboard.press('ArrowUp');
  await expect(page.text).toHaveValue('');
  await expect(page.drawnIn('live-below', '.blank')).toHaveCount(0);
  await expect.poll(top).toBeLessThan(below - 10);
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


const longItem = `long ${'wrap '.repeat(60)}tail`;
const marked = [
  {
    title: 'when the cursor reaches it',
    items: ['- bullet', `- ${longItem}`, '1. first', '12. twelfth', '- [ ] task', '- [x] done'],
    words: ['bullet', 'long', 'tail', 'first', 'twelfth', 'task', 'done'],
    between: '\n',
  },
  {
    title: 'however its marker is typed',
    items: ['* star', '+ plus', '3) paren', '-  roomy', '  - indented', '   1. deeper', '- [ ]  boxed'],
    words: ['star', 'plus', 'paren', 'roomy', 'indented', 'deeper', 'boxed'],
    between: '\n\n',
  },
  {
    title: 'when a box has no space after it, so it is no box',
    items: ['- [ ]zulu', '1. [x]yankee'],
    words: ['zulu', 'yankee'],
    between: '\n\n',
  },
];

for (const { title, items, words, between } of marked) {
  test(`the words of a list item stay where they are ${title}`, async ({ app, browser, disk, page }) => {
    await openLive({ app, disk, page }, `top\n\n${items.join(between)}`);
    const drawn = new Map<string, { left: number; top: number } | null>();
    for (const word of words) drawn.set(word, await page.placeOf(word));

    for (const item of items) {
      while ((await page.text.inputValue()) !== item) {
        await browser.keyboard.press('ArrowDown');
        await pause(60);
      }
      for (const word of words.filter((word) => item.includes(word))) {
        const was = drawn.get(word)!;
        const now = (await page.placeOf(word))!;
        expect({ word, left: Math.round(now.left - was.left), top: Math.round(now.top - was.top) }).toEqual({ word, left: 0, top: 0 });
      }
    }
  });
}

test('the words of a list with blank lines in it do not move as the cursor walks through', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const rows = ['top', '', '- alpha', '', '- bravo', '', '', '- charlie', '', '  delta', '', '1. echo', '', '2. foxtrot', '', 'golf'];
  const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf'];
  await openLive({ app, disk, page }, rows.join('\n'));
  const places = async () => {
    const found: Record<string, number> = {};
    for (const word of words) found[word] = Math.round((await page.placeOf(word))!.top);
    return found;
  };
  const still = await places();

  for (const row of rows.slice(1)) {
    await browser.keyboard.press('ArrowDown');
    await pause(60);
    expect({ row, ...(await places()) }).toEqual({ row, ...still });
  }
});

test('an arrow at the first line of the note stays put and keeps its column', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'abcdef\nabcdef\n\nlast');
  await expect(page.text).toHaveValue('abcdef\nabcdef');

  await browser.keyboard.press('ArrowDown');
  for (let presses = 0; presses < 3; presses++) await browser.keyboard.press('ArrowRight');
  await browser.keyboard.press('ArrowUp');
  await browser.keyboard.press('ArrowUp');
  await expect.poll(() => page.caret()).toBe('abc|def\nabcdef');
  await browser.keyboard.press('ArrowDown');
  await expect.poll(() => page.caret()).toBe('abcdef\nabc|def');
});

test('an arrow at the last line of the note stays put and keeps its column', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'first\n\nabcdef\nabcdef');
  await browser.keyboard.press('ArrowDown');
  await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue('abcdef\nabcdef');

  for (let presses = 0; presses < 3; presses++) await browser.keyboard.press('ArrowRight');
  await browser.keyboard.press('ArrowDown');
  await browser.keyboard.press('ArrowDown');
  await expect.poll(() => page.caret()).toBe('abcdef\nabc|def');
  await browser.keyboard.press('ArrowUp');
  await expect.poll(() => page.caret()).toBe('abc|def\nabcdef');
});

test('a key pressed right after Escape, before the page redraws, is not typed into the note', async ({
  app,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '# Trip\n\nwords');

  await page.pressBeforeRedraw('Escape', 'x', 'y');
  await expect(page.drawn('h1')).toHaveText('Trip');
  await page.markdown.tap();
  await expect(page.text).toHaveValue('# Trip\n\nwords');
});

test('composing with an IME on a blank row keeps the blocks around it drawn', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'first paragraph\n\nsecond paragraph');
  await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue('');

  await browser.evaluate(() => {
    const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    field.value = 'wo';
    field.setSelectionRange(2, 2);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    return null;
  });
  await page.nextFrame();
  await expect(page.above).toHaveText('first paragraph');
  await expect(page.below).toHaveText('second paragraph');

  await browser.evaluate(() => {
    const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    return null;
  });
  await expect(page.text).toHaveValue('first paragraph\nwo\nsecond paragraph');
});

test('a click on a fence with no code puts the caret after the fence, where code is typed', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'Steps\n\n```js');

  await page.drawnIn('live-below', 'pre').tap();
  await expect.poll(() => page.caret()).toBe('```js|');
  await browser.keyboard.press('Enter');
  await browser.keyboard.type('let a = 1;');
  await expect(page.text).toHaveValue('```js\nlet a = 1;');
});

test('a mouse drag from a paragraph into a later block selects the rows between', async ({
  app,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);

  await page.drag(await page.pointAt('hotel'), await page.pointAt('Shoes'));
  await expect.poll(() => page.selection()).toEqual({
    text: `${paragraph}\n\n- [ ] Passport\n- Shoes`,
    selected: 'hotel is *not*.\n\n- [ ] Passport\n',
    backward: false,
  });
});

test('a mouse drag up into an earlier block selects backwards', async ({ app, disk, page }) => {
  await openLive({ app, disk, page }, body);

  await page.drag(await page.pointAt('last'), await page.pointAt('booked'));
  await expect.poll(() => page.selection()).toEqual({
    text: `${paragraph}\n\n- [ ] Passport\n- Shoes\n\nlast`,
    selected: '**booked** and the hotel is *not*.\n\n- [ ] Passport\n- Shoes\n\n',
    backward: true,
  });
});

test('a mouse drag that starts in the text field selects past it', async ({ app, disk, page }) => {
  await openLive({ app, disk, page }, body);
  await page.drawn('em').tap();
  await expect(page.text).toHaveValue(paragraph);

  await page.drag(await page.pointAt('booked'), await page.pointAt('Shoes'));
  await expect.poll(() => page.selection()).toEqual({
    text: `${paragraph}\n\n- [ ] Passport\n- Shoes`,
    selected: 'booked** and the hotel is *not*.\n\n- [ ] Passport\n',
    backward: false,
  });
});

test('Shift and a click select from where the caret is to the place clicked', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  await page.drawn('em').tap();
  await browser.keyboard.press('End');

  const shoes = await page.pointAt('Shoes');
  await browser.keyboard.down('Shift');
  await browser.mouse.move(shoes.x, shoes.y);
  await browser.mouse.down();
  await browser.mouse.up();
  await browser.keyboard.up('Shift');
  await expect.poll(() => page.selection()).toEqual({
    text: `${paragraph}\n\n- [ ] Passport\n- Shoes`,
    selected: '\n\n- [ ] Passport\n',
    backward: false,
  });
});

test('Shift+ArrowDown selects into the blocks below, and a letter replaces the selection', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  await browser.keyboard.press('End');

  for (let presses = 0; presses < 3; presses++) await browser.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => page.selection()).toEqual({
    text: `# Trip\n\n${paragraph}\n`,
    selected: `\n\n${paragraph}\n`,
    backward: false,
  });

  await browser.keyboard.type('X');
  await expect(page.text).toHaveValue('# TripX');
  await page.markdown.tap();
  await expect(page.text).toHaveValue('# TripX\n- [ ] Passport\n- Shoes\n\nlast');
});

test('Shift+ArrowUp selects into the blocks above, and Backspace deletes the selection', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  await page.drawn('p').last().tap();
  await expect(page.text).toHaveValue('last');
  await browser.keyboard.press('Home');

  await browser.keyboard.press('Shift+ArrowUp');
  await browser.keyboard.press('Shift+ArrowUp');
  await expect.poll(() => page.selection()).toEqual({
    text: '- Shoes\n\nlast',
    selected: '- Shoes\n\n',
    backward: true,
  });

  await browser.keyboard.press('Backspace');
  await page.markdown.tap();
  await expect(page.text).toHaveValue(`# Trip\n\n${paragraph}\n\n- [ ] Passport\nlast`);
});

test('Ctrl+A selects the whole note, and copying it copies the markdown', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);

  await browser.keyboard.press('ControlOrMeta+a');
  await expect.poll(() => page.selection()).toEqual({ text: body, selected: body, backward: false });

  await browser.evaluate(() => {
    document.addEventListener('copy', (event) => {
      const field = event.target as HTMLTextAreaElement;
      (globalThis as { copied?: string }).copied = field.value.slice(field.selectionStart, field.selectionEnd);
    });
    return null;
  });
  await browser.keyboard.press('ControlOrMeta+c');
  expect(await browser.evaluate(() => (globalThis as { copied?: string }).copied ?? null)).toBe(body);
});

test('a click after a selection across blocks puts one block back in the field', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  await browser.keyboard.press('ControlOrMeta+a');
  await expect(page.text).toHaveValue(body);
  await expect(page.drawn('li')).toHaveCount(0);

  const shoes = await page.pointAt('Shoes');
  await browser.mouse.move(shoes.x, shoes.y);
  await browser.mouse.down();
  await browser.mouse.up();
  await expect(page.text).toHaveValue('- Shoes');
  await expect(page.drawn('h1')).toHaveText('Trip');
});

test('a double-click in the text field still selects one word', async ({ app, disk, page }) => {
  const long = 'word '.repeat(80).trim();
  await openLive({ app, disk, page }, `# Trip\n\n${long}`);
  await page.drawn('p').tap();
  await expect(page.text).toHaveValue(long);

  await page.text.dblclick();
  await expect.poll(async () => (await page.selection()).selected).toBe('word');
});

test('Shift+ArrowUp from below a wrapped paragraph selects only its last line', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const long =
    'This paragraph is long enough that it wraps onto several lines in the page, so a selection made with the keyboard has to move through it one line at a time, and not jump over all of it at once when Shift and the up arrow are pressed.';
  await openLive({ app, disk, page }, `${long}\n\nlast`);
  await page.drawn('p').last().tap();
  await expect(page.text).toHaveValue('last');
  await expect(page.drawn('p')).toHaveText([long]);
  const lastLine = await browser.evaluate(() => {
    const text = document.querySelector('.page.live .part p')!.firstChild as Text;
    const range = document.createRange();
    const top = (at: number) => {
      range.setStart(text, at);
      range.setEnd(text, at + 1);
      return range.getBoundingClientRect().top;
    };
    let at = text.length - 1;
    while (at > 0 && top(at - 1) === top(text.length - 1)) at--;
    return text.data.slice(at);
  });
  expect(lastLine.length).toBeLessThan(long.length / 2);
  await browser.keyboard.press('Home');

  await browser.keyboard.press('Shift+ArrowUp');
  await browser.keyboard.press('Shift+ArrowUp');
  await expect.poll(() => page.selection()).toEqual({
    text: `${long}\n\nlast`,
    selected: `${lastLine}\n\n`,
    backward: true,
  });
});

test('Shift+ArrowDown on the last row of the note selects to its end', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  await page.drawn('p').last().tap();
  await browser.keyboard.press('Home');

  await browser.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => page.selection()).toEqual({ text: 'last', selected: 'last', backward: false });
});

test('an arrow that ends a selection across blocks puts one block back in the field', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  await page.drawn('p').last().tap();
  await browser.keyboard.press('Home');
  await browser.keyboard.press('Shift+ArrowUp');
  await browser.keyboard.press('Shift+ArrowUp');
  await expect.poll(() => page.selection()).toEqual({
    text: '- Shoes\n\nlast',
    selected: '- Shoes\n\n',
    backward: true,
  });

  await browser.keyboard.press('ArrowRight');
  await expect.poll(() => page.caret()).toBe('|last');
  await expect(page.drawn('li')).toHaveText(['Passport', 'Shoes']);
});

test('a drag into the margin beside a block selects to the start of its line', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  const margin = await browser.evaluate(() => document.querySelector('.page')!.getBoundingClientRect().left + 4);
  const shoes = await page.pointAt('Shoes');

  await page.drag(await page.pointAt('hotel'), { x: margin, y: shoes.y });
  await expect.poll(() => page.selection()).toEqual({
    text: `${paragraph}\n\n- [ ] Passport\n- Shoes`,
    selected: 'hotel is *not*.\n\n- [ ] Passport\n',
    backward: false,
  });
});

test('Ctrl+A with Caps Lock on selects the whole note too', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, body);

  await browser.keyboard.press('ControlOrMeta+A');
  await expect.poll(() => page.selection()).toEqual({ text: body, selected: body, backward: false });
});

test('a drag let go off the page leaves no press held', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, body);
  await page.drawn('em').tap();
  await expect(page.text).toHaveValue(paragraph);

  const booked = await page.pointAt('booked');
  await browser.mouse.move(booked.x, booked.y);
  await browser.mouse.down();
  await browser.mouse.move(100, booked.y);
  await browser.mouse.up();
  await browser.keyboard.press('Shift+End');
  await expect.poll(async () => (await page.selection()).selected).toBe('booked** and the hotel is *not*.');

  const hotel = await page.pointAt('hotel');
  const shoes = await page.pointAt('Shoes');
  await browser.mouse.move(hotel.x, hotel.y);
  await browser.mouse.down();
  await browser.mouse.move(shoes.x, shoes.y);
  await browser.mouse.up();
  await page.nextFrame();
  await expect(page.text).toHaveValue(paragraph);
});

const sizeOf = async (page: { fieldFont(): Promise<{ size: string }> }) => (await page.fieldFont()).size;

test('a dash typed under a line leaves that line drawn as it was', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, '');
  await browser.keyboard.type('~~wow cool this feels great~~\n');
  await expect(page.text).toHaveValue('');
  await expect(page.drawnIn('live-above', 'p del')).toHaveText('wow cool this feels great');
  const body = await page.fieldFont();
  const line = await page.placeOf('wow');

  let typed = '';
  for (const key of '- item') {
    await browser.keyboard.type(key);
    typed += key;
    await expect(page.text).toHaveValue(typed);
    expect({ typed, font: await page.fieldFont() }).toEqual({ typed, font: body });
    await expect(page.drawnIn('live-above', 'p del')).toHaveText('wow cool this feels great');
    expect({ typed, line: await page.placeOf('wow') }).toEqual({ typed, line });
  }
});

test('the caret moving between a heading and its underline keeps the heading as it is', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '');
  await browser.keyboard.type('Hello\n-');
  await expect(page.text).toHaveValue('-');
  await expect(page.drawnIn('live-above', 'p')).toHaveText('Hello');

  await browser.keyboard.press('ArrowUp');
  await expect(page.text).toHaveValue('Hello\n-');
  await expect.poll(() => sizeOf(page)).toBe('24px');
  const heading = await page.fieldFont();
  const words = await page.placeOf('Hello');

  for (const key of ['ArrowDown', 'End', 'ArrowUp', 'Home', 'ArrowDown']) {
    await browser.keyboard.press(key);
    await expect(page.text).toHaveValue('Hello\n-');
    expect({ key, font: await page.fieldFont() }).toEqual({ key, font: heading });
    expect({ key, words: await page.placeOf('Hello') }).toEqual({ key, words });
  }
});

test('a line typed between a line and its underline stays on its own row', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '');
  await browser.keyboard.type('Hello\n--');
  await browser.keyboard.press('ArrowUp');
  await expect(page.text).toHaveValue('Hello\n--');
  await expect.poll(() => sizeOf(page)).toBe('24px');

  await browser.keyboard.press('End');
  await browser.keyboard.press('Enter');
  await expect(page.text).toHaveValue('');
  await expect(page.drawnIn('live-above', 'p')).toHaveText('Hello');
  await expect(page.drawnIn('live-below', 'p')).toHaveText('--');
  const body = await page.fieldFont();
  const above = await page.placeOf('Hello');
  const below = await page.placeOf('--');

  await browser.keyboard.type('X');
  await expect(page.text).toHaveValue('X');
  expect(await page.fieldFont()).toEqual(body);
  await expect(page.drawnIn('live-above', 'p')).toHaveText('Hello');
  await expect(page.drawnIn('live-below', 'p')).toHaveText('--');
  expect(await page.placeOf('Hello')).toEqual(above);
  expect(await page.placeOf('--')).toEqual(below);
});

test('a list item typed under a line leaves that line where it was', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, '');
  await browser.keyboard.type('Hello\n');
  await expect(page.text).toHaveValue('');
  await page.nextFrame();
  const line = await page.placeOf('Hello');

  let typed = '';
  for (const key of '- i') {
    await browser.keyboard.type(key);
    typed += key;
    await expect(page.text).toHaveValue(typed);
    await page.nextFrame();
    await expect(page.drawnIn('live-above', 'p')).toHaveText('Hello');
    expect({ typed, line: await page.placeOf('Hello') }).toEqual({ typed, line });
  }
});

test('a row typed under a table leaves the table drawn and the field set as body text', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '');
  await browser.keyboard.type('| a | b |\n|-|-|\n');
  await expect(page.text).toHaveValue('');
  await expect(page.drawnIn('live-above', 'th')).toHaveText(['a', 'b']);
  const body = await page.fieldFont();
  const top = (await page.fieldBox()).top;

  let typed = '';
  for (const key of '| 1 | 2 |') {
    await browser.keyboard.type(key);
    typed += key;
    await expect(page.text).toHaveValue(typed);
    expect({ typed, font: await page.fieldFont() }).toEqual({ typed, font: body });
    expect({ typed, top: (await page.fieldBox()).top }).toEqual({ typed, top });
    await expect(page.drawnIn('live-above', 'th')).toHaveText(['a', 'b']);
  }

  await browser.keyboard.press('Enter');
  await expect(page.drawnIn('live-above', 'td')).toHaveText(['1', '2']);
});

for (const header of ['| a | b |', '|-|-|']) {
  test(`${header} typed above a delimiter row leaves the rows below drawn as they were`, async ({
    app,
    browser,
    disk,
    page,
  }) => {
    const rest = '|-|-|\n| 1 | 2 |';
    await openLive({ app, disk, page }, `\n${rest}`);
    await expect(page.text).toHaveValue('');
    await page.nextFrame();
    const body = await page.fieldFont();
    const below = await page.placeOf('| 1');

    let typed = '';
    for (const key of header) {
      await browser.keyboard.type(key);
      typed += key;
      await expect(page.text).toHaveValue(typed);
      expect({ typed, font: await page.fieldFont() }).toEqual({ typed, font: body });
      expect({ typed, below: await page.placeOf('| 1') }).toEqual({ typed, below });
      await expect(page.drawn('table')).toHaveCount(0);
    }

    await browser.keyboard.press('ArrowDown');
    await expect(page.text).toHaveValue(`${header}\n${rest}`);
    await expect.poll(() => sizeOf(page)).toBe('14px');
  });
}

test('the caret moving onto a delimiter row keeps the table as it is', async ({ app, browser, disk, page }) => {
  const table = '| a | b |\n|-|-|\n| 1 | 2 |';
  await openLive({ app, disk, page }, `top\n\n${table}\n\nend`);

  await page.drawnIn('live-below', 'td').first().tap();
  await expect(page.text).toHaveValue(table);
  await expect.poll(() => sizeOf(page)).toBe('14px');
  const mono = await page.fieldFont();
  const top = (await page.fieldBox()).top;
  const still = async (step: string) => {
    await expect(page.text).toHaveValue(table);
    expect({ step, font: await page.fieldFont() }).toEqual({ step, font: mono });
    expect({ step, top: (await page.fieldBox()).top }).toEqual({ step, top });
  };

  for (const key of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown']) {
    await browser.keyboard.press(key);
    await still(key);
  }
  const delimiter = await page.pointAt('|-|-|');
  await browser.mouse.move(delimiter.x + 10, delimiter.y);
  await browser.mouse.down();
  await browser.mouse.up();
  expect(await page.caret()).toMatch(/^\| a \| b \|\n\|-?\|?-?\|?-?\|?.*\n\| 1 \| 2 \|$/);
  await still('a click on the delimiter row');

  await page.drawnIn('live-below', 'p').tap();
  await expect(page.text).toHaveValue('end');
  for (const step of ['', table, table]) {
    await browser.keyboard.press('ArrowUp');
    await expect(page.text).toHaveValue(step);
  }
  await still('ArrowUp onto the delimiter row');
});

test('a table or code in the text field is set with no ligatures', async ({ app, disk, page }) => {
  await openLive({ app, disk, page }, '| a | b |\n|-|-|\n\n```\n|-|-| -> !=\n```');
  await expect(page.text).toHaveValue('| a | b |\n|-|-|');
  await expect.poll(() => sizeOf(page)).toBe('14px');
  expect((await page.fieldFont()).ligatures).toBe('none');

  await page.drawnIn('live-below', 'pre').tap();
  await expect(page.text).toHaveValue('```\n|-|-| -> !=\n```');
  expect((await page.fieldFont()).ligatures).toBe('none');
});

test('code typed after an open fence at the end of the note is set as code from its first letter', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'Steps');
  await browser.keyboard.press('End');
  await browser.keyboard.type('\n\n```js\n');
  await expect(page.text).toHaveValue('```js\n');
  await expect.poll(() => sizeOf(page)).toBe('14px');
  const code = await page.fieldFont();
  const top = (await page.fieldBox()).top;
  const steps = await page.placeOf('Steps');

  let typed = '```js\n';
  for (const key of 'let a = 1;\nb') {
    await browser.keyboard.type(key);
    typed += key;
    await expect(page.text).toHaveValue(typed);
    expect({ typed, font: await page.fieldFont() }).toEqual({ typed, font: code });
    expect({ typed, top: (await page.fieldBox()).top }).toEqual({ typed, top });
    expect({ typed, steps: await page.placeOf('Steps') }).toEqual({ typed, steps });
  }
});
