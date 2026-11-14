import { expect } from 'e2e';
import { chromium } from 'playwright-core';
import { ctrl, Editing } from './editing.ts';
import { cursorAt, selectionOf } from './guards.ts';
import { pause, test } from './nullpad.ts';

/**
 * Two checklists of movement, each compared with a plain text field holding the
 * same markdown, and each pressed where `movement-keys.e2e.ts` does not press:
 *
 * - every key that moves the caret, pressed on a selection that already exists:
 *   inside one block, forward and backward, painted across blocks, forward and
 *   backward, from column 0 and from the middle of a row, and after Ctrl+A;
 * - runs of keys, vertical ones above all, that keep a column across presses:
 *   through short rows, wrapped rows, rows whose marks the page hides, list
 *   items, code blocks, setext underlines and rules; each press is looked at,
 *   and then the same run is pressed with no frame between its keys.
 *
 * A key that goes up or down keeps the caret's place across the page, and the
 * page draws proportional type and larger headings, so its column is not the
 * plain field's, except where the caret starts a row or the rows are plain text.
 * Those are held to the plain field to the letter. The others are held to its
 * row, and to the pixel the caret was at, within half a wide letter, or to the
 * end of a row too short to reach it.
 *
 * A case that fails today is marked with `test.fail` and the id of the finding
 * of the review it shows (F: Opus, X: Fable, B: blind, N: found while writing
 * this). Once the app is fixed the case passes, the mark fails it as an
 * unexpected pass, and the mark is deleted.
 */

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

/** A plain text field holding `body` with `anchor` to `head` selected, after each of `keys`. Runs on the blank page. */
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

/** The page draws the selection over the page, with no text field in sight. */
function paintedNow() {
  const highlights = globalThis.CSS?.highlights;
  const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]');
  return {
    painted: (highlights?.get('nullpad-selection')?.size ?? 0) > 0,
    field: field?.checkVisibility({ opacityProperty: true, visibilityProperty: true }) ?? false,
  };
}

type Look = { anchor: Cell; head: Cell; x: number; y: number };

/** Waits for the page to draw what was pressed, then reads the selection and where the caret is drawn. */
async function look(editor: Editing, lines: string[]): Promise<Look | { problem: string }> {
  const { browser, page } = editor.fixtures;
  await page.nextFrame();
  const got = await selectionOf(browser, lines);
  if ('problem' in got) return { problem: got.problem };
  const at = await cursorAt(browser);
  return { anchor: got.anchor, head: got.head, x: at?.x ?? NaN, y: at?.top ?? NaN };
}

type Follow = 'plain field' | 'row and pixel' | 'row' | 'wrapped';

const isVertical = (key: string) => /Arrow(Up|Down)$|Page(Up|Down)$/.test(key);
const isPage = (key: string) => /Page(Up|Down)$/.test(key);

/** What is wrong with where a key left the caret and the selection, given where the plain field left them. */
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

/**
 * Every key that moves the caret or the selection, with and without Shift and Ctrl.
 * Ctrl with Page Up or Page Down switches tabs, so it is not pressed.
 */
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

/** Where the state of a case puts the selection, and where a plain field goes from there with each key. Asked once for each state. */
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

/**
 * The cases that fail today, by state and key: the id of the finding of the review that shows it.
 * A key pressed on a painted selection leaves it painted, or draws it where the page puts the head.
 */
const forwardStart = 'a painted selection across blocks, forward, its head at the start of a row';
const forwardMiddle = 'a painted selection across blocks, forward, its head in the middle of a row';
const backwardStart = 'a painted selection across blocks, backward, its head at the start of a row';
const backwardMiddle = 'a painted selection across blocks, backward, its head in the middle of a row';
const wholeNote = 'the whole note, after Ctrl+A';
const up = ctrl('ArrowUp');
const down = ctrl('ArrowDown');

const failing = new Map<string, string>([
  // X7: Ctrl+Up and Ctrl+Down with a selection across rows move from the start of the selection, not from its head.
  [`${forwardStart}|${up}`, 'X7'],
  [`${forwardStart}|${down}`, 'X7'],
  [`${forwardMiddle}|${up}`, 'X7'],
  [`${forwardMiddle}|${down}`, 'X7'],
  [`${wholeNote}|${up}`, 'X7'],
  [`${wholeNote}|${down}`, 'X7'],
  // B5: Page Up and Page Down collapse a selection when nothing scrolls, where a plain field keeps it.
  [`${forwardStart}|PageUp`, 'B5'],
  [`${forwardMiddle}|PageUp`, 'B5'],
  [`${backwardMiddle}|PageDown`, 'B5'],
  [`${wholeNote}|PageUp`, 'B5'],
  [`${wholeNote}|PageDown`, 'B5'],
  // X6: a letter step of a painted head lands after the hidden marks of the row it enters.
  [`${forwardStart}|Shift+ArrowRight`, 'X6'],
  [`${backwardStart}|Shift+ArrowRight`, 'X6'],
  // X4: Shift+Down skips the fence row of a code block.
  [`${backwardMiddle}|Shift+ArrowDown`, 'X4'],
]);

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
  /** Keys that put the caret where the run starts, from the start of the note. */
  start: Step[];
  steps: Step[];
  /** How the vertical keys are held: to the letter where the caret starts a row or the rows are plain text. */
  follow: Follow;
  /** The finding that shows when the run fails today, for the paced press and for the held one. */
  fail?: { paced?: string; held?: string };
  /** Milliseconds between presses of the paced run, where the page needs time to settle a painted selection. */
  pace?: number;
  /** The held run is pressed this many times, for a race that does not always happen. */
  repeat?: number;
  /** The run is also pressed with every key sent at once, where the keys do not wait for the page and so share its frames. */
  burst?: boolean;
  /** How many times slower the page's thread is made, so that keys pile up and share frames whatever the load of the machine. */
  throttle?: number;
  /** A frame is waited for between the keys that put the caret where the run starts and the keys of the run, when the keys are sent at once. */
  frameBeforeSteps?: boolean;
  /** Only the run with the keys sent at once is made: its keys compare a column the page and a plain field place differently. */
  burstOnly?: boolean;
  /** The run is also pressed with Ctrl+E, which shows the source, sent with its keys. */
  viewSwitch?: boolean;
  /** The page's thread is held this many milliseconds while the keys of the run are sent, so that they all arrive before it draws. */
  stall?: number;
  /** The run is not pressed with no frame between its keys: whether the page has drawn between two keys of the harness's keyboard depends on the load of the machine. */
  noHeld?: boolean;
};

const key = (step: Step) => (typeof step === 'string' ? step : step.key);

const plainRows = ['abcdefghijklmnopqrstuvwxyz', 'abcdef', '', 'abcdefghijklmnopqrstuvwxyz', 'abcdefghij', 'abcdefghijklmnopqrstuvwxyz', '', 'xy', 'abcdefghijklmnopqrstuvwxyz'].join('\n');
const marked = ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '', '## bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '', '> cccccccccccccccccccccccccccccc', '', '1. dddddddddddddddddddddddddddddd', '', '- eeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '- ffffffffffffffffffffffffffffff', '', 'gggggggggggggggggggggggggggggg'].join('\n');
const blocks = ['# alpha', '', '- one', '- two', '', '> quote', '', '1. first', '2. second', '', 'text'].join('\n');
const fenced = ['para text here to start', '', '```', 'code line one is longer', 'short', 'code line three is long', '```', '', 'tail paragraph that is long'].join('\n');
const setext = ['Head one', '========', '', 'text under it', '', 'Head two', '--------', '', 'last'].join('\n');
const rules = ['a', '', '---', '', 'b', '', '***', 'c', '---', 'd'].join('\n');
const wrapped = `${'word '.repeat(40)}end\n\nnext paragraph`;

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
    pace: 150,
    noHeld: true,
  },
  {
    name: 'Ctrl+Shift+Left through words with hidden marks',
    body: 'one\n\npara **bold** end',
    start: [ctrl('End')],
    steps: times(8, ctrl('Shift+ArrowLeft')),
    follow: 'plain field',
    pace: 150,
  },
  {
    name: 'Ctrl+Right through words with hidden marks, then Ctrl+Shift+Down, then Ctrl+Shift+Up',
    body: 'one\n\npara **bold** end\n\nlast paragraph here',
    start: [],
    steps: [...times(6, ctrl('ArrowRight')), ...times(2, ctrl('Shift+ArrowDown')), ctrl('Shift+ArrowUp')],
    follow: 'plain field',
    pace: 150,
  },
  {
    name: 'Shift+Right and Backspace past the hidden marks of a list item and a heading',
    body: 'one\n\n- item\n\n## Head',
    start: ['End'],
    steps: ['Shift+ArrowRight', 'Shift+ArrowRight', 'Shift+ArrowRight', 'Shift+ArrowRight'],
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
    burst: true,
    burstOnly: true,
    repeat: 12,
    frameBeforeSteps: true,
  },
  {
    name: 'Enter, then Shift+Up, in one frame',
    body: 'a',
    start: ['End'],
    steps: ['Enter', 'Shift+ArrowUp'],
    follow: 'plain field',
    burst: true,
    burstOnly: true,
  },
  {
    name: 'Shift+Down, then Enter, in one frame',
    body: 'alpha beta\n\nsecond para here\nthird row\n\nlast',
    start: [],
    steps: ['Shift+ArrowDown', 'Enter'],
    follow: 'plain field',
    burst: true,
    burstOnly: true,
    stall: 80,
    throttle: 1,
    repeat: 30,
  },
  {
    name: 'a typed letter, then Up',
    body: 'a\n',
    start: [ctrl('End')],
    steps: ['b', 'ArrowUp'],
    follow: 'plain field',
    viewSwitch: true,
  },
  {
    name: 'a typed letter, then Shift+Up',
    body: 'a',
    start: ['End'],
    steps: ['d', 'Shift+ArrowUp'],
    follow: 'plain field',
    viewSwitch: true,
  },
  {
    name: 'a typed letter, then Page Up',
    body: 'a',
    start: ['End'],
    steps: ['x', 'PageUp'],
    follow: 'plain field',
    viewSwitch: true,
  },
  {
    name: 'a long run of keys with no pause between them',
    body: '# Head one\n\nbody text here\n\n## Two\nline\n\nend',
    start: [],
    steps: ['ArrowDown', 'End', 'Enter', 'ArrowLeft', 'a', 'b', 'Shift+ArrowRight', ctrl('Shift+ArrowRight'), 'Backspace', 'ArrowUp', 'Shift+End', 'Shift+ArrowDown', ctrl('ArrowRight'), ctrl('Shift+ArrowRight'), 'Shift+Home', 'x'],
    follow: 'plain field',
    burst: true,
    burstOnly: true,
    frameBeforeSteps: true,
  },
];

const cache = new Map<string, Promise<{ from: { anchor: Cell; head: Cell; x: number }; states: Plain[] }>>();

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
      return { from: { anchor: start.anchor, head: start.head, x: start.x }, states: done };
    })();
    cache.set(run.name, found);
  }
  return found;
}

async function begin(editor: Editing, run: Run) {
  await editor.open(run.body);
  for (const step of run.start) await editor.fixtures.browser.keyboard.press(key(step));
  await editor.fixtures.page.nextFrame();
}

/** The wrapped rows have no plain field to follow: the caret goes down a row of the page at a time, keeping its pixel. */
function judgeWrapped(step: string, before: Look, after: Look, first: Look) {
  const down = /Down/.test(step);
  const problems: string[] = [];
  if (Math.abs(after.x - first.x) > pixelSlack && !(after.head[1] === 0 || after.head[0] !== before.head[0])) {
    problems.push(`the caret is ${Math.round(after.x)}px across, where the run began at ${Math.round(first.x)}px`);
  }
  const moved = down ? after.y > before.y + 1 || after.head[0] > before.head[0] : after.y < before.y - 1 || after.head[0] < before.head[0];
  const atEnd = down ? before.head[0] === after.head[0] && after.head[1] >= before.head[1] : before.head[0] === after.head[0] && after.head[1] <= before.head[1];
  if (!moved && !atEnd) problems.push(`the caret did not go ${down ? 'down' : 'up'} a row of the page`);
  return problems;
}

const virtualKeys: Record<string, number> = { Enter: 13, Backspace: 8, Delete: 46, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34 };
const modifierBits: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };
const modifierKeys: Record<string, [string, number]> = { Control: ['ControlLeft', 17], Shift: ['ShiftLeft', 16], Alt: ['AltLeft', 18], Meta: ['MetaLeft', 91] };

/** One key press as Chrome DevTools key events, modifiers included. Letters and the named keys of the runs. */
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

/**
 * Pastes the note into a page of its own, then sends every key of the run to the
 * browser at once, as a held key or a fast hand does, and reads the note and its selection
 * once the page has drawn and Ctrl+E has shown the source, where the text field
 * can be read. With `withViewSwitch` Ctrl+E goes with the keys. The harness's own keyboard waits for the page to
 * handle each key, which keeps two keys from sharing a frame.
 */
async function pressTogether(origin: string, run: Run, withViewSwitch: boolean, times: number) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1280, height: 800 } });
    const raw = await context.newPage();
    await raw.goto(`${origin}/`);
    await raw.getByLabel('Note text').click();
    const frames = () => raw.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const session = await context.newCDPSession(raw);
    await session.send('Emulation.setCPUThrottlingRate', { rate: run.throttle ?? 4 });
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
      await raw.keyboard.press('Control+v');
      const send = (keys: string[]) => Promise.all(keys.flatMap(keyEvents).map((event) => session.send('Input.dispatchKeyEvent', event as never)));
      const steps = run.steps.map(key);
      if (withViewSwitch) steps.push('Control+e');
      if (run.frameBeforeSteps) {
        await send(['Control+Home', ...run.start.map(key)]);
        await raw.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
        await send(steps);
      } else {
        if (run.stall) void raw.evaluate((ms: number) => { for (const from = performance.now(); performance.now() - from < ms; ); }, run.stall);
        await send(['Control+Home', ...run.start.map(key), ...steps]);
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

const both = (finding: string) => ({ paced: finding, held: finding });

const failingRuns = new Map<string, { paced?: string; held?: string; burst?: string; viewSwitch?: string }>([
  // X2: the column kept by Up and Down is lost through a short last row of a block and a blank row.
  ['Down through short rows, a blank row and a short last row of a block', { paced: 'X2' }],
  ['Up through short rows', { paced: 'X2' }],
  ['Shift+Down through short rows', { paced: 'X2' }],
  ['Shift+Up through short rows', { paced: 'X2' }],
  ['Down and Up through the short last row of a heading block and a long row', both('X2')],
  // F4: Ctrl+Up and Ctrl+Down do not keep the column.
  ['Ctrl+Down through short rows', { paced: 'F4' }],
  ['Ctrl+Up through short rows', { paced: 'F4' }],
  ['Ctrl+Shift+Down through short rows', { paced: 'F4' }],
  // B1: a column kept through a short row survives Ctrl+Home and the moves after it.
  ['a column kept through a short row is forgotten by Ctrl+Home and the moves after it', both('B1')],
  // B2: Shift+Down onto a short row, then Up, drops the column.
  ['Shift+Down onto a short row, then Up, goes back to the column the caret had', both('B2')],
  // F1: Up and Down from the start of a row land inside the hidden marks of the next row.
  ['Up from the start of a list item onto a heading', both('F1')],
  ['Down from the start of a list item onto a heading', both('F1')],
  ['Up from the start of a list item onto the row above it', both('F1')],
  ['Up from the start of a list item onto the row of the same block', both('F1')],
  ['Up from the start of a list item onto a table', both('F1')],
  // X4: Shift+Up from the blank row below a code block jumps over the whole block.
  ['Shift+Up from the blank row below a code block', both('X4')],
  ['Shift+Down through a code block', both('X4')],
  // B3: Shift+Up and Shift+Down skip a setext underline and a rule.
  ['Shift+Up through setext headings and their underlines', { paced: 'B3' }],
  ['Shift+Down through setext headings and their underlines', both('B3')],
  ['Shift+Up through rules', both('B3')],
  ['Shift+Down through rules', both('B3')],
  // X3: the column of Shift+Down is measured where the marks are shown and applied where they are hidden.
  ['Shift+Down then Shift+Up over a row whose marks are hidden returns to where it began', both('X3')],
  // X7: Ctrl+Up and Ctrl+Down with a selection across rows.
  ['Ctrl+Up and Ctrl+Down move from the head of a selection across rows', both('X7')],
  ['Ctrl+Down on the whole note', both('X7')],
  // X1: Ctrl+Shift+Right sticks before hidden marks, and the anchor is snapped.
  ['Ctrl+Shift+Right through words with hidden marks', { paced: 'X1' }],
  ['Ctrl+Right through words with hidden marks, then Ctrl+Shift+Down, then Ctrl+Shift+Up', both('X1')],
  // X6: a painted head lands after the hidden marks of a list item and a heading.
  ['Shift+Right and Backspace past the hidden marks of a list item and a heading', both('X6')],
  ['Shift+Home and Shift+End on a painted selection that ends in a list item', both('X6')],
  // B5: Page Up and Page Down collapse a selection.
  ['Page Up and Page Down on a selection when nothing scrolls', { paced: 'B5' }],
  // The races. X5: steps queued behind a step the text field takes are dropped. F5: a step after an edit measures the page before it.
  // F2: a key typed while a step waits cancels the step. B4: a long run of keys gives different results from run to run.
  ['a typed letter, then Shift+Down twice, in one frame', { burst: 'X5' }],
  ['Enter, then Shift+Up, in one frame', { burst: 'F5' }],
  ['Shift+Down, then Enter, in one frame', { burst: 'F2' }],
  ['a long run of keys with no pause between them', { burst: 'B4' }],
  // N1: Ctrl+E, which shows the source, pressed in the frame after a step drops the step.
  ['a typed letter, then Up', { viewSwitch: 'N1' }],
  ['a typed letter, then Shift+Up', { viewSwitch: 'N1' }],
  ['a typed letter, then Page Up', { viewSwitch: 'N1' }],
]);

for (const run of runs) {
  const pending = failingRuns.get(run.name);
  const lines = (value: string) => value.split('\n');

  if (!run.burstOnly) test(`${run.name}, a key at a time, leaves the cursor and selection where a plain text field does`, async (fixtures) => {
    const editor = new Editing(fixtures);
    const plan = await runPlan(editor, run);
    if (pending?.paced) test.fail(pending.paced);
    await begin(editor, run);
    const problems: string[] = [];
    let goalX = plan.from.x;
    let before: Look = { anchor: plan.from.anchor, head: plan.from.head, x: plan.from.x, y: NaN };
    let first = before;
    for (const [index, step] of run.steps.entries()) {
      const name = key(step);
      await fixtures.browser.keyboard.press(name);
      if (run.pace) await pause(run.pace);
      const want = plan.states[index]!;
      const got = await look(editor, lines(want.value));
      if ('problem' in got) {
        problems.push(`step ${index + 1} (${name}): ${got.problem}`);
        break;
      }
      if (run.follow === 'wrapped') {
        const found = judgeWrapped(name, before, got, first);
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

  if (!run.burstOnly && !run.noHeld) test(`${run.name}, with no frame between the keys, ends where a plain text field does`, async (fixtures) => {
    const editor = new Editing(fixtures);
    const plan = await runPlan(editor, run);
    if (pending?.held) test.fail(pending.held);
    const wanted = plan.states.at(-1)!;
    const problems: string[] = [];
    for (let again = 0; again < (run.repeat ?? 1); again++) {
      await begin(editor, run);
      for (const step of run.steps) await fixtures.browser.keyboard.press(key(step));
      const got = await look(editor, lines(wanted.value));
      if ('problem' in got) {
        problems.push(`press ${again + 1}: ${got.problem}`);
        continue;
      }
      const last = key(run.steps.at(-1)!);
      const line = lines(wanted.value)[got.head[0]] ?? '';
      const follow: Follow = run.follow === 'wrapped' ? 'row' : isVertical(last) ? run.follow : 'plain field';
      for (const problem of judge(follow, wanted, got, plan.from.x, line.length)) problems.push(`press ${again + 1}: ${problem}`);
    }
    expect(problems).toEqual([]);
  });

  if (run.viewSwitch) {
    test(`${run.name}, then Ctrl+E in the same frame, ends where a plain text field does`, async (fixtures) => {
      const editor = new Editing(fixtures);
      const plan = await runPlan(editor, run);
      if (pending?.viewSwitch) test.fail(pending.viewSwitch);
      const wanted = plan.states.at(-1)!;
      await fixtures.app.open('/blank');
      const origin = new URL(await fixtures.browser.url()).origin;
      const problems: string[] = [];
      for (const [again, got] of (await pressTogether(origin, run, true, run.repeat ?? 6)).entries()) {
        const state = { anchor: got.anchor, head: got.head, x: NaN, y: NaN };
        if (got.value !== wanted.value) problems.push(`press ${again + 1}: the plain field holds ${JSON.stringify(wanted.value)}, the page ${JSON.stringify(got.value)}`);
        for (const problem of judge('plain field', wanted, state, NaN, 0)) problems.push(`press ${again + 1}: ${problem}`);
      }
      expect(problems).toEqual([]);
    });
  }

  if (run.burst) {
    test(`${run.name}, with the keys sent at once, ends where a plain text field does`, async (fixtures) => {
      const editor = new Editing(fixtures);
      const plan = await runPlan(editor, run);
      if (pending?.burst) test.fail(pending.burst);
      const wanted = plan.states.at(-1)!;
      await fixtures.app.open('/blank');
      const origin = new URL(await fixtures.browser.url()).origin;
      const problems: string[] = [];
      for (const [again, got] of (await pressTogether(origin, run, false, run.repeat ?? 6)).entries()) {
        const state = { anchor: got.anchor, head: got.head, x: NaN, y: NaN };
        if (got.value !== wanted.value) problems.push(`press ${again + 1}: the plain field holds ${JSON.stringify(wanted.value)}, the page ${JSON.stringify(got.value)}`);
        for (const problem of judge('plain field', wanted, state, NaN, 0)) problems.push(`press ${again + 1}: ${problem}`);
      }
      expect(problems).toEqual([]);
    });
  }
}
