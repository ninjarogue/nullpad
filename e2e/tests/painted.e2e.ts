import { expect } from 'e2e';
import type { App, Locator } from 'e2e';
import type { Browser } from '@e2e-dev/web';
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
    selected: 'Trip\n\nFlights are **booked** and the ',
    backward: false,
  });

  await listenForCopy(browser);
  await browser.keyboard.press('ControlOrMeta+c');
  expect(await copied(browser)).toBe('Trip\n\nFlights are **booked** and the ');

  await browser.keyboard.type('X');
  await expect(page.text).toHaveValue('# Xhotel is *not*.');
  await expect.poll(() => page.painted()).toBeNull();
  await page.markdown.tap();
  await expect(page.text).toHaveValue('# Xhotel is *not*.\n\n- [ ] Passport\n- Shoes\n\nlast');
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

test('Ctrl+A over a code block paints its closing line break and moves nothing', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const note = 'Intro\n\n```\ncode one\nline two\n```\n\nLast para.';
  await openLive({ app, disk, page }, note);
  const before = await page.layout();

  await browser.keyboard.press('ControlOrMeta+a');
  await expect.poll(() => page.painted()).toBe('Introcode one\nline two\nLast para.');
  expect(await page.paintedBreaks()).toEqual([0, 3]);
  expectSameLayout(await page.layout(), before);
});

test('Ctrl+A over a table paints the line break of each row inside the table and keeps it as wide', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nlast');
  const table = () =>
    browser.evaluate(() => {
      const table = document.querySelector('.page.live table')!.getBoundingClientRect();
      const scroll = document.querySelector('.page.live .table-scroll')!;
      return { width: table.width, scrollWidth: scroll.scrollWidth };
    });
  const before = await page.layout();
  const wide = await table();

  await browser.keyboard.press('ControlOrMeta+a');
  await expect.poll(() => page.painted()).toBe('Introab12last');
  expectSameLayout(await page.layout(), before);
  expect(await table()).toEqual(wide);
  expect(await page.paintedBreaks()).toEqual([0, 2, 4]);
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
  await expect(page.text).toHaveValue('# Xlast');
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
    await expect(page.text).toHaveValue(`# ${typed}hotel is *not*.`);
    await expect.poll(() => page.painted()).toBeNull();
    await page.markdown.tap();
    await expect(page.text).toHaveValue(`# ${typed}hotel is *not*.\n\n- [ ] Passport\n- Shoes\n\nlast`);
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
    selected: 'Trip\n\nFlights are **booked** and the ',
    backward: false,
  });
  await expect(page.drawn('h1')).toHaveCount(0);
  expect(await page.painted()).toBeNull();
});

test('Shift+ArrowDown and Shift+ArrowUp step over each line of a code block and past it', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const note = 'Intro para\n\n```\ncode one\nline two\n```\n\nAfter text';
  const stepOut = async (key: string, reached: string) => {
    let selected = '';
    for (let press = 0; press < 8 && !selected.includes(reached); press++) {
      await browser.keyboard.press(key);
      const before = selected.length;
      await expect.poll(async () => (await page.selection()).selected.length).toBeGreaterThan(before);
      selected = (await page.selection()).selected;
    }
    expect(selected).toContain(reached);
  };

  await openLive({ app, disk, page }, note);
  await browser.keyboard.press('End');
  await stepOut('Shift+ArrowDown', 'After');

  await page.drag(await page.pointAt('After'), await page.pointAt('After'));
  await browser.keyboard.press('Home');
  await stepOut('Shift+ArrowUp', 'Intro');
});

test('a step the page could not place lets the next Shift+ArrowDown step', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, body);
  await page.pressBeforeRedraw('Shift+ArrowDown', 'Shift+ArrowDown', 'ControlOrMeta+e');
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'true');
  await browser.keyboard.press('ControlOrMeta+e');
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'false');
  await page.nextFrame();
  const before = await page.selection();

  await browser.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => page.selection()).not.toEqual(before);
});

test('Shift+ArrowRight over the last letter of a bold word takes its hidden closing marks too', async ({
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

  for (let letter = 0; letter < 10; letter++) await browser.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => page.painted()).toBe('Flights are booked');
  await expect.poll(async () => (await page.selection()).selected).toBe('\n\nFlights are **booked**');
  await browser.keyboard.type('X');
  await page.markdown.tap();
  await expect(page.text).toHaveValue('# TripX and the hotel is *not*.\n\n- [ ] Passport\n- Shoes\n\nlast');
});

test('each Shift and arrow that crosses a line break into the next block paints it', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, 'alpha one\n\nbravo two\n\ncharlie');
  await browser.keyboard.press('End');
  await browser.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => page.paintedBreaks()).toEqual([0]);
  expect(await page.paintedBlanks()).toEqual([]);
  await browser.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => page.paintedBlanks()).toEqual([1]);
  await browser.keyboard.press('Shift+ArrowRight');
  await expect.poll(() => page.painted()).toBe('b');
  expect(await page.paintedBreaks()).toEqual([0]);

  await browser.keyboard.press('End');
  await expect.poll(() => page.paintedBreaks()).toEqual([]);
  await browser.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => page.paintedBreaks()).toEqual([2]);
  expect(await page.paintedBlanks()).toEqual([]);
  await browser.keyboard.press('Shift+ArrowDown');
  await expect.poll(() => page.paintedBlanks()).toEqual([3]);
  expect(await page.paintedBreaks()).toEqual([2]);
});

test('a drag to the start of an item or a heading reaches its text, past the marks it starts with', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  await page.stopEditing();
  await page.drag(await page.pointAt('hotel'), await page.pointAt('Shoes'));
  await expect.poll(() => page.painted()).toBe('hotel is not.Passport');
  await expect.poll(async () => (await page.selection()).selected).toBe('hotel is *not*.\n\n- [ ] Passport\n- ');
  await browser.keyboard.type('X');
  await page.markdown.tap();
  await expect(page.text).toHaveValue(`# Trip\n\nFlights are **booked** and the XShoes\n\nlast`);

  await page.showPage();
  await page.drag(await page.pointAt('XShoes'), await page.pointAt('Trip'));
  await expect.poll(async () => (await page.selection()).selected).toBe('Trip\n\nFlights are **booked** and the ');
  await browser.keyboard.type('Y');
  await page.markdown.tap();
  await expect(page.text).toHaveValue(`# YXShoes\n\nlast`);
});

test('the hidden field keeps its caret where a painted selection starts, so an IME opens there', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, body);
  await page.stopEditing();
  await page.drag(await page.pointAt('booked'), await page.pointAt('Shoes'));
  await expect.poll(() => page.painted()).toBe('booked and the hotel is not.Passport');
  await page.nextFrame();
  const places = await browser.evaluate(() => {
    const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
    const mirror = field.parentElement!.querySelector('.mirror')!;
    const text = mirror.firstChild as Text;
    const letter = document.createRange();
    letter.setStart(text, field.selectionStart);
    letter.setEnd(text, field.selectionStart + 1);
    const inMirror = letter.getClientRects()[0];
    const mirrorBox = mirror.getBoundingClientRect();
    const fieldBox = field.getBoundingClientRect();
    const caret = {
      x: fieldBox.left + inMirror.left - mirrorBox.left,
      y: fieldBox.top + inMirror.top - mirrorBox.top - field.scrollTop + inMirror.height / 2,
    };
    const painted = [...CSS.highlights.get('nullpad-selection')!][0] as Range;
    const node = painted.startContainer as Text;
    const at = painted.startOffset;
    const start = document.createRange();
    const after = at < node.length;
    start.setStart(node, after ? at : at - 1);
    start.setEnd(node, after ? at + 1 : at);
    const drawn = start.getClientRects()[0];
    return { caret, start: { x: after ? drawn.left : drawn.right, y: drawn.top + drawn.height / 2 } };
  });
  expect(Math.abs(places.caret.x - places.start.x)).toBeLessThan(2);
  expect(Math.abs(places.caret.y - places.start.y)).toBeLessThan(4);
});

/** Where the head of a painted selection is drawn, and whether that is inside the window. */
const paintedHeadInView = (browser: { evaluate<T>(run: () => T): Promise<T> }) =>
  browser.evaluate(() => {
    const head = [...(CSS.highlights.get('nullpad-head') ?? [])][0] as Range | undefined;
    if (!head) return null;
    const node = head.startContainer;
    const letter = document.createRange();
    const text = node.nodeType === Node.TEXT_NODE ? (node as Text) : null;
    let box: DOMRect;
    if (text && head.startOffset < text.length) {
      letter.setStart(text, head.startOffset);
      letter.setEnd(text, head.startOffset + 1);
      box = letter.getClientRects()[0] ?? letter.getBoundingClientRect();
    } else if (text && head.startOffset > 0) {
      letter.setStart(text, head.startOffset - 1);
      letter.setEnd(text, head.startOffset);
      box = [...letter.getClientRects()].pop() ?? letter.getBoundingClientRect();
    } else {
      box = (node instanceof Element ? node : node.parentElement!).getBoundingClientRect();
    }
    const sheet = document.querySelector('.page')!.getBoundingClientRect();
    return box.top >= Math.max(sheet.top, 0) - 1 && box.bottom <= Math.min(sheet.bottom, innerHeight) + 1;
  });

test('the head of a painted selection that the keys move stays in the window', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, Array.from({ length: 60 }, (_, i) => `para ${i}`).join('\n\n'));
  for (let step = 0; step < 30; step++) await browser.keyboard.press('ArrowDown');
  for (const key of ['Shift+ArrowDown', 'Control+Shift+Home', 'Control+Shift+End', 'Control+Shift+Home']) {
    await browser.keyboard.press(key);
    await page.nextFrame();
    await expect.poll(() => page.painted()).not.toBeNull();
    expect({ key, inView: await paintedHeadInView(browser) }).toEqual({ key, inView: true });
  }
  for (let step = 1; step <= 12; step++) {
    await browser.keyboard.press('Shift+ArrowRight');
    await page.nextFrame();
    expect({ step, inView: await paintedHeadInView(browser) }).toEqual({ step, inView: true });
  }
  await browser.keyboard.press('Control+Shift+End');
  for (let step = 1; step <= 12; step++) {
    await browser.keyboard.press('Shift+ArrowLeft');
    await page.nextFrame();
    expect({ step, inView: await paintedHeadInView(browser) }).toEqual({ step, inView: true });
  }
});

const threeParas = 'Alpha para one.\n\nBeta para two.\n\nDelta para.';

async function glide(
  browser: {
    mouse: { move(x: number, y: number): Promise<unknown>; down(): Promise<unknown>; up(): Promise<unknown> };
  },
  page: { nextFrame(): Promise<unknown> },
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  await browser.mouse.move(from.x, from.y);
  await browser.mouse.down();
  for (let step = 1; step <= 10; step++) {
    await browser.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
    await page.nextFrame();
  }
  await browser.mouse.up();
}

test('a painted selection dragged onto another block moves there, as in a text field', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, threeParas);
  await page.stopEditing();
  await page.drag(await page.pointAt('para one'), await page.pointAt('para two'));
  await expect.poll(() => page.painted()).toBe('para one.Beta ');

  await glide(browser, page, await page.pointAt('ra one'), await page.pointAt('para.'));
  await expect.poll(async () => (await page.selection()).selected).toBe('para one.\n\nBeta ');
  await expect(page.text).toBeFocused();
  await browser.keyboard.press('Escape');
  await page.markdown.tap();
  await expect(page.text).toHaveValue('Alpha para two.\n\nDelta para one.\n\nBeta para.');
});

test('a painted selection dragged onto another block with the copy key held is copied there', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, threeParas);
  await page.stopEditing();
  await page.drag(await page.pointAt('para one'), await page.pointAt('para two'));
  await expect.poll(() => page.painted()).toBe('para one.Beta ');
  const copyKey = await browser.evaluate(() => (/Mac/.test(navigator.platform) ? 'Alt' : 'Control'));

  const from = await page.pointAt('ra one');
  const to = await page.pointAt('para.');
  await browser.mouse.move(from.x, from.y);
  await browser.mouse.down();
  await browser.keyboard.down(copyKey);
  for (let step = 1; step <= 10; step++) {
    await browser.mouse.move(from.x + ((to.x - from.x) * step) / 10, from.y + ((to.y - from.y) * step) / 10);
    await page.nextFrame();
  }
  await browser.mouse.up();
  await browser.keyboard.up(copyKey);
  await expect.poll(async () => (await page.selection()).selected).toBe('para one.\n\nBeta ');
  await browser.keyboard.press('Escape');
  await page.markdown.tap();
  await expect(page.text).toHaveValue('Alpha para one.\n\nBeta para two.\n\nDelta para one.\n\nBeta para.');
});

test('a click inside a painted selection puts the caret where it clicked', async ({ app, browser, disk, page }) => {
  await openLive({ app, disk, page }, threeParas);
  await page.stopEditing();
  await page.drag(await page.pointAt('para one'), await page.pointAt('para two'));
  await expect.poll(() => page.painted()).toBe('para one.Beta ');

  const inside = await page.pointAt('ra one');
  await browser.mouse.move(inside.x, inside.y);
  await browser.mouse.down();
  await page.nextFrame();
  await expect.poll(() => page.painted()).toBe('para one.Beta ');
  await browser.mouse.up();
  await expect.poll(() => page.caret()).toBe('Alpha pa|ra one.');
  await expect.poll(() => page.painted()).toBeNull();
  await expect(page.text).toBeFocused();
});

test('Shift and a press inside a painted selection select from its anchor, and a drag from there reaches below', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, threeParas);
  await page.stopEditing();
  await page.drag(await page.pointAt('para one'), await page.pointAt('para two'));
  await expect.poll(() => page.painted()).toBe('para one.Beta ');

  const inside = await page.pointAt('ra one');
  const delta = await page.pointAt('lta');
  await browser.keyboard.down('Shift');
  await browser.mouse.move(inside.x, inside.y);
  await browser.mouse.down();
  await page.nextFrame();
  for (let step = 1; step <= 6; step++) {
    await browser.mouse.move(inside.x + ((delta.x - inside.x) * step) / 6, inside.y + ((delta.y - inside.y) * step) / 6);
    await page.nextFrame();
  }
  await browser.mouse.up();
  await browser.keyboard.up('Shift');
  await expect.poll(() => page.painted()).toBe('para one.Beta para two.De');
  expect((await page.selection()).backward).toBe(false);
});

test('a middle click inside a painted selection puts the caret where it clicked, where Linux pastes', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, threeParas);
  await page.stopEditing();
  await page.drag(await page.pointAt('para one'), await page.pointAt('para two'));
  await expect.poll(() => page.painted()).toBe('para one.Beta ');

  const point = await page.pointAt('ra one');
  await browser.evaluate((at: { x: number; y: number }) => {
    const target = document.elementFromPoint(at.x, at.y)!;
    const press = { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 1 };
    target.dispatchEvent(new MouseEvent('mousedown', { ...press, buttons: 4 }));
    target.dispatchEvent(new MouseEvent('mouseup', press));
    target.dispatchEvent(new MouseEvent('auxclick', press));
    return null;
  }, point);
  await expect.poll(() => page.caret()).toBe('Alpha pa|ra one.');
  await expect.poll(() => page.painted()).toBeNull();
  await expect(page.text).toBeFocused();
});

test('a triple click inside a painted selection selects the line clicked, and a drag from there paints whole lines', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, '# Trip\n\nsome words here\n\n- [ ] Passport\n- Shoes\n\nlast line');
  const tripleClick = (point: { x: number; y: number }, release = true) =>
    browser.evaluate(
      (at: { x: number; y: number; release: boolean }) => {
        for (const detail of [1, 2, 3]) {
          const target = document.elementFromPoint(at.x, at.y)!;
          const press = { bubbles: true, cancelable: true, detail, clientX: at.x, clientY: at.y };
          target.dispatchEvent(new MouseEvent('mousedown', { ...press, buttons: 1 }));
          if (detail < 3 || at.release) target.dispatchEvent(new MouseEvent('mouseup', press));
        }
        return null;
      },
      { ...point, release },
    );
  for (const [word, line] of [
    ['words', 'some words here'],
    ['Shoes', '- Shoes'],
  ]) {
    await browser.keyboard.press('ControlOrMeta+a');
    await expect.poll(() => page.painted()).not.toBeNull();
    await tripleClick(await page.pointAt(word));
    await expect.poll(async () => (await page.selection()).selected).toBe(line);
    await expect.poll(() => page.painted()).toBeNull();
  }

  await browser.keyboard.press('ControlOrMeta+a');
  await expect.poll(() => page.painted()).not.toBeNull();
  await tripleClick(await page.pointAt('words'), false);
  const last = await page.pointAt('last');
  const send = (type: string, buttons: number) =>
    browser.evaluate(
      (at: { x: number; y: number; type: string; buttons: number }) => {
        const target = document.elementFromPoint(at.x, at.y)!;
        const init = { bubbles: true, cancelable: true, detail: 3, clientX: at.x, clientY: at.y, buttons: at.buttons };
        target.dispatchEvent(new MouseEvent(at.type, init));
        return null;
      },
      { ...last, type, buttons },
    );
  await send('mousemove', 1);
  await page.nextFrame();
  await send('mouseup', 0);
  await expect.poll(async () => (await page.selection()).selected).toMatch(/^some words here\n[^]*last line$/);
  await expect.poll(() => page.painted()).toBe('some words herePassportShoeslast line');
});

// The mouse of a test presses once at a time, so a press that counts as the
// second of a double-click is sent from the page.
async function pressAndDrag(
  { browser, page }: { browser: Browser; page: { nextFrame(): Promise<null> } },
  from: { x: number; y: number },
  to: { x: number; y: number },
  detail: number,
) {
  const send = (type: string, at: { x: number; y: number }) =>
    browser.evaluate(
      (event: { type: string; x: number; y: number; detail: number }) => {
        const target = document.elementFromPoint(event.x, event.y)!;
        const init = { bubbles: true, cancelable: true, clientX: event.x, clientY: event.y, detail: event.detail };
        target.dispatchEvent(new MouseEvent(event.type, { ...init, button: 0, buttons: event.type === 'mouseup' ? 0 : 1 }));
        return null;
      },
      { type, ...at, detail },
    );
  await send('mousedown', from);
  await page.nextFrame();
  for (let step = 1; step <= 6; step++) {
    await send('mousemove', { x: from.x + ((to.x - from.x) * step) / 6, y: from.y + ((to.y - from.y) * step) / 6 });
    await page.nextFrame();
  }
  await send('mouseup', to);
  await page.nextFrame();
}

/** Where `before` ends on the first line of the text field. */
function inField(browser: Browser, before: string) {
  return browser.evaluate((before: string) => {
    const field = document.querySelector('[data-test-id="editor"]')!;
    const box = field.getBoundingClientRect();
    const style = getComputedStyle(field);
    const pen = document.createElement('canvas').getContext('2d')!;
    pen.font = style.font;
    const x = box.left + parseFloat(style.paddingLeft) + pen.measureText(before).width;
    return { x, y: box.top + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2 };
  }, before);
}

const boldNote = 'Some **bold** words\n\n- item one\n\nend';

test('a double-click on a bold word selects the word, and dragged on to another block holds both its marks', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, boldNote);
  const bold = await inField(browser, 'Some **bo');
  await pressAndDrag({ browser, page }, bold, bold, 2);
  await expect.poll(async () => (await page.selection()).selected).toBe('bold');
  await browser.keyboard.press('ArrowLeft');

  await pressAndDrag({ browser, page }, bold, await page.pointAt('item'), 2);
  await expect.poll(() => page.painted()).toBe('bold wordsitem');
  await expect.poll(async () => (await page.selection()).selected).toBe('**bold** words\n\n- item');
  await browser.keyboard.press('Delete');
  await expect(page.text).toHaveValue('Some  one');
});

test('a drag from between the hidden marks of a bold word to another block holds both its marks', async ({
  app,
  browser,
  disk,
  page,
}) => {
  await openLive({ app, disk, page }, boldNote);
  await pressAndDrag({ browser, page }, await inField(browser, 'Some *'), await page.pointAt('item'), 1);
  await expect.poll(() => page.painted()).toBe('bold words');
  await expect.poll(async () => (await page.selection()).selected).toBe('**bold** words\n\n- ');
  await browser.keyboard.type('X');
  await expect(page.text).toHaveValue('Some Xitem one');
});
