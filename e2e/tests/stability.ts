import type { Browser } from '@e2e-dev/web';
import { expect } from 'e2e';
import type { Locator } from 'e2e';

/**
 * Types sample notes into the page view one key at a time, and after every
 * key measures how each source row of the note is shown. The intended rule is
 * that the page lays out again only when the caret changes row, and that
 * typing on a row changes only that row. A key breaks it when it
 *
 * - types on the caret's row (the caret stays on its row and the text
 *   changes) and another row looks different or sits somewhere else. Rows
 *   below may all move together, by as much as the caret's row grew.
 * - moves the caret along its row (the text does not change) and any row
 *   looks different or moves.
 * - moves the caret with an arrow to another row of the block the text field
 *   already held, and any row looks different or moves.
 *
 * A key that leaves the caret's block, and Enter and Backspace at the start
 * of a row, change the caret's row, so the page may lay out again after them.
 * So does the first arrow that moves the caret to another row after typing on
 * a row, because typing there can change what the block is (a table loses its
 * delimiter row, a paragraph line becomes a list). That move is the commit.
 * After it, and after any move that has had no typing before it, the rule
 * holds again.
 *
 * A row is shown by the drawn element that carries its `data-row`, or, while
 * the caret's block is open, by the text field. A row with no element of its
 * own (the second line of a paragraph, a table's delimiter row, a closing
 * fence) is shown by the element before it, and an opening fence by the code
 * block after it. A look is the font size, family and weight, the line
 * height, and the top of the row's element on the page.
 */

export const ENTER = '\n';
export const BACKSPACE = '\b';
export const UP = '↑';
export const DOWN = '↓';
export const LEFT = '←';
export const RIGHT = '→';
export const HOME = '⇤';
export const END = '⇥';

export const back = (times: number) => BACKSPACE.repeat(times);
export const rows = (...lines: string[]) => lines.join(ENTER);
export const times = (count: number, key: string) => key.repeat(count);

/** Every kind of block and inline the markdown parser makes, as the element that draws it. */
export const everyKind = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li.task', 'blockquote', 'pre', 'hr', 'table', 'strong', 'em', ':not(pre) > code',
  'a', 'del',
];

type Sample = { name: string; keys: string };

type Look = { size: string; family: string; weight: string; line: string; top: number; shown: string };

type Snapshot = {
  looks: (Look | null)[];
  caret: { row: number; col: number };
  /** The rows the text field holds, both ends included. */
  field: { first: number; last: number };
  problems: string[];
};

type Rule = 'typing on a row' | 'moving along a row' | 'moving between rows of one block';

type Hit = { key: number; typed: string; rule: Rule; row: number; text: string; what: string };

const allTyped: { name: string; draws: string[]; samples: Sample[] }[] = [
  {
    name: 'paragraphs and inline marks',
    draws: ['p', 'strong', 'em', ':not(pre) > code', 'a', 'del'],
    samples: [
      { name: 'soft breaks and typos', keys: `teh${back(2)}he fox${ENTER}jumps${ENTER}over${ENTER}${ENTER}second${ENTER}${ENTER}third` },
      { name: 'every inline mark', keys: `**b** *i* ~~s~~ \`c\` [l](http://x.y)${ENTER}${ENTER}next **open` },
      { name: 'an escape and underscores', keys: `a \\* star${ENTER}${ENTER}_u_ __s__` },
    ],
  },
  {
    name: 'ATX headings',
    draws: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'],
    samples: [
      { name: 'every level', keys: rows('# 1', '## 2', '### 3', '#### 4', '##### 5', '###### 6', '', 'body') },
      { name: 'between paragraphs', keys: rows('# Title', '', 'para', '', '## Sub', 'text') },
      { name: 'empty ones and closing hashes', keys: rows('# ', '# Title #', '## ', '### x') },
    ],
  },
  {
    name: 'setext headings and the lines that look like their underline',
    draws: ['h1', 'h2', 'p', 'ul', 'ol', 'blockquote'],
    samples: [
      { name: 'a line then a dash', keys: rows('text', '-') },
      { name: 'equals signs and dashes', keys: rows('Title', '===', '', 'Sub', '---', '', 'body') },
      { name: 'a two-line paragraph then an underline', keys: rows('a', 'b', '---', '', 'c') },
      { name: 'backspacing an underline away', keys: `Title${ENTER}---${back(3)}x${ENTER}more` },
      { name: 'a list right under a paragraph line', keys: rows('intro:', '- a', '- b') },
      { name: 'a quote and a numbered item right under a paragraph line', keys: rows('text', '> q', '', 'intro', '1. one', '2. two') },
    ],
  },
  {
    name: 'lists',
    draws: ['ul', 'ol', 'li.task', 'p'],
    samples: [
      { name: 'bullets then a paragraph', keys: rows('- one', '- two', '- three', '', 'after') },
      { name: 'star and plus markers', keys: rows('* a', '* b', '', '+ c', '+ d') },
      { name: 'nesting', keys: rows('- a', '  - b', '    - c', '  - d', '- e') },
      { name: 'numbers', keys: rows('1. one', '2. two', '3. three', '', '7. seven', '8. eight') },
      { name: 'task boxes', keys: rows('- [ ] one', '- [x] two', '- [ ] three', '', 'done') },
      { name: 'a loose list and an item with two paragraphs', keys: rows('- a', '', '  more of a', '', '- b', '', '- c') },
      { name: 'backspacing a marker away', keys: `- a${ENTER}- ${back(3)}plain` },
    ],
  },
  {
    name: 'quotes',
    draws: ['blockquote', 'ul', 'pre', 'h1', 'h2', 'p'],
    samples: [
      { name: 'quotes and a nested quote', keys: rows('> quote one', '> quote two', '', '> > nested', '', 'out') },
      { name: 'a quote holding a list and a fence', keys: rows('> - a', '> - b', '>', '> ```', '> x', '> ```', '', 'after') },
      { name: 'a quote with a lazy line', keys: rows('> a', 'lazy', '', 'after') },
      { name: 'a heading inside a quote', keys: rows('> # Head', '> body', '', '> ## Sub') },
    ],
  },
  {
    name: 'code blocks with markdown-looking text inside',
    draws: ['pre', 'p', 'ul'],
    samples: [
      { name: 'a fence', keys: rows('```js', 'let a;', '# not a heading', '- not a list', '| a | b |', '|---|---|', '```', '', 'after') },
      { name: 'a tilde fence left open', keys: rows('~~~', 'code', '', '# still code', '> still code', '~~~', 'real') },
      { name: 'a fence right under a paragraph line', keys: rows('text', '```', 'code', '```', 'more') },
      { name: 'indented code', keys: rows('para', '', '    code line', '    more', '', 'after') },
      { name: 'a fence inside a list item', keys: rows('- item', '', '  ```', '  code', '  ```', '', 'after') },
    ],
  },
  {
    name: 'tables',
    draws: ['table', 'strong', ':not(pre) > code', 'del', 'p'],
    samples: [
      { name: 'a pipe table', keys: rows('| a | b |', '|-|-|', '| 1 | 2 |', '| 3 | 4 |', '', 'after') },
      { name: 'alignments and marks in cells', keys: rows('| l | c |', '|:--|:-:|', '| **1** | `2` |', '| ~~4~~ |') },
      { name: 'no outer pipes', keys: rows('Name | Qty', '--|--', 'x | 1', 'y | 2') },
      { name: 'right under a paragraph line', keys: rows('text', '| a | b |', '|-|-|', '| 1 | 2 |') },
      { name: 'torn down with Backspace', keys: `${rows('| a | b |', '|-|-|', '| 1 | 2 |', '', 'x')}${back(15)}y` },
    ],
  },
  {
    name: 'rules, blank rows and Backspace across rows',
    draws: ['hr', 'p', 'h1'],
    samples: [
      { name: 'thematic breaks', keys: rows('text', '', '---', '', 'more', '', '***', '', '___', 'end') },
      { name: 'several blank rows', keys: rows('a', '', '', '', 'b', '', '', 'c') },
      { name: 'joining rows', keys: `${rows('one', 'two', '')}${back(2)}three${ENTER}${ENTER}${back(3)}four` },
      { name: 'joining a heading and a list item', keys: `${rows('# Head', '- item', '')}${back(8)}x` },
    ],
  },
  {
    name: 'editing in the middle of a note, with the caret moved by keys',
    draws: ['h1', 'p', 'ul', 'table', 'pre'],
    samples: [
      {
        name: 'typing above, below and between blocks',
        keys:
          rows('# Title', '', 'para', '', '- a', '- b', '', '| a | b |', '|-|-|', '| 1 | 2 |', '', '```', 'code', '```') +
          `${times(13, UP)}${END}x${DOWN}${DOWN}y${HOME}z${times(3, DOWN)}${END}q${times(4, DOWN)}w${LEFT}${LEFT}${RIGHT}e${times(2, UP)}r`,
      },
      {
        name: 'editing a table row by row',
        keys: rows('| a | b |', '|-|-|', '| 1 | 2 |', '| 3 | 4 |') + `${UP}${END}x${UP}${END}y${UP}${END}z${DOWN}${DOWN}${DOWN}${END}w`,
      },
      {
        name: 'editing a two-row heading',
        keys: rows('Title', '===', '', 'next') + `${UP}${UP}${UP}${END}x${DOWN}${END}y${DOWN}${DOWN}${END}z`,
      },
    ],
  },
  {
    name: 'marks typed at the start of a row that is already there',
    draws: ['h1', 'h2', 'ul', 'blockquote', 'pre', 'p'],
    samples: [
      { name: 'a list marker on the second line of a paragraph', keys: rows('one', 'two', 'three') + `${UP}${HOME}- ${DOWN}x` },
      { name: 'a quote marker on the second line of a paragraph', keys: rows('one', 'two', 'three') + `${UP}${HOME}> ${DOWN}x` },
      { name: 'a heading marker on a paragraph, then taken off', keys: `para${HOME}# ${back(2)}x` },
      { name: 'a heading marker above a paragraph row', keys: rows('first', 'second') + `${UP}${HOME}# ` },
      { name: 'an opening fence above the rows below it', keys: rows('code', 'more', '', 'last') + `${times(3, UP)}${HOME}\`\`\`` },
      { name: 'an underline typed between a row and the text below', keys: rows('Title', 'text') + `${UP}${END}${ENTER}---` },
    ],
  },
  {
    name: 'a whole note, top to bottom',
    draws: ['h1', 'p', 'strong', 'ul', 'li.task', 'blockquote', 'em', 'pre', 'table', 'hr'],
    samples: [
      {
        name: 'a trip plan',
        keys: rows(
          '# Trip',
          '',
          'Leave **Friday**.',
          '',
          '- [ ] passport',
          '  - [x] socks',
          '',
          '> bring *cash*',
          '',
          '```',
          'rate = 1.5',
          '```',
          '',
          '| a | b |',
          '|---|---|',
          '| 1 | 2 |',
          '',
          '---',
          'end',
        ),
      },
    ],
  },
];

/** Prose, headings, lists and quotes, and then everything else, so that two files can run side by side. */
export const typedText = allTyped.slice(0, 5);
export const typedBlocks = allTyped.slice(5);
export const typed = allTyped;

export const noteWithEveryBlock = rows(
  '# Title', '', 'para one', 'para two', '', '- a', '- b', '', '> quote', '', '```', 'code', '```', '', '| a | b |', '|-|-|', '| 1 | 2 |', '',
  '---', '', 'Head', '===', '', 'last',
);

/** Notes opened as they are, with the caret moved through them by arrows alone. */
export const walked: { name: string; draws: string[]; note: string; keys: string }[] = [
  {
    name: 'a two-row heading and ATX headings',
    draws: ['h1', 'h2'],
    note: rows('Title', '===', '', 'Sub', '---', '', '# Atx', '## Atx two'),
    keys: times(9, DOWN) + times(9, UP),
  },
  {
    name: 'a table',
    draws: ['table', 'p'],
    note: rows('| a | b |', '|-|-|', '| 1 | 2 |', '| 3 | 4 |', '', 'after'),
    keys: times(6, DOWN) + times(6, UP),
  },
  {
    name: 'a table under a paragraph line and a table with no outer pipes',
    draws: ['table', 'p'],
    note: rows('text', '| a | b |', '|-|-|', '| 1 | 2 |', '', 'Name | Qty', '--|--', 'x | 1'),
    keys: times(8, DOWN) + times(8, UP),
  },
  {
    name: 'a paragraph of three rows, a quote of three rows',
    draws: ['p', 'blockquote'],
    note: rows('one', 'two', 'three', '', '> a', '> b', '> c'),
    keys: times(7, DOWN) + times(7, UP),
  },
  {
    name: 'a fence, an indented block and a fence inside a quote',
    draws: ['pre', 'blockquote'],
    note: rows('```js', 'let a;', '', 'let b;', '```', '', 'para', '', '    indented', '    more', '', '> ```', '> x', '> ```'),
    keys: times(13, DOWN) + times(13, UP),
  },
  {
    name: 'nested lists, numbers and tasks',
    draws: ['ul', 'ol', 'li.task'],
    note: rows('- a', '  - b', '    - c', '- d', '', '1. one', '2. two', '', '- [ ] x', '- [x] y'),
    keys: times(9, DOWN) + times(9, UP),
  },
  {
    name: 'a list item with a second paragraph and a blank row inside a fence',
    draws: ['ul', 'pre'],
    note: rows('- a', '', '  more of a', '- b', '', '  ```', '  code', '', '  more', '  ```'),
    keys: times(9, DOWN) + times(9, UP),
  },
  {
    name: 'every kind of block',
    draws: ['h1', 'p', 'ul', 'blockquote', 'pre', 'table', 'hr'],
    note: noteWithEveryBlock,
    keys: times(23, DOWN) + times(23, UP),
  },
];

function keyName(key: string) {
  const names: Record<string, string> = {
    [ENTER]: 'Enter',
    [BACKSPACE]: 'Backspace',
    [UP]: 'ArrowUp',
    [DOWN]: 'ArrowDown',
    [LEFT]: 'ArrowLeft',
    [RIGHT]: 'ArrowRight',
    [HOME]: 'Home',
    [END]: 'End',
  };
  return names[key] ?? key;
}

/**
 * What the page measures: one entry for every row of `lines`, however it is
 * shown, and where the caret is. Runs in the page.
 */
function snapshotInPage(model: { lines: string[] }): Promise<Snapshot> {
  const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
  const sheet = document.querySelector('.page')!;

  const lookOf = (element: HTMLElement, shown: string, top: number): Look => {
    const style = getComputedStyle(element);
    const line = style.lineHeight === 'normal' ? `${element.getBoundingClientRect().height}px` : style.lineHeight;
    return { size: style.fontSize, family: style.fontFamily, weight: style.fontWeight, line, top, shown };
  };

  const topOf = (element: HTMLElement) =>
    Math.round((element.getBoundingClientRect().top - sheet.getBoundingClientRect().top + sheet.scrollTop) * 100) / 100;

  const textOf = (element: HTMLElement) => {
    if (element.tagName === 'TR') return (element.firstElementChild as HTMLElement | null) ?? element;
    if (element.tagName === 'PRE') return element.querySelector<HTMLElement>('code') ?? element;
    return element;
  };

  const read = (): Snapshot => {
    const problems: string[] = [];
    const before = field.value.slice(0, field.selectionStart);
    const held = field.value.split('\n');
    const below = document.querySelector<HTMLElement>('[data-test-id="live-below"] [data-row]');
    const fenceBefore = (row: number) => /^[\s>]*(?:(?:[-*+]|\d+[.)])\s+)*(?:`{3,}|~{3,})/.test(model.lines[row - 1] ?? '');
    const firstBelow = below ? Number(below.dataset['row']) - (below.tagName === 'PRE' && fenceBefore(Number(below.dataset['row'])) ? 1 : 0) : model.lines.length;
    const last = firstBelow - 1;
    const first = last - held.length + 1;
    const typedRows = model.lines.slice(Math.max(first, 0), Math.max(first, 0) + held.length);
    if (first < 0 || typedRows.join('\n') !== field.value) {
      problems.push(`the text field holds ${JSON.stringify(field.value)} where the typed rows are ${JSON.stringify(typedRows.join('\n'))}`);
    }
    const kind = /\b(h[1-6]|mono|item|task)\b/.exec(field.closest('.editor')?.className ?? '')?.[1] ?? 'body';
    const inField = lookOf(field, `text field (${kind})`, topOf(field));
    const drawn = [...document.querySelectorAll<HTMLElement>('[data-test-id="live-above"] [data-row], [data-test-id="live-below"] [data-row]')].map(
      (element) => ({ element, row: Number(element.dataset['row']) }),
    );
    const looks = model.lines.map((line, row): Look | null => {
      if (row >= first && row <= last) return inField;
      let owner: (typeof drawn)[number] | undefined;
      for (const candidate of drawn) if (candidate.row <= row) owner = candidate;
      const next = drawn.find((candidate) => candidate.row > row);
      if (next && next.row === row + 1 && next.element.tagName === 'PRE' && fenceBefore(row + 1) && (!owner || owner.row < row)) owner = next;
      if (!owner) {
        problems.push(`row ${row} is drawn by nothing`);
        return null;
      }
      return lookOf(textOf(owner.element), owner.element.tagName.toLowerCase(), topOf(owner.element));
    });
    return {
      looks,
      caret: { row: first + before.split('\n').length - 1, col: before.length - (before.lastIndexOf('\n') + 1) },
      field: { first, last },
      problems,
    };
  };

  return new Promise((done) => {
    let last = '';
    let frames = 0;
    const frame = () => {
      const now = read();
      const text = JSON.stringify(now);
      frames++;
      if ((text === last && frames >= 2) || frames >= 12) done(now);
      else {
        last = text;
        requestAnimationFrame(frame);
      }
    };
    requestAnimationFrame(frame);
  });
}

const sameFont = (a: Look, b: Look) => a.size === b.size && a.family === b.family && a.weight === b.weight && a.line === b.line;

function describe(look: Look) {
  const family = /mono/i.test(look.family) ? 'mono' : 'ui';
  return `${look.shown}: ${look.size} ${look.weight} ${family}, line ${look.line}, top ${look.top}`;
}

type Typed = { hits: Hit[]; problems: string[] };

/**
 * Presses `keys` in the note the text field holds, starting with the caret at
 * the start of `text`, and lists every key that broke the rule.
 */
export async function typeAndMeasure(browser: Browser, text: string, keys: string): Promise<Typed> {
  const lines = () => text.split('\n');
  const offsetOf = (row: number, col: number) =>
    lines().slice(0, row).reduce((sum, line) => sum + line.length + 1, 0) + Math.min(col, lines()[row]!.length);
  const rowAt = (index: number) => text.slice(0, index).split('\n').length - 1;
  let caret = 0;
  let uncommitted = false;

  let was = await browser.evaluate(snapshotInPage, { lines: lines() });
  const hits: Hit[] = [];
  const problems: string[] = was.problems.map((problem) => `before any key: ${problem}`);

  for (const [index, key] of [...keys].entries()) {
    const before = text;
    const rowBefore = was.caret.row;
    const heldBefore = was.field;
    let move = 0;
    if (key === ENTER) {
      await browser.keyboard.press('Enter');
      text = text.slice(0, caret) + '\n' + text.slice(caret);
      caret += 1;
    } else if (key === BACKSPACE) {
      await browser.keyboard.press('Backspace');
      if (caret > 0) {
        text = text.slice(0, caret - 1) + text.slice(caret);
        caret -= 1;
      }
    } else if (key === UP || key === DOWN) {
      await browser.keyboard.press(key === UP ? 'ArrowUp' : 'ArrowDown');
      move = key === UP ? -1 : 1;
    } else if (key === LEFT || key === RIGHT) {
      await browser.keyboard.press(key === LEFT ? 'ArrowLeft' : 'ArrowRight');
      move = key === LEFT ? -0.5 : 0.5;
    } else if (key === HOME || key === END) {
      await browser.keyboard.press(key === HOME ? 'Home' : 'End');
      caret = offsetOf(rowBefore, key === HOME ? 0 : Infinity);
    } else {
      await browser.keyboard.type(key);
      text = text.slice(0, caret) + key + text.slice(caret);
      caret += 1;
    }
    const now = await browser.evaluate(snapshotInPage, { lines: lines() });
    const name = `key ${index + 1} (${keyName(key)})`;
    if (move !== 0) caret = offsetOf(now.caret.row, now.caret.col);
    else if (now.caret.row !== rowAt(caret) || now.caret.col !== caret - offsetOf(rowAt(caret), 0)) {
      problems.push(`${name}: the caret is at row ${now.caret.row} column ${now.caret.col}, the typed text puts it at offset ${caret}`);
    }
    for (const problem of now.problems) problems.push(`${name}: ${problem}`);

    const rowNow = now.caret.row;
    const stays = rowNow === rowBefore;
    const inBlock = rowNow >= heldBefore.first && rowNow <= heldBefore.last;
    const commits = !stays && uncommitted;
    if (text !== before && stays) uncommitted = true;
    else if (!stays) uncommitted = false;
    let rule: Rule | null = null;
    if (text !== before) rule = stays ? 'typing on a row' : null;
    else rule = stays ? 'moving along a row' : inBlock && !commits ? 'moving between rows of one block' : null;
    if (rule === null || lines().length !== was.looks.length) {
      was = now;
      continue;
    }

    let shift: number | null = null;
    now.looks.forEach((lookNow, row) => {
      const lookBefore = was.looks[row];
      if (!lookBefore || !lookNow) return;
      const record = (what: string) => hits.push({ key: index + 1, typed: keyName(key), rule: rule!, row, text: lines()[row] ?? '', what });
      if (row === rowNow && rule === 'typing on a row') return;
      if (!sameFont(lookBefore, lookNow)) return record(`${describe(lookBefore)}  ->  ${describe(lookNow)}`);
      const moved = Math.round((lookNow.top - lookBefore.top) * 100) / 100;
      const below = row > rowNow && rule === 'typing on a row';
      if (below) {
        shift ??= moved;
        if (Math.abs(moved - shift) > 0.5) record(`${describe(lookBefore)}  ->  ${describe(lookNow)}, moved ${moved}px where the row below the caret moved ${shift}px`);
      } else if (Math.abs(moved) > 0.5) record(`${describe(lookBefore)}  ->  ${describe(lookNow)}, moved ${moved}px`);
    });
    was = now;
  }
  return { hits, problems };
}

export function report(hits: Hit[], problems: string[]): string[] {
  const grouped = new Map<string, Hit[]>();
  for (const hit of hits) {
    const id = [hit.key, hit.rule, hit.what].join('|');
    grouped.set(id, [...(grouped.get(id) ?? []), hit]);
  }
  return [
    ...[...grouped.values()].map((group) => {
      const first = group[0]!;
      const shown = group.map((hit) => `${hit.row} ${JSON.stringify(hit.text)}`).join(', ');
      return `key ${first.key} (${first.typed}) ${first.rule}, changed ${group.length === 1 ? 'row' : 'rows'} ${shown}: ${first.what}`;
    }),
    ...problems,
  ];
}

export type Fixtures = { browser: Browser; page: { text: Locator; newNote: Locator; markdown: Locator; preview: Locator } };

export async function openEmptyNote({ page }: Fixtures, first: boolean) {
  if (!first) await page.newNote.tap();
  await expect(page.text).toBeFocused();
  await expect(page.text).toHaveValue('');
}

export async function drawnKinds({ browser, page }: Fixtures) {
  await expect(page.text).toBeFocused();
  await browser.keyboard.press('Escape');
  await expect(page.preview).toBeVisible();
  return browser.evaluate((kinds: string[]) => kinds.filter((kind) => document.querySelector(`[data-test-id="preview"] ${kind}`) !== null), everyKind);
}
