import { expect } from 'e2e';
import { Editing } from './editing.ts';
import { test } from './nullpad.ts';

/**
 * A key that turns the row under the caret into another kind of block, or moves the caret onto a row
 * of another kind, is handled before the page draws again. A second key, a click or a measure in the
 * same frame reads the text field as it is laid out then, and the page draws it after. Until it does,
 * the field is to keep the line height and the margins of the rows it was drawn with, so that nothing
 * around it moves. The keys are pressed while the page draws nothing and the page is read before it
 * does, so that no frame settles what the key laid out.
 */

const note = 'intro line\n\nbody row here\n\n## Heading two\n\n- item row\n\n- [ ] task row\n\nlast row';

const down = (rows: number) => Array.from({ length: rows }, () => 'ArrowDown');

type Scenario = { name: string; to: string[]; keys: string[]; field: string };

const scenarios: Scenario[] = [
  { name: 'typing # and a space on a body row', to: [...down(2), 'Home'], keys: ['#', ' '], field: '# body row here' },
  { name: 'typing ### and a space on a body row', to: [...down(2), 'Home'], keys: ['#', '#', '#', ' '], field: '### body row here' },
  { name: 'typing - and a space on a body row', to: [...down(2), 'Home'], keys: ['-', ' '], field: '- body row here' },
  { name: 'typing - [ ] on a body row', to: [...down(2), 'Home'], keys: ['-', ' ', '[', ' ', ']', ' '], field: '- [ ] body row here' },
  { name: 'taking the ## off a heading', to: [...down(4), 'Home'], keys: ['Delete', 'Delete', 'Delete'], field: 'Heading two' },
  { name: 'taking the - off a list item', to: [...down(6), 'Home'], keys: ['Delete', 'Delete'], field: 'item row' },
  { name: 'moving from a body row onto a heading', to: down(3), keys: down(1), field: '## Heading two' },
  { name: 'moving from a heading onto a body row', to: down(4), keys: ['ArrowUp', 'ArrowUp'], field: 'body row here' },
  { name: 'moving from a body row onto a list item', to: down(5), keys: down(1), field: '- item row' },
  { name: 'moving from a list item onto a task', to: down(6), keys: down(2), field: '- [ ] task row' },
];

/** Where the page draws the field and each drawn row, in the page's own coordinates. Runs in the page. */
function drawn() {
  const sheet = document.querySelector('.page')!;
  const place = (element: Element) => {
    const box = element.getBoundingClientRect();
    return { top: box.top - sheet.getBoundingClientRect().top + sheet.scrollTop, height: box.height };
  };
  const field = document.querySelector('[data-test-id="editor"]')!;
  const rows = (part: string) => [...document.querySelectorAll(`[data-test-id="${part}"] [data-row]`)].map(place);
  return { above: rows('live-above'), field: place(field), below: rows('live-below') };
}

for (const { name, to, keys, field } of scenarios) {
  test(`${name} moves nothing until the page draws`, async (fixtures) => {
    const { browser, page } = fixtures;
    await new Editing(fixtures).open(note);
    for (const key of to) await browser.keyboard.press(key);
    await page.nextFrame();
    const before = await browser.evaluate(drawn);

    let held = before;
    await page.beforeRedraw(async () => {
      for (const key of keys) await browser.keyboard.press(key);
      held = await browser.evaluate(drawn);
    });

    expect(held.above.length, 'rows drawn above the field').toBe(before.above.length);
    expect(held.below.length, 'rows drawn below the field').toBe(before.below.length);
    const moved = (now: { top: number; height: number }, was: { top: number; height: number }) => ({
      top: Math.abs(now.top - was.top) > 0.5 ? now.top - was.top : 0,
      height: Math.abs(now.height - was.height) > 0.5 ? now.height - was.height : 0,
    });
    await expect(page.text).toHaveValue(field);
    expect(moved(held.field, before.field), 'the text field').toEqual({ top: 0, height: 0 });
    expect(held.above.map((row, i) => moved(row, before.above[i]!)), 'rows above').toEqual(held.above.map(() => ({ top: 0, height: 0 })));
    expect(held.below.map((row, i) => moved(row, before.below[i]!)), 'rows below').toEqual(held.below.map(() => ({ top: 0, height: 0 })));
  });
}
