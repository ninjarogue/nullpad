export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];

export const pastes = ['x', 'two words', 'line1\nline2', '# head\n\n- item', 'a\n\nb\nc', '```\ncode\n```'];

export const classes = {
  char: { w: 30, gen: (r) => pick(r, [...'abcdefgh ijk#-*`>|[]~_=0123456789']) },
  enter: { w: 6, gen: () => 'Enter' },
  backspace: { w: 6, gen: () => 'Backspace' },
  del: { w: 3, gen: () => 'Delete' },
  horiz: { w: 8, gen: (r) => pick(r, ['ArrowLeft', 'ArrowRight']) },
  vertical: { w: 5, gen: (r) => pick(r, ['ArrowUp', 'ArrowDown']) },
  word: { w: 3, gen: (r) => pick(r, ['Control+ArrowLeft', 'Control+ArrowRight']) },
  wordDelete: { w: 3, gen: (r) => pick(r, ['Control+Backspace', 'Control+Delete']) },
  homeEnd: { w: 3, gen: (r) => pick(r, ['Home', 'End', 'Control+Home', 'Control+End']) },
  shift: {
    w: 6,
    gen: (r) =>
      pick(r, [
        'Shift+ArrowLeft', 'Shift+ArrowRight', 'Shift+Home', 'Shift+End',
        'Control+Shift+ArrowLeft', 'Control+Shift+ArrowRight',
      ]),
  },
  shiftVertical: { w: 2, gen: (r) => pick(r, ['Shift+ArrowUp', 'Shift+ArrowDown']) },
  page: { w: 2, gen: (r) => pick(r, ['PageUp', 'PageDown', 'Shift+PageUp', 'Shift+PageDown']) },
  rowStep: { w: 2, gen: (r) => pick(r, ['Control+ArrowUp', 'Control+ArrowDown']) },
  rowSelect: { w: 2, gen: (r) => pick(r, ['Control+Shift+ArrowUp', 'Control+Shift+ArrowDown']) },
  all: { w: 1, gen: () => 'Control+a' },
  paste: { w: 2, gen: (r) => ({ paste: pick(r, pastes) }) },
};

const times = (n, key) => Array.from({ length: n }, () => key);

/** Whether a key can change the text: a paste, a character, Enter, Backspace and Delete, with Ctrl for a word. */
export const editsText = (key) => {
  if (typeof key !== 'string') return key.paste !== undefined;
  const last = key.split('+').at(-1) || '+';
  return /^(Enter|Backspace|Delete)$/.test(last) || (last.length === 1 && !/(^|\+)Control\+/.test(key));
};

const notes = {
  rich: '# Head one\n\nbody text here\nmore body\n\n- item a\n- item b\n\n> quote line\n\n```\ncode\n```\n\nSetext\n======\n\nlast para',
  plain: 'alpha beta\n\nsecond para here\nthird row\n\nlast',
};

export const preludes = [
  { note: 'rich', keys: ['Control+Home', ...times(3, 'Shift+ArrowDown')] },
  { note: 'rich', keys: ['Control+End', 'Home', ...times(3, 'Shift+ArrowUp')] },
  { note: 'rich', keys: ['Control+a'] },
  { note: 'rich', keys: ['Control+Home', 'ArrowRight', 'ArrowRight', ...times(3, 'Shift+ArrowRight')] },
  { note: 'rich', keys: ['Control+Home', 'End', ...times(3, 'Shift+ArrowLeft')] },
  { note: 'rich', keys: ['Control+Home', 'Control+Shift+End'] },
  { note: 'plain', keys: ['Control+Home', ...times(2, 'Shift+ArrowDown')] },
  { note: 'plain', keys: ['Control+End', 'Home', ...times(2, 'Shift+ArrowUp')] },
  { note: 'plain', keys: ['Control+Home', 'ArrowDown', 'ArrowRight', ...times(4, 'Shift+ArrowRight')] },
].map((p) => ({ keys: [{ paste: notes[p.note] }, ...p.keys] }));

/**
 * One block of every kind a note holds, in the variants a person types. Each is a list of rows. A
 * tour joins one variant of each kind, in an order the seed picks, so that the cursor enters every
 * kind of block, and leaves it, with the blocks of other kinds on either side.
 */
const blockKinds = {
  paragraph: [['alpha beta gamma', 'delta epsilon'], ['a single row of words']],
  h1: [['# Heading one']],
  h2: [['## Heading two']],
  h3: [['### Heading three']],
  h4: [['#### Heading four']],
  h5: [['##### Heading five']],
  h6: [['###### Heading six']],
  setextTitle: [['Setext title', '============']],
  setextSub: [['Setext sub', '----------']],
  bullets: [['- apple', '- banana', '- cherry'], ['* star one', '* star two']],
  numbers: [['1. one', '2. two'], ['3) three', '4) four']],
  tasks: [['- [ ] to do', '- [x] done']],
  quote: [['> quoted line', '> second quoted']],
  fence: [['```', 'code here', '```'], ['```js', 'let a = 1;', '```']],
  indented: [['    indented code']],
  table: [['| a | b |', '|---|---|', '| 1 | 2 |']],
  rule: [['---'], ['***']],
};

/**
 * Scripts that visit every kind of block. Each pastes a note made of one block of each kind
 * (blank rows between), puts the cursor at the top and walks it down through every row and back
 * up, so that every block is entered from above and from below.
 */
export function tours(count, seed) {
  const r = rng(seed ^ 0x7077);
  return Array.from({ length: count }, () => {
    const order = Object.keys(blockKinds);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const rows = order.flatMap((kind, i) => [...(i ? [''] : []), ...pick(r, blockKinds[kind])]);
    return [{ paste: rows.join('\n') }, 'Control+Home', ...times(rows.length, 'ArrowDown'), ...times(rows.length, 'ArrowUp')];
  });
}

export function makeScripts(count, length, seed) {
  const r = rng(seed);
  const entries = Object.values(classes);
  const total = entries.reduce((sum, c) => sum + c.w, 0);
  return Array.from({ length: count }, () => {
    const start = r() < 0.4 ? pick(r, preludes).keys : [];
    return [
      ...start,
      ...Array.from({ length }, () => {
        let x = r() * total;
        for (const c of entries) if ((x -= c.w) < 0) return c.gen(r);
        throw new Error('unreachable');
      }),
    ];
  });
}

const base = {
  Enter: { code: 'Enter', vk: 13, text: '\r' }, Backspace: { code: 'Backspace', vk: 8 }, Delete: { code: 'Delete', vk: 46 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 }, ArrowUp: { code: 'ArrowUp', vk: 38 }, ArrowRight: { code: 'ArrowRight', vk: 39 }, ArrowDown: { code: 'ArrowDown', vk: 40 },
  Home: { code: 'Home', vk: 36 }, End: { code: 'End', vk: 35 }, PageUp: { code: 'PageUp', vk: 33 }, PageDown: { code: 'PageDown', vk: 34 }, Shift: { code: 'ShiftLeft', vk: 16 }, Control: { code: 'ControlLeft', vk: 17 },
  ' ': { code: 'Space', vk: 32, text: ' ' }, '-': { code: 'Minus', vk: 189, text: '-' }, '_': { code: 'Minus', vk: 189, text: '_', shifted: true },
  '=': { code: 'Equal', vk: 187, text: '=' }, '`': { code: 'Backquote', vk: 192, text: '`' }, '~': { code: 'Backquote', vk: 192, text: '~', shifted: true },
  '[': { code: 'BracketLeft', vk: 219, text: '[' }, ']': { code: 'BracketRight', vk: 221, text: ']' }, '|': { code: 'Backslash', vk: 220, text: '|', shifted: true },
  '#': { code: 'Digit3', vk: 51, text: '#', shifted: true }, '*': { code: 'Digit8', vk: 56, text: '*', shifted: true }, '>': { code: 'Period', vk: 190, text: '>', shifted: true },
};

function describe(key) {
  if (base[key]) return { key, ...base[key] };
  if (/^[a-z]$/.test(key)) return { key, code: 'Key' + key.toUpperCase(), vk: key.toUpperCase().charCodeAt(0), text: key };
  if (/^[A-Z]$/.test(key)) return { key, code: 'Key' + key, vk: key.charCodeAt(0), text: key, shifted: true };
  if (/^[0-9]$/.test(key)) return { key, code: 'Digit' + key, vk: key.charCodeAt(0), text: key };
  throw new Error('no key ' + key);
}

const modifier = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

export function keyEvents(spec) {
  const parts = spec.split('+');
  const key = parts.pop() || '+';
  let bits = 0;
  for (const p of parts) bits |= modifier[p];
  const d = describe(key);
  const out = [];
  let held = 0;
  for (const p of parts) {
    held |= modifier[p];
    out.push({ type: 'rawKeyDown', key: p, code: describe(p).code, windowsVirtualKeyCode: describe(p).vk, modifiers: held, location: 1 });
  }
  const text = (bits & (modifier.Control | modifier.Alt | modifier.Meta)) === 0 ? d.text : undefined;
  const modifiers = bits | (d.shifted ? modifier.Shift : 0);
  const common = { key: d.key, code: d.code, windowsVirtualKeyCode: d.vk, modifiers };
  out.push(text ? { type: 'keyDown', ...common, text, unmodifiedText: text } : { type: 'rawKeyDown', ...common });
  out.push({ type: 'keyUp', ...common });
  for (const p of [...parts].reverse()) {
    held &= ~modifier[p];
    out.push({ type: 'keyUp', key: p, code: describe(p).code, windowsVirtualKeyCode: describe(p).vk, modifiers: held, location: 1 });
  }
  return out;
}
