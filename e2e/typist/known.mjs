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
// sanitize  returns the script without the keys this entry cannot compare, or with a frame
//           waited for where it cannot be typed at speed. It runs on generated scripts only,
//           never on --script or --scripts. It gets the pace.
//
// `node typist/run.mjs --no-known` types everything and reports every difference.

/** @typedef {string | { paste: string } | { wait: true }} Key */
/** @typedef {{ value: string, anchor: number, head: number }} Caret The plain textarea's text and selection before a key. */

const P = (paste) => ({ paste });
const wait = { wait: true };
const times = (n, key) => Array.from({ length: n }, () => key);

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


/** A frame waited for before and after each key that waits for the page, which is how the old typist hid every race. */
const waitAroundSteps = (script, pace) => {
  if (pace !== 'burst') return script;
  const out = [];
  for (const k of script) {
    const step = typeof k === 'string' && isVertical(k);
    if (step && out.at(-1)?.wait !== true) out.push(wait);
    if (typeof k !== 'string' && k.wait && out.at(-1)?.wait === true) continue;
    out.push(k);
    if (step) out.push(wait);
  }
  return out;
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

/** @type {{ id: string, kind: 'intended' | 'open', finding?: string, reason: string, repro?: Key[], closeAtOnce?: boolean, pace?: 'burst' | 'frame' | 'slow', tries?: number, skip?: (k: string, c: Caret, pace: string) => boolean, sanitize: (script: Key[], pace: string) => Key[] }[]} */
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
    id: 'step-then-key',
    kind: 'open',
    finding: 'F2',
    reason:
      'F2: a key typed while a step waits for the page cancels the step: Shift+Down then Enter, in one frame, edits where the selection was before the step. IME composition cannot be sent by the typist, so only the letter and Enter forms are compared.',
    repro: [P('alpha beta\n\nsecond para here\nthird row\n\nlast'), 'Control+Home', 'Shift+ArrowDown', 'Enter'],
    tries: 12,
    sanitize: waitAroundSteps,
  },
  {
    id: 'two-steps-in-a-frame',
    kind: 'open',
    finding: 'B4',
    reason:
      'B4: keys with no pause between them give different results from run to run (Down End Enter Left a b Shift+Right Ctrl+Shift+Right Backspace Up Shift+End Shift+Down ...), where a textarea always agrees with itself. Left out by waiting a frame around the keys that wait for the page.',
    repro: [P('# Head one\n\nbody text here\n\n## Two\nline\n\nend'), 'Control+Home', wait, 'ArrowDown', 'End', 'Enter', 'ArrowLeft', 'a', 'b', 'Shift+ArrowRight', 'Control+Shift+ArrowRight', 'Backspace', 'ArrowUp', 'Shift+End', 'Shift+ArrowDown', 'Control+ArrowRight', 'Control+Shift+ArrowRight', 'Shift+Home', 'x'],
    tries: 12,
    sanitize: waitAroundSteps,
  },
  {
    id: 'word-select-over-marks',
    kind: 'open',
    finding: 'X1',
    reason: 'X1: Ctrl+Shift+Right sticks before hidden marks once the selection is painted: the browser moves the head into the hidden run and the page settles it back to where it came from. Only a paced run shows it, since a burst settles once at the end.',
    repro: [P('one\n\npara **bold** end'), 'Control+Home', ...times(8, 'Control+Shift+ArrowRight')],
    pace: 'slow',
    skip: (k, c, pace) => pace !== 'burst' && isWordSelect(k) && inlineMark.test(c.value),
    sanitize: (script) => script,
  },
];

export const sanitize = (script, pace = 'burst') => known.reduce((s, entry) => entry.sanitize(s, pace), script);
