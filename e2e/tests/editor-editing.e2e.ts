import { expect } from 'e2e';
import { ctrl, Editing, offsetOf } from './editing.ts';
import type { Spot } from './editing.ts';
import { test } from './nullpad.ts';

/**
 * What any text editor does when text is typed, split, joined, pasted and
 * undone, in the page view (Markdown off). Where a plain text field holding
 * the whole note has one right answer, the page is held to it: the same keys
 * must leave the same text.
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
const startOfCharlie: Spot = { word: 'charlie', at: 0 };
const endOfCharlie: Spot = { word: 'three', at: 5 };
const startOfAlpha: Spot = { word: 'alpha', at: 0 };

likeAPlainField('typing at the start of a block puts the text there', note, startOfBravo, []);
likeAPlainField('typing in the middle of a word puts the text there', note, midTwo, []);
likeAPlainField('typing at the end of the last block puts the text there', note, endOfCharlie, []);
likeAPlainField('typing on the blank row between two blocks starts a block there', note, endOfOne, ['ArrowDown']);

likeAPlainField('Enter in the middle of a block splits it', note, midTwo, ['Enter']);
likeAPlainField('Enter at the end of a block starts a row below it', note, endOfOne, ['Enter']);
likeAPlainField('Enter at the start of a block pushes it down', note, startOfBravo, ['Enter']);
likeAPlainField('Enter twice makes a blank row', note, midTwo, ['Enter', 'Enter']);
likeAPlainField('Enter on the blank row between blocks makes another', note, endOfOne, ['ArrowDown', 'Enter']);
likeAPlainField('Enter at the very end of the note starts a row', note, endOfCharlie, ['Enter']);

likeAPlainField('Backspace in the middle of a word deletes the letter before the caret', note, midTwo, ['Backspace']);
likeAPlainField('Backspace at the start of a block joins it to the blank row above', note, startOfBravo, ['Backspace']);
likeAPlainField('Backspace twice at the start of a block joins it to the block above', note, startOfBravo, ['Backspace', 'Backspace']);
likeAPlainField('Backspace three times at the start of a block eats a letter of the block above', note, startOfBravo, ['Backspace', 'Backspace', 'Backspace']);
likeAPlainField('Backspace at the very start of the note does nothing', note, startOfAlpha, ['Backspace']);
likeAPlainField('Backspace at the start of a block that has one blank row above it', 'alpha\n\nbravo', { word: 'bravo', at: 0 }, ['Backspace', 'Backspace']);

likeAPlainField('Delete in the middle of a word deletes the letter after the caret', note, midTwo, ['Delete']);
likeAPlainField('Delete at the end of a block joins it to the blank row below', note, endOfOne, ['Delete']);
likeAPlainField('Delete twice at the end of a block joins it to the block below', note, endOfOne, ['Delete', 'Delete']);
likeAPlainField('Delete three times at the end of a block eats a letter of the block below', note, endOfOne, ['Delete', 'Delete', 'Delete']);
likeAPlainField('Delete at the very end of the note does nothing', note, endOfCharlie, ['Delete']);

likeAPlainField('Ctrl+Backspace in the middle of a word deletes back to its start', note, midTwo, [ctrl('Backspace')]);
likeAPlainField('Ctrl+Backspace at the start of a block deletes back into the block above', note, startOfBravo, [ctrl('Backspace')]);
likeAPlainField('Ctrl+Backspace twice at the start of a block', note, startOfBravo, [ctrl('Backspace'), ctrl('Backspace')]);
likeAPlainField('Ctrl+Delete in the middle of a word deletes to its end', note, midTwo, [ctrl('Delete')]);
likeAPlainField('Ctrl+Delete at the end of a block deletes into the block below', note, endOfOne, [ctrl('Delete')]);
likeAPlainField('Ctrl+Delete twice at the end of a block', note, endOfOne, [ctrl('Delete'), ctrl('Delete')]);

likeAPlainField('Backspace deletes a selection made with Shift+Arrow inside a block', note, startOfBravo, [
  'Shift+ArrowRight',
  'Shift+ArrowRight',
  'Shift+ArrowRight',
  'Backspace',
]);
likeAPlainField('typing replaces a selection made with Shift+End', note, midTwo, ['Shift+End']);
likeAPlainField('Enter replaces a selection made with Shift+Home', note, midTwo, ['Shift+Home', 'Enter']);

test('a long typed note comes out as typed, row by row', async (fixtures) => {
  const editor = new Editing(fixtures);
  const typed = 'first row\nsecond row\n\nnew block here\nand its second row\n\n\nlast block after two blank rows';
  await editor.open('');
  await editor.write(typed);

  await editor.expectNote(typed);
  await editor.expectSaved(typed);
});

test('Enter then Backspace leaves the note as it was', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click(midTwo);
  await editor.press('Enter', 'Backspace');

  await editor.expectNote(note);
});

test('a note typed and saved comes back the same after a reload', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open('');
  await editor.write('one\n\ntwo words\nthree');
  await editor.expectSaved('one\n\ntwo words\nthree');
  await fixtures.browser.reload();
  await expect(fixtures.page.rows).toHaveCount(1);
  await editor.expectNote('one\n\ntwo words\nthree');
});

const pasted = '# Pasted title\n\nSome *text* here.\n\n- one\n- two\n\n| a | b |\n|-|-|\n| 1 | 2 |';

test('pasting several lines of markdown into an empty note keeps them and draws them', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open('');
  await editor.fillClipboard(pasted);
  await editor.press(ctrl('v'));

  await editor.expectSaved(pasted);
  await fixtures.page.stopEditing();
  await expect(fixtures.page.inPreview('h1')).toHaveText('Pasted title');
  await expect(fixtures.page.paragraphs).toHaveText(['Some text here.']);
  await expect(fixtures.page.items).toHaveText(['one', 'two']);
  await expect(fixtures.page.tables).toHaveCount(1);
});

test('pasting lines in the middle of a row splits it, and the caret ends after the paste', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click({ word: 'one', at: 0 });
  await editor.fillClipboard('X\nY');
  await editor.press(ctrl('v'));
  await editor.type('Z');

  await editor.expectNote('alpha X\nYZone\n\nbravo two words\n\ncharlie three');
});

test('pasting over a selection replaces it', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click(startOfBravo);
  await editor.press(...Array<string>(5).fill('Shift+ArrowRight'));
  await editor.fillClipboard('N\nM');
  await editor.press(ctrl('v'));

  await editor.expectNote('alpha one\n\nN\nM two words\n\ncharlie three');
});

test('pasting paragraphs on the blank row between two blocks makes them blocks of their own', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click(endOfOne);
  await editor.press('ArrowDown');
  await editor.fillClipboard('new para\n\nanother');
  await editor.press(ctrl('v'));

  await editor.expectNote('alpha one\nnew para\n\nanother\nbravo two words\n\ncharlie three');
  await expect(fixtures.page.text).toBeFocused();
});

test('pasting text with Windows line breaks leaves no stray carriage returns', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open('');
  await editor.fillClipboard('a\r\nb\r\n');
  await editor.press(ctrl('v'));

  await editor.expectSaved('a\nb\n');
});

test('pasting a line with a trailing break at the end of the note puts the caret on the row below', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click(endOfCharlie);
  await editor.fillClipboard(' tail\n');
  await editor.press(ctrl('v'));
  await editor.type('Z');

  await editor.expectNote('alpha one\n\nbravo two words\n\ncharlie three tail\nZ');
});

test('pasting a heading and a list, then leaving the field, draws both', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click(endOfCharlie);
  await editor.fillClipboard('\n\n## Pasted\n\n1. first\n2. second');
  await editor.press(ctrl('v'));
  await fixtures.page.stopEditing();

  await expect(fixtures.page.inPreview('h2')).toHaveText('Pasted');
  await expect(fixtures.page.items).toHaveText(['first', 'second']);
});

test('a paste that leaves the field is saved', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click(startOfBravo);
  await editor.fillClipboard('before ');
  await editor.press(ctrl('v'));

  await editor.expectSaved('alpha one\n\nbefore bravo two words\n\ncharlie three');
});

const redoKeys = [
  { name: 'Ctrl+Shift+Z', key: ctrl('Shift+z') },
  { name: 'Ctrl+Y', key: ctrl('y') },
];

for (const redo of redoKeys) {
  test(`${redo.name} redoes what Ctrl+Z undid in a block`, async (fixtures) => {
    const editor = new Editing(fixtures);
    await editor.open(note);
    await editor.click(endOfOne);
    const states = new Set([note]);
    for (const key of [' ', 'a', 'b']) {
      await editor.type(key);
      states.add(await editor.shown());
    }
    const typed = await editor.shown();
    expect(typed).toBe('alpha one ab\n\nbravo two words\n\ncharlie three');

    await editor.press(ctrl('z'));
    const undone = await editor.shown();
    expect.soft(undone, 'Ctrl+Z changes the text').not.toBe(typed);
    expect.soft(states.has(undone), `Ctrl+Z gives ${JSON.stringify(undone)}, which was never the text`).toBe(true);

    await editor.press(redo.key);
    await editor.expectNote(typed);
    await editor.expectSaved(typed);
  });

  test(`${redo.name} after typing a letter, a line break and a letter gives the text back exactly`, async (fixtures) => {
    const editor = new Editing(fixtures);
    await editor.open('');
    const states = new Set(['']);
    await editor.type('x');
    states.add(await editor.shown());
    await editor.press('Enter');
    states.add(await editor.shown());
    await editor.type('y');
    const typed = await editor.shown();
    expect(typed).toBe('x\ny');

    await editor.press(ctrl('z'));
    const undone = await editor.shown();
    expect.soft(undone, 'Ctrl+Z changes the text').not.toBe(typed);
    expect.soft(states.has(undone), `Ctrl+Z gives ${JSON.stringify(undone)}, which was never the text`).toBe(true);

    await editor.press(redo.key);
    await editor.expectNote(typed);
  });

  test(`${redo.name} redoes an edit in each of two blocks, last edit first`, async (fixtures) => {
    const editor = new Editing(fixtures);
    await editor.open('alpha one\n\nbravo two');
    await editor.click(endOfOne);
    await editor.type(' A');
    await editor.click({ word: 'two', at: 3 });
    await editor.type(' B');
    const both = await editor.shown();
    expect(both).toBe('alpha one A\n\nbravo two B');

    await editor.press(ctrl('z'));
    const first = await editor.shown();
    expect(first, 'the edit made last is taken back first').toMatch(/^alpha one A\n\nbravo two( |)$/);
    await editor.press(...Array<string>(2).fill(ctrl('z')));
    const second = await editor.shown();
    expect(second.startsWith('alpha one'), 'the first block is still there').toBe(true);

    await editor.press(redo.key);
    await editor.press(redo.key);
    await editor.press(redo.key);
    await editor.expectNote(both);
    await editor.expectSaved(both);
  });
}

test('undoing everything gives the note as it opened, and redoing everything the note as it ended', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open('alpha one\n\nbravo two');
  const states = new Set(['alpha one\n\nbravo two']);
  await editor.click(endOfOne);
  for (const key of [' ', 'A']) {
    await editor.type(key);
    states.add(await editor.shown());
  }
  await editor.click({ word: 'two', at: 3 });
  await editor.press('Enter');
  states.add(await editor.shown());
  await editor.type('B');
  states.add(await editor.shown());
  const ended = await editor.shown();

  const seen: string[] = [];
  for (let presses = 0; presses < 12; presses++) {
    await editor.press(ctrl('z'));
    seen.push(await editor.shown());
  }
  expect(seen.filter((text) => !states.has(text)), 'text that was never the note, after Ctrl+Z').toEqual([]);
  expect(seen.at(-1), 'after Ctrl+Z as often as it takes').toBe('alpha one\n\nbravo two');

  const redone: string[] = [];
  for (let presses = 0; presses < 12; presses++) {
    await editor.press(ctrl('Shift+z'));
    redone.push(await editor.shown());
  }
  expect(redone.filter((text) => !states.has(text)), 'text that was never the note, after Ctrl+Shift+Z').toEqual([]);
  expect(redone.at(-1), 'after Ctrl+Shift+Z as often as it takes').toBe(ended);
});

test('undo takes back typing made in a block the caret has left', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click(endOfOne);
  await editor.type(' A');
  await editor.click(startOfCharlie);
  await editor.press(ctrl('z'));

  const undone = await editor.shown();
  expect.soft(undone, 'Ctrl+Z changes the text').not.toBe('alpha one A\n\nbravo two words\n\ncharlie three');
  expect(undone).toMatch(/^alpha one( |)\n\nbravo two words\n\ncharlie three$/);
});

test('undo takes back the join Backspace made, and redo makes it again', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open('alpha one\n\nbravo two');
  await editor.click(startOfBravo);
  await editor.press('Backspace');
  await editor.expectNote('alpha one\nbravo two');

  await editor.press(ctrl('z'));
  await editor.expectNote('alpha one\n\nbravo two');
  await editor.press(ctrl('Shift+z'));
  await editor.expectNote('alpha one\nbravo two');
});

test('undo takes back a split made with Enter', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click({ word: 'alpha', at: 5 });
  await editor.press('Enter');
  await editor.type('X');
  await editor.press(ctrl('z'), ctrl('z'));

  await editor.expectNote(note);
});

test('undo takes back a cut, and redo cuts again', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click(startOfBravo);
  await editor.press('Shift+End', ctrl('x'));
  await editor.expectNote('alpha one\n\n\n\ncharlie three');

  await editor.press(ctrl('z'));
  await editor.expectNote(note);
  await editor.press(ctrl('Shift+z'));
  await editor.expectNote('alpha one\n\n\n\ncharlie three');
});

test('undo takes back a paste', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click(startOfBravo);
  await editor.fillClipboard('X\nY\n\nZ');
  await editor.press(ctrl('v'));
  await editor.expectNote('alpha one\n\nX\nY\n\nZbravo two words\n\ncharlie three');

  await editor.press(ctrl('z'));
  await editor.expectNote(note);
});

test('what the page shows is what is saved after an undo and a redo', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open('alpha one\n\nbravo two');
  await editor.click(endOfOne);
  await editor.type(' A');
  await editor.press(ctrl('z'), ctrl('Shift+z'));

  expect(await editor.shown()).toBe('alpha one A\n\nbravo two');
  await editor.expectSaved('alpha one A\n\nbravo two');
});
