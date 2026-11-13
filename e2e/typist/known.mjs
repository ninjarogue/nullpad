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
const vertical = ['ArrowUp', 'ArrowDown', 'Shift+ArrowUp', 'Shift+ArrowDown'];

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
    id: 'vertical-column',
    kind: 'intended',
    reason:
      'Up and Down keep the caret\'s place across the drawn page. nullpad draws proportional type, larger headings and list markers in the gutter, and the textarea is monospace, so the column they land on differs. In a script that makes a second line the vertical keys are left out; on one line they go to the start or end in both, and are compared.',
    sanitize: (script) => (makesLines(script) ? without(script, vertical) : script),
  },
];

export const sanitize = (script) => known.reduce((s, entry) => entry.sanitize(s), script);
