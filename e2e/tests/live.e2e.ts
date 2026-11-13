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
  await expect.poll(() => page.caret()).toBe('|two');
  await expect(page.above).toHaveText('one');
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
  await page.nextFrame();
  await expect(page.text).toHaveValue('wo');
  await expect(page.above).toHaveText('first paragraph');
  await expect(page.below).toHaveText('second paragraph');

  await browser.keyboard.press('ArrowUp');
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
  await expect.poll(async () => (await page.selection()).selected).toBe('booked** and the hotel is *not*.');
  await browser.keyboard.press('Escape');
  await page.showMarkdown();
  await expect(page.text).toHaveValue(
    '# Trip\n\nFlights are **\n\n- [ ] Passport\nbooked** and the hotel is *not*.- Shoes\n\nlast',
  );
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
  const caretRow = await browser.evaluate(() => {
    const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
    return field.value.slice(0, field.selectionStart).split('\n').length - 1;
  });
  expect(caretRow).toBe(1);
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

test('a window switch while a row is typed keeps the page as it is', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, '');
  await browser.keyboard.type('Hello\n-');
  await expect(page.text).toHaveValue('-');

  // Leaving the window blurs the field but keeps it the page's active
  // element, so the browser gives it the focus back on return.
  await browser.evaluate(() => {
    document.querySelector('[data-test-id="editor"]')!.dispatchEvent(new FocusEvent('blur'));
    return null;
  });
  await page.nextFrame();
  await expect(page.drawnIn('live-above', 'p')).toHaveText('Hello');
  await expect(page.text).toHaveValue('-');

  await browser.evaluate(() => {
    document.querySelector('[data-test-id="editor"]')!.dispatchEvent(new FocusEvent('focus'));
    return null;
  });
  await browser.keyboard.type('-');
  await expect(page.text).toHaveValue('--');
  await expect(page.drawnIn('live-above', 'p')).toHaveText('Hello');

  await browser.keyboard.press('Escape');
  await expect(page.preview.getByRole('heading')).toHaveText('Hello');
});

test('a click on the title while a row is typed lays out the page', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, '');
  await browser.keyboard.type('Hello\n-');
  await expect(page.text).toHaveValue('-');
  await page.title.tap();
  await expect(page.preview.getByRole('heading')).toHaveText('Hello');
});

test('Escape after a selection across blocks keeps only the caret, so a key typed later replaces nothing', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const note = 'First para here\n\n- [ ] task one\n\nSecond para\n\nThird para';
  await openLive({ app, disk, page }, note);
  await page.drag(await page.pointAt('First'), await page.pointAt('Third'));
  await expect.poll(async () => (await page.selection()).selected).not.toBe('');

  await browser.keyboard.press('Escape');
  await expect(page.preview).toBeVisible();
  await page.pressMarkdownShortcut();
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'true');
  expect((await page.selection()).selected).toBe('');
  await browser.keyboard.type('Q');
  await expect.poll(async () => (await disk.notes())[0].body).toBe(note.replace('Third', 'QThird'));
});

test('a click whose hand moves a pixel while the page lays out under it selects nothing', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const note = '# Trip\n\nThe flight is **booked** and the hotel is *not*.\n\nlast';
  await openLive({ app, disk, page }, note);
  const hotel = await page.pointAt('hotel');

  await browser.mouse.move(hotel.x, hotel.y);
  await browser.mouse.down();
  await page.nextFrame();
  await browser.mouse.move(hotel.x + 1, hotel.y);
  await page.nextFrame();
  await browser.mouse.up();
  await page.nextFrame();
  expect((await page.selection()).selected).toBe('');
});

test('a press on a text field that runs off the window does not scroll the page', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const paragraphs = Array.from({ length: 20 }, (_, i) => `para ${i + 1}`).join('\n\n');
  const code = Array.from({ length: 12 }, (_, i) => `line ${i + 1};`).join('\n');
  await openLive({ app, disk, page }, `${paragraphs}\n\n\`\`\`js\n${code}\n\`\`\`\n\n${paragraphs}`);
  await browser.evaluate(() => {
    document.querySelector('[data-test-id="live-below"] pre')!.scrollIntoView({ block: 'center' });
    return null;
  });
  await page.drawnIn('live-below', 'pre').tap();
  await expect(page.text).toHaveValue(`\`\`\`js\n${code}\n\`\`\``);

  await browser.evaluate(() => {
    const sheet = document.querySelector('.page')!;
    const field = document.querySelector('[data-test-id="editor"]')!;
    sheet.scrollTop += field.getBoundingClientRect().top - (sheet.getBoundingClientRect().bottom - 90);
    return null;
  });
  await page.nextFrame();
  const scrolled = await page.scrolled();
  const line = await browser.evaluate(() => {
    const box = document.querySelector('[data-test-id="editor"]')!.getBoundingClientRect();
    return { x: box.left + 200, y: box.top + 33 };
  });
  await browser.mouse.move(line.x, line.y);
  await browser.mouse.down();
  await page.nextFrame();
  await browser.mouse.up();
  await page.nextFrame();
  expect(await page.scrolled()).toBe(scrolled);
  expect((await page.caret()).startsWith('```js\n')).toBe(true);
});

test('a click on a line of a scrolled page leaves the page where it was', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const note = Array.from({ length: 50 }, (_, i) => `Line ${i} some text`).join('\n\n');
  await openLive({ app, disk, page }, note);
  await browser.evaluate(() => {
    document.querySelector('.page')!.scrollTop = 600;
    return null;
  });
  await page.nextFrame();
  const scrolled = await page.scrolled();
  expect(scrolled).toBe(600);

  for (const line of ['Line 14 ', 'Line 18 ', 'Line 16 ']) {
    const point = await page.pointAt(line);
    await browser.mouse.move(point.x, point.y);
    await browser.mouse.down();
    await browser.mouse.up();
    await expect(page.text).toHaveValue(`${line}some text`);
    await page.nextFrame();
    expect(await page.scrolled()).toBe(scrolled);
  }
});

test('a click past the end of a wrapped line puts the caret at the end of that line', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const long = 'This paragraph is long enough that it wraps onto several lines in the page, so a selection made with the keyboard has to move through it one line at a time, and not jump over all of it at once when Shift and the up arrow are pressed.';
  await openLive({ app, disk, page }, `${long}\n\nlast`);
  const end = await browser.evaluate(() => {
    const field = document.querySelector('[data-test-id="editor"]')!;
    const box = field.getBoundingClientRect();
    const style = getComputedStyle(field);
    return { x: box.right - 3, y: box.top + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2 };
  });

  await browser.mouse.move(end.x, end.y);
  await browser.mouse.down();
  await browser.mouse.up();
  await browser.keyboard.press('Shift+Home');
  const selected = (await page.selection()).selected;
  expect(long.startsWith(selected)).toBe(true);
  expect(selected.length).toBeGreaterThan(20);
});

test('a drag let go on a link selects to the place let go', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, '# Trip\n\nFirst para words.\n\nSee [the docs page](https://example.com) for more.\n\nlast');
  const first = await page.pointAt('First');
  const docs = await page.pointAt('docs');
  await browser.mouse.move(first.x, first.y);
  await browser.mouse.down();
  await page.nextFrame();
  for (let step = 1; step <= 8; step++) {
    await browser.mouse.move(first.x + ((docs.x - first.x) * step) / 8, first.y + ((docs.y - first.y) * step) / 8);
    await page.nextFrame();
  }
  await browser.mouse.up();
  await expect.poll(async () => (await page.selection()).selected).toMatch(/^First para words\.\n\nSee \[the ?$/);
});

test('a drag that starts on a link or a box selects, and a click on a box still ticks it', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '# Trip\n\nSee [the docs](https://example.com) now.\n\n- [ ] pack bags\n\nlast line');
  await page.drag(await page.pointAt('docs'), await page.pointAt('last'));
  await expect.poll(async () => (await page.selection()).selected).toBe('docs](https://example.com) now.\n\n- [ ] pack bags\n\n');

  await browser.keyboard.press('Escape');
  await expect(page.box('pack bags')).toBeVisible();
  const box = await browser.evaluate(() => {
    const at = document.querySelector('[data-test-id="preview"] input')!.getBoundingClientRect();
    return { x: at.left + at.width / 2, y: at.top + at.height / 2 };
  });
  await page.drag(box, await page.pointAt('line'));
  await expect.poll(async () => (await page.selection()).selected).toMatch(/pack bags\n\nlast $/);
  expect((await page.selection()).text).toContain('- [ ] pack bags');

  await browser.keyboard.press('Escape');
  await page.box('pack bags').tap();
  await expect(page.box('pack bags')).toBeChecked();
});

test('a drag held at the bottom of the window scrolls the page and keeps selecting', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const paragraphs = Array.from({ length: 60 }, (_, i) => `para ${i + 1}`);
  await openLive({ app, disk, page }, paragraphs.join('\n\n'));
  const second = await page.pointAt('para 2');
  const bottom = await browser.evaluate(() => innerHeight);

  await browser.mouse.move(second.x, second.y);
  await browser.mouse.down();
  for (let step = 0; step < 40; step++) {
    await browser.mouse.move(second.x + (step % 2), bottom - 4 - (step % 3));
    await pause(50);
  }
  await browser.mouse.up();
  expect(await page.scrolled()).toBeGreaterThan(300);
  const last = (await page.selection()).selected.split('\n').filter(Boolean).at(-1)!;
  expect(Number(last.split(' ')[1])).toBeGreaterThan(30);
});

test('the wheel turned during a drag keeps the end of the selection under the pointer', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const paragraphs = Array.from({ length: 60 }, (_, i) => `para ${i + 1}`);
  await openLive({ app, disk, page }, paragraphs.join('\n\n'));
  const first = await page.pointAt('para 1');
  const middle = await browser.evaluate(() => innerHeight / 2);

  await browser.mouse.move(first.x, first.y);
  await browser.mouse.down();
  await browser.mouse.move(first.x + 20, middle);
  await page.nextFrame();
  await browser.mouse.wheel(0, 300);
  await expect.poll(() => page.scrolled()).toBeGreaterThan(250);
  await pause(300);
  await page.nextFrame();
  const lines = await browser.evaluate((y: number) => {
    const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
    const box = field.getBoundingClientRect();
    const style = getComputedStyle(field);
    return {
      pointer: Math.floor((y - box.top - parseFloat(style.paddingTop)) / parseFloat(style.lineHeight)),
      head: field.value.slice(0, field.selectionEnd).split('\n').length - 1,
    };
  }, middle);
  await browser.mouse.up();
  expect(lines.head).toBeGreaterThan(8);
  expect(Math.abs(lines.head - lines.pointer)).toBeLessThanOrEqual(1);
});

test('a tap in the text field that moves the caret to another row is seen before the next key', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '| a | b |\n|-|-|\n| 1 | 2 |\n\nafter');
  await expect(page.text).toHaveValue('| a | b |\n|-|-|\n| 1 | 2 |');
  expect((await page.fieldFont()).size).toBe('14px');

  // A touch sends its pointer events first, then the mouse events, and the
  // browser moves the caret between the mouse press and its release, with
  // no select event, which setting the caret from a script would send.
  await browser.evaluate(() => {
    addEventListener('select', (event) => event.stopImmediatePropagation(), { capture: true });
    const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
    const box = field.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, clientX: box.left + 60, clientY: box.top + 30 };
    const touch = { ...at, pointerType: 'touch', isPrimary: true };
    const capabilities = (globalThis as unknown as { InputDeviceCapabilities: new (init: object) => object })
      .InputDeviceCapabilities;
    const fromTouch = { sourceCapabilities: new capabilities({ firesTouchEvents: true }) };
    field.dispatchEvent(new PointerEvent('pointerdown', touch));
    field.dispatchEvent(new PointerEvent('pointerup', touch));
    field.dispatchEvent(new MouseEvent('mousedown', { ...at, ...fromTouch, buttons: 1 }));
    field.setSelectionRange(15, 15);
    field.dispatchEvent(new MouseEvent('mouseup', { ...at, ...fromTouch }));
    field.dispatchEvent(new MouseEvent('click', { ...at, ...fromTouch }));
    return null;
  });
  await page.nextFrame();
  await browser.keyboard.type('x');
  await expect(page.text).toHaveValue('| a | b |\n|-|-|x\n| 1 | 2 |');
  expect((await page.fieldFont()).size).toBe('14px');
  await expect(page.drawnIn('live-below', 'p')).toHaveText('after');
});

test('a row joined by Delete or Backspace leaves the rows around it drawn while the caret stays on it', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'text\n\n-\n\nafter');
  await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue('');
  await browser.keyboard.press('Delete');
  await expect(page.text).toHaveValue('-');
  await expect(page.drawnIn('live-above', 'p')).toHaveText('text');
  expect((await page.fieldFont()).size).toBe('16px');

  await browser.keyboard.press('ArrowDown');
  await expect(page.drawn('h2')).toHaveText('text');
  await page.markdown.tap();
  await expect(page.text).toHaveValue('text\n-\n\nafter');
});

test('Delete at the end of a code line leaves the paragraph below drawn while the caret stays on the line', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '```\ncode\n```\n\nafter words');
  await expect(page.text).toHaveValue('```\ncode\n```');
  await browser.keyboard.press('ArrowDown');
  await browser.keyboard.press('End');
  await expect.poll(() => page.caret()).toBe('```\ncode|\n```');

  await browser.keyboard.press('Delete');
  await expect.poll(() => page.caret()).toContain('code|```');
  await page.nextFrame();
  await expect(page.drawnIn('live-below', 'p')).toHaveText('after words');
});

test('composing with an IME over a selection across blocks keeps the rows after it drawn', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'para one\n\n# Head\ntext under head\n\nend');
  await browser.keyboard.press('End');
  await browser.keyboard.press('Shift+ArrowDown');
  await browser.keyboard.press('Shift+ArrowDown');
  await expect(page.text).toHaveValue('para one\n\n# Head');

  await browser.evaluate(() => {
    const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    const value = field.value;
    field.value = value.slice(0, field.selectionStart) + 'か' + value.slice(field.selectionEnd);
    field.setSelectionRange(9, 9);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    return null;
  });
  await page.nextFrame();
  await expect(page.below).toContainText('text under head');
});

test('Ctrl+A and Ctrl+E work on a keyboard laid out for another alphabet', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, body);
  const press = (key: string, code: string) =>
    browser.evaluate(
      (which: { key: string; code: string }) => {
        const target = document.activeElement ?? document.body;
        const apple = /Mac|iPhone|iPad/.test(navigator.platform);
        target.dispatchEvent(
          new KeyboardEvent('keydown', { ...which, ctrlKey: !apple, metaKey: apple, bubbles: true, cancelable: true }),
        );
        return null;
      },
      { key, code },
    );

  await press('ф', 'KeyA');
  await expect.poll(() => page.selection()).toEqual({ text: body, selected: body, backward: false });

  await press('у', 'KeyE');
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'true');
});

test('Shift+ArrowUp and a letter pressed before the page redraws replace what the arrow selected', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '- alpha one\n- bravo two');
  await browser.keyboard.press('ArrowDown');
  await browser.keyboard.press('Home');
  await expect.poll(() => page.caret()).toBe('|- bravo two');

  await page.pressBeforeRedraw('Shift+ArrowUp', 'X');
  await page.markdown.tap();
  await expect(page.text).toHaveValue('X- bravo two');
});

test('an arrow pressed while a selection is held moves one row on from its head, as a text field does', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'alpha one\n\nbravo two\n\ncharlie three\n\ndelta four');
  await browser.keyboard.press('Shift+ArrowDown');
  await browser.keyboard.press('Shift+ArrowDown');
  await expect.poll(async () => (await page.selection()).selected).toBe('alpha one\n\n');
  await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue('');
  await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue('charlie three');

  for (let presses = 0; presses < 2; presses++) await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue('delta four');
  await browser.keyboard.press('End');
  await browser.keyboard.press('Shift+ArrowUp');
  await browser.keyboard.press('Shift+ArrowUp');
  await expect.poll(async () => (await page.selection()).backward).toBe(true);
  await browser.keyboard.press('ArrowUp');
  await expect(page.text).toHaveValue('');
  await browser.keyboard.press('ArrowUp');
  await expect(page.text).toHaveValue('bravo two');
});

test('an arrow past the first or last row of the note with a selection held goes to its start or end, as a text field does', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'abc def\n\nlast one');
  await browser.keyboard.press('End');
  for (let presses = 0; presses < 3; presses++) await browser.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => (await page.selection()).selected).toBe('def');
  await browser.keyboard.press('ArrowUp');
  await browser.keyboard.type('X');
  await expect(page.text).toHaveValue('Xabc def');

  for (let presses = 0; presses < 2; presses++) await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue('last one');
  await browser.keyboard.press('Home');
  for (let presses = 0; presses < 4; presses++) await browser.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await page.selection()).selected).toBe('last');
  await browser.keyboard.press('ArrowDown');
  await browser.keyboard.type('Y');
  await expect(page.text).toHaveValue('last oneY');
});

test('a drag with one move, let go before the page redraws, selects to where it was let go', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '# Title\n\nPara one\n\n> one quote\n\nlast');
  await expect(page.text).toHaveValue('# Title');
  const quote = await page.pointAt('quote');
  const field = await page.fieldBox();
  const besideTitle = await browser.evaluate(() => {
    const box = document.querySelector('[data-test-id="editor"]')!.getBoundingClientRect();
    return { x: box.right - 10, y: box.top + box.height / 2 };
  });
  expect(field.top).toBeLessThan(besideTitle.y);

  await page.beforeRedraw(async () => {
    await browser.mouse.move(quote.x, quote.y);
    await browser.mouse.down();
    await browser.mouse.move(besideTitle.x, besideTitle.y);
    await browser.mouse.up();
  });
  await page.nextFrame();
  expect(await page.selection()).toEqual({
    text: '# Title\n\nPara one\n\n> one quote',
    selected: '\n\nPara one\n\n> one ',
    backward: true,
  });
});

test('a right-click on the drawn page leaves the caret and the focus where they were', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'first\n\nA [link](https://example.com) here\n\nlast');
  await browser.keyboard.press('End');
  await page.drawn('p').last().secondaryTap();
  await page.drawn('a').secondaryTap();
  await expect(page.text).toBeFocused();
  await browser.keyboard.type('X');
  await expect(page.text).toHaveValue('firstX');
});

for (const [what, typed, below] of [
  ['a dash', '- x', 'below words'],
  ['indented code', '    c', 'below words'],
  ['a heading', '# T', 'below words'],
  ['a task', '- [ ] t', 'below words'],
  ['a number above a list', '1. n', '3. alpha\n4. beta'],
] as const) {
  test(`${what} typed on an empty row moves nothing around it and keeps the row's height`, async ({
    app,
    browser,
    disk,
    page,
  }) => {
    await openLive({ app, disk, page }, `top line\n\n\n\n${below}`);
    await browser.keyboard.press('ArrowDown');
    await browser.keyboard.press('ArrowDown');
    await expect(page.text).toHaveValue('');
    const word = below.startsWith('3.') ? 'alpha' : 'below';
    const measure = async () => ({
      top: (await page.placeOf('top'))!.top,
      below: (await page.placeOf(word))!.top,
      height: (await page.fieldBox()).height,
    });
    await page.nextFrame();
    const still = await measure();

    let sofar = '';
    for (const key of typed) {
      await browser.keyboard.type(key);
      sofar += key;
      await expect(page.text).toHaveValue(sofar);
      await page.nextFrame();
      const now = await measure();
      const moved = (side: keyof typeof now) => Math.abs(now[side] - still[side]) >= 0.5;
      expect({ sofar, top: moved('top'), below: moved('below'), height: moved('height') }).toEqual({
        sofar,
        top: false,
        below: false,
        height: false,
      });
    }
  });
}

test('a press whose hand moves up to four pixels each way selects nothing, and five pixels sideways selects', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '# Trip\n\nThe flight is booked and the hotel is not.\n\nlast');
  for (const [dx, dy] of [[3, 3], [4, 1], [4, 4], [5, 0]] as const) {
    await browser.keyboard.press('Escape');
    await expect(page.preview).toBeVisible();
    const hotel = await page.pointAt('otel');
    await browser.mouse.move(hotel.x, hotel.y);
    await browser.mouse.down();
    await page.nextFrame();
    await browser.mouse.move(hotel.x + dx, hotel.y + dy);
    await page.nextFrame();
    await browser.mouse.up();
    await page.nextFrame();
    expect({ dx, dy, selected: (await page.selection()).selected !== '' }).toEqual({ dx, dy, selected: dx > 4 });
  }
});

test('a tap in the margin level with a line of the text field puts the caret on that line', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '# Trip\n\nsome words here\n\nlast line');
  await page.drawn('p').first().tap();
  await expect(page.text).toHaveValue('some words here');
  await browser.keyboard.press('End');

  // A touch sends its pointer events first, then the mouse events.
  await browser.evaluate(() => {
    const sheet = document.querySelector('.page.live')!;
    const field = document.querySelector('[data-test-id="editor"]')!.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, clientX: sheet.getBoundingClientRect().left + 6, clientY: field.top + field.height / 2 };
    const touch = { ...at, pointerType: 'touch', isPrimary: true };
    const capabilities = (globalThis as unknown as { InputDeviceCapabilities: new (init: object) => object })
      .InputDeviceCapabilities;
    const fromTouch = { sourceCapabilities: new capabilities({ firesTouchEvents: true }) };
    sheet.dispatchEvent(new PointerEvent('pointerdown', touch));
    sheet.dispatchEvent(new PointerEvent('pointerup', touch));
    sheet.dispatchEvent(new MouseEvent('mousedown', { ...at, ...fromTouch, buttons: 1 }));
    sheet.dispatchEvent(new MouseEvent('mouseup', { ...at, ...fromTouch }));
    sheet.dispatchEvent(new MouseEvent('click', { ...at, ...fromTouch }));
    return null;
  });
  await page.nextFrame();
  await expect(page.text).toBeFocused();
  await browser.keyboard.type('Z');
  await expect(page.text).toHaveValue('Zsome words here');
});

test('the end of a selection that the keys move stays in the window as the field grows past it', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, Array.from({ length: 60 }, (_, i) => `para ${i}`).join('\n\n'));
  const head = () =>
    browser.evaluate(() => {
      const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
      const at = field.selectionDirection === 'backward' ? field.selectionStart : field.selectionEnd;
      const line = field.value.slice(0, at).split('\n').length - 1;
      const height = parseFloat(getComputedStyle(field).lineHeight);
      const top = field.getBoundingClientRect().top + line * height;
      const sheet = document.querySelector('.page')!.getBoundingClientRect();
      return {
        row: field.value.slice(0, at).split('\n').at(-1) ?? '',
        inView: top >= Math.max(sheet.top, 0) - 1 && top + height <= Math.min(sheet.bottom, innerHeight) + 1,
      };
    });
  for (let step = 0; step < 6; step++) await browser.keyboard.press('ArrowDown');
  for (let step = 1; step <= 50; step++) {
    await browser.keyboard.press('Shift+ArrowDown');
    await page.nextFrame();
    expect({ step, ...(await head()) }).toEqual({ step, row: expect.any(String), inView: true });
  }
  for (const key of ['Control+Shift+Home', 'Control+Shift+End', 'Control+Shift+Home']) {
    await browser.keyboard.press(key);
    await page.nextFrame();
    expect({ key, ...(await head()) }).toEqual({ key, row: expect.any(String), inView: true });
  }
  for (let step = 1; step <= 8; step++) await browser.keyboard.press('Shift+ArrowDown');
  await browser.keyboard.press('Control+Shift+End');
  for (let step = 1; step <= 50; step++) {
    await browser.keyboard.press('Shift+ArrowUp');
    await page.nextFrame();
    expect({ step, ...(await head()) }).toEqual({ step, row: expect.any(String), inView: true });
  }
});

test('Shift and a click on a link or a box select to it, and neither opens the link nor ticks the box', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'alpha beta gamma\n\nsee the [long link text](https://example.com/x) tail\n\n- [ ] box item');
  await page.drawn('a').tap({ modifiers: ['Shift'] });
  await expect.poll(async () => (await page.selection()).selected).toMatch(/^alpha beta gamma\n\nsee the \[long l/);
  await expect(page.text).toBeFocused();

  await page.drawn('input').tap({ modifiers: ['Shift'] });
  await expect.poll(async () => (await page.selection()).selected).toMatch(/^alpha beta gamma\n\n[^]* tail\n\n$/);
  await expect(page.text).toBeFocused();
  await browser.keyboard.press('Escape');
  await expect(page.box('box item')).not.toBeChecked();
  await page.showMarkdown();
  await expect(page.text).toHaveValue('alpha beta gamma\n\nsee the [long link text](https://example.com/x) tail\n\n- [ ] box item');
});

test('a middle click on the drawn page puts the caret where it clicked, where Linux pastes', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'first line\n\nsecond paragraph\n\nA [link](https://example.com) here');
  await browser.keyboard.press('End');
  const middleClick = (point: { x: number; y: number }) =>
    browser.evaluate((at: { x: number; y: number }) => {
      const target = document.elementFromPoint(at.x, at.y)!;
      const press = { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 1 };
      target.dispatchEvent(new MouseEvent('mousedown', { ...press, buttons: 4 }));
      target.dispatchEvent(new MouseEvent('mouseup', press));
      target.dispatchEvent(new MouseEvent('auxclick', press));
      return null;
    }, point);

  await middleClick(await page.pointAt('econd'));
  await expect.poll(() => page.caret()).toBe('s|econd paragraph');
  await expect(page.text).toBeFocused();
  await browser.keyboard.type('X');
  await expect(page.text).toHaveValue('sXecond paragraph');

  await middleClick(await page.pointAt('link'));
  await page.nextFrame();
  expect(await page.caret()).toBe('sX|econd paragraph');
});

test('a box ticked while a row is typed under a line keeps that line drawn as it was', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '- [ ] box\n\ntext');
  await browser.keyboard.press('ArrowDown');
  await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue('text');
  await browser.keyboard.press('End');
  await browser.keyboard.press('Enter');
  await browser.keyboard.type('-');
  await expect(page.text).toHaveValue('-');
  await expect(page.drawn('p')).toHaveText('text');

  await page.drawn('input').tap();
  await expect(page.drawn('input')).toBeChecked();
  await page.nextFrame();
  await expect(page.text).toHaveValue('-');
  await expect(page.drawn('p')).toHaveText('text');
  await expect(page.drawn('h2')).toHaveCount(0);
  await browser.keyboard.press('Escape');
  await page.showMarkdown();
  await expect(page.text).toHaveValue('- [x] box\n\ntext\n-');
});

test('at the end of a wrapped line the arrows move from that line, as a text field does', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
  await openLive({ app, disk, page }, `first\n\n${long}\n\nlast para`);
  await page.drawn('p').last().tap();
  await expect(page.text).toHaveValue('last para');
  await browser.keyboard.press('ArrowUp');
  await browser.keyboard.press('ArrowUp');
  await expect(page.text).toHaveValue(long);
  await page.nextFrame();
  const lines = await browser.evaluate(() => {
    const field = document.querySelector('[data-test-id="editor"]')!;
    return field.getBoundingClientRect().height / parseFloat(getComputedStyle(field).lineHeight);
  });
  expect(lines).toBeGreaterThanOrEqual(3);
  await browser.keyboard.press('ArrowUp');
  await browser.keyboard.press('End');
  await browser.keyboard.press('Shift+ArrowDown');
  await page.nextFrame();
  const down = await page.selection();
  expect(down.text).toBe(long);
  expect(long.endsWith(down.selected) && down.selected.length > 0).toBe(true);

  await browser.keyboard.press('ArrowUp');
  await browser.keyboard.press('End');
  await browser.keyboard.press('ArrowDown');
  await page.nextFrame();
  expect(await page.caret()).toBe(`${long}|`);

  await browser.keyboard.press('Control+Home');
  await browser.keyboard.press('End');
  await browser.keyboard.press('Shift+ArrowUp');
  await page.nextFrame();
  const up = await page.selection();
  expect(up.selected).toMatch(/^\nword0 word1 /);
  expect(up.selected).not.toContain('word39');
});

test('a double-click held and dragged into another block selects whole words, as a text field does', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'alpha beta gamma\n\nsecond para here');
  // The mouse of a test presses once at a time, so the second press of a
  // double-click is sent from the page.
  const send = (type: string, at: { x: number; y: number }, detail: number) =>
    browser.evaluate(
      (event: { type: string; x: number; y: number; detail: number }) => {
        const target = document.elementFromPoint(event.x, event.y)!;
        const pressed = event.type === 'mouseup' ? 0 : 1;
        target.dispatchEvent(
          new MouseEvent(event.type, {
            bubbles: true,
            cancelable: true,
            clientX: event.x,
            clientY: event.y,
            detail: event.detail,
            button: 0,
            buttons: pressed,
          }),
        );
        return null;
      },
      { type, ...at, detail },
    );
  const doubleDrag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await send('mousedown', from, 2);
    await page.nextFrame();
    for (let step = 1; step <= 6; step++) {
      await send('mousemove', { x: from.x + ((to.x - from.x) * step) / 6, y: from.y + ((to.y - from.y) * step) / 6 }, 0);
      await page.nextFrame();
    }
    await send('mouseup', to, 2);
    await page.nextFrame();
  };
  const inField = (before: string) =>
    browser.evaluate((before: string) => {
      const field = document.querySelector('[data-test-id="editor"]')!;
      const box = field.getBoundingClientRect();
      const style = getComputedStyle(field);
      const pen = document.createElement('canvas').getContext('2d')!;
      pen.font = style.font;
      const x = box.left + parseFloat(style.paddingLeft) + pen.measureText(before).width;
      return { x, y: box.top + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2 };
    }, before);

  await doubleDrag(await inField('al'), await page.pointAt('ara here'));
  await expect.poll(() => page.selection()).toEqual({
    text: 'alpha beta gamma\n\nsecond para here',
    selected: 'alpha beta gamma\n\nsecond para',
    backward: false,
  });

  await browser.keyboard.press('ArrowDown');
  await expect(page.text).toHaveValue('second para here');
  await doubleDrag(await inField('second pa'), await page.pointAt('eta'));
  await expect.poll(() => page.selection()).toEqual({
    text: 'alpha beta gamma\n\nsecond para here',
    selected: 'beta gamma\n\nsecond para',
    backward: true,
  });
});

test('selected text dragged onto another block moves there, as in a text field', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'alpha beta gamma\n\nsecond para here');
  for (let step = 0; step < 5; step++) await browser.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await page.selection()).selected).toBe('alpha');
  const from = await browser.evaluate(() => {
    const box = document.querySelector('[data-test-id="editor"]')!.getBoundingClientRect();
    return { x: box.left + 15, y: box.top + 12 };
  });
  const to = await page.pointAt('para here');

  await browser.mouse.move(from.x, from.y);
  await browser.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await browser.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
    await page.nextFrame();
  }
  await browser.mouse.up();
  await expect.poll(async () => (await page.selection()).selected).toBe('alpha');
  expect((await page.selection()).text).toBe('second alphapara here');
  await expect(page.text).toBeFocused();
  await browser.keyboard.press('Escape');
  await page.showMarkdown();
  await expect(page.text).toHaveValue(' beta gamma\n\nsecond alphapara here');
});

test('Ctrl+Shift+Home selects from the caret back to the start of the note', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  const hotel = await page.pointAt('hotel');
  await browser.mouse.move(hotel.x, hotel.y);
  await browser.mouse.down();
  await browser.mouse.up();
  await expect.poll(() => page.caret()).toBe('Flights are **booked** and the |hotel is *not*.');

  await browser.keyboard.press('Control+Shift+Home');
  await expect.poll(() => page.selection()).toEqual({
    text: `# Trip\n\n${paragraph}`,
    selected: '# Trip\n\nFlights are **booked** and the ',
    backward: true,
  });
});

test('Ctrl+Shift+A selects nothing, as in a text field', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, body);
  await page.drawn('p').first().tap();
  await expect(page.text).toHaveValue(paragraph);
  await browser.keyboard.press('End');

  await browser.keyboard.press('ControlOrMeta+Shift+A');
  await page.nextFrame();
  expect(await page.selection()).toEqual({ text: paragraph, selected: '', backward: false });
});

test('Ctrl and the key that types e shows the markdown on any Latin layout, and the key where E sits on QWERTY does not', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  const press = (key: string, code: string) =>
    browser.evaluate(
      (which: { key: string; code: string }) => {
        const target = document.activeElement ?? document.body;
        const apple = /Mac|iPhone|iPad/.test(navigator.platform);
        target.dispatchEvent(
          new KeyboardEvent('keydown', { ...which, ctrlKey: !apple, metaKey: apple, bubbles: true, cancelable: true }),
        );
        return null;
      },
      { key, code },
    );

  // On Colemak the key where QWERTY has E types f, and e is where QWERTY has K.
  await press('f', 'KeyE');
  await page.nextFrame();
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'false');

  await press('e', 'KeyK');
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'true');
});

test('a drag whose button is let go outside the window selects no further once the pointer comes back', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  await page.drawn('em').tap();
  await expect(page.text).toHaveValue(paragraph);

  const booked = await page.pointAt('booked');
  const hotel = await page.pointAt('hotel');
  await browser.mouse.move(booked.x, booked.y);
  await browser.mouse.down();
  await page.nextFrame();
  await browser.mouse.move(hotel.x, hotel.y);
  await expect.poll(async () => (await page.selection()).selected).toBe('booked** and the ');

  // The browser does not report a release outside its window: the pointer
  // comes back with no button held.
  const shoes = await page.pointAt('Shoes');
  await browser.evaluate((at: { x: number; y: number }) => {
    document.body.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, buttons: 0 }),
    );
    return null;
  }, shoes);
  await page.nextFrame();
  await page.nextFrame();
  expect((await page.selection()).selected).toBe('booked** and the ');
  await browser.mouse.up();
});

test('selected text dragged onto another block with the copy key held is copied there', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'alpha beta gamma\n\nsecond para here');
  for (let step = 0; step < 5; step++) await browser.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await page.selection()).selected).toBe('alpha');
  const from = await browser.evaluate(() => {
    const box = document.querySelector('[data-test-id="editor"]')!.getBoundingClientRect();
    return { x: box.left + 15, y: box.top + 12 };
  });
  const to = await page.pointAt('para here');
  const copyKey = await browser.evaluate(() => (/Mac/.test(navigator.platform) ? 'Alt' : 'Control'));

  await browser.mouse.move(from.x, from.y);
  await browser.mouse.down();
  await browser.keyboard.down(copyKey);
  for (let step = 1; step <= 10; step++) {
    await browser.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
    await page.nextFrame();
  }
  await browser.mouse.up();
  await browser.keyboard.up(copyKey);
  await expect.poll(async () => (await page.selection()).selected).toBe('alpha');
  await browser.keyboard.press('Escape');
  await page.showMarkdown();
  await expect(page.text).toHaveValue('alpha beta gamma\n\nsecond alphapara here');
});

test('Shift and a press on the selected text select from the anchor, and a drag from there reaches the blocks below', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  await page.drawn('p').first().tap();
  await expect(page.text).toHaveValue(paragraph);
  await browser.keyboard.press('Home');
  for (let step = 0; step < 7; step++) await browser.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await page.selection()).selected).toBe('Flights');

  const inside = await page.pointAt('ghts');
  const shoes = await page.pointAt('Shoes');
  await browser.keyboard.down('Shift');
  await browser.mouse.move(inside.x, inside.y);
  await browser.mouse.down();
  await page.nextFrame();
  for (let step = 1; step <= 6; step++) {
    await browser.mouse.move(inside.x + ((shoes.x - inside.x) * step) / 6, inside.y + ((shoes.y - inside.y) * step) / 6);
    await page.nextFrame();
  }
  await browser.mouse.up();
  await browser.keyboard.up('Shift');
  await expect.poll(async () => (await page.selection()).selected).toMatch(/^Flights are .*\n\n- \[ \] Passport\n- S/);
  expect((await page.selection()).backward).toBe(false);
});

test('a third click in the text field is left to the browser, which selects the line as in a text field', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '# Trip\n\nsome words here\n\nlast line');
  await page.drawn('p').first().tap();
  await expect(page.text).toHaveValue('some words here');
  await page.text.dblclick();
  const word = (await page.selection()).selected;
  expect(word).not.toBe('');

  // The mouse of a test presses once at a time, so the third press of a
  // triple click is sent from the page.
  const kept = await browser.evaluate(() => {
    const field = document.querySelector('[data-test-id="editor"]')!;
    const box = field.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
    const pressed = field.dispatchEvent(new MouseEvent('mousedown', { ...at, detail: 3, buttons: 1 }));
    field.dispatchEvent(new MouseEvent('mouseup', { ...at, detail: 3 }));
    return pressed;
  });
  await page.nextFrame();
  expect(kept).toBe(true);
  expect((await page.selection()).selected).toBe(word);
});

test('a tap in the text field is left to the browser, as in a text field', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, '# Trip\n\nsome words here\n\nlast line');
  await page.drawn('p').first().tap();
  await expect(page.text).toHaveValue('some words here');
  await browser.keyboard.press('End');

  // A touch sends its pointer events first, then the mouse events.
  const kept = await browser.evaluate(() => {
    const field = document.querySelector('[data-test-id="editor"]')!;
    const box = field.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, clientX: box.left + 20, clientY: box.top + box.height / 2 };
    const touch = { ...at, pointerType: 'touch', isPrimary: true };
    const capabilities = (globalThis as unknown as { InputDeviceCapabilities: new (init: object) => object })
      .InputDeviceCapabilities;
    const fromTouch = { sourceCapabilities: new capabilities({ firesTouchEvents: true }) };
    field.dispatchEvent(new PointerEvent('pointerdown', touch));
    field.dispatchEvent(new PointerEvent('pointerup', touch));
    const pressed = field.dispatchEvent(new MouseEvent('mousedown', { ...at, ...fromTouch, buttons: 1 }));
    field.dispatchEvent(new MouseEvent('mouseup', { ...at, ...fromTouch }));
    return pressed;
  });
  await page.nextFrame();
  expect(kept).toBe(true);
  expect(await page.caret()).toBe('some words here|');
});

test('a third click beside the text field selects the line level with it, as a third click in the field does', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '# Trip\n\nsome words here\n\nlast line');
  await page.drawn('p').first().tap();
  await expect(page.text).toHaveValue('some words here');
  await browser.keyboard.press('End');

  // The mouse of a test presses once at a time, so a triple click is sent
  // from the page.
  const click = (detail: number) =>
    browser.evaluate((detail: number) => {
      const sheet = document.querySelector('.page.live')!;
      const field = document.querySelector('[data-test-id="editor"]')!.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, detail, clientX: sheet.getBoundingClientRect().left + 6, clientY: field.top + field.height / 2 };
      sheet.dispatchEvent(new MouseEvent('mousedown', { ...at, buttons: 1 }));
      sheet.dispatchEvent(new MouseEvent('mouseup', at));
      return null;
    }, detail);
  await click(1);
  await click(2);
  await expect.poll(async () => (await page.selection()).selected).toBe('some');
  await click(3);
  await expect.poll(async () => (await page.selection()).selected).toBe('some words here');
});

test('switching to the page with the caret on a row below the window scrolls only until that row shows, as a text field does', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const rows = Array.from({ length: 60 }, (_, n) => `Paragraph ${n} with some words.`).join('\n\n');
  await disk.seed([stored(rows)]);
  await app.open('/');
  await expect(page.text).toHaveValue(rows);
  await browser.evaluate(() => {
    const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
    const at = field.value.indexOf('Paragraph 40');
    field.setSelectionRange(at, at);
    return null;
  });
  await browser.keyboard.press('ArrowRight');

  await page.markdown.tap();
  await expect(page.text).toHaveValue('Paragraph 40 with some words.');
  await expect(page.text).toBeFocused();
  const gapBelow = () =>
    browser.evaluate(() => {
      const sheet = document.querySelector('.page')!.getBoundingClientRect();
      const field = document.querySelector('[data-test-id="editor"]')!.getBoundingClientRect();
      return Math.min(sheet.bottom, innerHeight) - field.bottom;
    });
  await expect.poll(gapBelow).toBeGreaterThanOrEqual(-1);
  expect(await gapBelow()).toBeLessThan(8);
});

test('selected text across rows dragged onto another block moves there, as in a text field', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const note = 'Alpha para one.\n\n- item x\n- item y\n\nDelta para.';
  const glide = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await browser.mouse.move(from.x, from.y);
    await browser.mouse.down();
    for (let step = 1; step <= 10; step++) {
      await browser.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
      await page.nextFrame();
    }
    await browser.mouse.up();
  };

  await openLive({ app, disk, page }, note);
  await page.drawn('li').first().tap();
  await expect(page.text).toHaveValue('- item x');
  await browser.keyboard.press('Home');
  await browser.keyboard.press('Shift+ArrowDown');
  await browser.keyboard.press('Shift+End');
  await expect.poll(() => page.selection()).toEqual({
    text: '- item x\n- item y',
    selected: '- item x\n- item y',
    backward: false,
  });

  await glide(await page.pointAt('tem x'), await page.pointAt('para.'));
  await expect.poll(async () => (await page.selection()).selected).toBe('- item x\n- item y');
  await browser.keyboard.press('Escape');
  await page.showMarkdown();
  await expect(page.text).toHaveValue('Alpha para one.\n\n\n\nDelta - item x\n- item ypara.');
});

test('text selected by a drag across blocks dragged onto another block moves there', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const note = 'Alpha para one.\n\n- item x\n- item y\n\nDelta para.';
  const glide = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await browser.mouse.move(from.x, from.y);
    await browser.mouse.down();
    for (let step = 1; step <= 10; step++) {
      await browser.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
      await page.nextFrame();
    }
    await browser.mouse.up();
  };

  await openLive({ app, disk, page }, note);
  await page.drawn('p').last().tap();
  await expect(page.text).toHaveValue('Delta para.');
  await glide(await page.pointAt('para one'), await page.pointAt('tem x'));
  await expect.poll(async () => (await page.selection()).selected).toMatch(/^para one\.\n\n- i/);
  const moved = (await page.selection()).selected;

  await glide(await page.pointAt('ra one'), await page.pointAt('para.'));
  await expect.poll(async () => (await page.selection()).selected).toBe(moved);
  await browser.keyboard.press('Escape');
  await page.showMarkdown();
  const left = note.replace(moved, '');
  const at = left.lastIndexOf('para.');
  await expect(page.text).toHaveValue(left.slice(0, at) + moved + left.slice(at));
});

for (const [cell, row] of [
  ['1', '| alpha1 | 2 |'],
  ['2', '| 1 | alpha2 |'],
]) {
  test(`selected text dragged onto the start of a drawn table's cell ${cell} lands in that cell`, async ({
    app,
    browser,
    disk,
    page,
  }) => {
    const note = 'Para alpha beta.\n\n| a | b |\n|-|-|\n| 1 | 2 |\n\nEnd.';
    await openLive({ app, disk, page }, note);
    await expect(page.text).toHaveValue('Para alpha beta.');
    await browser.keyboard.press('Home');
    for (let step = 0; step < 5; step++) await browser.keyboard.press('ArrowRight');
    for (let step = 0; step < 5; step++) await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => (await page.selection()).selected).toBe('alpha');
    const from = await page.pointAt('lpha');
    const to = await browser.evaluate((cell: string) => {
      const text = [...document.querySelectorAll('.page.live td')].find((td) => td.textContent === cell)!.firstChild!;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 1);
      const box = range.getBoundingClientRect();
      return { x: box.left + box.width / 3, y: box.top + box.height / 2 };
    }, cell);

    await browser.mouse.move(from.x, from.y);
    await browser.mouse.down();
    for (let step = 1; step <= 10; step++) {
      await browser.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
      await page.nextFrame();
    }
    await browser.mouse.up();
    await expect.poll(async () => (await page.selection()).selected).toBe('alpha');
    await browser.keyboard.press('Escape');
    await page.showMarkdown();
    await expect(page.text).toHaveValue(`Para  beta.\n\n| a | b |\n|-|-|\n${row}\n\nEnd.`);
  });
}

test('a triple click on a block not in the text field selects its line, as a third click in the field does', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '# Trip\n\nsome words here\n\n- [ ] Passport\n- Shoes\n\n| a | b |\n|-|-|\n| 1 | 2 |\n\nlast line');

  // The mouse of a test presses once at a time, so a triple click is sent
  // from the page, its three presses quicker than the page redraws.
  const tripleClick = (point: { x: number; y: number }) =>
    browser.evaluate((at: { x: number; y: number }) => {
      for (const detail of [1, 2, 3]) {
        const target = document.elementFromPoint(at.x, at.y)!;
        const press = { bubbles: true, cancelable: true, detail, clientX: at.x, clientY: at.y };
        target.dispatchEvent(new MouseEvent('mousedown', { ...press, buttons: 1 }));
        target.dispatchEvent(new MouseEvent('mouseup', press));
      }
      return null;
    }, point);
  for (const [word, line] of [
    ['words', 'some words here'],
    ['Shoes', '- Shoes'],
    ['b', '| a | b |\n'],
  ]) {
    await tripleClick(await page.pointAt(word));
    await expect.poll(async () => (await page.selection()).selected).toBe(line);
    await browser.keyboard.press('Escape');
  }
});

for (const [what, press] of [
  ['a click and a key typed before the page redraws', 'left'],
  ['a middle click and the paste on its release', 'middle'],
] as const) {
  test(`${what} leave a scrolled page where it was`, async ({ app, browser, disk, page }) => {
    const note = Array.from(
      { length: 60 },
      (_, i) => `Paragraph ${i} with words enough to wrap onto a second line of the page at this width, and then some.`,
    ).join('\n\n');
    await openLive({ app, disk, page }, note);
    await page.drawn('p').last().click();
    await expect(page.text).toHaveValue(/^Paragraph 59 /);
    await browser.evaluate(() => {
      document.querySelector('.page')!.scrollTop = 1000;
      return null;
    });
    await page.nextFrame();
    expect(await page.scrolled()).toBe(1000);
    const paragraph = await browser.evaluate(
      () => [...document.querySelectorAll('.page.live p')].find((p) => p.getBoundingClientRect().top > innerHeight / 2)!.textContent!,
    );
    const at = await page.pointAt(paragraph.slice(0, 13));

    await page.beforeRedraw(async () => {
      if (press === 'left') {
        await browser.mouse.move(at.x, at.y);
        await browser.mouse.down();
        await browser.mouse.up();
        await browser.keyboard.type('X');
      } else {
        // The mouse of a test has no middle button, so its press is sent
        // from the page, and a key stands for the paste on its release.
        await browser.evaluate((at: { x: number; y: number }) => {
          const press = { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 1 };
          document.elementFromPoint(at.x, at.y)!.dispatchEvent(new MouseEvent('mousedown', { ...press, buttons: 4 }));
          document.activeElement!.dispatchEvent(new MouseEvent('mouseup', press));
          return null;
        }, at);
        await browser.keyboard.type('X');
      }
    });
    await expect(page.text).toHaveValue(`X${paragraph}`);
    expect(await page.scrolled()).toBe(1000);
  });
}

for (const [cell, field] of [
  ['a', '| a| | b |\n|-|-|\n| 1 | 2 |'],
  ['1', '| a | b |\n|-|-|\n| 1| | 2 |'],
  ['2', '| a | b |\n|-|-|\n| 1 | 2| |'],
] as const) {
  test(`a click on the right of a drawn table's cell ${cell} puts the caret at the end of that cell`, async ({
    app,
    disk,
    page,
  }) => {
    await openLive({ app, disk, page }, 'Para.\n\n| a | b |\n|-|-|\n| 1 | 2 |\n\nEnd.');
    const box = page.drawn('td, th').filter({ hasText: cell });
    const { width, height } = (await box.boundingBox())!;
    await box.click({ position: { x: width - 4, y: height / 2 } });
    await expect.poll(() => page.caret()).toBe(field);
  });
}

test('text dragged onto the right of a drawn table cell lands at the end of that cell', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const note = 'Para alpha beta.\n\n| a | b |\n|-|-|\n| 1 | 2 |\n\nEnd.';
  await openLive({ app, disk, page }, note);
  await browser.keyboard.press('Home');
  for (let step = 0; step < 5; step++) await browser.keyboard.press('ArrowRight');
  for (let step = 0; step < 5; step++) await browser.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await page.selection()).selected).toBe('alpha');
  const from = await page.pointAt('lpha');
  const to = await browser.evaluate(() => {
    const box = [...document.querySelectorAll('.page.live td')].find((td) => td.textContent === '1')!.getBoundingClientRect();
    return { x: box.right - 4, y: box.top + box.height / 2 };
  });

  await browser.mouse.move(from.x, from.y);
  await browser.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await browser.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
    await page.nextFrame();
  }
  await browser.mouse.up();
  await expect.poll(async () => (await page.selection()).selected).toBe('alpha');
  await browser.keyboard.press('Escape');
  await page.showMarkdown();
  await expect(page.text).toHaveValue('Para  beta.\n\n| a | b |\n|-|-|\n| 1alpha | 2 |\n\nEnd.');
});

test('a file dropped on the page or the text field is refused, so the browser stays on the note', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '# Trip\n\nsome words here\n\nlast line');
  const drop = (selector: string, file: boolean, text = false) =>
    browser.evaluate(
      ({ selector, file, text }: { selector: string; file: boolean; text: boolean }) => {
        const target = document.querySelector(selector)!;
        const box = target.getBoundingClientRect();
        const carried = new DataTransfer();
        if (file) carried.items.add(new File(['words'], 'words.txt', { type: 'text/plain' }));
        if (text || !file) carried.setData('text/plain', 'dropped ');
        const at = { bubbles: true, cancelable: true, dataTransfer: carried, clientX: box.left + 2, clientY: box.top + box.height / 2 };
        return ['dragenter', 'dragover', 'drop'].map((type) => {
          const event = new DragEvent(type, at);
          target.dispatchEvent(event);
          return event.defaultPrevented;
        });
      },
      { selector, file, text },
    );

  expect(await drop('.page.live .part p', true)).toEqual([false, true, true]);
  expect(await drop('[data-test-id="editor"]', true)).toEqual([false, true, true]);
  expect(await drop('nav.sidebar', true)).toEqual([false, true, true]);
  expect(await drop('[data-test-id="title"]', true)).toEqual([false, true, true]);
  expect(await drop('.page.live .part p', true, true)).toEqual([false, true, true]);
  expect(await drop('[data-test-id="editor"]', true, true)).toEqual([false, true, true]);
  await page.nextFrame();
  await expect(page.text).toHaveValue('# Trip');
  expect(await drop('.page.live .part p', false)).toEqual([false, true, true]);
  await expect(page.text).toHaveValue('dropped some words here');
});
