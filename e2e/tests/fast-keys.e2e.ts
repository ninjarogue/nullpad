import { expect } from 'e2e';
import { chromium, devices } from 'playwright-core';
import { ctrl, Editing, offsetOf, withRawPage } from './editing.ts';
import type { Fixtures, Spot } from './editing.ts';
import { imeKey as sendImeKey } from './ime.ts';
import { pause, test } from './nullpad.ts';

const note = 'alpha one\n\nbravo two words\n\ncharlie three';

const inThisBlock: Spot = { word: 'alpha', at: 2 };
const inAnotherBlock: Spot = { word: 'bravo', at: 2 };
const inTheLastBlock: Spot = { word: 'three', at: 3 };

const spots = [
  { name: 'in the block that is open', spot: inThisBlock },
  { name: 'in another block', spot: inAnotherBlock },
  { name: 'in the last block', spot: inTheLastBlock },
];

const keys = ['Backspace', 'Delete', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Shift+ArrowRight', ctrl('Backspace'), ctrl('Delete')];

const starts = [
  { name: 'with a block open', drawn: false },
  { name: 'with the whole note drawn', drawn: true },
];

for (const { name, spot } of spots) {
  for (const start of starts) {
    for (const key of keys) {
      test(`${key} pressed in the same frame as a click ${name}, ${start.name}, acts where the click put the caret`, async (fixtures) => {
        const { browser, page } = fixtures;
        const editor = new Editing(fixtures);
        await editor.seed(note);
        const expected = await editor.plainField(note, offsetOf(note, spot), [key], 'X');
        await editor.show(note);
        if (start.drawn) {
          await editor.press('Escape');
          await page.nextFrame();
        }
        await page.beforeRedraw(async () => {
          await editor.clickNow(spot);
          await browser.keyboard.press(key);
        });
        await editor.type('X');

        await editor.expectNote(expected);
      });
    }
  }
}

for (const { name, spot } of spots) {
  for (const key of keys) {
    test(`${key} pressed one frame after a click ${name}, with the whole note drawn, acts where the click put the caret`, async (fixtures) => {
      const { browser, page } = fixtures;
      const editor = new Editing(fixtures);
      await editor.seed(note);
      const expected = await editor.plainField(note, offsetOf(note, spot), [key], 'X');
      await editor.show(note);
      await editor.press('Escape');
      await page.nextFrame();
      await editor.clickNow(spot);
      await browser.evaluate(() => new Promise<null>((done) => requestAnimationFrame(() => done(null))));
      await browser.keyboard.press(key);
      await editor.type('X');

      await editor.expectNote(expected);
    });
  }
}

const afterClick = [
  { name: 'in the same frame', held: true },
  { name: 'with no wait', held: false },
];

for (const { name, held } of afterClick) {
  for (const spot of [inThisBlock, inAnotherBlock]) {
    test(`Ctrl+A ${name} after a click in "${spot.word}" selects the whole note`, async (fixtures) => {
      const { browser, page } = fixtures;
      const editor = new Editing(fixtures);
      await editor.open(note);
      const select = async () => {
        await editor.clickNow(spot);
        await browser.keyboard.press(ctrl('a'));
      };
      if (held) await page.beforeRedraw(select);
      else await select();
      await editor.type('X');

      await editor.expectNote('X');
    });
  }
}

const selections: { name: string; from: Spot; keys: string[] }[] = [
  { name: 'Shift+ArrowUp from the last block', from: inTheLastBlock, keys: ['Shift+ArrowUp'] },
  { name: 'Shift+ArrowUp twice from the last block', from: { word: 'charlie', at: 0 }, keys: ['Shift+ArrowUp', 'Shift+ArrowUp'] },
  { name: 'Shift+ArrowDown from the first block', from: { word: 'alpha', at: 2 }, keys: ['Shift+ArrowDown'] },
  { name: 'Shift+ArrowDown twice from the first block', from: { word: 'alpha', at: 0 }, keys: ['Shift+ArrowDown', 'Shift+ArrowDown'] },
  { name: 'Shift+ArrowUp from the middle block', from: { word: 'words', at: 2 }, keys: ['Shift+ArrowUp'] },
  { name: 'Shift+ArrowDown from the middle block', from: { word: 'words', at: 2 }, keys: ['Shift+ArrowDown'] },
];

for (const { name, from, keys: pressed } of selections) {
  test(`${name}, then a letter before the next frame, replaces what was selected`, async (fixtures) => {
    const { browser, page } = fixtures;
    const editor = new Editing(fixtures);
    await editor.seed(note);
    const expected = await editor.plainField(note, offsetOf(note, from), pressed, 'X');
    await editor.show(note);
    await editor.click(from);
    await page.beforeRedraw(async () => {
      for (const key of pressed) await browser.keyboard.press(key);
      await browser.keyboard.type('X');
    });

    await editor.expectNote(expected);
  });
}

const typed = 'XYZ';
const views = [
  { name: 'in the page view', markdown: false },
  { name: 'in the Markdown view', markdown: true },
];
const timings = [
  { name: 'right after the tap', held: false },
  { name: 'in the same frame as the tap', held: true },
];

async function savedNotes({ disk, page }: Fixtures) {
  await page.hide();
  let notes = await disk.notes();
  for (let wait = 0; wait < 20; wait++) {
    await pause(100);
    const again = await disk.notes();
    if (JSON.stringify(again) === JSON.stringify(notes)) break;
    notes = again;
  }
  return Object.fromEntries(notes.map((each) => [each.key, each.body]));
}

for (const view of views) {
  for (const timing of timings) {
    test(`typing ${timing.name} that switches notes ${view.name} loses no key and changes no other text`, async (fixtures) => {
      const { app, browser, disk, page } = fixtures;
      await disk.seed([
        { key: 'first', title: 'First', body: 'first note' },
        { key: 'second', title: 'Second', body: 'second note' },
      ]);
      await app.open('/');
      await expect(page.text).toHaveValue('second note');
      if (!view.markdown) await page.markdown.tap();
      await expect(page.text).toBeFocused();

      const switchAndType = async () => {
        const at = await page.rowCentre('First');
        await browser.mouse.move(at.x, at.y);
        await browser.mouse.down();
        await browser.mouse.up();
        await browser.keyboard.type(typed);
      };
      if (timing.held) await page.beforeRedraw(switchAndType);
      else await switchAndType();
      await page.nextFrame();

      const saved = await savedNotes(fixtures);
      const letters = (text = '') => text.replace(/[^XYZ]/g, '');
      const without = (text = '') => text.replace(/[XYZ]/g, '');
      expect(letters(saved['second']) + letters(saved['first']), 'the letters typed, in the note that was open and then the one that was opened').toBe(typed);
      expect(without(saved['first']), 'the first note without the typed letters').toBe('first note');
      expect(without(saved['second']), 'the second note without the typed letters').toBe('second note');
    });
  }
}

const crossings: { name: string; note: string; from: Spot; keys: string[] }[] = [
  { name: 'from a heading down to a paragraph', note: '# Big title here\n\nparagraph words', from: { word: 'here', at: 4 }, keys: ['ArrowDown', 'ArrowDown'] },
  { name: 'from a paragraph up to a heading', note: '# Big title here\n\nparagraph words', from: { word: 'words', at: 5 }, keys: ['ArrowUp', 'ArrowUp'] },
  { name: 'from a list item down to a quote', note: '- item one\n\n> quoted words', from: { word: 'one', at: 3 }, keys: ['ArrowDown', 'ArrowDown'] },
  { name: 'from a paragraph down to a code block', note: 'some words here\n\n```\ncode words here\n```', from: { word: 'words', at: 3 }, keys: ['ArrowDown', 'ArrowDown', 'ArrowDown'] },
];

for (const { name, note: body, from, keys: pressed } of crossings) {
  test(`arrows ${name}, then a letter before the next frame, land where they do after it`, async (fixtures) => {
    const { browser, page } = fixtures;
    const editor = new Editing(fixtures);
    await editor.open(body);
    await editor.click(from);
    for (const key of pressed) {
      await browser.keyboard.press(key);
      await page.nextFrame();
    }
    await editor.type('X');
    const slow = await editor.shown();

    await editor.open(body);
    await editor.click(from);
    await page.beforeRedraw(async () => {
      for (const key of pressed) await browser.keyboard.press(key);
      await browser.keyboard.type('X');
    });

    await editor.expectNote(slow);
  });
}

const stepsAfterClick: { name: string; note: string; before?: Spot; at: Spot; keys: string[] }[] = [
  { name: 'Shift+ArrowUp three times onto a quote at the top', note: '> a\n>\n> b\n\nnext', at: { word: 'next', at: 0 }, keys: ['Shift+ArrowUp', 'Shift+ArrowUp', 'Shift+ArrowUp'] },
  { name: 'Shift+ArrowDown three times onto a quote at the end', note: 'first\n\n> a\n>\n> b', before: { word: 'b', at: 1 }, at: { word: 'first', at: 0 }, keys: ['Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown'] },
  { name: 'Shift+ArrowDown four times onto a list item at the end', note: 'first\n\n- a\n\n b', before: { word: 'b', at: 1 }, at: { word: 'first', at: 0 }, keys: ['Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown'] },
  { name: 'Shift+ArrowDown three times onto a quote before a paragraph', note: 'first\n\n> a\n>\n> b\n\nlast', before: { word: 'b', at: 1 }, at: { word: 'first', at: 0 }, keys: ['Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown'] },
];

for (const { name, note: body, before, at, keys: pressed } of stepsAfterClick) {
  test(`${name}, in the same frame as the click, select what a plain field selects`, async (fixtures) => {
    const { browser, page } = fixtures;
    const editor = new Editing(fixtures);
    await editor.seed(body);
    const expected = await editor.plainField(body, offsetOf(body, at), pressed, 'X');
    await editor.show(body);
    if (before) await editor.click(before);
    await page.beforeRedraw(async () => {
      await editor.clickNow(at);
      for (const key of pressed) await browser.keyboard.press(key);
    });
    await editor.type('X');
    await page.markdown.tap();

    await expect(page.text).toHaveValue(expected);
  });
}

test('Shift+ArrowDown in the same frame as a click on a row that wraps, with the whole note drawn, selects one line', async (fixtures) => {
  const { browser, page } = fixtures;
  const editor = new Editing(fixtures);
  const words = Array.from({ length: 60 }, (_, index) => `word${index}`).join(' ');
  const body = `${words}\n\nnext`;
  const at = { word: 'word3', at: 2 };
  const typed = async (together: boolean) => {
    await editor.open(body);
    await editor.press('Escape');
    await page.nextFrame();
    await page.beforeRedraw(async () => {
      await editor.clickNow(at);
      if (together) await browser.keyboard.press('Shift+ArrowDown');
    });
    if (!together) await page.pressBeforeRedraw('Shift+ArrowDown');
    await editor.type('X');
    await page.markdown.tap();
    return page.text.inputValue();
  };
  const apart = await typed(false);
  expect(apart.includes('word59'), 'a frame later, Shift+ArrowDown selects less than the rest of the row').toBe(true);

  expect(await typed(true)).toBe(apart);
});

const afterTyping: { name: string; note: string; at?: Spot; keys: string[]; typed: string }[] = [
  { name: 'a letter, PageUp and a letter', note: 'aaaa\n\nbbb', keys: ['x', 'PageUp', 'y'], typed: '' },
  { name: 'a letter, Shift+ArrowUp and a letter', note: 'aaaa\n\nbbb', keys: ['x', 'Shift+ArrowUp', 'y'], typed: '' },
  { name: 'Enter and Shift+ArrowUp', note: 'aaaa\n\nbbb\n\nccc', keys: ['Enter', 'Shift+ArrowUp'], typed: 'y' },
  { name: 'Enter and Shift+ArrowDown twice', note: 'aaaa\n\nbbb\n\nccc', keys: ['Enter', 'Shift+ArrowDown', 'Shift+ArrowDown'], typed: 'y' },
  { name: 'a letter, PageUp and an undo', note: 'aaaa\n\nbbb', keys: ['x', 'PageUp', ctrl('z')], typed: 'Y' },
  { name: 'a letter, Shift+PageUp and an undo', note: 'aaaa\n\nbbb', keys: ['x', 'Shift+PageUp', ctrl('z')], typed: 'Y' },
  { name: 'a letter, Shift+ArrowUp and an undo', note: 'aaaa\n\nbbb', keys: ['x', 'Shift+ArrowUp', ctrl('z')], typed: 'Y' },
  { name: 'Enter at the start of a row, Shift+ArrowUp, ArrowRight and Ctrl+Backspace', note: 'aaaa\n\nbbb', at: { word: 'bbb', at: 0 }, keys: ['Enter', 'Shift+ArrowUp', 'ArrowRight', ctrl('Backspace')], typed: 'y' },
];

for (const { name, note: body, at = { word: 'bbb', at: 3 }, keys: pressed, typed: letters } of afterTyping) {
  test(`${name}, in one frame, act as in a plain field`, async (fixtures) => {
    const { browser, page } = fixtures;
    const editor = new Editing(fixtures);
    await editor.seed(body);
    const expected = await editor.plainField(body, offsetOf(body, at), pressed, letters);
    await editor.show(body);
    await editor.click(at);
    await page.nextFrame();
    await page.pressBeforeRedraw(...pressed);
    await browser.keyboard.type(letters);
    await page.markdown.tap();

    await expect(page.text).toHaveValue(expected);
  });
}

const fromMenu: { name: string; keys: string[]; asked: 'historyUndo' | 'historyRedo' }[] = [
  { name: 'an undo from a menu after a letter and a step', keys: ['x', 'Enter', 'Shift+ArrowUp'], asked: 'historyUndo' },
  { name: 'a redo from a menu after a step and an undo', keys: ['x', 'Enter', 'Shift+ArrowUp', ctrl('z')], asked: 'historyRedo' },
];

for (const { name, keys: pressed, asked } of fromMenu) {
  test(`${name}, in one frame, acts as it does a frame later`, async (fixtures) => {
    const { browser, page } = fixtures;
    const editor = new Editing(fixtures);
    const body = 'aaaa\n\nbbb';
    const fromTheMenu = () =>
      browser.evaluate((inputType: string) => {
        const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
        field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
        return null;
      }, asked);
    const typed = async (together: boolean, menu: boolean) => {
      await editor.open(body);
      await editor.click({ word: 'bbb', at: 3 });
      await editor.type('w');
      await page.nextFrame();
      if (together) {
        await page.beforeRedraw(async () => {
          for (const key of pressed) await browser.keyboard.press(key);
          if (menu) await fromTheMenu();
        });
      } else {
        for (const key of pressed) await page.pressBeforeRedraw(key);
        if (menu) await page.beforeRedraw(async () => void (await fromTheMenu()));
      }
      await browser.keyboard.type('Y');
      await page.nextFrame();
      await page.markdown.tap();
      return page.text.inputValue();
    };
    const apart = await typed(false, true);
    expect(apart, 'the menu changes the text').not.toBe(await typed(false, false));

    expect(await typed(true, true)).toBe(apart);
  });
}

const arrowsAfterClick: { name: string; at: Spot; key: string }[] = [
  { name: 'ArrowUp after a click on the last row of a block', at: { word: 'four', at: 2 }, key: 'ArrowUp' },
  { name: 'ArrowDown after a click on the first row of a block', at: { word: 'bravo', at: 3 }, key: 'ArrowDown' },
];

for (const { name, at, key } of arrowsAfterClick) {
  test(`${name}, in the same frame, moves one row from where the click put the caret`, async (fixtures) => {
    const { browser, page } = fixtures;
    const editor = new Editing(fixtures);
    const body = 'alpha one\n\nbravo two words\ncharlie three words\ndelta four\n\necho';
    const typed = async (together: boolean) => {
      await editor.open(body);
      await page.beforeRedraw(async () => {
        await editor.clickNow(at);
        if (together) await browser.keyboard.press(key);
      });
      if (!together) await page.pressBeforeRedraw(key);
      await browser.keyboard.type('X');
      await page.nextFrame();
      await page.markdown.tap();
      return page.text.inputValue();
    };
    const apart = await typed(false);
    expect(apart.split('\n').findIndex((row) => row.includes('X')), 'a frame later, the arrow moves one row').toBe(3);

    expect(await typed(true)).toBe(apart);
  });
}

test('letters that make a heading a paragraph, and ArrowDown, in one frame, aim at the column the letters left', async (fixtures) => {
  const { browser, page } = fixtures;
  const editor = new Editing(fixtures);
  const body = '# Title\n\npara one\npara two';
  await editor.open(body);
  await page.pressBeforeRedraw('d', 'e', 'f', 'ArrowDown');
  for (const key of ['ArrowDown', 'ArrowDown']) {
    await browser.keyboard.press(key);
    await page.nextFrame();
  }
  await browser.keyboard.type('x');
  await page.nextFrame();
  await page.markdown.tap();

  await expect(page.text).toHaveValue('def# Title\n\npara one\nparxa two');
});

test('an undo after steps that wait for the page, in the frame of a click, takes the steps back with the typing', async (fixtures) => {
  const { browser, page } = fixtures;
  const editor = new Editing(fixtures);
  const body = '> a\n>\n> b\n\nnext';
  const steps = ['Shift+ArrowUp', 'Shift+ArrowUp', 'Shift+ArrowUp'];
  await editor.seed(body);
  const expected = await editor.plainField(body, body.indexOf('\n\nnext'), ['z', 'ArrowDown', 'ArrowDown', 'Home', ...steps, ctrl('z')], 'Y');
  await editor.show(body);
  await editor.click({ word: 'b', at: 1 });
  await editor.type('z');
  await page.nextFrame();
  await page.beforeRedraw(async () => {
    await editor.clickNow({ word: 'next', at: 0 });
    for (const key of [...steps, ctrl('z')]) await browser.keyboard.press(key);
  });
  await browser.keyboard.type('Y');
  await page.markdown.tap();

  await expect(page.text).toHaveValue(expected);
});

test('steps after an undo, in one frame, each move a row, also those the field takes', async (fixtures) => {
  const { browser, page } = fixtures;
  const editor = new Editing(fixtures);
  const body = 'aaaa\naaaa\naaaa\naaaa\naaaa\naaaa';
  const burst = [ctrl('z'), 'Shift+ArrowUp', 'Shift+ArrowUp', 'Shift+ArrowUp'];
  await editor.seed(body);
  const expected = await editor.plainField(body, body.length, ['Enter', ...burst], 'X');
  await editor.show(body);
  await editor.press(ctrl('End'), 'Enter');
  await page.nextFrame();
  await page.pressBeforeRedraw(...burst);
  await browser.keyboard.type('X');
  await page.markdown.tap();

  await expect(page.text).toHaveValue(expected);
});

test('keys typed into an empty note in one frame, the last a selection to the end of the note, act as in a plain field', async (fixtures) => {
  const { browser, page } = fixtures;
  const editor = new Editing(fixtures);
  const burst = [']', 'ArrowLeft', '~', 'Enter', 'ArrowUp', ctrl('Shift+ArrowDown')];
  await editor.seed('');
  const expected = await editor.plainField('', 0, burst, 'X');
  await editor.show('');
  await page.nextFrame();
  await page.pressBeforeRedraw(...burst);
  await browser.keyboard.type('X');
  await page.markdown.tap();

  await expect(page.text).toHaveValue(expected);
});

test('Shift+ArrowLeft after Ctrl+Delete at the end of the note, drawn before the field is read, selects one letter', async (fixtures) => {
  const { browser, page } = fixtures;
  const editor = new Editing(fixtures);
  await editor.seed('');
  const expected = await editor.plainField('', 0, ['1', 'i', ctrl('Delete'), 'Shift+ArrowLeft'], 'X');
  await editor.show('');
  await editor.type('1i');
  await page.nextFrame();
  await browser.evaluate(() => {
    const real = window.setTimeout;
    const held: (() => void)[] = [];
    window.setTimeout = ((run: () => void, ms?: number) => {
      if (ms) return real(run, ms);
      held.push(run);
      return 0;
    }) as typeof window.setTimeout;
    (globalThis as { read?: () => void }).read = () => {
      window.setTimeout = real;
      for (const run of held) run();
    };
    return null;
  });
  await browser.keyboard.press(ctrl('Delete'));
  await page.nextFrame();
  await browser.keyboard.press('Shift+ArrowLeft');
  await browser.evaluate(() => {
    (globalThis as { read?: () => void }).read!();
    return null;
  });
  await page.nextFrame();
  await browser.keyboard.type('X');
  await page.markdown.tap();

  await expect(page.text).toHaveValue(expected);
});

test('a key an IME sends while the page is behind goes to the IME, and is not typed again', async ({ app, browser }) => {
  await app.open('/blank');
  const origin = new URL(await browser.url()).origin;
  await withRawPage(origin, note, async (raw) => {
    const session = await raw.context().newCDPSession(raw);
    const imeKey = (type: 'rawKeyDown' | 'keyUp') => sendImeKey(session, type);
    await raw.evaluate(() => {
      const seen: { key: string; ime: boolean; held: boolean }[] = [];
      document.querySelector('textarea')!.addEventListener('keydown', (key) => {
        queueMicrotask(() => seen.push({ key: key.key, ime: key.keyCode === 229, held: key.defaultPrevented }));
      });
      (globalThis as { keys?: typeof seen }).keys = seen;
      const held: FrameRequestCallback[] = [];
      const real = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (run) => held.push(run);
      (globalThis as { redraw?: () => void }).redraw = () => {
        window.requestAnimationFrame = real;
        for (const run of held) real(run);
      };
      return null;
    });
    await raw.keyboard.press('Enter');
    await raw.keyboard.press('Shift+ArrowUp');
    await raw.keyboard.press('z');
    await imeKey('rawKeyDown');
    await session.send('Input.imeSetComposition', { text: 'k', selectionStart: 1, selectionEnd: 1 });
    await imeKey('keyUp');
    await imeKey('rawKeyDown');
    await session.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
    await imeKey('keyUp');
    await session.send('Input.insertText', { text: 'か' });
    const keys = await raw.evaluate(() => (globalThis as { keys?: { key: string; ime: boolean; held: boolean }[] }).keys!);
    await raw.evaluate(() => {
      (globalThis as { redraw?: () => void }).redraw!();
      return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    });
    await raw.evaluate(() => new Promise((done) => setTimeout(done, 200)));
    await raw.keyboard.press('Control+e');
    const text = await raw.evaluate(() => document.querySelector('textarea')!.value);

    expect(keys.find((key) => key.key === 'z'), 'the page is behind when z is pressed, so z is held').toMatchObject({ held: true });
    expect(keys.filter((key) => key.ime).map((key) => key.held), "the IME's keys go on to the field").toEqual([false, false]);
    expect(text.split('k').length - 1, `no letter of the IME is typed again in ${JSON.stringify(text)}`).toBe(0);
  });
});

test('PageDown pressed while a step waits for the rows an Enter in the same frame added waits behind the letter before it', async ({ app, browser }) => {
  await app.open('/blank');
  const origin = new URL(await browser.url()).origin;
  await withRawPage(origin, note, async (raw) => {
    await raw.evaluate(() => {
      const held: FrameRequestCallback[] = [];
      const real = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (run) => held.push(run);
      (globalThis as { redraw?: () => void }).redraw = () => {
        window.requestAnimationFrame = real;
        for (const run of held) real(run);
      };
      return null;
    });
    for (const key of ['Enter', 'Shift+ArrowUp', 'z', 'PageDown']) await raw.keyboard.press(key);
    await raw.evaluate(() => {
      (globalThis as { redraw?: () => void }).redraw!();
      return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    });
    await raw.keyboard.type('X');
    await raw.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await raw.keyboard.press('Control+e');

    expect(await raw.evaluate(() => document.querySelector('textarea')!.value)).toBe(`z${note}X`);
  });
});

const longNote = "# Heading one that is quite long and will wrap around on the page because it keeps going and going and going\n\nFirst paragraph with **bold words** and *italic words* and some `code` here, long enough to wrap onto several visual lines in the editor at this width, yes indeed.\n\n## Second heading\nLine directly under heading\n\n> quote line one that is long enough to wrap around because quotes are narrower than the page and so on and so forth\n> - item in quote\n>   - nested item in quote with a lot of words to make it wrap around the width of the quote block\n> > nested quote\n> > - list in nested quote\n\n- list item one\n- list item two that is long enough to wrap around because it keeps going and going on and on and on and on and on\n  - nested a\n1. ordered\n2. second\n\n```js\nconst a = 1;\n\nfunction f() { return 2; }\n```\n\n> ```\n> fenced in quote\n> \n> more\n> ```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 33 | 44 |\n\n\n### h3\n#### h4 long long long long long long long long long long long long long long long long long long long long long long long long long long long\n##### h5\n###### h6\n\nlast paragraph";
test('ArrowDown onto the next block and PageDown, in one frame, land where they do a frame apart', async (fixtures) => {
  const { browser, page } = fixtures;
  const editor = new Editing(fixtures);
  await browser.setViewport({ width: 1280, height: 800 });
  const typed = async (frames: string[][]) => {
    await editor.open(longNote);
    for (const keys of frames) await page.pressBeforeRedraw(...keys);
    await browser.keyboard.type('@');
    await page.nextFrame();
    await page.markdown.tap();
    return page.text.inputValue();
  };
  const drawn = [[ctrl('Home')], ['ArrowDown'], ['ArrowDown']];
  const apart = await typed([...drawn, ['ArrowDown'], ['PageDown']]);

  expect(await typed([...drawn, ['ArrowDown', 'PageDown']])).toBe(apart);
});

test('PageDown twice in one frame on a phone, after a letter, lands where it does a frame apart', async ({ app, browser }) => {
  await app.open('/blank');
  const origin = new URL(await browser.url()).origin;
  const phone = await chromium.launch();
  try {
    const typed = async (together: boolean) => {
      const context = await phone.newContext({ ...devices['Pixel 7'], permissions: ['clipboard-read', 'clipboard-write'] });
      const raw = await context.newPage();
      await raw.addInitScript(() => localStorage.setItem('nullpad.markdown', 'off'));
      await raw.goto(`${origin}/`);
      const frames = () => raw.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const hold = () =>
        raw.evaluate(() => {
          const held: FrameRequestCallback[] = [];
          const real = window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame = (run) => held.push(run);
          (globalThis as { redraw?: () => void }).redraw = () => {
            window.requestAnimationFrame = real;
            for (const run of held) real(run);
          };
          return null;
        });
      const redraw = async () => {
        await raw.evaluate(() => {
          (globalThis as { redraw?: () => void }).redraw!();
          return null;
        });
        await frames();
      };
      await raw.getByLabel('Note text').click();
      await raw.evaluate((text: string) => navigator.clipboard.writeText(text), longNote);
      await raw.keyboard.press('Control+v');
      await expect.poll(() => raw.evaluate(() => document.querySelectorAll('.page.live [data-row]').length)).toBeGreaterThan(20);
      for (const key of ['Control+Home', 'a', 'Control+Home']) {
        await raw.keyboard.press(key);
        await frames();
      }
      await hold();
      await raw.keyboard.press('PageDown');
      if (!together) {
        await redraw();
        await hold();
      }
      await raw.keyboard.press('PageDown');
      await redraw();
      await raw.keyboard.type('@');
      await frames();
      await raw.keyboard.press('Control+e');
      const text = await raw.evaluate(() => document.querySelector('textarea')!.value);
      await context.close();
      return text;
    };
    const apart = await typed(false);

    expect(await typed(true)).toBe(apart);
  } finally {
    await phone.close();
  }
});

type ImeStep = string | { ime: string } | { commit: string } | 'redraw' | 'late keydown';

async function composeBehind(origin: string, steps: ImeStep[], frames: boolean) {
  let text = '';
  const seen: string[] = [];
  await withRawPage(origin, note, async (raw) => {
    const session = await raw.context().newCDPSession(raw);
    const imeKey = (type: 'rawKeyDown' | 'keyUp') => sendImeKey(session, type);
    if (frames) {
      await raw.evaluate(() => {
        const held: FrameRequestCallback[] = [];
        const real = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = (run) => held.push(run);
        (globalThis as { redraw?: () => void }).redraw = () => {
          window.requestAnimationFrame = real;
          for (const run of held.splice(0)) real(run);
        };
        return null;
      });
    }
    const field = () => raw.evaluate(() => {
      const control = document.querySelector('textarea')!;
      return `${control.value.slice(0, control.selectionStart)}|${control.value.slice(control.selectionStart)}`;
    });
    for (const step of steps) {
      if (step === 'redraw') {
        if (!frames) continue;
        await raw.evaluate(() => {
          (globalThis as { redraw?: () => void }).redraw!();
          return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        });
        seen.push(await field());
      } else if (step === 'late keydown') {
        await imeKey('rawKeyDown');
        await imeKey('keyUp');
      } else if (typeof step === 'string') {
        await raw.keyboard.press(step);
      } else if ('ime' in step) {
        await imeKey('rawKeyDown');
        await session.send('Input.imeSetComposition', { text: step.ime, selectionStart: step.ime.length, selectionEnd: step.ime.length });
        await imeKey('keyUp');
      } else {
        await session.send('Input.insertText', { text: step.commit });
      }
    }
    await raw.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await raw.evaluate(() => new Promise((done) => setTimeout(done, 200)));
    await raw.keyboard.press('Control+e');
    text = await raw.evaluate(() => document.querySelector('textarea')!.value);
  });
  return { text, seen };
}

const behindAStep = ['Enter', 'Shift+ArrowUp'];

test('text an IME composes while a key waits behind a step goes in after the key', async ({ app, browser }) => {
  await app.open('/blank');
  const origin = new URL(await browser.url()).origin;
  const { text } = await composeBehind(origin, [...behindAStep, 'z', { ime: 'k' }, { ime: 'か' }, { commit: 'か' }, 'redraw'], true);

  expect(text).toBe(`zか${note}`);
});

test('text an IME composes while two keys wait behind a step goes in after both', async ({ app, browser }) => {
  await app.open('/blank');
  const origin = new URL(await browser.url()).origin;
  const { text } = await composeBehind(origin, [...behindAStep, 'z', 'y', { ime: 'k' }, { ime: 'か' }, { commit: 'か' }, 'redraw'], true);

  expect(text).toBe(`zyか${note}`);
});

test('text an IME composes while only a step waits goes over what the step selects', async ({ app, browser }) => {
  await app.open('/blank');
  const origin = new URL(await browser.url()).origin;
  const { text } = await composeBehind(origin, [...behindAStep, { ime: 'k' }, { ime: 'か' }, { commit: 'か' }, 'redraw'], true);

  expect(text).toBe(`か${note}`);
});

test('a key that waits behind a step while an IME composes leaves the composition alone when the page catches up, and goes in before it', async ({ app, browser }) => {
  await app.open('/blank');
  const origin = new URL(await browser.url()).origin;
  const { text, seen } = await composeBehind(origin, [...behindAStep, 'z', { ime: 'k' }, 'redraw', { ime: 'か' }, { commit: 'か' }], true);

  expect(seen[0]?.startsWith('k|alpha one'), `the field keeps what the IME composes, where it composes it, in ${JSON.stringify(seen)}`).toBe(true);
  expect(text).toBe(`zか${note}`);
});

test('text an IME composes behind a key goes in after it when compositionend comes before the last keydown', async ({ app, browser }) => {
  await app.open('/blank');
  const origin = new URL(await browser.url()).origin;
  const { text } = await composeBehind(origin, [...behindAStep, 'z', { ime: 'k' }, { ime: 'か' }, { commit: 'か' }, 'late keydown', 'redraw'], true);

  expect(text).toBe(`zか${note}`);
});

test('an undo asked while an IME composes behind a key is not taken', async ({ app, browser }) => {
  await app.open('/blank');
  const origin = new URL(await browser.url()).origin;
  const { text } = await composeBehind(origin, [...behindAStep, 'z', { ime: 'k' }, 'Control+z', { ime: 'か' }, { commit: 'か' }, 'redraw'], true);

  expect(text).toBe(`zか${note}`);
});

test('a redo asked while an IME composes behind an undo is not taken, and the undo still is', async ({ app, browser }) => {
  await app.open('/blank');
  const origin = new URL(await browser.url()).origin;
  const { text } = await composeBehind(origin, [...behindAStep, 'z', 'Control+z', { ime: 'k' }, 'Control+Shift+z', { ime: 'か' }, { commit: 'か' }, 'redraw'], true);

  expect(text).toBe(`か${note}`);
});

test('an undo after a composition behind a key takes back the composition with the key', async ({ app, browser }) => {
  await app.open('/blank');
  const origin = new URL(await browser.url()).origin;
  const { text } = await composeBehind(origin, [...behindAStep, 'z', { ime: 'k' }, { ime: 'か' }, { commit: 'か' }, 'Control+z', 'redraw'], true);

  expect(text).toBe(`\n${note}`);
});

for (const frames of [false, true]) {
  const caughtUp = frames ? ['redraw'] : [];
  const after = frames ? ', with the redraws held until the step is drawn' : '';

  test(`an undo while an IME composes is not taken, though Chrome selects in the field as it composes${after}`, async ({ app, browser }) => {
    await app.open('/blank');
    const origin = new URL(await browser.url()).origin;
    const { text } = await composeBehind(origin, [...behindAStep, 'z', ...caughtUp, { ime: 'k' }, 'Control+z', { ime: 'か' }, { commit: 'か' }], frames);

    expect(text).toBe(`zか${note}`);
  });

  test(`a composition is one step of the history, though Chrome selects in the field as it composes${after}`, async ({ app, browser }) => {
    await app.open('/blank');
    const origin = new URL(await browser.url()).origin;
    const { text } = await composeBehind(origin, [...behindAStep, 'z', ...caughtUp, { ime: 'k' }, { ime: 'か' }, { commit: 'か' }, 'Control+z'], frames);

    expect(text).toBe(`\n${note}`);
  });
}

const breaks = [
  {
    name: 'a step of the head over the page',
    keys: ['Shift+ArrowUp', 'Shift+ArrowUp'],
    held: false,
    typed: 'alpha one\n\nbravo two words\nX',
    fails: () => {
      const real = Selection.prototype.modify;
      Selection.prototype.modify = function (alter, direction, granularity) {
        if (alter === 'move' && granularity === 'line') {
          localStorage.setItem('thrown', 'yes');
          throw new Error('the browser could not step');
        }
        return real.call(this, alter, direction, granularity);
      };
      return () => (Selection.prototype.modify = real);
    },
  },
  {
    name: 'an aim at the column of a run',
    keys: ['ArrowUp'],
    held: false,
    typed: 'alpha one\n\nbravo two words\nX\ncharlie three',
    fails: () => {
      const real = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
      Object.defineProperty(Element.prototype, 'scrollTop', {
        ...real,
        set(top: number) {
          if (this instanceof HTMLTextAreaElement) {
            localStorage.setItem('thrown', 'yes');
            throw new Error('the browser could not aim');
          }
          real.set!.call(this, top);
        },
      });
      return () => Object.defineProperty(Element.prototype, 'scrollTop', real);
    },
  },
  {
    name: 'a letter replayed after a step',
    keys: ['Enter', 'Shift+ArrowUp', 'z'],
    held: true,
    typed: 'alpha one\n\nbravo two words\n\nX',
    fails: () => {
      const real = HTMLTextAreaElement.prototype.setRangeText;
      HTMLTextAreaElement.prototype.setRangeText = function () {
        localStorage.setItem('thrown', 'yes');
        throw new Error('the browser could not type');
      };
      return () => (HTMLTextAreaElement.prototype.setRangeText = real);
    },
  },
];

for (const { name, keys: pressed, held, typed, fails } of breaks) {
  test(`keys still work after ${name} fails in the browser`, async ({ app, browser, disk, page }) => {
    await disk.seed([{ key: 'live', title: null, body: note }]);
    await app.open('/');
    await expect(page.text).toHaveValue(note);
    await page.markdown.tap();
    await expect(page.text).toBeFocused();
    await browser.keyboard.press('ControlOrMeta+End');
    await page.nextFrame();
    await browser.evaluate(`(globalThis.mend = (${fails.toString()})(), null)`);
    if (held) await page.pressBeforeRedraw(...pressed);
    else for (const key of pressed) await browser.keyboard.press(key);
    await page.nextFrame();
    await page.nextFrame();
    await browser.evaluate('(globalThis.mend(), null)');
    expect(await browser.evaluate(() => localStorage.getItem('thrown'))).toBe('yes');

    await browser.keyboard.type('X');
    await page.nextFrame();
    await page.markdown.tap();
    await expect(page.text).toHaveValue(typed);
  });
}

test('browser shortcuts pressed while the page is behind go on to the browser', async ({ app, browser, disk, page }) => {
  await disk.seed([{ key: 'live', title: null, body: note }]);
  await app.open('/');
  await expect(page.text).toHaveValue(note);
  await page.markdown.tap();
  await browser.keyboard.press('ControlOrMeta+End');
  await page.nextFrame();
  const shortcuts = ['f', 'p', 's', 'l', 'r', 'd', '=', '+', '-', '0'];
  let held: Record<string, boolean> = {};
  await page.beforeRedraw(async () => {
    await browser.keyboard.press('Enter');
    await browser.keyboard.press('Shift+ArrowUp');
    held = await browser.evaluate((shortcuts: string[]) => {
      const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
      const press = (key: string, modifiers: KeyboardEventInit) => {
        const pressed = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
        field.dispatchEvent(pressed);
        return pressed.defaultPrevented;
      };
      const seen: Record<string, boolean> = {};
      for (const key of shortcuts) {
        seen[`Control+${key}`] = press(key, { ctrlKey: true });
        seen[`Meta+${key}`] = press(key, { metaKey: true });
        seen[`Control+Shift+${key}`] = press(key, { ctrlKey: true, shiftKey: true });
      }
      seen['Alt+ArrowLeft'] = press('ArrowLeft', { altKey: true });
      seen['Control+a'] = press('a', { ctrlKey: true });
      seen['z'] = press('z', {});
      return seen;
    }, shortcuts);
  });
  const expected: Record<string, boolean> = {};
  for (const key of shortcuts) {
    expected[`Control+${key}`] = false;
    expected[`Meta+${key}`] = false;
    expected[`Control+Shift+${key}`] = false;
  }
  expected['Alt+ArrowLeft'] = false;
  expected['Control+a'] = true;
  expected['z'] = true;
  expect(held).toEqual(expected);
});

const appleKeys = [
  { name: 'Cmd and ArrowLeft goes to the start of the line', key: 'Meta+ArrowLeft', typed: 'Xone two' },
  { name: 'Option and ArrowLeft goes back a word', key: 'Alt+ArrowLeft', typed: 'one Xtwo' },
  { name: 'Cmd and Backspace deletes to the start of the line', key: 'Meta+Backspace', typed: 'X' },
  { name: 'Option and Backspace deletes a word', key: 'Alt+Backspace', typed: 'one X' },
];

for (const { name, key, typed } of appleKeys) {
  test(`on a Mac, ${name}, also while the page is behind`, async ({ app, browser, disk, page }) => {
    await browser.addInitScript(() => Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }));
    await disk.seed([{ key: 'live', title: null, body: note }]);
    await app.open('/');
    await expect(page.text).toHaveValue(note);
    await page.markdown.tap();
    await browser.keyboard.press('Meta+ArrowDown');
    await page.nextFrame();
    await page.beforeRedraw(async () => {
      await browser.keyboard.press('Enter');
      await browser.keyboard.press('Shift+ArrowUp');
      await browser.keyboard.press('Shift+ArrowDown');
      await browser.keyboard.type('one two');
      await browser.keyboard.press(key);
    });
    await page.nextFrame();
    await browser.keyboard.type('X');
    await page.nextFrame();
    await page.markdown.tap();
    await expect(page.text).toHaveValue(`${note}\n${typed}`);
  });
}

const paragraphKeys = [
  { name: 'Control and ArrowUp moves up a paragraph', key: 'Control+ArrowUp', typed: 'one\nX\ntwo' },
  { name: 'Control, Shift and ArrowUp selects up a paragraph', key: 'Control+Shift+ArrowUp', typed: 'one\nX' },
];

for (const { name, key, typed } of paragraphKeys) {
  test(`off a Mac, ${name}, also while the page is behind`, async ({ app, browser, disk, page }) => {
    await disk.seed([{ key: 'live', title: null, body: note }]);
    await app.open('/');
    await expect(page.text).toHaveValue(note);
    await page.markdown.tap();
    await browser.keyboard.press('Control+End');
    await page.nextFrame();
    await page.beforeRedraw(async () => {
      await browser.keyboard.press('Enter');
      await browser.keyboard.press('Shift+ArrowUp');
      await browser.keyboard.press('Shift+ArrowDown');
      await browser.keyboard.type('one');
      await browser.keyboard.press('Enter');
      await browser.keyboard.press('Enter');
      await browser.keyboard.type('two');
      await browser.keyboard.press(key);
    });
    await page.nextFrame();
    await browser.keyboard.type('X');
    await page.nextFrame();
    await page.markdown.tap();
    await expect(page.text).toHaveValue(`${note}\n${typed}`);
  });
}

test('text an IME puts in the field in the frame of Escape wakes it, and the keys after it are typed there', async ({ app, browser }) => {
  await app.open('/blank');
  const origin = new URL(await browser.url()).origin;
  await withRawPage(origin, '# T\n\nstart para\n\nsecond one', async (raw) => {
    await raw.keyboard.press('Control+End');
    await raw.keyboard.press('ArrowUp');
    await raw.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await raw.evaluate(() => {
      const held: FrameRequestCallback[] = [];
      const real = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (run) => held.push(run);
      (globalThis as { redraw?: () => void }).redraw = () => {
        window.requestAnimationFrame = real;
        for (const run of held) real(run);
      };
      return null;
    });
    await raw.keyboard.press('Escape');
    await raw.keyboard.insertText('日');
    await raw.evaluate(() => {
      (globalThis as { redraw?: () => void }).redraw!();
      return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    });
    await raw.keyboard.press('a');
    await raw.keyboard.press('Enter');
    await raw.keyboard.type('b');
    await raw.keyboard.press('Control+e');
    await expect.poll(() => raw.getByLabel('Note text').inputValue()).toBe('# T\n\nstart para\n日a\nb\nsecond one');
  });
});

test('text an IME commits in the frame of a PageDown, before the page has drawn the block the caret went to, goes where the PageDown put the caret', async ({ app, browser }) => {
  await app.open('/blank');
  const origin = new URL(await browser.url()).origin;
  const note = '# Title here\n\nPara one with words\nsecond line\n\n- item a\n  - nested b\n- item c\n\n> quote q\n\n```\ncode\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nlast para';
  const committedAfterPageDown = (held: boolean) => {
    let saved = '';
    return withRawPage(origin, note, async (raw) => {
      const frames = () => raw.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      if (held) {
        await raw.evaluate(() => {
          const real = window.requestAnimationFrame.bind(window);
          const waiting: FrameRequestCallback[] = [];
          window.requestAnimationFrame = (run) => waiting.push(run);
          (globalThis as { redraw?: () => void }).redraw = () => {
            window.requestAnimationFrame = real;
            for (const run of waiting) real(run);
          };
          return null;
        });
      }
      for (const key of ['ArrowDown', 'ArrowRight', 'PageDown']) {
        await raw.keyboard.press(key);
        if (!held) await frames();
      }
      await raw.keyboard.insertText('X');
      if (held) {
        await raw.evaluate(() => {
          (globalThis as { redraw?: () => void }).redraw!();
          return null;
        });
      }
      await frames();
      await raw.keyboard.press('Control+e');
      saved = await raw.getByLabel('Note text').inputValue();
    }).then(() => saved);
  };
  const apart = await committedAfterPageDown(false);
  expect(apart, 'the text goes at the end of the note').toBe(`${note}X`);
  expect(await committedAfterPageDown(true)).toBe(apart);
});

const paintedThenPage = [
  '# Heading one',
  '',
  'Paragraph with a fairly long line that will certainly wrap around several times when the width is narrow enough to force it, yes indeed.',
  '',
  '- item one',
  '  - nested item two that is also long enough to wrap around the available width at some point yes',
  '    - deep',
  '- item three',
  '',
  '> quote line that is long enough to wrap around the available width for sure, really quite long indeed yes',
  '> second quote line',
  '',
  '```js',
  'code  line',
  '  indented',
  '```',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
  '',
  '',
  '## Last heading here',
  'tail line',
].join('\n');

test('a letter typed in the frame of a PageDown from a selection the page paints goes where the PageDown put the caret', async (fixtures) => {
  const { browser, page } = fixtures;
  const editor = new Editing(fixtures);
  await browser.setViewport({ width: 1024, height: 600 });
  const typedAfterPageDown = async (held: boolean) => {
    await editor.open(paintedThenPage);
    for (const key of ['Enter', '`', '-', ' ', 'Shift+ArrowDown']) await browser.keyboard.press(key);
    await page.nextFrame();
    if (held) {
      await page.beforeRedraw(async () => {
        await browser.keyboard.press('PageDown');
        await browser.keyboard.press('x');
      });
    } else {
      await browser.keyboard.press('PageDown');
      await page.nextFrame();
      await browser.keyboard.press('x');
    }
    await page.nextFrame();
    await page.hide();
    return editor.saved();
  };
  const afterTheFrame = await typedAfterPageDown(false);
  expect(afterTheFrame, 'the letter is typed').toContain('x');
  expect(await typedAfterPageDown(true)).toBe(afterTheFrame);
});

const listKeys = [
  { name: 'Enter at the end of a list item', body: '- one\n- two', keys: ['Enter', 'Shift+ArrowUp', 'Shift+ArrowDown', 'x', 'Enter'], slow: '- one\n- two\n- x\n- Y' },
  { name: 'Tab on a list item', body: '- one\n- two', keys: ['Enter', 'x', 'Shift+ArrowUp', 'ArrowLeft', 'Tab'], slow: '- one\n  - tYwo\n- x' },
  { name: 'Shift+Tab on a nested list item', body: '- one\n  - two', keys: ['Enter', 'x', 'Shift+ArrowUp', 'ArrowLeft', 'Shift+Tab'], slow: '- one\n- tYwo\n  - x' },
];

for (const { name, body, keys: pressed, slow } of listKeys) {
  test(`${name}, behind a step that waits for the page, lands as it does a frame apart`, async (fixtures) => {
    const { browser, page } = fixtures;
    const editor = new Editing(fixtures);
    const typed = async (together: boolean) => {
      await editor.open(body);
      await browser.keyboard.press(ctrl('End'));
      await page.nextFrame();
      if (together) await page.beforeRedraw(async () => {
        for (const key of pressed) await browser.keyboard.press(key);
      });
      else for (const key of pressed) await page.pressBeforeRedraw(key);
      await page.nextFrame();
      await browser.keyboard.type('Y');
      await page.nextFrame();
      await expect(page.text).toBeFocused();
      await page.markdown.tap();
      return page.text.inputValue();
    };
    const apart = await typed(false);
    expect(apart, 'the list key works on the item a frame apart').toBe(slow);

    expect(await typed(true)).toBe(apart);
  });
}
