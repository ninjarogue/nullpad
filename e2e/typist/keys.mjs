// Seeded script generator and raw Chrome DevTools key events (US layout).

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

/** Weighted key classes. A script is a list of key specs ("Control+Shift+ArrowLeft") or { paste }. */
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
  all: { w: 1, gen: () => 'Control+a' },
  paste: { w: 2, gen: (r) => ({ paste: pick(r, pastes) }) },
};

export function makeScripts(count, length, seed) {
  const r = rng(seed);
  const entries = Object.values(classes);
  const total = entries.reduce((sum, c) => sum + c.w, 0);
  return Array.from({ length: count }, () =>
    Array.from({ length }, () => {
      let x = r() * total;
      for (const c of entries) if ((x -= c.w) < 0) return c.gen(r);
      throw new Error('unreachable');
    }),
  );
}

// key -> [code, virtual key code, text, needs shift]
const base = {
  Enter: ['Enter', 13, '\r'], Backspace: ['Backspace', 8], Delete: ['Delete', 46],
  ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38], ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40],
  Home: ['Home', 36], End: ['End', 35], Shift: ['ShiftLeft', 16], Control: ['ControlLeft', 17],
  ' ': ['Space', 32, ' '], '-': ['Minus', 189, '-'], '_': ['Minus', 189, '_', true],
  '=': ['Equal', 187, '='], '`': ['Backquote', 192, '`'], '~': ['Backquote', 192, '~', true],
  '[': ['BracketLeft', 219, '['], ']': ['BracketRight', 221, ']'], '|': ['Backslash', 220, '|', true],
  '#': ['Digit3', 51, '#', true], '*': ['Digit8', 56, '*', true], '>': ['Period', 190, '>', true],
};

function describe(key) {
  if (base[key]) {
    const [code, vk, text, shifted] = base[key];
    return { key, code, vk, text, shifted };
  }
  if (/^[a-z]$/.test(key)) return { key, code: 'Key' + key.toUpperCase(), vk: key.toUpperCase().charCodeAt(0), text: key };
  if (/^[A-Z]$/.test(key)) return { key, code: 'Key' + key, vk: key.charCodeAt(0), text: key, shifted: true };
  if (/^[0-9]$/.test(key)) return { key, code: 'Digit' + key, vk: key.charCodeAt(0), text: key };
  throw new Error('no key ' + key);
}

const modifier = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

/** One key press as a list of Input.dispatchKeyEvent parameters, modifier presses included. */
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
