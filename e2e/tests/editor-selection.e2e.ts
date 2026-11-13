import { expect } from 'e2e';
import { clickSeries, ctrl, doubleClick, Editing, offsetOf, withRawPage } from './editing.ts';
import type { Spot } from './editing.ts';
import { test } from './nullpad.ts';

/**
 * What any text editor does with a selection, in the page view (Markdown
 * off), where the note is drawn and a text field holds the block the caret is
 * in. A selection can start and end in different blocks, so each way of
 * making one is followed by each thing a person does with one.
 */

const note = 'alpha one\n\nbravo two\n\ncharlie three';
const start: Spot = { word: 'one', at: 0 };
const end: Spot = { word: 'three', at: 0 };
const from = offsetOf(note, start);
const to = offsetOf(note, end);

type Selection = { name: string; from: number; to: number; make(editor: Editing): Promise<void> };

const selections: Selection[] = [
  { name: 'a mouse drag down', from, to, make: (editor) => editor.drag(start, end) },
  { name: 'a mouse drag up', from, to, make: (editor) => editor.drag(end, start) },
  {
    name: 'a click and a Shift+click',
    from,
    to,
    make: async (editor) => {
      await editor.click(start);
      await editor.shiftClick(end);
    },
  },
  {
    name: 'a click and Shift+Arrow Right',
    from,
    to,
    make: async (editor) => {
      await editor.click(start);
      await editor.press(...Array<string>(to - from).fill('Shift+ArrowRight'));
    },
  },
  {
    name: 'a click at the end and Shift+Arrow Left',
    from,
    to,
    make: async (editor) => {
      await editor.click(end);
      await editor.press(...Array<string>(to - from).fill('Shift+ArrowLeft'));
    },
  },
  {
    name: 'Ctrl+A',
    from: 0,
    to: note.length,
    make: (editor) => editor.press(ctrl('a')),
  },
  {
    name: 'a click in the last block and Ctrl+A',
    from: 0,
    to: note.length,
    make: async (editor) => {
      await editor.click(end);
      await editor.press(ctrl('a'));
    },
  },
];

type Action = {
  name: string;
  /** Every way of selecting is tried with the core actions, and the first and last also with the rest. */
  core: boolean;
  run(editor: Editing): Promise<void>;
  /** What the note is after it, and what is on the clipboard, given what was selected. */
  after(selection: Selection): { note: string; clipboard: string };
};

const without = (selection: Selection) => note.slice(0, selection.from) + note.slice(selection.to);
const typed = (selection: Selection, text: string) => note.slice(0, selection.from) + text + note.slice(selection.to);

const actions: Action[] = [
  {
    name: 'copied',
    core: true,
    run: (editor) => editor.press(ctrl('c')),
    after: (selection) => ({ note, clipboard: note.slice(selection.from, selection.to) }),
  },
  {
    name: 'cut',
    core: true,
    run: (editor) => editor.press(ctrl('x')),
    after: (selection) => ({ note: without(selection), clipboard: note.slice(selection.from, selection.to) }),
  },
  {
    name: 'replaced by a typed letter',
    core: true,
    run: (editor) => editor.type('X'),
    after: (selection) => ({ note: typed(selection, 'X'), clipboard: 'sentinel' }),
  },
  {
    name: 'replaced by a typed word',
    core: false,
    run: (editor) => editor.type('new words'),
    after: (selection) => ({ note: typed(selection, 'new words'), clipboard: 'sentinel' }),
  },
  {
    name: 'deleted with Backspace',
    core: true,
    run: (editor) => editor.press('Backspace'),
    after: (selection) => ({ note: without(selection), clipboard: 'sentinel' }),
  },
  {
    name: 'deleted with Delete',
    core: false,
    run: (editor) => editor.press('Delete'),
    after: (selection) => ({ note: without(selection), clipboard: 'sentinel' }),
  },
  {
    name: 'replaced by Enter',
    core: false,
    run: (editor) => editor.press('Enter'),
    after: (selection) => ({ note: typed(selection, '\n'), clipboard: 'sentinel' }),
  },
];

for (const [index, selection] of selections.entries()) {
  for (const action of actions) {
    if (!action.core && index !== 0 && index !== selections.length - 2) continue;
    test(`${selection.name} selects text that is ${action.name}`, async (fixtures) => {
      const editor = new Editing(fixtures);
      await editor.open(note);
      await editor.fillClipboard('sentinel');
      await selection.make(editor);
      await action.run(editor);

      const expected = action.after(selection);
      expect.soft(await editor.clipboard(), 'the clipboard').toBe(expected.clipboard);
      await editor.expectNote(expected.note);
      await expect(fixtures.page.text).toBeFocused();
    });
  }
}

test('a selection across blocks is shown as selected', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.drag(start, end);

  const shown = await fixtures.browser.evaluate(() => {
    const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
    const marked = (getSelection()?.toString() ?? '') + field.value.slice(field.selectionStart, field.selectionEnd);
    return marked.replace(/\s+/g, ' ') + (CSS.highlights.size > 0 ? ' highlighted' : '');
  });
  expect(shown).toMatch(/bravo two|highlighted/);
});

test('Shift+Arrow Down keeps the caret in the same column across blocks', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open('mmone more\n\nmmtwo more\n\nmmsix more');
  await editor.click({ word: 'mmone', at: 2 });
  await editor.press('Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown');
  await editor.type('X');

  await editor.expectNote('mmXsix more');
});

test('Shift+Arrow Right at the end of a block selects the line break and the start of the next', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click({ word: 'one', at: 3 });
  await editor.press('Shift+ArrowRight', 'Shift+ArrowRight', 'Shift+ArrowRight');
  await editor.type('X');

  await editor.expectNote('alpha oneXravo two\n\ncharlie three');
});

test('Shift+Arrow Left at the start of a block selects the line break and the end of the block above', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click({ word: 'bravo', at: 0 });
  await editor.press('Shift+ArrowLeft', 'Shift+ArrowLeft', 'Shift+ArrowLeft');
  await editor.type('X');

  await editor.expectNote('alpha onXbravo two\n\ncharlie three');
});

test('Shift+Arrow Up from the second block selects up into the first', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click({ word: 'bravo', at: 0 });
  await editor.press('Shift+ArrowUp', 'Shift+ArrowUp');
  await editor.type('X');

  await editor.expectNote('Xbravo two\n\ncharlie three');
});

test('Shift+Arrow Down from the first block selects down into the next', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click({ word: 'alpha', at: 0 });
  await editor.press('Shift+ArrowDown', 'Shift+ArrowDown');
  await editor.type('X');

  await editor.expectNote('Xbravo two\n\ncharlie three');
});

test('Shift+Arrow Up or Down from the start of a row selects to the start of a quote, a heading or an item, before its marks', async (fixtures) => {
  const cases = [
    { body: '> quote\n\nnext', at: { word: 'next', at: 0 }, keys: ['Shift+ArrowUp', 'Shift+ArrowUp'] },
    { body: '>\n\nnext', at: { word: 'next', at: 0 }, keys: ['Shift+ArrowUp', 'Shift+ArrowUp'] },
    { body: '> a\n>\n> b\n\nnext', at: { word: 'next', at: 0 }, keys: ['Shift+ArrowUp', 'Shift+ArrowUp', 'Shift+ArrowUp'] },
    { body: '# heading\n\nnext', at: { word: 'next', at: 0 }, keys: ['Shift+ArrowUp', 'Shift+ArrowUp'] },
    { body: '#\n\nnext', at: { word: 'next', at: 0 }, keys: ['Shift+ArrowUp', 'Shift+ArrowUp'] },
    { body: '- item\n\nnext', at: { word: 'next', at: 0 }, keys: ['Shift+ArrowUp', 'Shift+ArrowUp'] },
    { body: '-\n\nnext', at: { word: 'next', at: 0 }, keys: ['Shift+ArrowUp', 'Shift+ArrowUp'] },
    { body: 'first\n\n> quote', at: { word: 'first', at: 0 }, keys: ['Shift+ArrowDown', 'Shift+ArrowDown'] },
    { body: 'first\n\n>', at: { word: 'first', at: 0 }, keys: ['Shift+ArrowDown', 'Shift+ArrowDown'] },
    { body: 'first\n\n## heading', at: { word: 'first', at: 0 }, keys: ['Shift+ArrowDown', 'Shift+ArrowDown'] },
    { body: 'first\n\n##', at: { word: 'first', at: 0 }, keys: ['Shift+ArrowDown', 'Shift+ArrowDown'] },
  ];
  const editor = new Editing(fixtures);
  const typed = [];
  for (const { body, at, keys } of cases) {
    await editor.seed(body);
    const plain = await editor.plainField(body, offsetOf(body, at), keys, 'X');
    await editor.show(body);
    await editor.click(at);
    await editor.press(...keys);
    await editor.type('X');
    await fixtures.page.markdown.tap();
    typed.push({ body, plain, page: await fixtures.page.text.inputValue() });
  }
  expect(typed).toEqual(typed.map(({ body, plain }) => ({ body, plain, page: plain })));
});

test('Shift+Home on a heading, an item or a quote under a painted selection selects to the start of its row, before its marks', async (fixtures) => {
  const keys = ['Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+Home'];
  const editor = new Editing(fixtures);
  const typed = [];
  for (const body of ['one\n\n## Two', 'one\n\n- item', 'one\n\n> quote']) {
    await editor.seed(body);
    const plain = await editor.plainField(body, 3, keys, 'X');
    await editor.show(body);
    await editor.click({ word: 'one', at: 3 });
    await editor.press(...keys);
    await editor.type('X');
    await fixtures.page.markdown.tap();
    typed.push({ body, plain, page: await fixtures.page.text.inputValue() });
  }
  expect(typed).toEqual(typed.map(({ body, plain }) => ({ body, plain, page: plain })));
});

test('Shift+Arrow Left onto a quote, a heading or an item with nothing after its marks shows the cursor there', async (fixtures) => {
  const editor = new Editing(fixtures);
  const typed = [];
  for (const body of ['>\n\nnext', '> a\n>\n\nnext', '#\n\nnext', '-\n\nnext']) {
    const keys = ['Shift+ArrowLeft', 'Shift+ArrowLeft'];
    await editor.seed(body);
    const plain = await editor.plainField(body, body.indexOf('next'), keys, 'X');
    await editor.show(body);
    await editor.click({ word: 'next', at: 0 });
    await editor.press(...keys);
    await editor.type('X');
    await fixtures.page.markdown.tap();
    typed.push({ body, plain, page: await fixtures.page.text.inputValue() });
  }
  expect(typed).toEqual(typed.map(({ body, plain }) => ({ body, plain, page: plain })));
});

test('a drag inside one block selects text that typing replaces', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.drag({ word: 'bravo', at: 0 }, { word: 'two', at: 0 });
  await editor.type('X');

  await editor.expectNote('alpha one\n\nXtwo\n\ncharlie three');
});

test('a click after a selection puts the caret there and drops the selection', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.drag(start, end);
  await editor.click({ word: 'bravo', at: 2 });
  await editor.type('X');

  await editor.expectNote('alpha one\n\nbrXavo two\n\ncharlie three');
});

test('Shift+click extends a selection that began with a drag', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.drag({ word: 'alpha', at: 0 }, { word: 'one', at: 0 });
  await editor.shiftClick(end);
  await editor.press('Backspace');

  await editor.expectNote('three');
});

const marked = 'intro words\n\n# Big title here\n\n- list item words\n\n> quoted words here\n\n**bold** and plain\n\n```\ncode words\n```\n\n| head | cells |\n|-|-|\n| first | second |';

const words: { name: string; spot: Spot; selected: string }[] = [
  { name: 'a paragraph', spot: { word: 'words', at: 1 }, selected: 'words' },
  { name: 'a heading', spot: { word: 'title', at: 2 }, selected: 'title' },
  { name: 'a list item', spot: { word: 'item', at: 1 }, selected: 'item' },
  { name: 'a quote', spot: { word: 'quoted', at: 2 }, selected: 'quoted' },
  { name: 'bold text', spot: { word: 'bold', at: 1 }, selected: 'bold' },
  { name: 'plain text after bold text', spot: { word: 'plain', at: 2 }, selected: 'plain' },
  { name: 'a code block', spot: { word: 'code', at: 1 }, selected: 'code' },
  { name: 'a table heading', spot: { word: 'head', at: 1 }, selected: 'head' },
  { name: 'a table cell', spot: { word: 'second', at: 2 }, selected: 'second' },
];

for (const word of words) {
  test(`a double click on a word in ${word.name} selects the word`, async ({ app, browser }) => {
    await app.open('/blank');
    const origin = new URL(await browser.url()).origin;
    await withRawPage(origin, marked, async (raw) => {
      await clickSeries(raw, word.spot, 2);
      await raw.keyboard.press('Control+c');
      const clipboard = await raw.evaluate(() => navigator.clipboard.readText());
      expect(clipboard.trim()).toBe(word.selected);
    });
  });
}

for (const word of words) {
  test(`one double click of two presses on a word in ${word.name}, with the whole note drawn, selects the word`, async ({ app, browser }) => {
    await app.open('/blank');
    const origin = new URL(await browser.url()).origin;
    await withRawPage(origin, marked, async (raw) => {
      await raw.keyboard.press('Escape');
      await raw.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await doubleClick(raw, word.spot);
      await raw.keyboard.press('Control+c');
      const clipboard = await raw.evaluate(() => navigator.clipboard.readText());
      expect(clipboard.trim()).toBe(word.selected);
    });
  });
}

const lines: { name: string; spot: Spot; selected: string }[] = [
  { name: 'a paragraph', spot: { word: 'words', at: 1 }, selected: 'intro words' },
  { name: 'a heading', spot: { word: 'title', at: 2 }, selected: '# Big title here' },
  { name: 'a list item', spot: { word: 'item', at: 1 }, selected: '- list item words' },
  { name: 'a quote', spot: { word: 'quoted', at: 2 }, selected: '> quoted words here' },
  { name: 'a line of code', spot: { word: 'code', at: 1 }, selected: 'code words' },
  { name: 'a table row', spot: { word: 'second', at: 2 }, selected: '| first | second |' },
];

for (const line of lines) {
  test(`a triple click on ${line.name} selects its line`, async ({ app, browser }) => {
    await app.open('/blank');
    const origin = new URL(await browser.url()).origin;
    await withRawPage(origin, marked, async (raw) => {
      await clickSeries(raw, line.spot, 3);
      await raw.keyboard.press('Control+c');
      const clipboard = await raw.evaluate(() => navigator.clipboard.readText());
      expect(clipboard.replace(/\n$/, '')).toBe(line.selected);
    });
  });
}

test('a double click inside the open block selects the word, and typing replaces it', async ({ app, browser }) => {
  await app.open('/blank');
  const origin = new URL(await browser.url()).origin;
  await withRawPage(origin, note, async (raw) => {
    await clickSeries(raw, { word: 'alpha', at: 2 }, 2);
    await raw.keyboard.type('X');
    await raw.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    expect(await raw.getByLabel('Note text').inputValue()).toBe('X one');
  });
});
