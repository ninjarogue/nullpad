import { expect } from 'e2e';
import { ctrl, Editing, offsetOf } from './editing.ts';
import type { Fixtures, Spot } from './editing.ts';
import { pause, test } from './nullpad.ts';

/**
 * Fast typing. A hurried hand sends a key before the page has drawn what the
 * click before it did, and a busy device draws nothing between two events.
 * Each test sends its events with no frame between them, by holding the
 * page's animation frames back until the last one is in, and then holds the
 * page to what a plain text field does with the same events one after the
 * other.
 */

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

/** Up and Down keep a column that a proportional font does not share with the plain field, so the keys that go on past one row start in column 0. */
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

/** What the notes are once the page has saved them. */
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

/** An arrow into a block of another kind aims at the column on that block as it is drawn, so a letter before the next frame lands where it lands after the frame. */
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

/**
 * A click moves the text field to the block it lands in, and until the next
 * frame the page still shows the field on the block it left. Steps pressed
 * in that frame go over that page, up or down onto the block the field left,
 * which is first or last on the page, or has a paragraph past it.
 */
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

/**
 * Typing changes the field before the page is drawn again, so a step after
 * it in the same frame starts from text the page does not show yet. The
 * keys after the step act where the step took the caret, in that frame or
 * once it is drawn.
 */
const afterTyping: { name: string; note: string; keys: string[]; typed: string }[] = [
  { name: 'a letter, PageUp and a letter', note: 'aaaa\n\nbbb', keys: ['x', 'PageUp', 'y'], typed: '' },
  { name: 'a letter, Shift+ArrowUp and a letter', note: 'aaaa\n\nbbb', keys: ['x', 'Shift+ArrowUp', 'y'], typed: '' },
  { name: 'Enter and Shift+ArrowUp', note: 'aaaa\n\nbbb\n\nccc', keys: ['Enter', 'Shift+ArrowUp'], typed: 'y' },
  { name: 'Enter and Shift+ArrowDown twice', note: 'aaaa\n\nbbb\n\nccc', keys: ['Enter', 'Shift+ArrowDown', 'Shift+ArrowDown'], typed: 'y' },
  { name: 'a letter, PageUp and an undo', note: 'aaaa\n\nbbb', keys: ['x', 'PageUp', ctrl('z')], typed: 'Y' },
  { name: 'a letter, Shift+PageUp and an undo', note: 'aaaa\n\nbbb', keys: ['x', 'Shift+PageUp', ctrl('z')], typed: 'Y' },
  { name: 'a letter, Shift+ArrowUp and an undo', note: 'aaaa\n\nbbb', keys: ['x', 'Shift+ArrowUp', ctrl('z')], typed: 'Y' },
];

for (const { name, note: body, keys: pressed, typed: letters } of afterTyping) {
  test(`${name}, in one frame, act as in a plain field`, async (fixtures) => {
    const { browser, page } = fixtures;
    const editor = new Editing(fixtures);
    const at = { word: 'bbb', at: 3 };
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

/**
 * A key the browser acts on past the rows the field holds, such as Ctrl+Delete
 * at the end of the note, is acted on with the whole note in the field, which
 * is read once the browser has acted. A frame can draw that field before the
 * read, and a key can come before the read too: it acts where the browser left
 * the caret. The reads are held back here, so that both happen every time.
 */
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
