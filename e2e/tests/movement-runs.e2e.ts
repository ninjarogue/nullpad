import { expect } from 'e2e';
import { chromium } from 'playwright-core';
import { ctrl, Editing } from './editing.ts';
import { cursorAt, cursorStartsLine, selectionOf } from './guards.ts';
import { pause, test } from './nullpad.ts';

type Cell = [number, number];

const pixelSlack = 16;

const note = [
  '# Head one',
  '',
  'first para here',
  'second row text',
  '',
  '- item one',
  '- item two',
  '',
  '> quote line',
  '',
  '```',
  'code one',
  'code two',
  '```',
  '',
  'Setext head',
  '===========',
  '',
  '---',
  '',
  'last para',
].join('\n');

const rowCol = (text: string, offset: number): Cell => {
  const before = text.slice(0, offset);
  return [before.split('\n').length - 1, offset - (before.lastIndexOf('\n') + 1)];
};

const offsetOfCell = (text: string, [row, col]: Cell) =>
  text.split('\n').slice(0, row).reduce((sum, line) => sum + line.length + 1, 0) + col;

const show = ([row, col]: Cell) => `row ${row} column ${col}`;
const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];

type Plain = { value: string; anchor: Cell; head: Cell };

async function plainPresses(editor: Editing, body: string, anchor: Cell, head: Cell, keys: string[]) {
  const { browser } = editor.fixtures;
  const [from, to] = [offsetOfCell(body, anchor), offsetOfCell(body, head)];
  await browser.evaluate(
    (put: { body: string; from: number; to: number }) => {
      const field = document.createElement('textarea');
      field.style.cssText = 'position:fixed;top:0;left:0;width:2400px;height:600px;white-space:pre;font:16px monospace';
      document.body.append(field);
      field.value = put.body;
      field.focus();
      if (put.to < put.from) field.setSelectionRange(put.to, put.from, 'backward');
      else field.setSelectionRange(put.from, put.to, 'forward');
      return null;
    },
    { body, from, to },
  );
  const states: Plain[] = [];
  for (const key of keys) {
    await browser.keyboard.press(key);
    const state = await browser.evaluate(() => {
      const field = document.querySelector('textarea')!;
      const backward = field.selectionDirection === 'backward';
      return {
        value: field.value,
        anchor: backward ? field.selectionEnd : field.selectionStart,
        head: backward ? field.selectionStart : field.selectionEnd,
      };
    });
    states.push({ value: state.value, anchor: rowCol(state.value, state.anchor), head: rowCol(state.value, state.head) });
  }
  await browser.evaluate(() => {
    document.querySelector('textarea')!.remove();
    return null;
  });
  return states;
}

function paintedNow() {
  const highlights = globalThis.CSS?.highlights;
  const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]');
  return {
    painted: (highlights?.get('nullpad-selection')?.size ?? 0) > 0,
    field: field?.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ?? false,
  };
}

type Look = { anchor: Cell; head: Cell; x: number; y: number; lineStart?: boolean };

async function look(editor: Editing, lines: string[]): Promise<Look | { problem: string }> {
  const { browser, page } = editor.fixtures;
  await page.nextFrame();
  const got = await selectionOf(browser, lines);
  if ('problem' in got) return { problem: got.problem };
  const at = await cursorAt(browser);
  return { anchor: got.anchor, head: got.head, x: at?.x ?? NaN, y: at?.top ?? NaN, lineStart: await cursorStartsLine(browser) };
}

type Follow = 'plain field' | 'row and pixel' | 'row' | 'wrapped';

const isVertical = (key: string) => /Arrow(Up|Down)$|Page(Up|Down)$/.test(key);
const isPage = (key: string) => /Page(Up|Down)$/.test(key);

function judge(follow: Follow, want: Plain, got: Look, goalX: number, lineLength: number) {
  const ends = (cell: Cell, other: Cell) => (same(cell, other) ? `the caret at ${show(cell)}` : `the selection from ${show(other)} to ${show(cell)}`);
  const wantSaw = `the plain field ends with ${ends(want.head, want.anchor)}, the page with ${ends(got.head, got.anchor)}`;
  const wantCollapsed = same(want.head, want.anchor);
  const anchorOk = wantCollapsed ? same(got.head, got.anchor) : same(got.anchor, want.anchor);
  const rowOk = got.head[0] === want.head[0];
  if (rowOk && same(got.head, want.head) && anchorOk) return [];
  if (follow === 'plain field') return [wantSaw];
  const kept = Math.abs(got.x - goalX) <= pixelSlack;
  const tooShort = got.head[1] === lineLength && got.x < goalX;
  const placed = follow === 'row' || kept || tooShort;
  if (rowOk && placed && anchorOk) return [];
  const how = follow === 'row' ? 'row only' : `row, and ${Math.round(goalX)}px across within ${pixelSlack}px or the end of a shorter row, the page put it ${Math.round(got.x)}px across`;
  return [`${wantSaw} (${how})`];
}

/** Ctrl with Page Up or Page Down switches tabs, so it is not pressed. */
const moving = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].flatMap((name) => [
  name,
  `Shift+${name}`,
  ctrl(name),
  ctrl(`Shift+${name}`),
]).concat(['PageUp', 'Shift+PageUp', 'PageDown', 'Shift+PageDown']);

type State = { name: string; keys: string[]; painted: boolean };

const times = (count: number, key: string) => Array.from({ length: count }, () => key);

const states: State[] = [
  { name: 'a selection inside one block, forward', keys: ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight', ...times(3, 'Shift+ArrowRight')], painted: false },
  { name: 'a selection inside one block, backward', keys: ['ArrowDown', 'ArrowDown', 'End', ...times(3, 'Shift+ArrowLeft')], painted: false },
  { name: 'a painted selection across blocks, forward, its head at the start of a row', keys: times(7, 'Shift+ArrowDown'), painted: true },
  { name: 'a painted selection across blocks, forward, its head in the middle of a row', keys: times(18, 'Shift+ArrowRight'), painted: true },
  { name: 'a painted selection across blocks, backward, its head at the start of a row', keys: [ctrl('End'), 'Home', ...times(7, 'Shift+ArrowUp')], painted: true },
  { name: 'a painted selection across blocks, backward, its head in the middle of a row', keys: [ctrl('End'), ...times(30, 'Shift+ArrowLeft')], painted: true },
  { name: 'the whole note, after Ctrl+A', keys: [ctrl('a')], painted: true },
];

type Plan = { anchor: Cell; head: Cell; x: number; results: Map<string, Plain> };

const plans = new Map<string, Promise<Plan>>();

async function setUp(editor: Editing, body: string, keys: string[]) {
  await editor.open(body);
  for (const key of keys) {
    await editor.fixtures.browser.keyboard.press(key);
    await editor.fixtures.page.nextFrame();
  }
}

function planOf(editor: Editing, state: State) {
  let found = plans.get(state.name);
  if (!found) {
    found = (async () => {
      await setUp(editor, note, state.keys);
      const start = await look(editor, note.split('\n'));
      if ('problem' in start) throw new Error(`${state.name}: ${start.problem}`);
      const drawn = await editor.fixtures.browser.evaluate(paintedNow);
      expect(drawn.painted, `${state.name} is painted over the page`).toBe(state.painted);
      await editor.fixtures.app.open('/blank');
      const results = new Map<string, Plain>();
      for (const key of moving) {
        const [done] = await plainPresses(editor, note, start.anchor, start.head, [key]);
        results.set(key, done!);
      }
      return { anchor: start.anchor, head: start.head, x: start.x, results };
    })();
    plans.set(state.name, found);
  }
  return found;
}

const failing = new Map<string, string>();

for (const state of states) {
  for (const key of moving) {
    test(`${key} on ${state.name} leaves the cursor and selection where a plain text field does`, async (fixtures) => {
      const editor = new Editing(fixtures);
      const plan = await planOf(editor, state);
      const finding = failing.get(`${state.name}|${key}`);
      if (finding) test.fail(finding);
      await setUp(editor, note, state.keys);
      const began = await look(editor, note.split('\n'));
      expect('problem' in began ? began.problem : [began.anchor, began.head], 'the state is set up as it was when the plain field was asked').toEqual([plan.anchor, plan.head]);
      const want = plan.results.get(key)!;
      await fixtures.browser.keyboard.press(key);
      const got = await look(editor, want.value.split('\n'));
      expect('problem' in got ? got.problem : null, 'the page can be read after the key').toBeNull();
      if ('problem' in got) return;
      const follow: Follow = isPage(key) ? 'row' : isVertical(key) && plan.head[1] !== 0 ? 'row and pixel' : 'plain field';
      const line = want.value.split('\n')[got.head[0]] ?? '';
      expect(judge(follow, want, got, plan.x, line.length)).toEqual([]);
    });
  }
}

type Step = string | { key: string; follow: Follow };

type Run = {
  name: string;
  body: string;
  start: Step[];
  steps: Step[];
  follow: Follow;
  fail?: { paced?: string; held?: string };
  paceMs?: number;
  heldRepeats?: number;
  sendAllAtOnce?: boolean;
  cpuSlowdown?: number;
  frameBeforeSteps?: boolean;
  onlyAllAtOnce?: boolean;
  alsoWithViewSwitch?: boolean;
  stallMs?: number;
  holdFramesWhileSending?: boolean;
  compareToPacedPage?: boolean;
  skipHeldRun?: boolean;
  hiddenMarkPairs?: [number, number][];
};

const key = (step: Step) => (typeof step === 'string' ? step : step.key);

const plainRows = ['abcdefghijklmnopqrstuvwxyz', 'abcdef', '', 'abcdefghijklmnopqrstuvwxyz', 'abcdefghij', 'abcdefghijklmnopqrstuvwxyz', '', 'xy', 'abcdefghijklmnopqrstuvwxyz'].join('\n');
const marked = ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '', '## bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '', '> cccccccccccccccccccccccccccccc', '', '1. dddddddddddddddddddddddddddddd', '', '- eeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '- ffffffffffffffffffffffffffffff', '', 'gggggggggggggggggggggggggggggg'].join('\n');
const blocks = ['# alpha', '', '- one', '- two', '', '> quote', '', '1. first', '2. second', '', 'text'].join('\n');
const fenced = ['para text here to start', '', '```', 'code line one is longer', 'short', 'code line three is long', '```', '', 'tail paragraph that is long'].join('\n');
const setext = ['Head one', '========', '', 'text under it', '', 'Head two', '--------', '', 'last'].join('\n');
const rules = ['a', '', '---', '', 'b', '', '***', 'c', '---', 'd'].join('\n');
const wrapped = `${'word '.repeat(40)}end\n\nnext paragraph`;
const wrappedBlocks = [`${'word '.repeat(40)}end`, '', `## ${'head '.repeat(30)}end`, '', `> ${'quote '.repeat(30)}end`, '', `- ${'item '.repeat(36)}end`, '', 'last'].join('\n');

const rightBy = (count: number): Step[] => times(count, 'ArrowRight');
const downBy = (count: number, step = 'ArrowDown'): Step[] => times(count, step);

const runs: Run[] = [
  { name: 'Down through short rows, a blank row and a short last row of a block', body: plainRows, start: rightBy(12), steps: downBy(9), follow: 'plain field' },
  { name: 'Up through short rows', body: plainRows, start: [ctrl('End'), ...times(4, 'ArrowLeft')], steps: downBy(9, 'ArrowUp'), follow: 'plain field' },
  { name: 'Shift+Down through short rows', body: plainRows, start: rightBy(12), steps: downBy(9, 'Shift+ArrowDown'), follow: 'plain field' },
  { name: 'Shift+Up through short rows', body: plainRows, start: [ctrl('End'), ...times(4, 'ArrowLeft')], steps: downBy(9, 'Shift+ArrowUp'), follow: 'plain field' },
  { name: 'Ctrl+Down through short rows', body: plainRows, start: rightBy(12), steps: downBy(9, ctrl('ArrowDown')), follow: 'plain field' },
  { name: 'Ctrl+Up through short rows', body: plainRows, start: [ctrl('End'), ...times(4, 'ArrowLeft')], steps: downBy(9, ctrl('ArrowUp')), follow: 'plain field' },
  { name: 'Ctrl+Shift+Down through short rows', body: plainRows, start: rightBy(12), steps: downBy(9, ctrl('Shift+ArrowDown')), follow: 'plain field' },
  { name: 'Page Down and Page Up through short rows', body: plainRows, start: rightBy(12), steps: ['PageDown', 'PageUp', 'PageDown'].map((key) => ({ key, follow: 'row' as const })), follow: 'row' },
  {
    name: 'a column kept through a short row is forgotten by Ctrl+Home and the moves after it',
    body: 'abcdefghij\n\nklmnopqrst\n\nuvwxyz',
    start: [],
    steps: [...rightBy(6), 'ArrowDown', ctrl('Home'), ...rightBy(11), 'ArrowUp'],
    follow: 'plain field',
  },
  {
    name: 'Shift+Down onto a short row, then Up, goes back to the column the caret had',
    body: 'abcdefghij\n\nklmnopqrst\n\nuvwxyz',
    start: [],
    steps: [...rightBy(5), 'Shift+ArrowDown', 'ArrowUp'],
    follow: 'plain field',
  },
  {
    name: 'Down and Up through the short last row of a heading block and a long row',
    body: 'abcdefghijklmnop\nab\n\nabcdefghijklmnop',
    start: rightBy(10),
    steps: [...downBy(3), ...downBy(3, 'ArrowUp')],
    follow: 'plain field',
  },
  { name: 'Down through rows with marks the page hides, from the middle of a row', body: marked, start: rightBy(12), steps: downBy(12), follow: 'row and pixel' },
  { name: 'Up through rows with marks the page hides, from the middle of a row', body: marked, start: [ctrl('End'), ...times(18, 'ArrowLeft')], steps: downBy(12, 'ArrowUp'), follow: 'row and pixel' },
  { name: 'Down through rows with marks the page hides, from the start of a row', body: marked, start: [], steps: downBy(12), follow: 'plain field' },
  { name: 'Up through rows with marks the page hides, from the start of a row', body: marked, start: [ctrl('End'), 'Home'], steps: downBy(12, 'ArrowUp'), follow: 'plain field' },
  { name: 'Up from the start of a list item onto a heading', body: '# alpha\n\n- one', start: [ctrl('End'), 'Home'], steps: downBy(2, 'ArrowUp'), follow: 'plain field' },
  { name: 'Down from the start of a list item onto a heading', body: '- one\n\n# alpha', start: [], steps: downBy(2), follow: 'plain field' },
  { name: 'Up from the start of a paragraph onto a quote', body: '> alpha\n\naaaa', start: [ctrl('End'), 'Home'], steps: downBy(2, 'ArrowUp'), follow: 'plain field' },
  { name: 'Up from the start of a list item onto the row above it', body: 'aaaa\n\n- aaaa', start: [ctrl('End'), 'Home'], steps: downBy(2, 'ArrowUp'), follow: 'plain field' },
  { name: 'Up from the start of a list item onto the row of the same block', body: 'aaaa\n- aaaa', start: [ctrl('End'), 'Home'], steps: downBy(1, 'ArrowUp'), follow: 'plain field' },
  { name: 'Up from the start of a list item onto a table', body: '| a | b |\n|---|---|\n| 1 | 2 |\n\n- aaaa', start: [ctrl('End'), 'Home'], steps: downBy(3, 'ArrowUp'), follow: 'plain field' },
  { name: 'Page Up from the start of a list item onto a heading', body: '# alpha\n\n- item 10', start: [ctrl('End'), 'Home'], steps: [{ key: 'PageUp', follow: 'plain field' }], follow: 'plain field' },
  { name: 'Down through headings, items, a quote, a number and a paragraph, from the start of a row', body: blocks, start: [], steps: downBy(10), follow: 'plain field' },
  { name: 'Up through headings, items, a quote, a number and a paragraph, from the start of a row', body: blocks, start: [ctrl('End'), 'Home'], steps: downBy(10, 'ArrowUp'), follow: 'plain field' },
  { name: 'Shift+Down through headings, items, a quote and a number, from the start of a row', body: blocks, start: [], steps: downBy(10, 'Shift+ArrowDown'), follow: 'plain field' },
  { name: 'Shift+Up through headings, items, a quote and a number, from the start of a row', body: blocks, start: [ctrl('End'), 'Home'], steps: downBy(10, 'Shift+ArrowUp'), follow: 'plain field' },
  { name: 'Down through a code block, from the middle of a row', body: fenced, start: rightBy(8), steps: downBy(8), follow: 'row and pixel' },
  { name: 'Up through a code block, from the middle of a row', body: fenced, start: [ctrl('End'), ...times(10, 'ArrowLeft')], steps: downBy(8, 'ArrowUp'), follow: 'row and pixel' },
  { name: 'Down through a code block, from the start of a row', body: fenced, start: [], steps: downBy(9), follow: 'plain field' },
  { name: 'Up through a code block, from the start of a row', body: fenced, start: [ctrl('End'), 'Home'], steps: downBy(9, 'ArrowUp'), follow: 'plain field' },
  { name: 'Shift+Up from the blank row below a code block', body: 'top\n\n```\ncode one\ncode two\n```\n\nend', start: [ctrl('End'), 'Home'], steps: downBy(4, 'Shift+ArrowUp'), follow: 'plain field' },
  { name: 'Shift+Down through a code block', body: 'top\n\n```\ncode one\ncode two\n```\n\nend', start: [], steps: downBy(7, 'Shift+ArrowDown'), follow: 'plain field' },
  { name: 'Shift+Up from the middle of a row over the blank row below a code block', body: '```\ncode\n```\n\nz', start: [ctrl('End')], steps: downBy(2, 'Shift+ArrowUp'), follow: 'plain field' },
  { name: 'Shift+Up from the middle of a row through the nested items of a quote', body: '> a\n> - b\n>   - c\n\nd', start: [ctrl('End')], steps: downBy(3, 'Shift+ArrowUp'), follow: 'plain field' },
  { name: 'Down through setext headings and their underlines, from the start of a row', body: setext, start: [], steps: downBy(9), follow: 'plain field' },
  { name: 'Up through setext headings and their underlines, from the start of a row', body: setext, start: [ctrl('End'), 'Home'], steps: downBy(9, 'ArrowUp'), follow: 'plain field' },
  { name: 'Shift+Up through setext headings and their underlines', body: setext, start: [ctrl('End'), 'Home'], steps: downBy(8, 'Shift+ArrowUp'), follow: 'plain field' },
  { name: 'Shift+Down through setext headings and their underlines', body: setext, start: [], steps: downBy(8, 'Shift+ArrowDown'), follow: 'plain field' },
  { name: 'Down through rules, from the start of a row', body: rules, start: [], steps: downBy(9), follow: 'plain field' },
  { name: 'Up through rules, from the start of a row', body: rules, start: [ctrl('End'), 'Home'], steps: downBy(9, 'ArrowUp'), follow: 'plain field' },
  { name: 'Shift+Up through rules', body: rules, start: [ctrl('End')], steps: downBy(9, 'Shift+ArrowUp'), follow: 'plain field' },
  { name: 'Shift+Down through rules', body: rules, start: [], steps: downBy(9, 'Shift+ArrowDown'), follow: 'plain field' },
  { name: 'Down and Up over a row the page wraps', body: wrapped, start: rightBy(10), steps: [...downBy(4), ...downBy(4, 'ArrowUp')], follow: 'wrapped' },
  { name: 'Shift+Down and Shift+Up over a row the page wraps', body: wrapped, start: rightBy(10), steps: [...downBy(4, 'Shift+ArrowDown'), ...downBy(4, 'Shift+ArrowUp')], follow: 'wrapped' },
  { name: 'Shift+Down from the start of each row of the page in a wrapped paragraph', body: wrapped, start: [], steps: downBy(4, 'Shift+ArrowDown'), follow: 'wrapped', paceMs: 70 },
  { name: 'Down, then Shift+Down, from the start of a row of the page in a wrapped paragraph', body: wrapped, start: [], steps: ['ArrowDown', ...downBy(3, 'Shift+ArrowDown')], follow: 'wrapped', paceMs: 70 },
  { name: 'Shift+Down from the start of rows of the page through a wrapped paragraph, heading, quote and list item', body: wrappedBlocks, start: [], steps: downBy(16, 'Shift+ArrowDown'), follow: 'wrapped', paceMs: 70 },
  { name: 'Down through a wrapped paragraph, heading, quote and list item, from the start of a row', body: wrappedBlocks, start: [], steps: downBy(16), follow: 'wrapped', paceMs: 70 },
  { name: 'Shift+Up from the start of rows of the page back through a wrapped list item, quote, heading and paragraph', body: wrappedBlocks, start: [ctrl('End'), 'Home'], steps: downBy(16, 'Shift+ArrowUp'), follow: 'wrapped', paceMs: 70 },
  { name: 'Up from the end of rows of the page back through a wrapped list item, quote, heading and paragraph', body: wrappedBlocks, start: [ctrl('End')], steps: downBy(16, 'ArrowUp'), follow: 'wrapped', paceMs: 70 },
  {
    name: 'Shift+Down then Shift+Up over a row whose marks are hidden returns to where it began',
    body: 'some **bold** words here\n\nplain second paragraph text',
    start: ['End', ...times(3, 'ArrowLeft')],
    steps: [{ key: 'Shift+ArrowDown', follow: 'row and pixel' }, 'Shift+ArrowUp'],
    follow: 'plain field',
  },
  {
    name: 'Ctrl+Up and Ctrl+Down move from the head of a selection across rows',
    body: '# Head\n\nfirst para\n\n- item one\n- item two\n\n> quote line\n\nlast para',
    start: downBy(2),
    steps: [...downBy(3, 'Shift+ArrowDown'), ctrl('ArrowUp'), ctrl('ArrowDown')],
    follow: 'plain field',
  },
  { name: 'Ctrl+Down on the whole note', body: '# Head\n\nfirst para\n\n- item one\n- item two\n\n> quote line\n\nlast para', start: [ctrl('a')], steps: [ctrl('ArrowDown')], follow: 'plain field' },
  {
    name: 'Ctrl+Shift+Right through words with hidden marks',
    body: 'one\n\npara **bold** end',
    start: [],
    steps: times(8, ctrl('Shift+ArrowRight')),
    follow: 'plain field',
    paceMs: 150,
    skipHeldRun: true,
    hiddenMarkPairs: [[10, 18]],
  },
  {
    name: 'Ctrl+Shift+Left through words with hidden marks, from the paragraph below',
    body: 'para **bold** end\n\nlast',
    start: [ctrl('End')],
    steps: times(8, ctrl('Shift+ArrowLeft')),
    follow: 'plain field',
    paceMs: 150,
    skipHeldRun: true,
    hiddenMarkPairs: [[5, 13]],
  },
  {
    name: 'Ctrl+Shift+Left through words with hidden marks',
    body: 'one\n\npara **bold** end',
    start: [ctrl('End')],
    steps: times(8, ctrl('Shift+ArrowLeft')),
    follow: 'plain field',
    paceMs: 150,
  },
  {
    name: 'Ctrl+Right through words with hidden marks, then Ctrl+Shift+Down, then Ctrl+Shift+Up',
    body: 'one\n\npara **bold** end\n\nlast paragraph here',
    start: [],
    steps: [...times(6, ctrl('ArrowRight')), ...times(2, ctrl('Shift+ArrowDown')), ctrl('Shift+ArrowUp')],
    follow: 'row and pixel',
    paceMs: 150,
    hiddenMarkPairs: [[10, 18]],
  },
  {
    name: 'Shift+Right and Backspace past the hidden marks of a list item and a heading',
    body: 'one\n\n- item\n\n## Head',
    start: ['End'],
    steps: [...times(9, 'Shift+ArrowRight'), 'Backspace'],
    follow: 'plain field',
  },
  {
    name: 'Shift+Home and Shift+End on a painted selection that ends in a list item',
    body: 'one\n\n- item\n\n## Head',
    start: ['End', ...times(2, 'Shift+ArrowRight')],
    steps: ['Shift+Home', 'Shift+End', 'Shift+Home'],
    follow: 'plain field',
  },
  {
    name: 'Ctrl+Home from the last paragraph goes to the top of the note, then Shift+Down',
    body: 'alpha one\n\nbravo two\n\nlast',
    start: [ctrl('End')],
    steps: [ctrl('Home'), ...times(3, 'Shift+ArrowDown'), ctrl('End')],
    follow: 'plain field',
  },
  {
    name: 'Shift+Down from the start of the row above a quote, then a letter, keeps the quote mark',
    body: 'first para here\n\n> quote line',
    start: ['ArrowDown'],
    steps: ['Shift+ArrowDown', 'x'],
    follow: 'plain field',
  },
  {
    name: 'Page Up and Page Down on a selection when nothing scrolls',
    body: 'line1\nline2',
    start: ['Shift+ArrowRight', 'Shift+ArrowRight'],
    steps: ['PageUp', 'PageDown'].map((step) => ({ key: step, follow: 'plain field' as const })),
    follow: 'plain field',
  },
  {
    name: 'a typed letter, then Shift+Down twice, in one frame',
    body: 'aaaa\n'.repeat(6),
    start: [],
    steps: ['a', 'Shift+ArrowDown', 'Shift+ArrowDown'],
    follow: 'plain field',
    sendAllAtOnce: true,
    onlyAllAtOnce: true,
    heldRepeats: 12,
    frameBeforeSteps: true,
  },
  {
    name: 'Enter, then Shift+Up, in one frame',
    body: 'a',
    start: ['End'],
    steps: ['Enter', 'Shift+ArrowUp'],
    follow: 'plain field',
    sendAllAtOnce: true,
    onlyAllAtOnce: true,
  },
  {
    name: 'Shift+Down, then Enter, in one frame',
    body: 'alpha beta\n\nsecond para here\nthird row\n\nlast',
    start: [],
    steps: ['Shift+ArrowDown', 'Enter'],
    follow: 'plain field',
    sendAllAtOnce: true,
    onlyAllAtOnce: true,
    stallMs: 80,
    holdFramesWhileSending: true,
    cpuSlowdown: 1,
    heldRepeats: 30,
  },
  {
    name: 'Shift+Down, then a letter, Backspace and Left, in one frame',
    body: 'alpha beta\n\nsecond para here\nthird row\n\nlast',
    start: [],
    steps: ['Shift+ArrowDown', 'x', 'Backspace', 'ArrowLeft', 'y'],
    follow: 'plain field',
    sendAllAtOnce: true,
    onlyAllAtOnce: true,
    holdFramesWhileSending: true,
    cpuSlowdown: 1,
  },
  {
    name: 'Shift+Down, then Right and Ctrl+Backspace at the start of a row, in one frame',
    body: 'alpha beta\nmore\n\nlast',
    start: [],
    steps: ['Shift+ArrowDown', 'ArrowRight', ctrl('Backspace')],
    follow: 'plain field',
    sendAllAtOnce: true,
    onlyAllAtOnce: true,
    holdFramesWhileSending: true,
    cpuSlowdown: 1,
  },
  {
    name: 'Shift+Down twice, then Shift+Up, in one frame',
    body: 'alpha beta\n\nsecond para here\nthird row\n\nlast',
    start: [],
    steps: ['Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowUp'],
    follow: 'plain field',
    sendAllAtOnce: true,
    onlyAllAtOnce: true,
    holdFramesWhileSending: true,
    cpuSlowdown: 1,
  },
  {
    name: 'a typed letter, then Up',
    body: 'a\n',
    start: [ctrl('End')],
    steps: ['b', 'ArrowUp'],
    follow: 'plain field',
    alsoWithViewSwitch: true,
    holdFramesWhileSending: true,
  },
  {
    name: 'a typed letter, then Shift+Up',
    body: 'a',
    start: ['End'],
    steps: ['d', 'Shift+ArrowUp'],
    follow: 'plain field',
    alsoWithViewSwitch: true,
  },
  {
    name: 'a typed letter, then Page Up',
    body: 'a',
    start: ['End'],
    steps: ['x', 'PageUp'],
    follow: 'plain field',
    alsoWithViewSwitch: true,
  },
  {
    name: 'a long run of keys with no pause between them',
    body: '# Head one\n\nbody text here\n\n## Two\nline\n\nend',
    start: [],
    steps: ['ArrowDown', 'End', 'Enter', 'ArrowLeft', 'a', 'b', 'Shift+ArrowRight', ctrl('Shift+ArrowRight'), 'Backspace', 'ArrowUp', 'Shift+End', 'Shift+ArrowDown', ctrl('ArrowRight'), ctrl('Shift+ArrowRight'), 'Shift+Home', 'x'],
    follow: 'plain field',
    sendAllAtOnce: true,
    onlyAllAtOnce: true,
    frameBeforeSteps: true,
    holdFramesWhileSending: true,
    compareToPacedPage: true,
  },
];

const cache = new Map<string, Promise<{ from: { anchor: Cell; head: Cell; x: number; y: number }; states: Plain[] }>>();

async function runPlan(editor: Editing, run: Run) {
  let found = cache.get(run.name);
  if (!found) {
    found = (async () => {
      await editor.open(run.body);
      for (const step of run.start) await editor.fixtures.browser.keyboard.press(key(step));
      const start = await look(editor, run.body.split('\n'));
      if ('problem' in start) throw new Error(`${run.name}: before the run, ${start.problem}`);
      await editor.fixtures.app.open('/blank');
      const done = await plainPresses(editor, run.body, start.anchor, start.head, run.steps.map(key));
      return { from: { anchor: start.anchor, head: start.head, x: start.x, y: start.y }, states: done };
    })();
    cache.set(run.name, found);
  }
  return found;
}

function wholePairs(run: Run, states: Plain[]): Plain[] {
  const pairs = run.hiddenMarkPairs;
  if (!pairs) return states;
  const cut = (value: string, cell: Cell) => {
    const at = offsetOfCell(value, cell);
    return pairs.find(([from, to]) => at > from && at < to);
  };
  const painted = (state: Plain) => {
    const [top, bottom] = [state.anchor[0], state.head[0]].sort((a, b) => a - b);
    return state.value.split('\n').slice(top, bottom + 1).includes('');
  };
  const kept = states.filter((state) => !(painted(state) && cut(state.value, state.head)));
  return states.map((_, index) => kept[Math.min(index, kept.length - 1)]!);
}

async function begin(editor: Editing, run: Run) {
  await editor.open(run.body);
  for (const step of run.start) await editor.fixtures.browser.keyboard.press(key(step));
  await editor.fixtures.page.nextFrame();
}

function judgeWrapped(step: string, before: Look, after: Look, first: Look, rowLength: number) {
  const down = /Down/.test(step);
  const problems: string[] = [];
  const moved = down ? after.y > before.y + 1 || after.head[0] > before.head[0] : after.y < before.y - 1 || after.head[0] < before.head[0];
  const atEnd = !moved && before.head[0] === after.head[0] && after.head[1] === (down ? rowLength : 0);
  const leftmost = after.lineStart === true && after.x > first.x;
  if (Math.abs(after.x - first.x) > pixelSlack && !(after.head[1] === 0 || after.head[0] !== before.head[0] || leftmost || atEnd)) {
    problems.push(`the caret is ${Math.round(after.x)}px across at ${after.head}, where the run began at ${Math.round(first.x)}px`);
  }
  if (!moved && !atEnd) {
    problems.push(`the caret did not go ${down ? 'down' : 'up'} a row of the page: it went from ${before.head} at ${Math.round(before.y)}px down to ${after.head} at ${Math.round(after.y)}px`);
  }
  return problems;
}

const virtualKeys: Record<string, number> = { Enter: 13, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34 };
const modifierBits: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const modifierKeys: Record<string, [string, number]> = { Control: ['ControlLeft', 17], Shift: ['ShiftLeft', 16], Alt: ['AltLeft', 18], Meta: ['MetaLeft', 91] };

function keyEvents(spec: string) {
  const parts = spec.replace('ControlOrMeta', 'Control').split('+');
  const main = parts.pop()!;
  const bits = parts.reduce((sum, part) => sum | modifierBits[part]!, 0);
  const events: Record<string, unknown>[] = [];
  let held = 0;
  for (const part of parts) {
    held |= modifierBits[part]!;
    const [code, vk] = modifierKeys[part]!;
    events.push({ type: 'rawKeyDown', key: part, code, windowsVirtualKeyCode: vk, modifiers: held, location: 1 });
  }
  const named = virtualKeys[main];
  const common = { key: main, code: named ? main : `Key${main.toUpperCase()}`, windowsVirtualKeyCode: named ?? main.toUpperCase().charCodeAt(0), modifiers: bits };
  const text = bits & (modifierBits['Control']! | modifierBits['Alt']! | modifierBits['Meta']!) ? undefined : main === 'Enter' ? '\r' : main.length === 1 ? main : undefined;
  events.push(text ? { type: 'keyDown', ...common, text, unmodifiedText: text } : { type: 'rawKeyDown', ...common });
  events.push({ type: 'keyUp', ...common });
  for (const part of [...parts].reverse()) {
    held &= ~modifierBits[part]!;
    const [code, vk] = modifierKeys[part]!;
    events.push({ type: 'keyUp', key: part, code, windowsVirtualKeyCode: vk, modifiers: held, location: 1 });
  }
  return events;
}

function holdFrames() {
  const page = window as unknown as { heldFrames?: FrameRequestCallback[]; letFrame?: typeof requestAnimationFrame };
  page.heldFrames = [];
  page.letFrame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => {
    page.heldFrames!.push(callback);
    return 0;
  };
}

function releaseFrames() {
  const page = window as unknown as { heldFrames: FrameRequestCallback[]; letFrame: typeof requestAnimationFrame };
  window.requestAnimationFrame = page.letFrame;
  for (const callback of page.heldFrames) page.letFrame(callback);
}

async function pressTogether(origin: string, run: Run, withViewSwitch: boolean, times: number, paced = false) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1280, height: 800 } });
    const raw = await context.newPage();
    await raw.goto(`${origin}/`);
    await raw.getByLabel('Note text').click();
    const frames = () => raw.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const session = await context.newCDPSession(raw);
    await session.send('Emulation.setCPUThrottlingRate', { rate: run.cpuSlowdown ?? 4 });
    const found: Plain[] = [];
    for (let again = 0; again < times; again++) {
      if (again > 0) {
        await raw.evaluate(async () => {
          const rows = () => document.querySelectorAll('[data-test-id=note-list] li').length;
          const before = rows();
          document.querySelector<HTMLElement>('[data-test-id=new-note]')!.click();
          for (let wait = 0; wait < 200; wait++) {
            await new Promise((done) => requestAnimationFrame(done));
            const field = document.querySelector('textarea');
            if (rows() > before && field && field.value === '' && document.activeElement === field) return;
          }
          throw new Error('the new note did not open');
        });
      }
      await raw.evaluate((text: string) => navigator.clipboard.writeText(text), run.body);
      const holdAll = run.holdFramesWhileSending && !run.frameBeforeSteps && !paced;
      if (holdAll) await raw.evaluate(holdFrames);
      await raw.keyboard.press('Control+v');
      const send = (keys: string[]) => Promise.all(keys.flatMap(keyEvents).map((event) => session.send('Input.dispatchKeyEvent', event as never)));
      const steps = run.steps.map(key);
      if (withViewSwitch) steps.push('Control+e');
      const held = async (keys: string[]) => {
        if (run.holdFramesWhileSending && !holdAll) await raw.evaluate(holdFrames);
        await send(keys);
        if (run.holdFramesWhileSending) await raw.evaluate(releaseFrames);
      };
      if (paced) {
        for (const step of ['Control+Home', ...run.start.map(key), ...steps]) {
          await send([step]);
          await frames();
        }
      } else if (run.frameBeforeSteps) {
        await send(['Control+Home', ...run.start.map(key)]);
        await raw.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
        await held(steps);
      } else {
        if (run.stallMs) void raw.evaluate((ms: number) => { for (const from = performance.now(); performance.now() - from < ms; ); }, run.stallMs);
        await held(['Control+Home', ...run.start.map(key), ...steps]);
      }
      await frames();
      if (!withViewSwitch) await raw.keyboard.press('Control+e');
      await frames();
      const field = await raw.evaluate(() => {
        const c = document.querySelector('textarea')!;
        const backward = c.selectionDirection === 'backward';
        return { value: c.value, anchor: backward ? c.selectionEnd : c.selectionStart, head: backward ? c.selectionStart : c.selectionEnd };
      });
      found.push({ value: field.value, anchor: rowCol(field.value, field.anchor), head: rowCol(field.value, field.head) });
      await raw.keyboard.press('Control+e');
      await frames();
    }
    return found;
  } finally {
    await browser.close();
  }
}

const failingRuns = new Map<string, { paced?: string; held?: string; sendAllAtOnce?: string; alsoWithViewSwitch?: string }>();

for (const run of runs) {
  const pending = failingRuns.get(run.name);
  const lines = (value: string) => value.split('\n');

  if (!run.onlyAllAtOnce) test(`${run.name}, a key at a time, leaves the cursor and selection where a plain text field does`, async (fixtures) => {
    const editor = new Editing(fixtures);
    const plan = await runPlan(editor, run);
    if (pending?.paced) test.fail(pending.paced);
    const wants = wholePairs(run, plan.states);
    await begin(editor, run);
    const problems: string[] = [];
    let goalX = plan.from.x;
    let before: Look = { ...plan.from };
    let first = before;
    for (const [index, step] of run.steps.entries()) {
      const name = key(step);
      await fixtures.browser.keyboard.press(name);
      if (run.paceMs) await pause(run.paceMs);
      const want = wants[index]!;
      const got = await look(editor, lines(want.value));
      if ('problem' in got) {
        problems.push(`step ${index + 1} (${name}): ${got.problem}`);
        break;
      }
      if (run.follow === 'wrapped') {
        const found = judgeWrapped(name, before, got, first, (lines(want.value)[got.head[0]] ?? '').length);
        for (const problem of found) problems.push(`step ${index + 1} (${name}): ${problem}`);
      } else {
        const follow: Follow = typeof step === 'string' ? (isVertical(name) ? run.follow : 'plain field') : step.follow;
        const line = lines(want.value)[got.head[0]] ?? '';
        for (const problem of judge(isPage(name) && follow !== 'plain field' ? 'row' : follow, want, got, goalX, line.length)) problems.push(`step ${index + 1} (${name}): ${problem}`);
      }
      if (!isVertical(name)) {
        goalX = got.x;
        first = got;
      }
      before = got;
      if (problems.length > 0) break;
    }
    expect(problems).toEqual([]);
  });

  if (!run.onlyAllAtOnce && !run.skipHeldRun) test(`${run.name}, with no frame between the keys, ends where a plain text field does`, async (fixtures) => {
    const editor = new Editing(fixtures);
    const plan = await runPlan(editor, run);
    if (pending?.held) test.fail(pending.held);
    const wanted = wholePairs(run, plan.states).at(-1)!;
    const problems: string[] = [];
    let paced: Look | null = null;
    if (run.follow === 'wrapped') {
      await begin(editor, run);
      for (const step of run.steps) {
        await fixtures.browser.keyboard.press(key(step));
        const got = await look(editor, lines(wanted.value));
        paced = 'problem' in got ? null : got;
      }
    }
    for (let again = 0; again < (run.heldRepeats ?? 1); again++) {
      await begin(editor, run);
      for (const step of run.steps) await fixtures.browser.keyboard.press(key(step));
      const got = await look(editor, lines(wanted.value));
      if ('problem' in got) {
        problems.push(`press ${again + 1}: ${got.problem}`);
        continue;
      }
      if (run.follow === 'wrapped') {
        if (!paced || !same(paced.anchor, got.anchor) || !same(paced.head, got.head)) {
          problems.push(`press ${again + 1}: a frame apart the keys select from ${paced?.anchor} to ${paced?.head}, with no frame between them from ${got.anchor} to ${got.head}`);
        }
        continue;
      }
      const last = key(run.steps.at(-1)!);
      const line = lines(wanted.value)[got.head[0]] ?? '';
      const follow: Follow = isVertical(last) ? run.follow : 'plain field';
      for (const problem of judge(follow, wanted, got, plan.from.x, line.length)) problems.push(`press ${again + 1}: ${problem}`);
    }
    expect(problems).toEqual([]);
  });

  if (run.alsoWithViewSwitch) {
    test(`${run.name}, then Ctrl+E in the same frame, ends where a plain text field does`, async (fixtures) => {
      const editor = new Editing(fixtures);
      const plan = await runPlan(editor, run);
      if (pending?.alsoWithViewSwitch) test.fail(pending.alsoWithViewSwitch);
      const wanted = plan.states.at(-1)!;
      await fixtures.app.open('/blank');
      const origin = new URL(await fixtures.browser.url()).origin;
      const problems: string[] = [];
      for (const [again, got] of (await pressTogether(origin, run, true, run.heldRepeats ?? 6)).entries()) {
        const state = { anchor: got.anchor, head: got.head, x: NaN, y: NaN };
        if (got.value !== wanted.value) problems.push(`press ${again + 1}: the plain field holds ${JSON.stringify(wanted.value)}, the page ${JSON.stringify(got.value)}`);
        for (const problem of judge('plain field', wanted, state, NaN, 0)) problems.push(`press ${again + 1}: ${problem}`);
      }
      expect(problems).toEqual([]);
    });
  }

  if (run.sendAllAtOnce) {
    const against = run.compareToPacedPage ? 'the same keys pressed a frame apart do' : 'a plain text field does';
    test(`${run.name}, with the keys sent at once, ends where ${against}`, async (fixtures) => {
      const editor = new Editing(fixtures);
      const plan = await runPlan(editor, run);
      if (pending?.sendAllAtOnce) test.fail(pending.sendAllAtOnce);
      await fixtures.app.open('/blank');
      const origin = new URL(await fixtures.browser.url()).origin;
      const wanted = run.compareToPacedPage ? (await pressTogether(origin, run, false, 1, true))[0]! : plan.states.at(-1)!;
      const field = run.compareToPacedPage ? 'the page with a frame between the keys' : 'the plain field';
      const problems: string[] = [];
      for (const [again, got] of (await pressTogether(origin, run, false, run.heldRepeats ?? 6)).entries()) {
        const state = { anchor: got.anchor, head: got.head, x: NaN, y: NaN };
        if (got.value !== wanted.value) problems.push(`press ${again + 1}: ${field} holds ${JSON.stringify(wanted.value)}, the page ${JSON.stringify(got.value)}`);
        for (const problem of judge('plain field', wanted, state, NaN, 0)) problems.push(`press ${again + 1}: ${problem}`);
      }
      expect(problems).toEqual([]);
    });
  }
}

const underHeadings = [`# ${'word '.repeat(50)}end`, '', `### ${'word '.repeat(70)}end`, '', 'below'];

// A text field moves Shift+Up on a backward selection whose head is at the
// start of a wrapped line on from the line above, so from the start of one
// line it lands at the start of the line two above. From the blank row below
// the h3 the selection is painted across rows and each Shift+Up lands a line
// above; from inside the h3 it is in the field and lands two lines above.
for (const [name, row, skips] of [['an h1', 1, true], ['an h3', 3, false]] as const) {
  const title = skips
    ? `Shift+Up from the blank row below ${name} the page wraps reaches the rows a plain text field does, a key at a time`
    : `Up and Shift+Up from the blank row below ${name} the page wraps reach the same rows of it, a key at a time`;
  test(title, async (fixtures) => {
    const editor = new Editing(fixtures);
    const body = underHeadings.join('\n');
    const lines = body.split('\n');
    const heads = async (step: string, presses: number) => {
      await editor.open(body);
      await fixtures.browser.keyboard.press(ctrl('End'));
      await fixtures.browser.keyboard.press('Home');
      for (let up = 4; up > row; up--) await fixtures.browser.keyboard.press('ArrowUp');
      const seen: string[] = [];
      for (let press = 0; press < presses; press++) {
        await fixtures.browser.keyboard.press(step);
        const got = await look(editor, lines);
        seen.push('problem' in got ? got.problem : show(got.head));
      }
      return seen;
    };
    const up = await heads('ArrowUp', 5);
    expect(await heads('Shift+ArrowUp', 3)).toEqual(skips ? [up[0], up[2], up[4]] : up.slice(0, 3));
  });
}
