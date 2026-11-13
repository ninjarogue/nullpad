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
