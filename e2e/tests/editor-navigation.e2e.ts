import { expect } from 'e2e';
import { ctrl, Editing, offsetOf } from './editing.ts';
import { cursorAt } from './guards.ts';
import type { Spot } from './editing.ts';
import { test } from './nullpad.ts';

/**
 * What any text editor does when the caret is moved, in the page view
 * (Markdown off): with keys, with the pointer, and when the note is longer
 * than the window. Where a plain text field holding the whole note has one
 * right answer, the page is held to it: the same keys must leave the caret in
 * the same place, which is seen by typing a letter there.
 */

const note = 'alpha one\n\nbravo two words\n\ncharlie three';

function likeAPlainField(name: string, body: string, at: Spot, keys: string[]) {
  test(name, async (fixtures) => {
    const editor = new Editing(fixtures);
    await editor.seed(body);
    const expected = await editor.plainField(body, offsetOf(body, at), keys, 'X');
    await editor.show(body);
    await editor.click(at);
    await editor.press(...keys);
    await editor.type('X');

    await editor.expectNote(expected);
  });
}

const endOfOne: Spot = { word: 'one', at: 3 };
const startOfBravo: Spot = { word: 'bravo', at: 0 };
const midTwo: Spot = { word: 'two', at: 1 };
const midThree: Spot = { word: 'three', at: 2 };
const midAlpha: Spot = { word: 'alpha', at: 2 };

const repeat = (key: string, times: number) => Array<string>(times).fill(key);

likeAPlainField('Home goes to the start of the row', note, midTwo, ['Home']);
likeAPlainField('End goes to the end of the row', note, midTwo, ['End']);
likeAPlainField('End and then Home go back to the start of the row', note, midTwo, ['End', 'Home']);
likeAPlainField('Home at the start of a row stays there', note, startOfBravo, ['Home']);
likeAPlainField('End at the end of a row stays there', note, endOfOne, ['End']);
likeAPlainField('Ctrl+Home goes to the start of the note from the last block', note, midThree, [ctrl('Home')]);
likeAPlainField('Ctrl+End goes to the end of the note from the first block', note, midAlpha, [ctrl('End')]);

likeAPlainField('Ctrl+Right moves by a word', note, midAlpha, [ctrl('ArrowRight')]);
likeAPlainField('Ctrl+Right twice moves by two words', note, midAlpha, repeat(ctrl('ArrowRight'), 2));
likeAPlainField('Ctrl+Right moves from the end of a block into the next', note, endOfOne, [ctrl('ArrowRight')]);
likeAPlainField('Ctrl+Right three times from the end of a block', note, endOfOne, repeat(ctrl('ArrowRight'), 3));
likeAPlainField('Ctrl+Right six times from the first block moves as it does in a plain field', note, midAlpha, repeat(ctrl('ArrowRight'), 6));
likeAPlainField('Ctrl+Left moves by a word', note, midThree, [ctrl('ArrowLeft')]);
likeAPlainField('Ctrl+Left twice moves by two words', note, midThree, repeat(ctrl('ArrowLeft'), 2));
likeAPlainField('Ctrl+Left at the start of a block moves as it does in a plain field', note, startOfBravo, [ctrl('ArrowLeft')]);
likeAPlainField('Ctrl+Left three times at the start of a block moves as it does in a plain field', note, startOfBravo, repeat(ctrl('ArrowLeft'), 3));
likeAPlainField('Ctrl+Left six times from the last block moves as it does in a plain field', note, midThree, repeat(ctrl('ArrowLeft'), 6));

likeAPlainField('ArrowRight at the end of a block goes to the blank row below it', note, endOfOne, ['ArrowRight']);
likeAPlainField('ArrowRight twice at the end of a block goes to the start of the next', note, endOfOne, repeat('ArrowRight', 2));
likeAPlainField('ArrowRight three times at the end of a block goes one letter into the next', note, endOfOne, repeat('ArrowRight', 3));
likeAPlainField('ArrowLeft at the start of a block goes to the blank row above it', note, startOfBravo, ['ArrowLeft']);
likeAPlainField('ArrowLeft twice at the start of a block goes to the end of the block above', note, startOfBravo, repeat('ArrowLeft', 2));
likeAPlainField('ArrowLeft at the very start of the note stays there', note, { word: 'alpha', at: 0 }, ['ArrowLeft']);
likeAPlainField('ArrowRight at the very end of the note stays there', note, { word: 'three', at: 5 }, ['ArrowRight']);

likeAPlainField('ArrowDown on the last row goes to the end of the note', note, midThree, ['ArrowDown']);
likeAPlainField('ArrowUp on the first row goes to the start of the note', note, midAlpha, ['ArrowUp']);

likeAPlainField('Shift+Home selects to the start of the row', note, midTwo, ['Shift+Home']);
likeAPlainField('Shift+End selects to the end of the row', note, midTwo, ['Shift+End']);
likeAPlainField('Shift+Ctrl+Right selects a word', note, midAlpha, [ctrl('Shift+ArrowRight')]);
likeAPlainField('Shift+Ctrl+Right three times selects into the next block', note, midAlpha, repeat(ctrl('Shift+ArrowRight'), 3));
likeAPlainField('Shift+Ctrl+Left three times selects into the block above', note, midThree, repeat(ctrl('Shift+ArrowLeft'), 3));
likeAPlainField('Shift+Ctrl+End selects to the end of the note', note, midTwo, [ctrl('Shift+End')]);
likeAPlainField('Shift+Ctrl+Home selects to the start of the note', note, midTwo, [ctrl('Shift+Home')]);
likeAPlainField('Shift+Left then Shift+Right selects nothing', note, endOfOne, ['Shift+ArrowLeft', 'Shift+ArrowRight']);
likeAPlainField('an arrow after a selection drops it and moves from its edge', note, midTwo, ['Shift+End', 'ArrowLeft']);

const columns = 'xxxxa tail of the row\n\nxxxxb tail of the row\n\nxxxxc tail of the row';

test('ArrowDown through a blank row keeps the column', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(columns);
  await editor.click({ word: 'xxxxa', at: 4 });
  const start = await editor.caret(columns);
  expect(start).toMatchObject({ row: 0, col: 4 });

  await editor.press('ArrowDown');
  expect(await editor.caret(columns)).toMatchObject({ row: 1, col: 0 });
  await editor.press('ArrowDown');
  const landed = await editor.caret(columns);
  expect(landed.row).toBe(2);
  expect(landed.col).toBeGreaterThanOrEqual(3);
  expect(landed.col).toBeLessThanOrEqual(5);
});

test('ArrowUp through a blank row keeps the column', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(columns);
  await editor.click({ word: 'xxxxc', at: 4 });
  expect(await editor.caret(columns)).toMatchObject({ row: 4, col: 4 });

  await editor.press('ArrowUp');
  expect(await editor.caret(columns)).toMatchObject({ row: 3, col: 0 });
  await editor.press('ArrowUp');
  const landed = await editor.caret(columns);
  expect(landed.row).toBe(2);
  expect(landed.col).toBeGreaterThanOrEqual(3);
  expect(landed.col).toBeLessThanOrEqual(5);
});

test('ArrowDown from the end of a long row lands at the end of a shorter block', async (fixtures) => {
  const body = 'a long first row of the note\n\nshort';
  const editor = new Editing(fixtures);
  await editor.open(body);
  await editor.click({ word: 'note', at: 4 });
  await editor.press('ArrowDown', 'ArrowDown');

  expect(await editor.caret(body)).toMatchObject({ row: 2, col: 5 });
});

test('ArrowDown keeps the column of keys pressed after an ArrowUp the page has not drawn yet', async (fixtures) => {
  const body = '# Title\n\nlong row of xxxxxxxxxxxxxxxxxxxxxxxx';
  const typed = body.replace('Title', 'TitleY');
  const landing = async (held: boolean) => {
    const editor = new Editing(fixtures);
    await editor.open(body);
    await editor.click({ word: 'long', at: 1 });
    const press = async () => {
      for (const key of ['ArrowUp', 'ArrowUp', 'End']) await fixtures.browser.keyboard.press(key);
      await fixtures.browser.keyboard.type('Y');
    };
    if (held) await fixtures.page.beforeRedraw(press);
    else {
      await editor.press('ArrowUp', 'ArrowUp', 'End');
      await editor.type('Y');
    }
    await editor.press('ArrowDown', 'ArrowDown');
    return editor.caret(typed);
  };
  const slow = await landing(false);
  expect(slow.col).toBeGreaterThan(10);
  expect(await landing(true)).toEqual(slow);
});

test('ArrowDown from the start of a row lands at the start of the row below', async (fixtures) => {
  const items = '- xxxxa first\n- xxxxb second\n- xxxxc third';
  const editor = new Editing(fixtures);
  await editor.open(items);
  await editor.click({ word: 'xxxxa', at: 4 });
  const before = await editor.caret(items);
  await editor.press('ArrowDown');

  const after = await editor.caret(items);
  expect(after.row).toBe(1);
  expect(Math.abs(after.col - before.col)).toBeLessThanOrEqual(1);
});

const everyBlock = [
  '# Title',
  '',
  'para one',
  '',
  '- a',
  '- b',
  '',
  '> quote',
  '',
  '```',
  'code',
  '```',
  '',
  '| a | b |',
  '|-|-|',
  '| 1 | 2 |',
  '',
  '---',
  '',
  'last',
].join('\n');
const everyRow = everyBlock.split('\n').length;

test('ArrowDown moves the caret one row at a time through every kind of block', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(everyBlock);
  const rows: number[] = [];
  for (let row = 1; row < everyRow; row++) {
    await editor.press('ArrowDown');
    rows.push((await editor.caret(everyBlock)).row);
  }

  expect(rows).toEqual(Array.from({ length: everyRow - 1 }, (_, index) => index + 1));
});

test('ArrowUp moves the caret one row at a time back through every kind of block', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(everyBlock);
  await editor.press(...repeat('ArrowDown', everyRow - 1));
  expect(await editor.caret(everyBlock), 'the caret at the end of the note').toMatchObject({ row: everyRow - 1 });
  const rows: number[] = [];
  for (let row = everyRow - 1; row > 0; row--) {
    await editor.press('ArrowUp');
    rows.push((await editor.caret(everyBlock)).row);
  }

  expect(rows).toEqual(Array.from({ length: everyRow - 1 }, (_, index) => everyRow - 2 - index));
});

test('a click to the right of a short row puts the caret at its end', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  const row = await editor.rowBox('bravo');
  await editor.clickAt(row.right + 150, (row.top + row.bottom) / 2);
  await editor.type('X');

  await editor.expectNote('alpha one\n\nbravo two wordsX\n\ncharlie three');
});

test('a click in the margin to the left of a row puts the caret at its start', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  const row = await editor.rowBox('bravo');
  await editor.clickAt(row.left - 40, (row.top + row.bottom) / 2);
  await editor.type('X');

  await editor.expectNote('alpha one\n\nXbravo two words\n\ncharlie three');
});

test('a click on the page below the last row puts the caret at the end of the note', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  const row = await editor.rowBox('charlie');
  await editor.clickAt(row.left + 20, row.bottom + 150);
  await editor.type('X');

  await editor.expectNote('alpha one\n\nbravo two words\n\ncharlie threeX');
});

test('a click on the blank row between two blocks puts the caret on it', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  const row = await editor.rowBox('alpha');
  await editor.clickAt(row.left + 20, row.bottom + 13);
  await editor.type('X');

  await editor.expectNote('alpha one\nX\nbravo two words\n\ncharlie three');
});

const long = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n\n');
const endOfLong: Spot = { word: 'line 40', at: 7 };

async function openAtTheEnd(editor: Editing) {
  await editor.open(long);
  await editor.scrollToEnd();
  await editor.click(endOfLong);
}

test('Ctrl+End goes to the end of a note longer than the window and scrolls the caret into view', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(long);
  await editor.press(ctrl('End'));
  await editor.type('X');

  expect.soft(await editor.cursorInView(), 'the cursor is in view').toBe(true);
  await editor.expectNote(`${long}X`);
});

test('ArrowDown through a note longer than the window keeps the caret in view', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(long);
  const lost: number[] = [];
  for (let press = 1; press <= 60; press++) {
    await editor.press('ArrowDown');
    if (!(await editor.cursorInView())) lost.push(press);
  }

  expect(lost, 'presses after which the cursor is out of view').toEqual([]);
});

test('ArrowUp from the end of a note longer than the window keeps the caret in view', async (fixtures) => {
  const editor = new Editing(fixtures);
  await openAtTheEnd(editor);
  const lost: number[] = [];
  for (let press = 1; press <= 60; press++) {
    await editor.press('ArrowUp');
    if (!(await editor.cursorInView())) lost.push(press);
  }

  expect(lost, 'presses after which the cursor is out of view').toEqual([]);
});

test('Enter at the end of a note longer than the window keeps the caret in view', async (fixtures) => {
  const editor = new Editing(fixtures);
  await openAtTheEnd(editor);
  const lost: number[] = [];
  for (let press = 1; press <= 25; press++) {
    await editor.press('Enter');
    if (!(await editor.cursorInView())) lost.push(press);
  }

  expect(lost, 'presses after which the cursor is out of view').toEqual([]);
});

test('typing a long paragraph at the end of a long note keeps the caret in view', async (fixtures) => {
  const editor = new Editing(fixtures);
  await openAtTheEnd(editor);
  await editor.type(` ${'more words '.repeat(60)}`);

  expect(await editor.cursorInView(), 'the cursor is in view').toBe(true);
});

test('Ctrl+Home scrolls back to the start of the note', async (fixtures) => {
  const editor = new Editing(fixtures);
  await openAtTheEnd(editor);
  await editor.press(ctrl('Home'));

  await expect.poll(() => fixtures.page.scrolled(), { message: 'how far the page is scrolled' }).toBe(0);
  expect(await editor.caret(long)).toMatchObject({ row: 0, col: 0 });
});

test('PageDown moves the caret down by about a window', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(long);
  await editor.press('PageDown');

  const caret = await editor.caret(long);
  expect(caret.row, 'the row the caret is on after PageDown').toBeGreaterThan(10);
  expect(await editor.cursorInView(), 'the cursor is in view').toBe(true);
});

test('PageUp moves the caret up by about a window', async (fixtures) => {
  const editor = new Editing(fixtures);
  await openAtTheEnd(editor);
  await editor.press('PageUp');

  const caret = await editor.caret(long);
  expect(caret.row, 'the row the caret is on after PageUp').toBeLessThan(long.split('\n').length - 10);
  expect(await editor.cursorInView(), 'the cursor is in view').toBe(true);
});

test('a block the caret reaches with the keys is where the caret is when typed into', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.press('ArrowDown', 'ArrowDown');
  await editor.type('X');

  await editor.expectNote('alpha one\n\nXbravo two words\n\ncharlie three');
  await expect(fixtures.page.text).toBeFocused();
});

/**
 * A run of Up and Down keeps the place across the page that it started from,
 * as a plain text field keeps the caret's x: through rows too short to reach
 * it, wrapped rows and rows of other kinds, until another key or a click moves
 * the caret. The page draws proportional type, so the plain field it is held to
 * is set as the page sets a paragraph (`pageField`), and holds the markdown, as
 * the text field shows the rows it holds.
 */
function keepsTheColumn(name: string, body: string, at: Spot, keys: string[]) {
  test(name, async (fixtures) => {
    const editor = new Editing(fixtures);
    await editor.open(body);
    const expected = await editor.pageField(body, offsetOf(body, at), keys, 'X');
    await editor.click(at);
    await editor.press(...keys);
    await editor.type('X');

    await editor.expectSaved(expected);
  });
}

/** Where a plain text field holding the markdown in monospace type agrees with the page: the start of a row, and type that is monospace on the page too. */
function keepsTheColumnOfAPlainField(name: string, body: string, at: Spot, keys: string[]) {
  test(name, async (fixtures) => {
    const editor = new Editing(fixtures);
    await editor.seed(body);
    const expected = await editor.plainField(body, offsetOf(body, at), keys, 'X');
    await editor.show(body);
    await editor.click(at);
    await editor.press(...keys);
    await editor.type('X');

    await editor.expectSaved(expected);
  });
}

const shortMiddle = 'xxxxxxxxxxxxxxxa\nxb\n\nxxxxxxxxxxxxxxxc\n\nxd\n\nxxxxxxxxxxxxxxxe';
keepsTheColumn('ArrowDown three times keeps the column through a short last row of a block and a blank row', shortMiddle, { word: 'xxxxxxxxxxxxxxxa', at: 10 }, repeat('ArrowDown', 3));
keepsTheColumn('ArrowDown six times keeps the column through short rows and blank rows', shortMiddle, { word: 'xxxxxxxxxxxxxxxa', at: 10 }, repeat('ArrowDown', 6));
keepsTheColumn('ArrowUp six times keeps the column through short rows and blank rows', shortMiddle, { word: 'xxxxxxxxxxxxxxxe', at: 12 }, repeat('ArrowUp', 6));
keepsTheColumn('ArrowDown and back up keeps the column through a short row', shortMiddle, { word: 'xxxxxxxxxxxxxxxa', at: 10 }, [...repeat('ArrowDown', 4), ...repeat('ArrowUp', 4)]);

const wrapped = `xxxxxxxxxxxa\n\n${'xxxxx '.repeat(70)}xb\n\nxxxxxxxxxxxc`;
keepsTheColumn('ArrowDown keeps the column on every line of a row the page wraps', wrapped, { word: 'xxxxxxxxxxxa', at: 7 }, repeat('ArrowDown', 7));
keepsTheColumn('ArrowUp keeps the column on every line of a row the page wraps', wrapped, { word: 'xxxxxxxxxxxc', at: 7 }, repeat('ArrowUp', 7));

const marked = 'xx **xx** [xx](http://example.com) xxxxxxxxxxxxxa\n\nxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxb\n\nxx **xx** [xx](http://example.com) xxxxxxxxxxxxxc';
keepsTheColumn('ArrowDown keeps the column of the markdown the field shows, with hidden marks to the left of the caret', marked, { word: 'xxxxxxxxxxxxxa', at: 6 }, repeat('ArrowDown', 4));
keepsTheColumn('ArrowDown and back up with hidden marks to the left of the caret comes back to where it started', marked, { word: 'xxxxxxxxxxxxxa', at: 6 }, [...repeat('ArrowDown', 2), ...repeat('ArrowUp', 2)]);
keepsTheColumn('Shift+ArrowDown and Shift+ArrowUp across blocks, with hidden marks to the left, select nothing in the end', marked, { word: 'xxxxxxxxxxxxxa', at: 6 }, ['Shift+ArrowDown', 'Shift+ArrowUp']);
keepsTheColumn('Shift+ArrowDown twice and Shift+ArrowUp twice across blocks, with hidden marks to the left, select nothing in the end', marked, { word: 'xxxxxxxxxxxxxa', at: 6 }, [...repeat('Shift+ArrowDown', 2), ...repeat('Shift+ArrowUp', 2)]);

const columnsOfX = 'xxxxxxxxxa\n\nxxxxxxxxxb\n\nxxxxxc';
keepsTheColumn('Ctrl+Home and arrows across a row end a run: ArrowUp takes the column the caret is at', columnsOfX, { word: 'xxxxxxxxxa', at: 0 }, [...repeat('ArrowRight', 6), 'ArrowDown', ctrl('Home'), ...repeat('ArrowRight', 11), 'ArrowUp']);
keepsTheColumn('Ctrl+Home and arrows across a row end a run: ArrowDown takes the column the caret is at', columnsOfX, { word: 'xxxxxxxxxa', at: 0 }, [...repeat('ArrowRight', 6), 'ArrowDown', ctrl('Home'), ...repeat('ArrowRight', 11), 'ArrowDown']);
keepsTheColumn('ArrowLeft ends a run: ArrowDown takes the column the caret is at', columnsOfX, { word: 'xxxxxxxxxa', at: 8 }, ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowDown']);
keepsTheColumn('ArrowUp after Shift+ArrowDown onto a short row keeps the column the selection started at', columnsOfX, { word: 'xxxxxxxxxa', at: 5 }, ['Shift+ArrowDown', 'ArrowUp']);
keepsTheColumn('ArrowDown after Shift+ArrowDown keeps the column through a blank row', columnsOfX, { word: 'xxxxxxxxxa', at: 5 }, ['Shift+ArrowDown', 'ArrowDown']);

const rowsOfOneBlock = 'xxxxxxa\nxxb\nxxxxxxc';
keepsTheColumn('Ctrl+ArrowUp twice keeps the column through a short row', rowsOfOneBlock, { word: 'xxxxxxc', at: 6 }, repeat(ctrl('ArrowUp'), 2));
keepsTheColumn('Ctrl+ArrowDown twice keeps the column through a short row', rowsOfOneBlock, { word: 'xxxxxxa', at: 6 }, repeat(ctrl('ArrowDown'), 2));
keepsTheColumn('Ctrl+ArrowUp keeps the column through short rows of other blocks', columnsOfX.split('\n').reverse().join('\n'), { word: 'xxxxxxxxxa', at: 8 }, repeat(ctrl('ArrowUp'), 4));
keepsTheColumn('ArrowUp after Ctrl+ArrowUp keeps the same column', 'xxxxxxxxxa\nxb\nxxxxxxxxxc\nxxxxxxxxxd', { word: 'xxxxxxxxxd', at: 8 }, [ctrl('ArrowUp'), ctrl('ArrowUp'), 'ArrowUp']);

keepsTheColumn('ArrowDown keeps the column through the rows of a quote and out of it', 'xxxxxxxxxxa\n\n> xxxxxxxxb\n> xc\n> xxxxxxxxd\n\nxxxxxxxxxxe', { word: 'xxxxxxxxxxa', at: 8 }, repeat('ArrowDown', 6));
keepsTheColumn('ArrowDown keeps the column through list items with short ones between', '- xxxxxxxxxxa\n- xb\n- xxxxxxxxxxc\n- xd\n- xxxxxxxxxxe', { word: 'xxxxxxxxxxa', at: 8 }, repeat('ArrowDown', 4));
keepsTheColumnOfAPlainField('ArrowDown keeps the column through the short rows of a code block', '```\nxxxxxxxxxxa\nxb\n\nxxxxxxxxxxc\n```', { word: 'xxxxxxxxxxa', at: 8 }, repeat('ArrowDown', 3));
keepsTheColumnOfAPlainField('ArrowDown keeps the column through the rows of a table', '| xxxxxxxxa | xxxxxxxxxxb |\n| - | - |\n| xc | xd |\n| xxxxxxxxe | xxxxxxxxxxf |', { word: 'xxxxxxxxxxb', at: 8 }, repeat('ArrowDown', 3));

/** The start of a row is the same column on every row, before the marks the page hides, as in a plain field holding the markdown. */
const fromTheStart: [string, string, Spot, string[]][] = [
  ['ArrowUp twice from the start of a list item lands at the start of a heading, before its marks', '# alpha\n\n- one', { word: 'one', at: 0 }, ['Home', 'ArrowUp', 'ArrowUp']],
  ['ArrowUp twice from the start of a list item lands at the start of a quote, before its marks', '> alpha\n\n- one', { word: 'one', at: 0 }, ['Home', 'ArrowUp', 'ArrowUp']],
  ['ArrowUp twice from the start of a list item lands at the start of a paragraph', 'aaaa\n\n- bbbb', { word: 'bbbb', at: 0 }, ['Home', 'ArrowUp', 'ArrowUp']],
  ['ArrowDown twice from the start of a list item lands at the start of a heading, before its marks', '- one\n\n# alpha', { word: 'one', at: 0 }, ['Home', 'ArrowDown', 'ArrowDown']],
  ['ArrowDown four times from the start of a paragraph lands at the start of a table, before its marks', 'aaaa\n\n| b | c |\n| - | - |\n| d | e |', { word: 'aaaa', at: 0 }, repeat('ArrowDown', 4)],
  ['ArrowUp from the start of a quote row lands at the start of the quote row above', '> alpha\n> bravo', { word: 'bravo', at: 0 }, ['Home', 'ArrowUp']],
];
for (const [name, body, at, keys] of fromTheStart) keepsTheColumnOfAPlainField(name, body, at, keys);

test('PageUp from the start of a list item lands at the start of a row, before its marks', async (fixtures) => {
  const body = Array.from({ length: 30 }, (_, index) => `# head ${index}\n\n- item ${index}`).join('\n\n');
  const editor = new Editing(fixtures);
  await editor.open(body);
  await editor.scrollToEnd();
  await editor.click({ word: 'item 29', at: 0 });
  await editor.press('Home', 'PageUp');

  const caret = await editor.caret(body);
  expect(caret.row, 'the row PageUp went to').toBeLessThan(body.split('\n').length - 5);
  expect(caret.col, 'the column PageUp went to').toBe(0);
});

test('ArrowUp into a heading lands straight above the caret, where the heading draws its bigger letters, not at the same count of letters', async (fixtures) => {
  const body = '# xxxxxxxxxxxxxxxxxxxxa\n\nxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxb';
  const editor = new Editing(fixtures);
  await editor.open(body);
  await editor.click({ word: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxb', at: 24 });
  const before = (await cursorAt(fixtures.browser))!.x;
  await editor.press('ArrowUp', 'ArrowUp');

  const caret = await editor.caret(body);
  expect(caret.row, 'the row the caret went to').toBe(0);
  expect(caret.col, 'the column, in the heading\'s text').toBeGreaterThan(2);
  expect(caret.col, 'the column, short of the same count of letters').toBeLessThan(20);
  await expect.poll(async () => Math.abs((await cursorAt(fixtures.browser))!.x - before), { message: 'how far across the caret moved' }).toBeLessThanOrEqual(12);
});
