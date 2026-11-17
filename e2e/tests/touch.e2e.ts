import { expect } from 'e2e';
import type { Browser } from '@e2e-dev/web';
import type { App } from 'e2e';
import { phone } from './finger.ts';
import type { Finger, Point } from './finger.ts';
import { test } from './nullpad.ts';
import type { Disk, Note, Page } from './nullpad.ts';

const stored = (body: string, key = 'touch'): Note => ({ key, title: null, body });

type Fixtures = { app: App; disk: Disk; page: Page };

/** Opens the note on a phone, with the whole note drawn but for the block the cursor is in. */
async function openOnPhone({ app, disk, page }: Fixtures, body: string) {
  await disk.seed([stored(body)]);
  await app.open('/');
  await expect(page.text).toHaveValue(body);
  const finger = await page.phone();
  await finger.tapOn(page.markdown);
  await expect(page.markdown).toHaveAttribute('aria-pressed', 'false');
  await expect(page.text).toBeFocused();
  return finger;
}

test('a tap is a trusted touch, pointer, mouse and click event, in the order a phone sends them', async ({
  app,
  browser,
  page,
}) => {
  await app.open('/blank');
  const finger = await page.phone();
  expect(await browser.evaluate(() => ({ touchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches }))).toEqual({
    touchPoints: 1,
    coarse: true,
  });
  await browser.evaluate(() => {
    document.body.innerHTML = '<button style="position: fixed; left: 40px; top: 40px; width: 120px; height: 60px">tap</button>';
    const seen: string[] = [];
    (globalThis as { seen?: string[] }).seen = seen;
    for (const type of ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'mousedown', 'mouseup', 'click']) {
      document.addEventListener(
        type,
        (event) => {
          const pointer = (event as PointerEvent).pointerType;
          const fromTouch = (event as MouseEvent & { sourceCapabilities?: { firesTouchEvents: boolean } }).sourceCapabilities?.firesTouchEvents;
          seen.push(`${type}${pointer ? ` ${pointer}` : ''}${fromTouch ? ' from touch' : ''}${event.isTrusted ? '' : ' untrusted'}`);
        },
        true,
      );
    }
    return null;
  });

  await finger.tap({ x: 100, y: 70 });
  expect(await browser.evaluate(() => (globalThis as { seen?: string[] }).seen ?? [])).toEqual([
    'pointerdown touch',
    'touchstart from touch',
    'pointerup touch',
    'touchend from touch',
    'mousedown from touch',
    'mouseup from touch',
    'click touch from touch',
  ]);
});

const flights = 'Flights are **booked** and the hotel is *not* yet, so we keep looking for a better place.';

type Case = { block: string; note: string; word: string; field: string; caret: `${string}|${string}` };

const cases: Case[] = [
  { block: 'a paragraph', note: `top\n\n${flights}\n\nlast`, word: 'hotel', field: flights, caret: `${flights.slice(0, flights.indexOf('hotel'))}|${flights.slice(flights.indexOf('hotel'))}` },
  { block: 'a heading', note: '# Trip plan\n\nbody', word: 'plan', field: '# Trip plan', caret: '# Trip |plan' },
  {
    block: 'a list item',
    note: 'top\n\n- first\n- second item\n- third',
    word: 'item',
    field: '- second item',
    caret: '- second |item',
  },
  {
    block: 'a table cell',
    note: 'top\n\n| name | qty |\n|-|-|\n| apple | 3 |\n\nlast',
    word: 'apple',
    field: '| name | qty |\n|-|-|\n| apple | 3 |',
    caret: '| name | qty |\n|-|-|\n| |apple | 3 |',
  },
];

for (const { block, note, word, field, caret } of cases) {
  test(`a tap on ${block} on a phone puts the caret where the finger is`, async ({ app, disk, page }) => {
    const finger = await openOnPhone({ app, disk, page }, note);
    await finger.tap(await page.pointAt(word));
    await expect(page.text).toBeFocused();
    await expect(page.text).toHaveValue(field);
    expect(await page.caret()).toBe(caret);
  });
}

test('a tap on a box below the text field ticks it and leaves the caret where it was', async ({ app, disk, page }) => {
  const finger = await openOnPhone({ app, disk, page }, '# Trip\n\n- [ ] one\n- [ ] two');
  await finger.tapOn(page.below.getByRole('checkbox', 'two'));
  await expect(page.saveState).toHaveText('Unsaved');
  await expect(page.saveState).toHaveText('Saved');
  await expect(page.below.getByRole('checkbox', 'two')).toBeChecked();
  await expect(page.below.getByRole('checkbox', 'one')).not.toBeChecked();
  await expect(page.text).toHaveValue('# Trip');
});

test('a tap on a box with the whole note drawn ticks it without opening its block', async ({ app, browser, disk, page }) => {
  const finger = await openOnPhone({ app, disk, page }, '# Trip\n\n- [ ] one\n- [ ] two');
  await browser.keyboard.press('Escape');
  await expect(page.text).not.toBeFocused();
  await finger.tapOn(page.box('one'));
  await expect(page.box('one')).toBeChecked();
  await expect(page.box('two')).not.toBeChecked();
  await expect(page.text).not.toBeFocused();
  await expect(page.saveState).toHaveText('Saved');
});

test('a tap on a note in the side panel opens it', async ({ app, disk, page }) => {
  await disk.seed([stored('# Trip\n\nflights', 'trip'), { key: 'groceries', title: 'Groceries', body: 'milk' }]);
  await app.open('/');
  await expect(page.currentRow).toHaveText('Groceries');
  await expect(page.text).toHaveValue('milk');
  const finger = await page.phone();

  await finger.tapOn(page.row('Trip'));
  await expect(page.currentRow).toHaveText('Trip');
  await expect(page.text).toHaveValue('# Trip\n\nflights');

  await finger.tapOn(page.row('Groceries'));
  await expect(page.currentRow).toHaveText('Groceries');
  await expect(page.text).toHaveValue('milk');
});

test('a tap on a paragraph after the page is scrolled by a swipe puts the caret in that paragraph and keeps it where it was', async ({
  app,
  browser,
  disk,
  page,
}) => {
  const long = Array.from({ length: 80 }, (_, i) => `paragraph number ${i} has a few words in it`).join('\n\n');
  const finger = await openOnPhone({ app, disk, page }, long);
  expect(await page.scrolled()).toBe(0);

  await finger.swipeUp({ x: phone.width / 2, y: phone.height - 100 }, 600);
  await expect.poll(() => page.scrolled()).toBeGreaterThan(400);
  await page.nextFrame();
  const scrolled = await page.scrolled();

  const target = await browser.evaluate(() => {
    const paragraph = [...document.querySelectorAll('.page.live .part p')].find((p) => p.getBoundingClientRect().top > innerHeight / 2)!;
    const text = paragraph.firstChild as Text;
    const word = document.createRange();
    word.setStart(text, text.data.indexOf('few'));
    word.setEnd(text, text.data.indexOf('few') + 1);
    const box = word.getBoundingClientRect();
    return {
      number: Number(/\d+/.exec(text.data)![0]),
      top: paragraph.getBoundingClientRect().top,
      x: box.left + box.width / 4,
      y: box.top + box.height / 2,
    };
  });
  await finger.tap(target);

  await expect(page.text).toBeFocused();
  expect(await page.caret()).toBe(`paragraph number ${target.number} has a |few words in it`);
  expect(await page.scrolled()).toBe(scrolled);
  expect(Math.abs((await page.fieldBox()).top - target.top)).toBeLessThan(1);
});

type Press = { target: string; trusted: boolean; cancelled: boolean };

/** From now on, notes each mouse press the browser sends, and whether the page cancelled what the browser does with it. */
async function watchPresses(browser: Browser) {
  await browser.evaluate(() => {
    const seen: Press[] = [];
    (globalThis as { presses?: Press[] }).presses = seen;
    document.addEventListener('mousedown', (press) => {
      setTimeout(() => seen.push({ target: (press.target as Element).tagName, trusted: press.isTrusted, cancelled: press.defaultPrevented }), 0);
    });
    return null;
  });
}

async function pressesSeen(browser: Browser, page: Page) {
  await page.nextFrame();
  return browser.evaluate(() => (globalThis as { presses?: Press[] }).presses!);
}

// Chromium has no touch selection here: a long press ends as a tap and a drag pans the page. What a
// test can pin is that the page leaves the press to the browser, which is what selecting by finger
// on a phone needs, and that a drag does not become a selection.
const gestures: { gesture: string; act: (finger: Finger, at: Point) => Promise<void> }[] = [
  { gesture: 'a tap', act: (finger, at) => finger.tap(at) },
  { gesture: 'a long press', act: (finger, at) => finger.hold(at) },
];

for (const { gesture, act } of gestures) {
  test(`${gesture} on the text field is left to the browser, which places the caret and owns any selecting that starts there`, async ({
    app,
    browser,
    disk,
    page,
  }) => {
    const finger = await openOnPhone({ app, disk, page }, `top\n\n${flights}\n\nlast`);
    await finger.tap(await page.pointAt('hotel'));
    await expect(page.text).toHaveValue(flights);
    await watchPresses(browser);

    const box = (await page.text.boundingBox())!;
    const at = { x: box.x + 60, y: box.y + 8 };
    await act(finger, at);
    expect(await pressesSeen(browser, page)).toEqual([{ target: 'TEXTAREA', trusted: true, cancelled: false }]);
    expect((await page.selection()).selected).toBe('');
    const caretAt = (await page.caret()).indexOf('|');
    expect(caretAt).toBeGreaterThan(3);
    expect(caretAt).toBeLessThan(20);
  });
}

test('a finger drag that starts on the text field scrolls the page and selects nothing', async ({ app, browser, disk, page }) => {
  const long = Array.from({ length: 80 }, (_, i) => `paragraph number ${i} has a few words in it`).join('\n\n');
  const finger = await openOnPhone({ app, disk, page }, long);
  await finger.tap(await page.pointAt('number 0'));
  await expect(page.text).toHaveValue('paragraph number 0 has a few words in it');
  await watchPresses(browser);
  const caret = await page.caret();
  expect(await page.scrolled()).toBe(0);

  const box = (await page.text.boundingBox())!;
  await finger.swipeUp({ x: box.x + 60, y: box.y + box.height / 2 }, 600);
  await expect.poll(() => page.scrolled()).toBeGreaterThan(400);
  expect(await page.caret()).toBe(caret);
  expect(await page.painted()).toBeNull();
  expect(await pressesSeen(browser, page)).toEqual([]);
});
