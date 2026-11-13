import { expect } from 'e2e';
import { ctrl, Editing, offsetOf } from './editing.ts';
import type { Spot } from './editing.ts';
import { cursorAt, selectionOf } from './guards.ts';
import { pause, test } from './nullpad.ts';

/**
 * A checklist of every key that moves the cursor or the selection, or deletes
 * around it, pressed at the edges of every kind of block in the page view
 * (Markdown off). Each key is one row of `keys`, and each edge is one entry of
 * a place in `sheets`. Every key at every place must leave the cursor, the
 * selection and the text where the same key leaves them in a plain text field
 * holding the same markdown.
 *
 * Where only the layout decides (Up, Down, Page Up and Page Down, and their
 * Shift forms), the plain field cannot be matched to the letter, because the
 * page draws proportional fonts and hides marks, so its columns are not the
 * field's. Up and Down are held to the source row, and to the pixel the caret
 * was at, within a few pixels, or to the end of a row too short to reach it.
 * Page Up and Page Down are held to the source row alone. Both are marked in
 * `follow`. A key that lands exactly where the plain field does always passes.
 *
 * To check a new key, add a row to `keys`. A test fails for every key the
 * browser's own text field moves a caret or selection with that has no row.
 */

type Follow = 'plain field' | 'row and pixel' | 'row';

type Row = {
  key: string;
  follow?: Follow;
};

const keys: Row[] = [
  { key: 'ArrowLeft' },
  { key: 'Shift+ArrowLeft' },
  { key: 'ArrowRight' },
  { key: 'Shift+ArrowRight' },
  { key: ctrl('ArrowLeft') },
  { key: ctrl('Shift+ArrowLeft') },
  { key: ctrl('ArrowRight') },
  { key: ctrl('Shift+ArrowRight') },
  { key: 'Home' },
  { key: 'Shift+Home' },
  { key: 'End' },
  { key: 'Shift+End' },
  { key: ctrl('Home') },
  { key: ctrl('Shift+Home') },
  { key: ctrl('End') },
  { key: ctrl('Shift+End') },
  { key: 'ArrowUp', follow: 'row and pixel' },
  { key: 'Shift+ArrowUp', follow: 'row and pixel' },
  { key: ctrl('ArrowUp') },
  { key: ctrl('Shift+ArrowUp') },
  { key: 'ArrowDown', follow: 'row and pixel' },
  { key: 'Shift+ArrowDown', follow: 'row and pixel' },
  { key: ctrl('ArrowDown') },
  { key: ctrl('Shift+ArrowDown') },
  { key: 'PageUp', follow: 'row' },
  { key: 'Shift+PageUp', follow: 'row' },
  { key: 'PageDown', follow: 'row' },
  { key: 'Shift+PageDown', follow: 'row' },
  { key: ctrl('a') },
  { key: 'Backspace' },
  { key: 'Shift+Backspace' },
  { key: ctrl('Backspace') },
  { key: ctrl('Shift+Backspace') },
  { key: 'Delete' },
  { key: 'Shift+Delete' },
  { key: ctrl('Delete') },
];

/** How far, in pixels, a caret may land from where it was where only the layout decides: half a wide letter of a heading. */
const pixelSlack = 16;

/** Where the caret is put before the key: the note as opened, a blank row, or the gap before a letter of a word drawn on the page. */
type Where = 'opened' | { blank: number } | Spot;

type Place = {
  name: string;
  at: Where;
  /** The row starts with marks the page hides, so a click before its first letter may put the caret before or after them. */
  marks?: true;
};

type Sheet = {
  name: string;
  note: string;
  places: Place[];
};

const sheets: Sheet[] = [
  {
    name: 'paragraphs',
    note: ['alpha one', '', 'beta first', 'gamma middle', 'delta last', '', 'epsilon end'].join('\n'),
    places: [
      { name: 'the start of the note', at: 'opened' },
      { name: 'the end of a block of one row', at: { word: 'one', at: 3 } },
      { name: 'a blank row between blocks', at: { blank: 1 } },
      { name: 'the start of the first row of a block of three', at: { word: 'beta', at: 0 } },
      { name: 'the end of the first row of a block of three', at: { word: 'first', at: 5 } },
      { name: 'the start of the last row of a block of three', at: { word: 'delta', at: 0 } },
      { name: 'the end of the last row of a block of three', at: { word: 'last', at: 4 } },
      { name: 'the end of the note', at: { word: 'end', at: 3 } },
    ],
  },
  {
    name: 'a heading, a list and a quote',
    note: ['## Heading text', '', '- first item', '- other item', '  third row', '', '> quote text', '', 'last paragraph'].join('\n'),
    places: [
      { name: 'the start of a heading, before its hidden marks', at: 'opened' },
      { name: 'the text of a heading, after its hidden marks', at: { word: 'Heading', at: 0 }, marks: true },
      { name: 'the end of a heading', at: { word: 'Heading text', at: 12 } },
      { name: 'the start of a list item', at: { word: 'first item', at: 0 }, marks: true },
      { name: 'the end of a list item', at: { word: 'first item', at: 10 } },
      { name: 'the end of the last row of a list item of two rows', at: { word: 'third row', at: 9 } },
      { name: 'the end of a quote', at: { word: 'quote text', at: 10 } },
    ],
  },
  {
    name: 'a table and a code block',
    note: ['| name | qty |', '|------|-----|', '| apple | 3 |', '| pear | 12 |', '', '```', 'code one', 'code two', '```'].join('\n'),
    places: [
      { name: 'the start of a table', at: 'opened' },
      { name: 'a cell of the header row of a table', at: { word: 'qty', at: 3 } },
      { name: 'a cell of the first row of a table body', at: { word: 'apple', at: 2 } },
      { name: 'the last row of a table', at: { word: 'pear', at: 4 } },
      { name: 'a blank row between a table and a code block', at: { blank: 4 } },
      { name: 'the first row of a code block', at: { word: 'code one', at: 0 } },
      { name: 'the last row of a code block', at: { word: 'code two', at: 8 } },
    ],
  },
];

type Cell = [number, number];

const rowCol = (text: string, offset: number): Cell => {
  const before = text.slice(0, offset);
  return [before.split('\n').length - 1, offset - (before.lastIndexOf('\n') + 1)];
};

const offsetOfRow = (note: string, row: number) => note.split('\n').slice(0, row).reduce((sum, line) => sum + line.length + 1, 0);

function startOf(sheet: Sheet, place: Place) {
  if (place.at === 'opened') return 0;
  if ('blank' in place.at) return offsetOfRow(sheet.note, place.at.blank);
  return offsetOf(sheet.note, place.at);
}

const show = ([row, col]: Cell) => `row ${row} column ${col}`;

const describe = (anchor: Cell, head: Cell) =>
  anchor[0] === head[0] && anchor[1] === head[1] ? `the caret at ${show(head)}` : `the selection from ${show(anchor)} to ${show(head)}`;

/** Presses the pointer on the blank row, drawn or open in the text field. */
async function blankPoint(editor: Editing, row: number) {
  const point = await editor.fixtures.browser.evaluate((row: number) => {
    const drawn = document.querySelector(`[data-row="${row}"].blank`);
    const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]');
    const held = field && Number(field.dataset['row']) === row && field.value === '' ? field : null;
    const box = (drawn ?? held)?.getBoundingClientRect();
    return box ? { x: box.left + Math.min(box.width / 2, 120), y: box.top + box.height / 2 } : null;
  }, row);
  expect(point, `blank row ${row} is on the page`).not.toBeNull();
  return point!;
}

async function reach(editor: Editing, place: Place) {
  if (place.at === 'opened') return;
  if ('blank' in place.at) {
    const { x, y } = await blankPoint(editor, place.at.blank);
    return editor.clickAt(x, y);
  }
  return editor.click(place.at);
}

/** Waits for the page to draw what was pressed, then reads the selection of the text field. */
async function looked(editor: Editing, note: string) {
  await editor.fixtures.page.nextFrame();
  return selectionOf(editor.fixtures.browser, note.split('\n'));
}

async function savedAs(editor: Editing, expected: string) {
  await editor.fixtures.page.hide();
  let saved = await editor.saved();
  for (let wait = 0; wait < 15 && saved !== expected; wait++) {
    await pause(100);
    saved = await editor.saved();
  }
  return saved;
}

/** Escape draws the whole note, whichever blocks the last key opened. */
async function drawWholeNote(editor: Editing) {
  await editor.fixtures.browser.keyboard.press('Escape');
  await editor.fixtures.page.nextFrame();
}

/** Puts the page where a place is reached from: the whole note drawn, or the note opened with the caret at its start. */
async function begin(editor: Editing, sheet: Sheet, place: Place, reopen: boolean) {
  if (reopen || place.at === 'opened') await editor.open(sheet.note);
  else await drawWholeNote(editor);
}

type Landing = { at: Cell } | { problem: string };

/**
 * Where a click aimed at each place of the sheet puts the caret in the page.
 * Asked once for each sheet, because a plain text field has to start where the
 * page does. A click before the first letter of a row whose marks are hidden may
 * be before or after the marks, and the page decides, so the key is tried from
 * wherever the page put the caret.
 */
const landings = new Map<Sheet, Promise<Map<Place, Landing>>>();

function landingsOf(editor: Editing, sheet: Sheet) {
  let found = landings.get(sheet);
  if (!found) {
    found = (async () => {
      const lands = new Map<Place, Landing>();
      await editor.open(sheet.note);
      let used = false;
      for (const place of sheet.places) {
        if (used) await begin(editor, sheet, place, false);
        used = true;
        await reach(editor, place);
        const got = await looked(editor, sheet.note);
        if ('problem' in got) lands.set(place, { problem: got.problem });
        else if (got.anchor[0] !== got.head[0] || got.anchor[1] !== got.head[1]) lands.set(place, { problem: `a click selected from ${show(got.anchor)} to ${show(got.head)}` });
        else lands.set(place, { at: got.head });
      }
      return lands;
    })();
    landings.set(sheet, found);
  }
  return found;
}

type Want = { value: string; anchor: Cell; head: Cell };

/** Where the caret is across the window, before the key and after it. */
type Pixels = { before: number; after: number };

/**
 * What is wrong with where the page left the caret and the selection, given
 * where the plain text field did. `x` is where the caret was in the window
 * before the key and after it, and `rowLength` the length of the row it is on.
 */
function judge(row: Row, want: Want, got: { anchor: Cell; head: Cell }, x: Pixels, rowLength: number) {
  const follow = row.follow ?? 'plain field';
  const rowApart = got.head[0] !== want.head[0];
  const anchorApart = got.anchor[0] !== want.anchor[0] || got.anchor[1] !== want.anchor[1];
  const ends = `the plain field ends with ${describe(want.anchor, want.head)}, the page with ${describe(got.anchor, got.head)}`;
  if (!rowApart && got.head[1] === want.head[1] && !anchorApart) return [];
  if (follow === 'plain field') return [ends];

  const anchorWrong = row.key.includes('Shift') ? anchorApart : got.anchor[0] !== got.head[0] || got.anchor[1] !== got.head[1];
  const kept = Math.abs(x.after - x.before) <= pixelSlack;
  const tooShort = got.head[1] === rowLength && x.after < x.before;
  const placed = follow === 'row' || kept || tooShort;
  if (!rowApart && placed && !anchorWrong) return [];
  const how = follow === 'row' ? 'row only' : `row, and ${Math.round(x.before)}px across within ${pixelSlack}px or the end of a shorter row, the page put it ${Math.round(x.after)}px across`;
  return [`${ends} (${how})`];
}

for (const row of keys) {
  test(`${row.key} leaves the text, cursor and selection where a plain text field does, at every edge`, async (fixtures) => {
    const editor = new Editing(fixtures);
    const failures: string[] = [];
    await fixtures.app.open('/blank');
    let tried = 0;

    for (const sheet of sheets) {
      const lines = sheet.note.split('\n');
      const lands = await landingsOf(editor, sheet);
      await editor.seed(sheet.note);
      const plain = new Map<Place, Want>();
      for (const place of sheet.places) {
        const landing = lands.get(place)!;
        if ('problem' in landing) continue;
        const done = await editor.plainKey(sheet.note, offsetOfRow(sheet.note, landing.at[0]) + landing.at[1], row.key);
        plain.set(place, { value: done.value, anchor: rowCol(done.value, done.anchor), head: rowCol(done.value, done.head) });
      }
      await editor.show(sheet.note);
      let used = false;
      let reopen = false;

      for (const place of sheet.places) {
        const landing = lands.get(place)!;
        if ('problem' in landing) continue;
        const from = landing.at;
        const where = `${sheet.name}, ${place.name} (${show(from)}), ${row.key}`;
        if (used) await begin(editor, sheet, place, reopen);
        used = true;
        reopen = false;
        await reach(editor, place);
        const start = await looked(editor, sheet.note);
        if ('problem' in start) {
          failures.push(`${where}: before the key, ${start.problem}`);
          continue;
        }
        if (start.head[0] !== from[0] || start.head[1] !== from[1] || start.anchor[0] !== from[0] || start.anchor[1] !== from[1]) {
          failures.push(`${where}: the same click now puts the caret at ${show(start.head)}`);
          continue;
        }
        const xBefore = (await cursorAt(fixtures.browser))?.x ?? NaN;
        await editor.press(row.key);
        tried++;
        const want = plain.get(place)!;
        const got = await looked(editor, want.value);
        if ('problem' in got) {
          failures.push(`${where}: after the key, ${got.problem}`);
          reopen = true;
          continue;
        }

        const xAfter = (await cursorAt(fixtures.browser))?.x ?? NaN;
        const problems = judge(row, want, got, { before: xBefore, after: xAfter }, want.value.split('\n')[got.head[0]]?.length ?? 0);
        const edited = want.value !== sheet.note;
        if (edited) {
          const saved = await savedAs(editor, want.value);
          if (saved !== want.value) problems.push(`the plain field holds ${JSON.stringify(want.value)}, the saved note is ${JSON.stringify(saved)}`);
          reopen = true;
        } else {
          const held = lines.slice(got.first, got.first + got.value.split('\n').length).join('\n');
          if (held !== got.value) {
            problems.push(`the key changed the text of the row it was pressed on: ${JSON.stringify(held)} became ${JSON.stringify(got.value)}`);
            reopen = true;
          }
        }
        for (const problem of problems) failures.push(`${where}: ${problem}`);
      }
    }

    expect(tried, 'places where the key was pressed').toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });
}

test('the page puts the caret where a click aimed at every place of the checklist', async (fixtures) => {
  const editor = new Editing(fixtures);
  const failures: string[] = [];
  await fixtures.app.open('/blank');
  for (const sheet of sheets) {
    const lands = await landingsOf(editor, sheet);
    for (const place of sheet.places) {
      const landing = lands.get(place)!;
      if ('problem' in landing) {
        failures.push(`${sheet.name}, ${place.name}: ${landing.problem}`);
        continue;
      }
      const from = rowCol(sheet.note, startOf(sheet, place));
      const row = landing.at[0] === from[0];
      const col = landing.at[1] === from[1] || (place.marks === true && landing.at[1] === 0);
      if (!row || !col) failures.push(`${sheet.name}, ${place.name}: the caret should be at ${show(from)} and is at ${show(landing.at)}`);
    }
  }
  expect(failures).toEqual([]);
});

const names = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'Backspace', 'Delete'];
const modifiers = ['', 'Shift', 'Control', 'Control+Shift', 'Alt', 'Alt+Shift', 'Meta', 'Meta+Shift', 'Control+Alt', 'Control+Alt+Shift'];
const modifierOrder = ['Control', 'Alt', 'Meta', 'Shift'];

function named(key: string, mac: boolean) {
  const parts = key.split('+');
  const name = parts.pop()!;
  const held = parts.map((modifier) => (modifier === 'ControlOrMeta' ? (mac ? 'Meta' : 'Control') : modifier));
  return [...modifierOrder.filter((modifier) => held.includes(modifier)), name].join('+');
}

test("every key that moves or deletes in the browser's own text field has a row in the checklist", async (fixtures) => {
  const editor = new Editing(fixtures);
  await fixtures.app.open('/blank');
  const mac = await fixtures.browser.evaluate(() => navigator.platform.startsWith('Mac'));
  const note = 'alpha one two\n\nbeta first row\ngamma middle row\ndelta last row';
  const moves: string[] = [];
  for (const modifier of modifiers) {
    for (const name of names) {
      const key = modifier === '' ? name : `${modifier}+${name}`;
      const collapsed = await editor.plainKey(note, 20, key);
      const selected = await editor.plainKey(note, 20, key, 25);
      const moved = collapsed.value !== note || collapsed.head !== 20 || selected.value !== note || selected.head !== 25 || selected.anchor !== 20;
      if (moved) moves.push(key);
    }
  }
  const known = new Set(keys.map((row) => named(row.key, mac)));
  expect(moves.length, 'keys the plain text field reacts to').toBeGreaterThan(20);
  expect(
    moves.filter((key) => !known.has(key)),
    'keys the browser moves a caret or selection with, that the checklist has no row for',
  ).toEqual([]);
});
