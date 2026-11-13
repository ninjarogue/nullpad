import { expect } from 'e2e';
import type { App, Locator } from 'e2e';
import { test } from './nullpad.ts';
import type { Note, Placed } from './nullpad.ts';

const paragraph = 'Flights are **booked** and the hotel is *not*.';
const body = `# Trip\n\n${paragraph}\n\n- [ ] Passport\n- Shoes\n\nlast`;
const everything = 'TripFlights are booked and the hotel is not.PassportShoeslast';

type Fixtures = {
  app: App;
  disk: { seed(notes: Note[]): Promise<void> };
  page: { text: Locator; markdown: Locator };
};

async function openLive({ app, disk, page }: Fixtures, body: string) {
  await disk.seed([{ key: 'painted', title: null, body }]);
  await app.open('/');
  await expect(page.text).toHaveValue(body);
  await page.markdown.tap();
  await expect(page.text).toBeFocused();
}

function expectSameLayout(now: Placed[], before: Placed[]) {
  const kind = ({ row, size, family }: Placed) => ({ row, size, family });
  expect(now.map(kind)).toEqual(before.map(kind));
  now.forEach((placed, index) => {
    expect(Math.abs(placed.top - before[index].top), `row ${placed.row} keeps its top`).toBeLessThan(1);
    expect(Math.abs(placed.height - before[index].height), `row ${placed.row} keeps its height`).toBeLessThan(1);
  });
}

async function listenForCopy(browser: { evaluate<T>(run: () => T): Promise<T> }) {
  await browser.evaluate(() => {
    document.addEventListener('copy', (event) => {
      const field = event.target as HTMLTextAreaElement;
      (globalThis as { copied?: string }).copied = field.value.slice(field.selectionStart, field.selectionEnd);
    });
    return null;
  });
}

const copied = (browser: { evaluate<T>(run: () => T): Promise<T> }) =>
  browser.evaluate(() => (globalThis as { copied?: string }).copied ?? null);

test('a drag from a heading into a paragraph paints the selection over the page and moves nothing', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  await page.stopEditing();
  const before = await page.layout();

  const from = await page.pointAt('Trip');
  const to = await page.pointAt('hotel');
  await browser.mouse.move(from.x, from.y);
  await browser.mouse.down();
  await page.nextFrame();
  await browser.mouse.move(to.x, to.y);
  await page.nextFrame();
  await expect.poll(() => page.painted()).toBe('TripFlights are booked and the ');
  expectSameLayout(await page.layout(), before);

  await browser.mouse.up();
  await page.nextFrame();
  expectSameLayout(await page.layout(), before);
  await expect(page.text).toBeFocused();
  await expect.poll(() => page.selection()).toEqual({
    text: `# Trip\n\n${paragraph}`,
    selected: '# Trip\n\nFlights are **booked** and the ',
    backward: false,
  });

  await listenForCopy(browser);
  await browser.keyboard.press('ControlOrMeta+c');
  expect(await copied(browser)).toBe('# Trip\n\nFlights are **booked** and the ');

  await browser.keyboard.type('X');
  await expect(page.text).toHaveValue('Xhotel is *not*.');
  await expect.poll(() => page.painted()).toBeNull();
  await page.markdown.tap();
  await expect(page.text).toHaveValue('Xhotel is *not*.\n\n- [ ] Passport\n- Shoes\n\nlast');
});

test('Shift+ArrowDown and Shift+ArrowUp move a painted selection one drawn line at a time', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const long = 'Flights are **booked** and the hotel is *not* yet, so we keep looking. '.repeat(5).trim();
  await openLive({ app, disk, page }, `Start here\n\n${long}\n\nlast`);
  await browser.keyboard.press('End');

  await browser.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => page.painted()).toBe('');
  const steady = await page.layout();

  const drawn = await browser.evaluate(() => {
    const [start, long] = [...document.querySelectorAll('.page.live .part p')];
    const words = document.createRange();
    words.selectNodeContents(start);
    const x = words.getBoundingClientRect().right;
    const tops = new Map<number, number>();
    const texts = document.createTreeWalker(long, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let text = texts.nextNode() as Text | null; text; text = texts.nextNode() as Text | null) {
      for (let at = 0; at < text.length; at++) {
        range.setStart(text, at);
        range.setEnd(text, at + 1);
        const box = range.getClientRects()[0];
        if (box && box.width > 0) tops.set(Math.round(box.top), box.top + box.height / 2);
      }
    }
    const offsets = [...tops.values()].map((middle) => {
      const caret = document.caretPositionFromPoint(x, middle)!;
      const before = document.createRange();
      before.setStart(long, 0);
      before.setEnd(caret.offsetNode, caret.offset);
      return before.toString().length;
    });
    return { text: long.textContent!, offsets };
  });
  expect(drawn.offsets.length).toBeGreaterThan(3);
  const toLine = (line: number) => drawn.text.slice(0, drawn.offsets[line]);

  for (const line of [0, 1, 2]) {
    await browser.keyboard.press('Shift+ArrowDown');
    await expect.poll(() => page.painted()).toBe(toLine(line));
  }
  for (const line of [1, 0]) {
    await browser.keyboard.press('Shift+ArrowUp');
    await expect.poll(() => page.painted()).toBe(toLine(line));
  }
  expectSameLayout(await page.layout(), steady);
});

test('Ctrl+A paints the whole note and moves nothing', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, body);
  const before = await page.layout();

  await browser.keyboard.press('ControlOrMeta+a');
  await expect.poll(() => page.painted()).toBe(everything);
  expectSameLayout(await page.layout(), before);
  expect(await page.scrolled()).toBe(0);
  await expect.poll(() => page.selection()).toEqual({ text: body, selected: body, backward: false });
  await expect(page.drawn('li')).toHaveText(['Passport', 'Shoes']);

  await listenForCopy(browser);
  await browser.keyboard.press('ControlOrMeta+c');
  expect(await copied(browser)).toBe(body);
});

test('the blank lines inside a painted selection are painted, and none outside it', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  await browser.keyboard.press('End');
  const shoes = await page.pointAt('Shoes');
  await browser.keyboard.down('Shift');
  await browser.mouse.move(shoes.x, shoes.y);
  await browser.mouse.down();
  await browser.mouse.up();
  await browser.keyboard.up('Shift');

  await expect.poll(() => page.painted()).toBe('Flights are booked and the hotel is not.Passport');
  expect(await page.paintedBlanks()).toEqual([1, 3]);

  await browser.keyboard.press('ControlOrMeta+a');
  await expect.poll(() => page.paintedBlanks()).toEqual([1, 3, 6]);
});

test('Escape takes the paint off and draws the whole note', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, body);
  await browser.keyboard.press('ControlOrMeta+a');
  await expect.poll(() => page.painted()).toBe(everything);

  await browser.keyboard.press('Escape');
  await expect(page.preview).toBeVisible();
  expect(await page.painted()).toBeNull();
  expect(await page.paintedBlanks()).toEqual([]);
});

test('a click takes the paint off and puts the block clicked in the field', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  await browser.keyboard.press('ControlOrMeta+a');
  await expect.poll(() => page.painted()).toBe(everything);

  const shoes = await page.pointAt('Shoes');
  await browser.mouse.move(shoes.x, shoes.y);
  await browser.mouse.down();
  await browser.mouse.up();
  await expect(page.text).toHaveValue('- Shoes');
  await expect.poll(() => page.painted()).toBeNull();
  await expect.poll(() => page.paintedBlanks()).toEqual([]);
});

test('a selection across blocks is painted at phone width too, and the page stays as wide as the window', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await browser.setViewport({ width: 390, height: 844 });
  await openLive({ app, disk, page }, body);
  await page.stopEditing();
  const before = await page.layout();

  await page.drag(await page.pointAt('Trip'), await page.pointAt('last'));
  await expect.poll(() => page.painted()).toBe('TripFlights are booked and the hotel is not.PassportShoes');
  expectSameLayout(await page.layout(), before);
  const widths = await browser.evaluate(() => ({
    window: innerWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(widths.page).toBeLessThanOrEqual(widths.window);

  await browser.keyboard.type('X');
  await page.markdown.tap();
  await expect(page.text).toHaveValue('Xlast');
});

test('Shift+ArrowRight and Shift+ArrowLeft move a painted selection one drawn letter at a time, past hidden marks', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  await browser.keyboard.press('End');
  const are = await page.pointAt('are');
  await browser.keyboard.down('Shift');
  await browser.mouse.move(are.x, are.y);
  await browser.mouse.down();
  await browser.mouse.up();
  await browser.keyboard.up('Shift');
  await expect.poll(() => page.painted()).toBe('Flights ');
  const steady = await page.layout();

  for (const painted of ['Flights a', 'Flights ar', 'Flights are', 'Flights are ', 'Flights are b']) {
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => page.painted()).toBe(painted);
  }
  await expect.poll(async () => (await page.selection()).selected).toBe('\n\nFlights are **b');
  for (const painted of ['Flights are ', 'Flights are']) {
    await browser.keyboard.press('Shift+ArrowLeft');
    await expect.poll(() => page.painted()).toBe(painted);
  }
  for (let letter = 0; letter < 7; letter++) await browser.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => page.painted()).toBe('Flights are booked');
  await browser.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => page.painted()).toBe('Flights are booked ');
  await expect.poll(async () => (await page.selection()).selected).toBe('\n\nFlights are **booked** ');
  expectSameLayout(await page.layout(), steady);
});

test('Shift and a click, or a drag, from a painted selection paint further', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, body);
  await page.stopEditing();
  await page.drag(await page.pointAt('Trip'), await page.pointAt('hotel'));
  await expect.poll(() => page.painted()).toBe('TripFlights are booked and the ');

  const passport = await page.pointAt('Passport');
  await browser.keyboard.down('Shift');
  await browser.mouse.move(passport.x, passport.y);
  await browser.mouse.down();
  await browser.mouse.up();
  await browser.keyboard.up('Shift');
  await expect.poll(() => page.painted()).toBe('TripFlights are booked and the hotel is not.');

  const last = await page.pointAt('last');
  await browser.keyboard.down('Shift');
  await browser.mouse.move(passport.x, passport.y);
  await browser.mouse.down();
  await page.nextFrame();
  await browser.mouse.move(last.x, last.y);
  await page.nextFrame();
  await browser.mouse.up();
  await browser.keyboard.up('Shift');
  await expect.poll(() => page.painted()).toBe('TripFlights are booked and the hotel is not.PassportShoes');
  await expect(page.text).toBeFocused();
});

test('Backspace, Delete and text the browser puts in replace a painted selection', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const put = (text: string) =>
    browser.evaluate((text: string) => {
      document.execCommand('insertText', false, text);
      return null;
    }, text);
  const replacements: [string, () => Promise<unknown>][] = [
    ['', () => browser.keyboard.press('Backspace')],
    ['', () => browser.keyboard.press('Delete')],
    ['Put ', () => put('Put ')],
  ];
  for (const [typed, replace] of replacements) {
    await openLive({ app, disk, page }, body);
    await page.stopEditing();
    await page.drag(await page.pointAt('Trip'), await page.pointAt('hotel'));
    await expect.poll(() => page.painted()).toBe('TripFlights are booked and the ');

    await replace();
    await expect(page.text).toHaveValue(`${typed}hotel is *not*.`);
    await expect.poll(() => page.painted()).toBeNull();
    await page.markdown.tap();
    await expect(page.text).toHaveValue(`${typed}hotel is *not*.\n\n- [ ] Passport\n- Shoes\n\nlast`);
  }
});

test('Ctrl+A pressed right after a click, before the page draws again, paints the whole note', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  await page.stopEditing();
  const shoes = await page.pointAt('Shoes');

  await page.beforeRedraw(async () => {
    await browser.mouse.move(shoes.x, shoes.y);
    await browser.mouse.down();
    await browser.mouse.up();
    await browser.keyboard.press('ControlOrMeta+a');
  });
  await expect.poll(() => page.painted()).toBe(everything);
  await expect.poll(() => page.selection()).toEqual({ text: body, selected: body, backward: false });
});

test('without the Highlight API a selection across blocks is shown in the field as markdown', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await browser.addInitScript(() => {
    (globalThis as { Highlight?: unknown }).Highlight = undefined;
  });
  await openLive({ app, disk, page }, body);
  await page.stopEditing();

  await page.drag(await page.pointAt('Trip'), await page.pointAt('hotel'));
  await expect.poll(() => page.selection()).toEqual({
    text: `# Trip\n\n${paragraph}`,
    selected: '# Trip\n\nFlights are **booked** and the ',
    backward: false,
  });
  await expect(page.drawn('h1')).toHaveCount(0);
  expect(await page.painted()).toBeNull();
});
