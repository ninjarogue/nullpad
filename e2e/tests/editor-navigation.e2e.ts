import { expect } from 'e2e';
import { ctrl, Editing, offsetOf } from './editing.ts';
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
