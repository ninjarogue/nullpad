import { expect } from 'e2e';
import { ctrl, Editing } from './editing.ts';
import { cursorProblem } from './guards.ts';
import { test } from './nullpad.ts';

/**
 * Can a person still see the cursor? After every key of every movement and
 * typing guard, `cursorProblem` looks at the cursor's box. These tests add a
 * note of more than 80 blocks, where the page has to scroll all the way, in a
 * small window and at the width of a phone, where paragraphs wrap.
 */

const words = (count: number, from: string) => Array.from({ length: count }, (_, index) => `${from}${index}`).join(' ');

/** Eight kinds of block, over and over, so that every kind is reached from above and from below. */
function longNote(blocks: number) {
  const kinds = [
    (n: number) => `## Section ${n}`,
    (n: number) => `A paragraph ${n} of words that is long enough to wrap on a phone ${words(18, 'w')}`,
    (n: number) => `- bullet ${n}\n- bullet ${n} again\n  - nested ${n}`,
    (n: number) => `> a quote ${n}\n> and a second row`,
    (n: number) => `\`\`\`\ncode ${n}\nmore ${n}\n\`\`\``,
    (n: number) => `| a ${n} | b |\n|---|---|\n| 1 | 2 |`,
    (n: number) => `- [ ] task ${n}\n- [x] done ${n}`,
    (n: number) => `1. one ${n}\n2. two ${n}`,
  ];
  return Array.from({ length: blocks }, (_, index) => kinds[index % kinds.length]!(index)).join('\n\n');
}

const note = longNote(88);

const windows = [
  { name: 'a small window', width: 800, height: 500 },
  { name: 'the width of a phone', width: 390, height: 640 },
];

type Walk = (key: string, times: number) => Promise<void>;

const walks: { name: string; run(walk: Walk, editor: Editing): Promise<void> }[] = [
  {
    name: 'ArrowDown from the top',
    run: (walk) => walk('ArrowDown', 50),
  },
  {
    name: 'ArrowUp from the end',
    run: async (walk) => {
      await walk(ctrl('End'), 1);
      await walk('ArrowUp', 50);
    },
  },
  {
    name: 'PageDown and PageUp',
    run: async (walk) => {
      await walk('PageDown', 8);
      await walk('PageUp', 8);
    },
  },
  {
    name: 'Shift+ArrowDown and Shift+ArrowUp',
    run: async (walk) => {
      await walk('Shift+ArrowDown', 15);
      await walk('Shift+ArrowUp', 30);
    },
  },
  {
    name: 'Ctrl+End, Ctrl+Home, ArrowLeft and ArrowRight',
    run: async (walk) => {
      await walk(ctrl('End'), 1);
      await walk('ArrowLeft', 3);
      await walk(ctrl('Home'), 1);
      await walk('ArrowRight', 3);
    },
  },
  {
    name: 'Enter, typing and Backspace at the end',
    run: async (walk, editor) => {
      await walk(ctrl('End'), 1);
      await walk('Enter', 6);
      await editor.type(` ${words(40, 'tail')}`);
      await walk('Backspace', 30);
    },
  },
  {
    name: 'typing at the start',
    run: async (walk, editor) => {
      await walk(ctrl('Home'), 1);
      await editor.type(` ${words(40, 'head')}`);
    },
  },
];

for (const size of windows) {
  for (const { name, run } of walks) {
    test(`the cursor stays in view after ${name} through a note of 88 blocks in ${size.name}`, async (fixtures) => {
      const { browser } = fixtures;
      const editor = new Editing(fixtures);
      await browser.setViewport({ width: size.width, height: size.height });
      await editor.open(note);
      expect(note.split('\n\n').length).toBeGreaterThan(80);
      await run(async (key, times) => {
        for (let press = 1; press <= times; press++) {
          await browser.keyboard.press(key);
          await editor.settle(`${key} ${press} of ${times}`);
        }
      }, editor);
    });
  }
}

test('the check sees a cursor that has been scrolled out of view', async (fixtures) => {
  const { browser, page } = fixtures;
  const editor = new Editing(fixtures);
  await browser.setViewport({ width: 800, height: 500 });
  await editor.open(note);
  expect(await cursorProblem(browser, 'opening the note')).toBeNull();

  await browser.evaluate(() => {
    document.querySelector('.page')!.scrollTop = 100000;
    return null;
  });
  await page.nextFrame();
  expect(await cursorProblem(browser, 'scrolling')).toContain('out of view');
});

test('the check sees a cursor that has no text field to be in', async (fixtures) => {
  const { browser } = fixtures;
  const editor = new Editing(fixtures);
  await editor.open(note);
  await editor.press('Escape');
  const problem = await cursorProblem(browser, 'Escape');
  expect(problem).toContain('after Escape');
  expect(problem).toMatch(/no size|no focus/);
});
