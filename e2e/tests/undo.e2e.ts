import { expect } from 'e2e';
import { ctrl, Editing } from './editing.ts';
import type { Fixtures, Spot } from './editing.ts';
import { test } from './nullpad.ts';

/**
 * Undo and redo. The editor keeps the history, because the browser's own is
 * lost each time the text field is written, and in the page view the field
 * is written whenever the caret moves to another block.
 */

const note = 'alpha one\n\nbravo two words\n\ncharlie three';
const endOfOne: Spot = { word: 'one', at: 3 };
const startOfBravo: Spot = { word: 'bravo', at: 0 };
const startOfCharlie: Spot = { word: 'charlie', at: 0 };

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

/**
 * What the Edit menu and the field's own menu send. Chromium undoes the field
 * itself and then reports it, and offers the command only while its own
 * history has something in it, so only the first undo after typing can come
 * from a menu.
 */
async function undoFromMenu({ browser, page }: Fixtures) {
  await browser.evaluate(() => document.execCommand('undo'));
  await page.nextFrame();
}

test('an undo from the Edit menu takes back the editor step and keeps one history', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open('alpha one\n\nbravo two');
  await editor.click(endOfOne);
  await editor.type(' A');
  await editor.click({ word: 'two', at: 3 });
  await editor.type(' B');

  await undoFromMenu(fixtures);
  await editor.expectNote('alpha one A\n\nbravo two');
  await editor.press(ctrl('z'));
  await editor.expectNote('alpha one\n\nbravo two');
  await editor.press(ctrl('Shift+z'), ctrl('Shift+z'));
  await editor.expectNote('alpha one A\n\nbravo two B');
});

test('with the whole note in the field, undo and redo step through what was typed', async ({ app, disk, page }) => {
  await disk.seed([{ key: 'edit', title: null, body: 'alpha one' }]);
  await app.open('/');
  await expect(page.text).toHaveValue('alpha one');
  await page.text.click();
  await page.text.press(ctrl('End'));
  const states = new Set(['alpha one']);
  for (const key of [' ', 'A', 'Enter', 'B']) {
    await page.text.press(key);
    states.add(await page.text.inputValue());
  }
  await expect(page.text).toHaveValue('alpha one A\nB');

  const seen: string[] = [];
  for (let presses = 0; presses < 6; presses++) {
    await page.text.press(ctrl('z'));
    seen.push(await page.text.inputValue());
  }
  expect(seen.filter((text) => !states.has(text)), 'text that was never the note, after Ctrl+Z').toEqual([]);
  await expect(page.text).toHaveValue('alpha one');

  for (let presses = 0; presses < 6; presses++) await page.text.press(ctrl('Shift+z'));
  await expect(page.text).toHaveValue('alpha one A\nB');
});

test('undo reaches back past a switch from the page to the whole note', async (fixtures) => {
  const { page } = fixtures;
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click(endOfOne);
  await editor.type(' A');
  await page.pressMarkdownShortcut();
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'true');
  await expect(page.text).toHaveValue('alpha one A\n\nbravo two words\n\ncharlie three');

  await page.text.press(ctrl('z'));
  await expect(page.text).toHaveValue(note);
  await editor.expectSaved(note);
});

test('a note opened from the list starts with nothing to undo', async ({ app, disk, page }) => {
  await disk.seed([
    { key: 'first', title: null, body: 'first note' },
    { key: 'second', title: null, body: 'second note' },
  ]);
  await app.open('/');
  await page.text.click();
  await page.text.press(ctrl('End'));
  await page.text.press('!');
  const typed = await page.text.inputValue();
  const other = typed === 'first note!' ? 'second note' : 'first note';
  await page.rows.filter({ hasText: other }).click();
  await expect(page.text).toHaveValue(other);

  await page.text.press(ctrl('z'));
  await page.nextFrame();
  await expect(page.text).toHaveValue(other);
});

test('undo puts the caret where the step began, and redo where it ended', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.click(endOfOne);
  await editor.type(' A');
  await editor.click(startOfCharlie);
  await editor.press(ctrl('z'));
  await editor.type('Y');
  await editor.expectNote('alpha oneY\n\nbravo two words\n\ncharlie three');

  await editor.press(ctrl('z'));
  await editor.click(startOfCharlie);
  await editor.press(ctrl('Shift+z'));
  await editor.type('Z');
  await editor.expectNote('alpha oneYZ\n\nbravo two words\n\ncharlie three');
});

test('a pause while typing ends an undo step, and typing without a pause is undone a word at a time', async (fixtures) => {
  const editor = new Editing(fixtures);
  await editor.open('');
  await editor.type('abc');
  await new Promise((resolve) => setTimeout(resolve, 1300));
  await editor.type('def');
  expect(await editor.shown()).toBe('abcdef');

  await editor.press(ctrl('z'));
  expect(await editor.shown(), 'Ctrl+Z takes back only what was typed after the pause').toBe('abc');
  await editor.press(ctrl('z'));
  expect(await editor.shown()).toBe('');

  await editor.type('one two');
  await editor.press(ctrl('z'));
  expect(await editor.shown(), 'without a pause a step is a word').toBe('one');
  await editor.press(ctrl('z'));
  expect(await editor.shown()).toBe('');
});

async function glide(fixtures: Fixtures, from: { x: number; y: number }, to: { x: number; y: number }, held?: string) {
  const { browser, page } = fixtures;
  await browser.mouse.move(from.x, from.y);
  await browser.mouse.down();
  if (held) await browser.keyboard.down(held);
  for (let step = 1; step <= 10; step++) {
    await browser.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
    await page.nextFrame();
  }
  await browser.mouse.up();
  if (held) await browser.keyboard.up(held);
  await page.nextFrame();
}

const inField = (fixtures: Fixtures, x: number) =>
  fixtures.browser.evaluate((x: number) => {
    const box = document.querySelector('[data-test-id="editor"]')!.getBoundingClientRect();
    return { x: box.left + x, y: box.top + 12 };
  }, x);

test('undo takes back selected text dragged onto another block in one step, and redo moves it again', async (fixtures) => {
  const editor = new Editing(fixtures);
  const start = 'alpha beta gamma\n\nsecond para here';
  const moved = ' beta gamma\n\nsecond alphapara here';
  await editor.open(start);
  await editor.press(...Array.from({ length: 5 }, () => 'Shift+ArrowRight'));
  await glide(fixtures, await inField(fixtures, 15), await fixtures.page.pointAt('para here'));
  await editor.expectSaved(moved);

  await editor.press(ctrl('z'));
  await editor.expectSaved(start);
  await editor.press(ctrl('Shift+z'));
  await editor.expectSaved(moved);
});

test('undo takes back selected text dragged along its own row in one step', async (fixtures) => {
  const editor = new Editing(fixtures);
  const start = 'alpha beta gamma\n\nsecond para here';
  await editor.open(start);
  await editor.press(...Array.from({ length: 5 }, () => 'Shift+ArrowRight'));
  const end = await editor.point({ word: 'gamma', at: 5 });
  await glide(fixtures, await inField(fixtures, 15), end);
  await expect.poll(() => editor.saved()).not.toBe(start);
  expect(await editor.saved()).toMatch(/alpha\n\nsecond para here$/);

  await editor.press(ctrl('z'));
  await editor.expectSaved(start);
});

test('undo takes back a painted selection dragged onto another block in one step, and a copy too', async (fixtures) => {
  const editor = new Editing(fixtures);
  const { page } = fixtures;
  const start = 'Alpha para one.\n\nBeta para two.\n\nDelta para.';
  await editor.open(start);
  await page.stopEditing();
  await page.drag(await page.pointAt('para one'), await page.pointAt('para two'));
  await expect.poll(() => page.painted()).toBe('para one.Beta ');
  await glide(fixtures, await page.pointAt('ra one'), await page.pointAt('para.'));
  await editor.expectSaved('Alpha para two.\n\nDelta para one.\n\nBeta para.');

  await editor.press(ctrl('z'));
  await editor.expectSaved(start);

  await page.stopEditing();
  await page.drag(await page.pointAt('para one'), await page.pointAt('para two'));
  await expect.poll(() => page.painted()).toBe('para one.Beta ');
  const copyKey = await fixtures.browser.evaluate(() => (/Mac/.test(navigator.platform) ? 'Alt' : 'Control'));
  await glide(fixtures, await page.pointAt('ra one'), await page.pointAt('para.'), copyKey);
  await editor.expectSaved('Alpha para one.\n\nBeta para two.\n\nDelta para one.\n\nBeta para.');

  await editor.press(ctrl('z'));
  await editor.expectSaved(start);
});
