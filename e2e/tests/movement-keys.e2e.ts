import { expect } from 'e2e';
import { ctrl, Editing, offsetOf } from './editing.ts';
import type { Spot } from './editing.ts';
import { cursorAt, fast, selectionOf } from './guards.ts';
import { pause, test } from './nullpad.ts';

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
  { key: ctrl('ArrowUp'), follow: 'row and pixel' },
  { key: ctrl('Shift+ArrowUp'), follow: 'row and pixel' },
  { key: 'ArrowDown', follow: 'row and pixel' },
  { key: 'Shift+ArrowDown', follow: 'row and pixel' },
  { key: ctrl('ArrowDown'), follow: 'row and pixel' },
  { key: ctrl('Shift+ArrowDown'), follow: 'row and pixel' },
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

const pixelSlack = 16;

type Where = 'opened' | { blank: number } | { line: number; of: number } | Spot;

type Place = {
  name: string;
  at: Where;
  marks?: true;
};

type Sheet = {
  name: string;
  note: string;
  places: Place[];
  wrapped?: true;
};

const counted = (letter: string, count: number) => Array.from({ length: count }, (_, index) => `${letter}${index}`).join(' ');

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
  {
    name: 'a quote holding nested items, a heading, a paragraph and code, then an item of two paragraphs',
    note: ['> a', '> - b', '>   - c', '>', '> # h', '> text', '> ```', '> code', '> ```', '- a', '', '  b'].join('\n'),
    places: [
      { name: 'the start of a quote, before its hidden marks', at: 'opened' },
      { name: 'the end of the first row of a quote', at: { word: 'a', at: 1, row: 0 } },
      { name: 'the start of an item in a quote', at: { word: 'b', at: 0, row: 1 }, marks: true },
      { name: 'the end of an item in a quote, before its nested item', at: { word: 'b', at: 1, row: 1 } },
      { name: 'the start of a nested item in a quote', at: { word: 'c', at: 0, row: 2 }, marks: true },
      { name: 'the end of a nested item in a quote', at: { word: 'c', at: 1, row: 2 } },
      { name: 'a blank row in a quote, after its hidden mark', at: { blank: 3 } },
      { name: 'the start of a heading in a quote', at: { word: 'h', at: 0, row: 4 }, marks: true },
      { name: 'the end of a heading in a quote', at: { word: 'h', at: 1, row: 4 } },
      { name: 'the start of a paragraph in a quote', at: { word: 'text', at: 0 }, marks: true },
      { name: 'the end of a paragraph in a quote', at: { word: 'text', at: 4 } },
      { name: 'the start of code in a quote', at: { word: 'code', at: 0 }, marks: true },
      { name: 'the end of code in a quote, the last row of the quote', at: { word: 'code', at: 4 } },
      { name: 'the start of an item after a quote', at: { word: 'a', at: 0, row: 9 }, marks: true },
      { name: 'the end of the first paragraph of an item', at: { word: 'a', at: 1, row: 9 } },
      { name: 'a blank row between the paragraphs of an item', at: { blank: 10 } },
      { name: 'the start of the second paragraph of an item', at: { word: 'b', at: 0, row: 11 }, marks: true },
      { name: 'the end of the note, in the second paragraph of an item', at: { word: 'b', at: 1, row: 11 } },
    ],
  },
  {
    name: 'a paragraph, a heading, a quote and a list item the page wraps',
    note: [counted('p', 60), '', `## ${counted('h', 36)}`, '', `> ${counted('q', 50)}`, '', `- ${counted('i', 50)}`, '', 'last'].join('\n'),
    wrapped: true,
    places: [
      { name: 'the start of a wrapped paragraph', at: 'opened' },
      { name: 'the start of the second line of a wrapped paragraph', at: { line: 1, of: 0 } },
      { name: 'the middle of a wrapped paragraph', at: { word: 'p25', at: 1 } },
      { name: 'the end of a wrapped paragraph', at: { word: 'p59', at: 3 } },
      { name: 'the text of a wrapped heading, after its hidden marks', at: { word: 'h0', at: 0 }, marks: true },
      { name: 'the start of the second line of a wrapped heading', at: { line: 1, of: 2 } },
      { name: 'the middle of a wrapped heading', at: { word: 'h20', at: 1 } },
      { name: 'the end of a wrapped heading', at: { word: 'h35', at: 3 } },
      { name: 'the start of the second line of a wrapped quote', at: { line: 1, of: 4 } },
      { name: 'the middle of a wrapped quote', at: { word: 'q30', at: 1 } },
      { name: 'the end of a wrapped quote', at: { word: 'q49', at: 3 } },
      { name: 'the start of the second line of a wrapped list item', at: { line: 1, of: 6 } },
      { name: 'the middle of a wrapped list item', at: { word: 'i30', at: 1 } },
      { name: 'the end of a wrapped list item', at: { word: 'i49', at: 3 } },
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
  if ('blank' in place.at) return offsetOfRow(sheet.note, place.at.blank) + (sheet.note.split('\n')[place.at.blank] ?? '').length;
  if ('line' in place.at) return offsetOfRow(sheet.note, place.at.of);
  return offsetOf(sheet.note, place.at);
}

const show = ([row, col]: Cell) => `row ${row} column ${col}`;
const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];

const describe = (anchor: Cell, head: Cell) =>
  anchor[0] === head[0] && anchor[1] === head[1] ? `the caret at ${show(head)}` : `the selection from ${show(anchor)} to ${show(head)}`;

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

async function linePoint(editor: Editing, line: number, row: number) {
  const point = await editor.fixtures.browser.evaluate(
    ({ line, row }: { line: number; row: number }) => {
      const drawn = document.querySelector(`.page [data-row="${row}"]:not(textarea)`);
      if (!drawn) return null;
      const range = document.createRange();
      range.selectNodeContents(drawn);
      const starts = new Map<number, DOMRect>();
      for (const box of range.getClientRects()) {
        if (box.width === 0) continue;
        const top = Math.round(box.top);
        const known = starts.get(top);
        if (!known || box.left < known.left) starts.set(top, box);
      }
      const box = [...starts.entries()].sort(([a], [b]) => a - b)[line]?.[1];
      return box ? { x: box.left + 2, y: box.top + box.height / 2 } : null;
    },
    { line, row },
  );
  expect(point, `line ${line} of row ${row} is drawn on the page`).not.toBeNull();
  return point!;
}

async function reach(editor: Editing, place: Place) {
  if (place.at === 'opened') return;
  if ('blank' in place.at) {
    const { x, y } = await blankPoint(editor, place.at.blank);
    return editor.clickAt(x, y);
  }
  if ('line' in place.at) {
    const { x, y } = await linePoint(editor, place.at.line, place.at.of);
    return editor.clickAt(x, y);
  }
  return editor.click(place.at);
}

async function fieldKey(editor: Editing, key: string) {
  const { browser } = editor.fixtures;
  const first = await browser.evaluate(() => {
    const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
    const style = getComputedStyle(field);
    const twin = document.createElement('textarea');
    twin.dataset['twin'] = '';
    for (const name of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariantLigatures', 'fontKerning', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize', 'textIndent', 'whiteSpace', 'overflowWrap', 'wordBreak', 'paddingLeft', 'paddingRight'] as const) {
      twin.style[name] = style[name];
    }
    twin.style.cssText += `;position:fixed;top:0;left:0;z-index:9;box-sizing:border-box;border:0;margin:0;height:90vh;width:${field.clientWidth}px`;
    document.body.append(twin);
    twin.value = field.value;
    twin.focus();
    twin.setSelectionRange(field.selectionStart, field.selectionEnd, field.selectionDirection);
    return Number(field.dataset['row']);
  });
  await browser.keyboard.press(key);
  const done = await browser.evaluate(() => {
    const twin = document.querySelector<HTMLTextAreaElement>('textarea[data-twin]')!;
    const backward = twin.selectionDirection === 'backward';
    const out = { value: twin.value, anchor: backward ? twin.selectionEnd : twin.selectionStart, head: backward ? twin.selectionStart : twin.selectionEnd };
    twin.remove();
    return out;
  });
  const cell = (offset: number): Cell => {
    const [row, col] = rowCol(done.value, offset);
    return [row + first, col];
  };
  return { value: done.value, rows: done.value, first, anchor: cell(done.anchor), head: cell(done.head) };
}

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

async function drawWholeNote(editor: Editing) {
  await editor.fixtures.browser.keyboard.press('Escape');
  await editor.fixtures.page.nextFrame();
}

async function begin(editor: Editing, sheet: Sheet, place: Place, reopen: boolean) {
  if (reopen || place.at === 'opened') await editor.open(sheet.note);
  if (place.at !== 'opened') await drawWholeNote(editor);
}

type Landing = { at: Cell; x: number } | { problem: string };

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
        else lands.set(place, { at: got.head, x: (await cursorAt(editor.fixtures.browser))?.x ?? NaN });
      }
      return lands;
    })();
    landings.set(sheet, found);
  }
  return found;
}

type Want = { value: string; anchor: Cell; head: Cell };

type Pixels = { before: number; after: number };

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

function nearTwin(row: Row, twin: Cell, got: Cell, before: number, after: number) {
  return row.follow === 'row and pixel' && twin[0] === got[0] && Math.abs(twin[1] - got[1]) <= 1 && Math.abs(after - before) <= pixelSlack;
}

const apart = new Set([
  'a table and a code block, a blank row between a table and a code block (row 4 column 0), Shift+ArrowDown',
  'a table and a code block, a blank row between a table and a code block (row 4 column 0), ControlOrMeta+Shift+ArrowDown',
]);

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
        if (!fast) {
          const start = await looked(editor, sheet.note);
          if ('problem' in start) {
            failures.push(`${where}: before the key, ${start.problem}`);
            continue;
          }
          if (start.head[0] !== from[0] || start.head[1] !== from[1] || start.anchor[0] !== from[0] || start.anchor[1] !== from[1]) {
            failures.push(`${where}: the same click now puts the caret at ${show(start.head)}`);
            continue;
          }
        }
        let twin: Awaited<ReturnType<typeof fieldKey>> | null = null;
        if (sheet.wrapped) {
          const held = await looked(editor, sheet.note);
          twin = await fieldKey(editor, row.key);
          if ('problem' in held) twin = null;
          else twin.value = [...lines.slice(0, held.first), twin.value, ...lines.slice(held.first + held.value.split('\n').length)].join('\n');
          await fixtures.page.text.focus();
          await begin(editor, sheet, place, false);
          await reach(editor, place);
        }
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
        const fits = (want: Cell, end: Cell) => same(want, end) || nearTwin(row, want, end, landing.x, xAfter);
        const asTwin = twin !== null && (twin.value !== sheet.note) === (want.value !== sheet.note) && twin.rows === got.value && twin.first === got.first && fits(twin.anchor, got.anchor) && fits(twin.head, got.head);
        const problems = asTwin ? [] : judge(row, want, got, { before: landing.x, after: xAfter }, want.value.split('\n')[got.head[0]]?.length ?? 0);
        if (twin && !asTwin && problems.length > 0) problems.push(`a field set as the page's ends with ${describe(twin.anchor, twin.head)}`);
        const expected = asTwin ? twin!.value : want.value;
        const edited = expected !== sheet.note;
        if (edited) {
          const saved = await savedAs(editor, expected);
          if (saved !== expected) problems.push(`the ${asTwin ? "field set as the page's" : 'plain field'} holds ${JSON.stringify(expected)}, the saved note is ${JSON.stringify(saved)}`);
          reopen = true;
        } else {
          const held = lines.slice(got.first, got.first + got.value.split('\n').length).join('\n');
          if (held !== got.value) {
            problems.push(`the key changed the text of the row it was pressed on: ${JSON.stringify(held)} became ${JSON.stringify(got.value)}`);
            reopen = true;
          }
        }
        if (!apart.has(where)) for (const problem of problems) failures.push(`${where}: ${problem}`);
        if (sheet.wrapped) reopen = true;
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
      if (place.at !== 'opened' && 'line' in place.at) {
        if (landing.at[0] !== place.at.of || landing.at[1] === 0) failures.push(`${sheet.name}, ${place.name}: the caret should start a line of row ${place.at.of} past its first, and is at ${show(landing.at)}`);
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
