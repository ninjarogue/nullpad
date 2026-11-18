import { expect } from 'e2e';
import { ctrl, Editing } from './editing.ts';
import type { Fixtures } from './editing.ts';
import { selectionOf } from './guards.ts';
import { test } from './nullpad.ts';

type Cell = [number, number];

const texts = {
  paragraph:
    'The quick brown fox jumps over the lazy dog and keeps running through the long meadow while the sun sets slowly behind distant hills, café naïve 日本語のテキスト 😀 emoji 👨‍👩‍👧 é. Supercalifragilisticexpialidocious_averyveryverylongunbrokenwordthatwraps and more words follow here to wrap many lines.',
  heading: '### A heading that is long enough to wrap across several visual lines in the editor view, for 日本語 testing 😀',
  'list item': '- item one is long enough to wrap around the visual lines of the editor yes indeed it is and more',
};

type Text = keyof typeof texts;

type Case = { text: Text; width: number; root: number; keys: string[] };

const show = ([row, col]: Cell) => `row ${row} column ${col}`;
const ends = (anchor: Cell, head: Cell) =>
  anchor[0] === head[0] && anchor[1] === head[1] ? `the caret at ${show(head)}` : `the selection from ${show(anchor)} to ${show(head)}`;

async function open(editor: Editing, run: Case) {
  const { browser, page } = editor.fixtures;
  await browser.setViewport({ width: run.width, height: 800 });
  await editor.open(texts[run.text]);
  await browser.evaluate((root: number) => {
    document.documentElement.style.fontSize = `${root}px`;
    return null;
  }, run.root);
  await page.nextFrame();
  await browser.keyboard.press(ctrl('End'));
  await page.nextFrame();
}

/** The cells a plain text field laid out as the page's field is, and holding its text, goes through for `keys`. */
async function plainField(editor: Editing, run: Case) {
  const { browser } = editor.fixtures;
  await open(editor, run);
  await browser.evaluate(() => {
    const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
    const style = getComputedStyle(field);
    const twin = document.createElement('textarea');
    twin.dataset['twin'] = '';
    for (const name of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariantLigatures', 'fontKerning', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize', 'textIndent', 'whiteSpace', 'overflowWrap', 'wordBreak', 'paddingLeft', 'paddingRight'] as const) {
      twin.style[name] = style[name];
    }
    twin.style.cssText += `;position:fixed;top:0;left:0;z-index:9;box-sizing:border-box;border:0;margin:0;height:90vh;resize:none;width:${field.clientWidth}px`;
    document.body.append(twin);
    twin.value = field.value;
    twin.focus();
    twin.setSelectionRange(field.value.length, field.value.length);
    return null;
  });
  const cells: { anchor: Cell; head: Cell }[] = [];
  for (const key of run.keys) {
    await browser.keyboard.press(key);
    cells.push(
      await browser.evaluate(() => {
        const twin = document.querySelector<HTMLTextAreaElement>('textarea[data-twin]')!;
        const backward = twin.selectionDirection === 'backward';
        return {
          anchor: [0, backward ? twin.selectionEnd : twin.selectionStart] as Cell,
          head: [0, backward ? twin.selectionStart : twin.selectionEnd] as Cell,
        };
      }),
    );
  }
  return cells;
}

async function differences(fixtures: Fixtures, run: Case) {
  const editor = new Editing(fixtures);
  const wants = await plainField(editor, run);
  await open(editor, run);
  const lines = [texts[run.text]];
  for (const [index, key] of run.keys.entries()) {
    await fixtures.browser.keyboard.press(key);
    await fixtures.page.nextFrame();
    const got = await selectionOf(fixtures.browser, lines);
    const want = wants[index]!;
    const step = `${run.keys.slice(0, index + 1).join(', ')}`;
    if ('problem' in got) return [`${step}: ${got.problem}`];
    const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
    if (!same(got.anchor, want.anchor) || !same(got.head, want.head)) {
      return [`${step}: the plain field ends with ${ends(want.anchor, want.head)}, the page with ${ends(got.anchor, got.head)}`];
    }
  }
  return [];
}

const repros: { name: string; run: Case }[] = [
  ...(['paragraph', 'heading', 'list item'] as const).map((text) => ({
    name: `Shift+Home then Shift+Up from the end of a wrapped ${text}`,
    run: { text, width: 1000, root: 18, keys: ['Shift+Home', 'Shift+ArrowUp'] },
  })),
  {
    name: 'Shift+Up twice then Down from the end of a wrapped paragraph',
    run: { text: 'paragraph', width: 1000, root: 18, keys: ['Shift+ArrowUp', 'Shift+ArrowUp', 'ArrowDown'] },
  },
  {
    name: 'Shift+Down twice then Up from three lines above the end of a wrapped paragraph',
    run: { text: 'paragraph', width: 1000, root: 18, keys: ['ArrowUp', 'ArrowUp', 'ArrowUp', 'Shift+ArrowDown', 'Shift+ArrowDown', 'ArrowUp'] },
  },
  {
    name: 'Up, Shift+End, Shift+Down then Shift+Up in a wrapped paragraph',
    run: { text: 'paragraph', width: 1000, root: 18, keys: ['ArrowUp', 'Shift+End', 'Shift+ArrowDown', 'Shift+ArrowUp'] },
  },
  {
    name: 'Up twice, a Ctrl+Shift+Home that changes nothing, then Down in a wrapped heading',
    run: { text: 'heading', width: 1000, root: 18, keys: ['ArrowUp', 'ArrowUp', ctrl('Shift+Home'), 'ArrowDown'] },
  },
];

for (const { name, run } of repros) {
  test(`${name} leaves the cursor and selection where a plain text field does`, async (fixtures) => {
    expect(await differences(fixtures, run)).toEqual([]);
  });
}

const sweepKeys = ['Shift+ArrowUp', 'Shift+ArrowDown', 'Shift+Home', 'Shift+End', 'ArrowUp', 'ArrowDown'];

function sequences(seed: number, count: number, length: number) {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state;
  };
  return Array.from({ length: count }, () => Array.from({ length }, () => sweepKeys[next() % sweepKeys.length]!));
}

for (const [width, root] of [[760, 16], [1000, 18], [1400, 20]] as const) {
  test(`Shift with Up, Down, Home and End over a paragraph wrapped ${width}px wide at ${root}px type ends where a plain text field does`, async (fixtures) => {
    const problems: string[] = [];
    for (const keys of sequences(width + root, 4, 7)) {
      problems.push(...(await differences(fixtures, { text: 'paragraph', width, root, keys })));
    }
    expect(problems).toEqual([]);
  });
}
