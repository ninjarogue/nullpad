import type { Browser } from '@e2e-dev/web';
import { expect } from 'e2e';
import type { App } from 'e2e';
import { test } from './nullpad.ts';
import type { Disk, Note, Page } from './nullpad.ts';
import { Editing } from './editing.ts';

const stored = (body: string): Note => ({ key: 'live', title: null, body });

type Fixtures = { app: App; browser: Browser; disk: Disk; page: Page };
type Words = Record<string, { left: number; top: number }>;

/** Opens `top`, a blank row, `shape`, a blank row and `below words`, on the page, with the caret on `top`. */
async function open({ app, browser, disk, page }: Fixtures, shape: string, width: number) {
  await browser.setViewport({ width, height: 900 });
  const body = `top\n\n${shape}\n\nbelow words`;
  await disk.seed([stored(body)]);
  await app.open('/');
  await expect(page.text).toHaveValue(body);
  await page.markdown.tap();
  await expect(page.text).toHaveValue('top');
  return body.split('\n').length;
}

/** Each word drawn outside the field that is not where the whole page draws it, by more than the browser rounds to. */
function moved(row: number, words: Words, idle: Words) {
  return Object.entries(words).flatMap(([word, at]) => {
    const whole = idle[word];
    const by = whole ? Math.round((Math.abs(at.left - whole.left) + Math.abs(at.top - whole.top)) * 10) / 10 : 0;
    return by > 0 ? [{ row, word, by }] : [];
  });
}

/** Moves the caret down every row of the note, a wrapped row taking more than one press, and gives every drawn word that moved on the way. */
async function walk(page: Page, browser: Browser, rows: number) {
  const seen: { row: number; words: Words }[] = [];
  for (let row = 0; row < rows; row++) {
    for (let presses = 0; presses < 4 && (await page.caretRow()) < row; presses++) {
      await browser.keyboard.press('ArrowDown');
      await page.nextFrame();
    }
    await expect.poll(() => page.caretRow()).toBe(row);
    await page.nextFrame();
    seen.push({ row, words: await page.drawnWords() });
  }
  await page.stopEditing();
  await page.nextFrame();
  const idle = await page.drawnWords();
  return seen.flatMap(({ row, words }) => moved(row, words, idle));
}

for (const width of [1280, 412]) {
  for (const shape of [
    '- aa\n  - # Head\n  - bb',
    '- # Head\n  para',
    '- aa\n  # Head',
    '- aa\n  > # Head',
    '> # q1\n> ## q2',
    '> # a\n> > ## b',
    '> # h\n> b',
    '> - # a\n>   # b',
    '> lines above\n> # A heading long enough to wrap across the narrow page width here\n> b',
    '1. x\n   1. ## sub',
    '- a\n  - ## nested\n  - ### nested2\n- b',
    '> # h\n> b\n>',
    '> - [ ] # a\n> - [x] b',
    '> quote\n> # Title',
    '- [ ] a\n  - [x] # b\n- [ ] c',
    '1. a\n2. # b\n3. c',
    '> ```\n> code\n> ```\n> b',
    '- a\n\n  b\n\n- # c',
    '- [ ] a\n  # b',
    '- [ ] # a\n- b',
    '- ```\n  code\n  ```\n- b',
    '>     code\n>     code\n>\n> b',
    '> b\n> ```\n> code',
    '    code\n    more\n\nb',
  ]) {
    test(`arriving at and leaving each row of ${JSON.stringify(shape)} moves no word drawn around the field, ${width}px wide`, async (fixtures) => {
      const rows = await open(fixtures, shape, width);
      expect(await walk(fixtures.page, fixtures.browser, rows)).toEqual([]);
    });
  }
}

for (const width of [1280, 412]) {
  for (const [before, row, col, typed] of [
    ['line one\nline two', 3, 0, '# '],
    ['> quote', 2, 7, '\n> # Title'],
  ] as const) {
    test(`${JSON.stringify(typed)} typed in ${JSON.stringify(before)} moves no word drawn around the field once the caret leaves, ${width}px wide`, async (fixtures) => {
      const { browser, page } = fixtures;
      const rows = await open(fixtures, before, width);
      for (let at = 0; at < row; at++) await browser.keyboard.press('ArrowDown');
      await expect.poll(() => page.caretRow()).toBe(row);
      await browser.keyboard.press('Home');
      for (let at = 0; at < col; at++) await browser.keyboard.press('ArrowRight');
      await browser.keyboard.type(typed);
      await page.nextFrame();
      const added = typed.split('\n').length - 1;
      const typedAt = await page.drawnWords();
      await browser.keyboard.press('ArrowDown');
      await expect.poll(() => page.caretRow()).toBe(row + added + 1);
      await page.nextFrame();
      const left = await page.drawnWords();
      expect(moved(row, left, typedAt)).toEqual([]);
      await page.stopEditing();
      await page.nextFrame();
      expect(moved(rows + added - 1, left, await page.drawnWords())).toEqual([]);
    });
  }
}

/** Where `@` is in `text`, as `row:column`. */
function markAt(text: string) {
  const before = text.slice(0, text.indexOf('@')).split('\n');
  return `${before.length - 1}:${before[before.length - 1]!.length}`;
}

/** Puts the caret at the start or the end of `row`, from the first row, with keys that cross leaves. */
async function caretOnRow({ browser, page }: Fixtures, rows: number, row: number, end: 'Home' | 'End') {
  for (let presses = 0; presses <= rows && (await page.caretRow()) > 0; presses++) {
    await browser.keyboard.press('ArrowUp');
    await page.nextFrame();
  }
  for (let presses = 0; presses < 4 * rows && (await page.caretRow()) < row; presses++) {
    await browser.keyboard.press('ArrowDown');
    await page.nextFrame();
  }
  await browser.keyboard.press(end);
  await page.nextFrame();
}

for (const note of [
  '- a\n- b',
  'a\n\nb',
  '# h\ntext',
  '> a\n> - b\n>   - c',
  '> abcd\n>\n> efgh',
  '> # h\n> text',
  '- a\n  - b\n    - c',
  '- a\n\n  b',
  '> ```\n> code\n> ```\n> z',
  '1. a\n   b\n2. c',
  '- a\n  > b\n  > c',
  '> - > - # x\n>   >   y\n> - z',
]) {
  test(`ArrowLeft at the start of each row of ${JSON.stringify(note)} and ArrowRight at its end go where a plain text field puts the caret`, async (fixtures) => {
    const { app, page } = fixtures;
    const editor = new Editing(fixtures);
    const lines = note.split('\n');
    const rowStart = (row: number) => lines.slice(0, row).reduce((sum, line) => sum + line.length + 1, 0);
    const presses = lines.slice(1).flatMap((_, at) => [
      { row: at, end: 'End' as const, key: 'ArrowRight', from: `${at}:${lines[at]!.length}` },
      { row: at + 1, end: 'Home' as const, key: 'ArrowLeft', from: `${at + 1}:0` },
    ]);
    await editor.seed(note);
    await app.open('/blank');
    const plain = [];
    for (const press of presses) plain.push(markAt(await editor.plainField(note, rowStart(press.row), [press.end, press.key], '@')));
    await editor.show(note);
    const failures: string[] = [];
    for (const [at, press] of presses.entries()) {
      await caretOnRow(fixtures, lines.length, press.row, press.end);
      const from = await page.caretAt();
      if (from !== press.from) {
        failures.push(`${press.end} on row ${press.row} put the caret at ${from}, not ${press.from}`);
        continue;
      }
      await fixtures.browser.keyboard.press(press.key);
      await page.nextFrame();
      await page.nextFrame();
      const got = await page.caretAt();
      if (got !== plain[at]) failures.push(`${press.key} from ${press.from}: the plain field puts the caret at ${plain[at]}, the page at ${got}`);
    }
    expect(failures).toEqual([]);
  });
}
