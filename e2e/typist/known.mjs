// Every known difference between nullpad and a plain textarea, in one place.
//
//   intended  nullpad differs on purpose. The typist never types the keys that show it.
//   open      a bug we know about. The typist leaves out the keys that show it, so the
//             rest of the run stays green and keeps looking. Its repro must still differ:
//             when it stops differing the run fails (like test.fixme failing once the test
//             passes) and the entry is deleted, which brings its keys back.
//
// repro     a short script that shows the difference. Open entries have one.
// sanitize  returns the script without the keys this entry cannot compare. It runs on
//           generated scripts only, never on --script or --scripts.
//
// `node typist/run.mjs --no-known` types everything and reports every difference.

/** @typedef {string | { paste: string }} Key */

const text = (k) => (typeof k === 'string' ? k : '');
const makesLines = (script) => script.some((k) => (typeof k === 'string' ? k === 'Enter' : k.paste.includes('\n')));
const without = (script, keys) => script.filter((k) => !keys.includes(text(k)));

/** @type {{ id: string, kind: 'intended' | 'open', reason: string, repro?: Key[], sanitize: (script: Key[]) => Key[] }[]} */
export const known = [
  {
    id: 'undo-steps',
    kind: 'intended',
    reason:
      'An undo step ends at a word and at a pause of a second, a textarea\'s does not, and the native undo stack is not a dependable reference. Ctrl+Z is never typed into the comparison; instead, after every script, pressing Ctrl+Z enough times must bring nullpad back to an empty note.',
    sanitize: (script) => script,
  },
  {
    id: 'vertical-edge',
    kind: 'open',
    reason:
      'ArrowUp on the first line and ArrowDown on the last do not move to the start or end of the text as a textarea does. Every vertical key is left out, so sticky-column bugs are not looked for either (hand probes of a sticky column matched the textarea on this branch).',
    repro: ['f', 'ArrowUp'],
    sanitize: (script) => without(script, ['ArrowUp', 'ArrowDown', 'Shift+ArrowUp', 'Shift+ArrowDown']),
  },
  {
    id: 'left-across-blocks',
    kind: 'open',
    reason:
      'Moving left, by character or word, out of an empty line does not cross into the line before. Only scripts that make a second line (Enter, or a paste with a newline) can show it; in those the keys are left out.',
    repro: ['Enter', 'ArrowLeft'],
    sanitize: (script) => (makesLines(script) ? without(script, ['ArrowLeft', 'Control+ArrowLeft', 'Control+Shift+ArrowLeft', 'Shift+ArrowLeft']) : script),
  },
  {
    id: 'ctrl-home-end-across-blocks',
    kind: 'open',
    reason: 'Ctrl+Home does not reach the start of the note when the cursor is on a later line.',
    repro: ['Enter', 'Control+Home'],
    sanitize: (script) => (makesLines(script) ? without(script, ['Control+Home', 'Control+End']) : script),
  },
  {
    id: 'ctrl-backspace-delete-across-blocks',
    kind: 'open',
    reason: 'Ctrl+Backspace at the start of a line deletes nothing instead of the line break and the word before it.',
    repro: ['Enter', 'Control+Backspace'],
    sanitize: (script) => (makesLines(script) ? without(script, ['Control+Backspace', 'Control+Delete']) : script),
  },
];

export const sanitize = (script) => known.reduce((s, entry) => entry.sanitize(s), script);
