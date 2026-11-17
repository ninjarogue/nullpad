// Every known difference between nullpad and a plain textarea, in one place.
//
//   intended  nullpad differs on purpose. The typist never types the keys that show it.
//   open      a bug we know about. The typist leaves out the keys that show it, so the
//             rest of the run stays green and keeps looking. Its repro must still differ:
//             when it stops differing the run fails (like test.fixme failing once the test
//             passes) and the entry is deleted, which brings its keys back.
//
// repro     a short script that shows the difference. Open entries have one.
// pace      how fast the repro is typed at: 'burst' (the default), 'frame' or 'slow'.
// closeAtOnce  the repro is typed with the Ctrl+E that shows the source sent with its last keys, not a frame after them.
// tries     how often a repro that is a race is typed before it counts as fixed.
// finding   the id of the review finding behind an open entry (F: Opus, X: Fable, B: blind).
// skip      says whether a key of a generated script is left out, given the script so far typed
//           into a plain textarea (its text and where its selection is) and the pace. Open
//           entries skip the keys that show their bug, so the rest of the run stays green.
// shift     says whether a text shift (see shifts.mjs) is this bug's, given the problem the watcher
//           found: how far it moved and the blocks it is about. The shift is left out of the run
//           while the repro, typed a frame at a time, still shows it. Only open entries have one.
// sanitize  returns the script without the keys this entry cannot compare, or with a frame
//           waited for where it cannot be typed at speed. It runs on generated scripts only,
//           never on --script or --scripts. It gets the pace.
//
// `node typist/run.mjs --no-known` types everything and reports every difference.

/** @typedef {string | { paste: string } | { wait: true }} Key */
/** @typedef {{ value: string, anchor: number, head: number }} Caret The plain textarea's text and selection before a key. */
/** @typedef {import('./shifts.mjs').Problem} Problem */

const near = (n, to) => Math.abs(Math.abs(n) - to) < 0.2;
const fieldText = (problem) => problem.blocks.filter((b) => b.kind === 'field').map((b) => b.text);

/** A key whose result depends on where the caret is drawn across the page: Up and Down, with Shift or Ctrl, Page Up and Page Down. */
export const isVertical = (k) => /^(Control\+)?(Shift\+)?Arrow(Up|Down)$|^(Shift\+)?Page(Up|Down)$/.test(k);
const isPage = (k) => /Page(Up|Down)$/.test(k);
const isShiftHorizontal = (k) => /^(Control\+)?Shift\+(Arrow(Left|Right)|Home|End)$/.test(k);
const isWordSelect = (k) => /^Control\+Shift\+Arrow(Left|Right)$/.test(k);

const rowAt = (value, offset) => value.slice(0, offset).split('\n').length - 1;
const columnAt = (value, offset) => offset - (value.slice(0, offset).lastIndexOf('\n') + 1);
const atRowStart = (c) => columnAt(c.value, c.head) === 0;
const rows = (c) => c.value.split('\n');

const anyMark = /[#\-*>`|[\]~_=]/;
const inlineMark = /[*_~`[\]]/;

/** Whether every font lands a vertical key at the same column: from the start of a row, onto an empty row, or onto a row that shares the text left of the caret. */
const fontFree = (k, c) => {
  const all = rows(c);
  const row = rowAt(c.value, c.head);
  const column = columnAt(c.value, c.head);
  const up = /Up$/.test(k);
  const target = isPage(k) ? (up ? 0 : all.length - 1) : row + (up ? -1 : 1);
  if (column === 0 || target < 0 || target >= all.length || target === row) return true;
  const here = all[row].slice(0, column);
  const there = all[target];
  return there.startsWith(here) || here.startsWith(there);
};


/** Whether a key may be left out, so that the text before it is worth reading. */
export const judged = (k) => isVertical(k) || isShiftHorizontal(k);

/**
 * Whether a key is left out of the comparison, given what the plain textarea holds before it.
 * @param {string} k
 * @param {Key[]} script
 * @param {Caret} c
 * @param {string} pace
 */
export function skips(k, script, c, pace) {
  return known.some((entry) => entry.skip?.(k, c, pace));
}

/** @type {{ id: string, kind: 'intended' | 'open', finding?: string, reason: string, repro?: Key[], closeAtOnce?: boolean, pace?: 'burst' | 'frame' | 'slow', tries?: number, skip?: (k: string, c: Caret, pace: string) => boolean, shift?: (problem: Problem) => boolean, sanitize: (script: Key[], pace: string) => Key[] }[]} */
export const known = [
  {
    id: 'undo-steps',
    kind: 'intended',
    reason:
      'An undo step ends at a word and at a pause of a second, a textarea\'s does not, and the native undo stack is not a dependable reference. Ctrl+Z is never typed into the comparison; instead, after every script, pressing Ctrl+Z enough times must bring nullpad back to an empty note.',
    sanitize: (script) => script,
  },
  {
    id: 'vertical-column',
    kind: 'intended',
    reason:
      'Up and Down keep the caret\'s place across the drawn page, in the page\'s type, which is not the textarea\'s monospace and draws headings larger. So the column a vertical key lands on depends on the fonts, except where every font gives the same answer: the caret starts a row, or the row it goes to is empty, or the text left of the caret is also the start of the row it goes to (or the reverse, so the end of the shorter row is where it lands). Any other vertical key is left out. A page key goes as far as the page is tall, which a note of a few rows never reaches in either. Where the note has marks the page hides them, so only a caret that starts a row is compared.',
    skip: (k, c) => isVertical(k) && ((anyMark.test(c.value) && !atRowStart(c)) || !fontFree(k, c) || (isPage(k) && rows(c).length > 8)),
    sanitize: (script) => script,
  },
  {
    id: 'word-select-over-marks',
    kind: 'intended',
    reason:
      'The head of a painted selection that a key moves never ends inside a pair of marks the page hides. Where a textarea\'s word step stops inside a pair, as between ** and bold, the painted head goes on past the pair, or back before it, the way the step was going. Only a paced run paints between the keys, and only a selection across rows can be painted: one already across rows, or one whose head the step takes over the end of its row.',
    skip: (k, c, pace) => {
      if (pace === 'burst' || !isWordSelect(k) || !inlineMark.test(c.value)) return false;
      const line = rows(c)[rowAt(c.value, c.head)];
      const column = columnAt(c.value, c.head);
      const edge = /Right$/.test(k) ? line.slice(column).trim() === '' : line.slice(0, column).trim() === '';
      return rowAt(c.value, c.anchor) !== rowAt(c.value, c.head) || edge;
    },
    sanitize: (script) => script,
  },
  {
    id: 'painted-letter-over-marks',
    kind: 'intended',
    finding: 'B1',
    reason:
      'Shift and an arrow left or right on a selection painted across blocks steps one letter of the drawn page, so it also passes the marks the page hides beside that letter, and a head that ends among the marks of a pair goes on past the pair. A textarea steps one character of the markdown. Whether it should is a question for aric; if the answer is one character, this entry becomes open. Left out: only Shift+ArrowLeft or Shift+ArrowRight with the selection across rows and a mark within two characters on the side the head steps to.',
    repro: ['#', ' ', 'a', 'Enter', '*', '*', 'b', '*', '*', ' ', 'c', 'Enter', 'd', 'Control+Home', 'Shift+ArrowDown', 'Shift+ArrowRight'],
    skip: (k, c) => {
      if (!/^Shift\+Arrow(Left|Right)$/.test(k) || rowAt(c.value, c.anchor) === rowAt(c.value, c.head)) return false;
      const beside = /Right$/.test(k) ? c.value.slice(c.head, c.head + 2) : c.value.slice(Math.max(0, c.head - 2), c.head);
      return anyMark.test(beside);
    },
    sanitize: (script) => script,
  },
  {
    id: 'setext-underline-row',
    kind: 'open',
    reason:
      'A setext heading is drawn on one row and its underline row is hidden, so when the cursor enters it the field opens the underline row at the heading\'s size, and the blocks below move down by that row. With the cursor on its first row, the rows below are drawn as blocks of their own, not as the underline.',
    repro: [{ paste: 'Setext\n======\n\nlast' }, 'Control+Home'],
    pace: 'frame',
    shift: (problem) => fieldText(problem).some((text) => /[^\n]\n(=+|-+) *(?=\n|\u200b|$)/.test(text)),
    sanitize: (script) => script,
  },
  {
    id: 'fence-one-pixel',
    kind: 'open',
    reason: 'A fenced code block is drawn 1px taller than the rows of its text field, so everything below it moves 1px when the cursor enters or leaves it.',
    repro: [{ paste: '```\ncode\n```' }, 'Enter', 'ArrowUp'],
    pace: 'frame',
    shift: (problem) => near(problem.change, 1) && problem.blocks.some((b) => b.kind === 'pre'),
    sanitize: (script) => script,
  },
  {
    id: 'unclosed-fence-row',
    kind: 'open',
    reason: 'A code fence that is never closed is drawn as an empty block with both fence rows, 21px more than its one row in the text field.',
    repro: ['3', { paste: '```\ncode\n```' }, 'Control+Home'],
    pace: 'frame',
    shift: (problem) => near(problem.change, 21) && problem.blocks.some((b) => b.kind === 'pre' && b.text === ''),
    sanitize: (script) => script,
  },
  {
    id: 'indented-code-panel',
    kind: 'open',
    reason:
      'An indented code block is drawn as a panel with 43px of padding above and below its lines, but its rows in the text field are bare lines with no fence rows to stand for the padding, so the blocks below move 43px when the cursor enters or leaves it.',
    repro: [{ paste: 'a\n\n    code\n\nb' }, 'Control+Home', 'ArrowDown', 'ArrowDown'],
    pace: 'frame',
    shift: (problem) => (near(problem.change, 43) || near(problem.change, 44)) && problem.blocks.some((b) => b.kind === 'pre'),
    sanitize: (script) => script,
  },
  {
    id: 'table-height',
    kind: 'open',
    reason:
      'A table is drawn with cell padding and borders, so it is not as tall as the rows it opens as in the text field: a table with one body row is 10.37px shorter than its three rows, and the blocks below move that much when the cursor enters or leaves it.',
    repro: [{ paste: '| a | b |\n|---|---|\n| 1 | 2 |\n\nb' }, 'Control+Home'],
    pace: 'frame',
    shift: (problem) => problem.blocks.some((b) => b.kind === 'div.table-scroll'),
    sanitize: (script) => script,
  },
  {
    id: 'first-list-margins',
    kind: 'open',
    reason:
      'A list at the top of the note is drawn 4px lower than the same item in the text field, which gives up its margin there, and what follows the item is 4px lower again, so the text moves 4px or 8px when the cursor enters or leaves it.',
    repro: [{ paste: '- a\n\nb' }, 'Control+Home'],
    pace: 'frame',
    shift: (problem) => (near(problem.change, 4) || near(problem.change, 8)) && problem.blocks.some((b) => b.kind === 'ul' || b.kind === 'ol'),
    sanitize: (script) => script,
  },
  {
    id: 'heading-in-quote',
    kind: 'open',
    reason: 'A heading inside a quote is drawn at the heading\'s size, but the quote\'s row in the text field is a body line, so the blocks below move by the difference when the cursor enters it.',
    repro: [{ paste: 'top\n\n> #\n\nlast' }, 'ArrowUp', 'ArrowUp'],
    pace: 'frame',
    shift: (problem) => fieldText(problem).some((text) => /^>\s*#/m.test(text)),
    sanitize: (script) => script,
  },
  {
    id: 'code-span-over-rows',
    kind: 'open',
    reason: 'A code span that runs over two rows is drawn on one line, but its text field has two, so the blocks below move one line when the cursor enters it.',
    repro: ['`', 'Enter', '`', 'Enter', 'Control+ArrowUp'],
    pace: 'frame',
    shift: (problem) => fieldText(problem).some((text) => /`[^`]*\n[^`]*`/.test(text)),
    sanitize: (script) => script,
  },
];

export const sanitize = (script, pace = 'burst') => known.reduce((s, entry) => entry.sanitize(s, pace), script);
