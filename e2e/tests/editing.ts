import type { Browser } from '@e2e-dev/web';
import { expect } from 'e2e';
import type { App } from 'e2e';
import { chromium } from 'playwright-core';
import type { Page as RawPage } from 'playwright-core';
import { cursorProblem, fast, selectionOf } from './guards.ts';
import type { Disk, Page } from './nullpad.ts';

/** Where a person aims the pointer: the gap before character `at` of the first `word` drawn on the page. */
export type Spot = { word: string; at: number };

export type Fixtures = { app: App; browser: Browser; disk: Disk; page: Page };

export const ctrl = (key: string) => `ControlOrMeta+${key}`;

/** The offset of `spot` in `note`. A word that is not unique in the note cannot be aimed at. */
export function offsetOf(note: string, spot: Spot) {
  expect(note.split(spot.word).length - 1, `"${spot.word}" appears once in the note`).toBe(1);
  return note.indexOf(spot.word) + spot.at;
}

function centreOf(spot: Spot) {
  const sheet = document.querySelector('.page')!;
  const texts = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('textarea') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let text = texts.nextNode() as Text | null; text; text = texts.nextNode() as Text | null) {
    const found = text.data.indexOf(spot.word);
    if (found < 0) continue;
    const letter = Math.min(spot.at, spot.word.length - 1);
    const range = document.createRange();
    range.setStart(text, found + letter);
    range.setEnd(text, found + letter + 1);
    const box = range.getClientRects()[0];
    if (!box) continue;
    const gap = spot.at > letter ? box.right - 0.5 : box.left + 0.5;
    return { x: gap, y: box.top + box.height / 2 };
  }
  return null;
}

/**
 * The note as the page shows it: the part drawn above the text field, the
 * field while it is in sight, and the part drawn below.
 */
function shownInPage() {
  const sheet = document.querySelector('.page')!;
  const rows = (part: Element | null) => (part ? [...part.children].map((row) => row.textContent ?? '') : []);
  const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
  const seen = field.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && field.getBoundingClientRect().height > 0;
  return [
    ...rows(sheet.querySelector('[data-test-id="live-above"], [data-test-id="preview"]')),
    ...(seen ? [field.value] : []),
    ...rows(sheet.querySelector('[data-test-id="live-below"]')),
  ].join('\n');
}

/** Drives the page view of one note the way a person does: the pointer, the keyboard and the clipboard. */
export class Editing {
  private lost = 0;
  private blurred = false;

  constructor(readonly fixtures: Fixtures) {}

  /**
   * Seeds the note and leaves the browser on a blank page, where `plainField`
   * can run. The page opens with Markdown on, as it does the first time, so
   * `show` can be called again and again.
   */
  async seed(body: string) {
    await this.fixtures.app.open('/blank');
    for (const { key } of await this.fixtures.disk.notes()) await this.fixtures.disk.remove(key);
    await this.fixtures.disk.seed([{ key: 'edit', title: null, body }]);
    await this.fixtures.browser.evaluate(() => {
      localStorage.removeItem('nullpad.markdown');
      return null;
    });
  }

  /** Opens the seeded note in the page view, with the caret at its start. */
  async show(body: string) {
    const { app, page } = this.fixtures;
    await app.open('/');
    await expect(page.text).toHaveValue(body);
    await page.markdown.tap();
    await expect(page.text).toBeFocused();
    await page.nextFrame();
  }

  async open(body: string) {
    await this.seed(body);
    await this.show(body);
  }

  /** A plain text field on the blank page, holding `body`, with `start` to `end` selected. */
  private async putPlainField(body: string, start: number, end: number) {
    await this.fixtures.browser.evaluate(
      (put: { body: string; start: number; end: number }) => {
        const field = document.createElement('textarea');
        field.style.cssText = 'position:fixed;top:0;left:0;width:2400px;height:600px;white-space:pre;font:16px monospace';
        document.body.append(field);
        field.value = put.body;
        field.focus();
        field.setSelectionRange(put.start, put.end);
        return null;
      },
      { body, start, end },
    );
  }

  /**
   * What a plain text field holding `body` does to its text when `keys` are
   * pressed from `start`, and `typed` is typed after them. Runs on the blank
   * page, so the page under test is not in the way.
   */
  async plainField(body: string, start: number, keys: string[], typed: string) {
    const { browser } = this.fixtures;
    await this.putPlainField(body, start, start);
    for (const key of keys) await browser.keyboard.press(key);
    await browser.keyboard.type(typed);
    return browser.evaluate(() => {
      const field = document.querySelector('textarea')!;
      const value = field.value;
      field.remove();
      return value;
    });
  }

  /**
   * What a plain text field holding `body` ends with when `key` is pressed
   * with the caret at `start`, or with `start` to `end` selected: its text and
   * the two ends of its selection as offsets, `head` being the end that moves.
   * Runs on the blank page.
   */
  async plainKey(body: string, start: number, key: string, end = start) {
    const { browser } = this.fixtures;
    await this.putPlainField(body, start, end);
    await browser.keyboard.press(key);
    return browser.evaluate(() => {
      const field = document.querySelector('textarea')!;
      const backward = field.selectionDirection === 'backward';
      const out = {
        value: field.value,
        anchor: backward ? field.selectionEnd : field.selectionStart,
        head: backward ? field.selectionStart : field.selectionEnd,
      };
      field.remove();
      return out;
    });
  }

  point(spot: Spot) {
    return this.fixtures.browser.evaluate(centreOf, spot).then((at) => {
      expect(at, `"${spot.word}" is drawn on the page`).not.toBeNull();
      return at!;
    });
  }

  /** Where the first drawn text node holding `word` is, whole. */
  async rowBox(word: string) {
    const box = await this.fixtures.browser.evaluate((word: string) => {
      const texts = document.createTreeWalker(document.querySelector('.page')!, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => (node.parentElement?.closest('textarea') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      for (let text = texts.nextNode() as Text | null; text; text = texts.nextNode() as Text | null) {
        if (!text.data.includes(word)) continue;
        const range = document.createRange();
        range.selectNodeContents(text);
        const box = range.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      }
      return null;
    }, word);
    expect(box, `"${word}" is drawn on the page`).not.toBeNull();
    return box!;
  }

  /**
   * Waits for the page to draw what was just done, and checks that the cursor
   * can be seen. A test fails, after it has run on, for each of the first few
   * actions after which it cannot. The fast mode waits for nothing and looks
   * only where a guard asserts something.
   */
  async settle(after: string) {
    if (fast) return;
    await this.fixtures.page.nextFrame();
    await this.seeCursor(after);
  }

  async seeCursor(after: string) {
    if (this.blurred) return;
    const problem = await cursorProblem(this.fixtures.browser, after);
    if (problem !== null && this.lost++ < 5) expect.soft(problem, 'the cursor is in view').toBeNull();
  }

  private async pointerAt(x: number, y: number) {
    this.blurred = false;
    const { browser } = this.fixtures;
    await browser.mouse.move(x, y);
    await browser.mouse.down();
    await browser.mouse.up();
  }

  /** Presses the pointer at a place in the window. */
  async clickAt(x: number, y: number) {
    await this.pointerAt(x, y);
    await this.settle(`a click at ${Math.round(x)}, ${Math.round(y)}`);
  }

  async click(spot: Spot) {
    await this.clickNow(spot);
    await this.settle(`a click on "${spot.word}"`);
  }

  /** A click that waits for nothing, so that the next key can come in the same frame. */
  async clickNow(spot: Spot) {
    const { x, y } = await this.point(spot);
    await this.pointerAt(x, y);
  }

  async shiftClick(spot: Spot) {
    const { browser } = this.fixtures;
    const { x, y } = await this.point(spot);
    await browser.keyboard.down('Shift');
    await browser.mouse.move(x, y);
    await browser.mouse.down();
    await browser.mouse.up();
    await browser.keyboard.up('Shift');
    await this.settle(`a Shift+click on "${spot.word}"`);
  }

  async drag(from: Spot, to: Spot) {
    const { browser } = this.fixtures;
    const start = await this.point(from);
    const end = await this.point(to);
    await browser.mouse.move(start.x, start.y);
    await browser.mouse.down();
    for (let step = 1; step <= 8; step++) {
      await browser.mouse.move(start.x + ((end.x - start.x) * step) / 8, start.y + ((end.y - start.y) * step) / 8);
    }
    await browser.mouse.up();
    await this.settle(`a drag from "${from.word}" to "${to.word}"`);
  }

  /** Escape leaves the text field, so after it there is no cursor to look at. */
  async press(...keys: string[]) {
    for (const key of keys) {
      this.blurred = key === 'Escape';
      await this.fixtures.browser.keyboard.press(key);
      if (!this.blurred) await this.settle(key);
      else if (!fast) await this.fixtures.page.nextFrame();
    }
  }

  /** A word at a time, so that the cursor is looked at as the text grows. */
  async type(text: string) {
    this.blurred = false;
    if (fast) return this.fixtures.browser.keyboard.type(text);
    for (const piece of text.match(/\S*\s*/g) ?? []) {
      if (piece === '') continue;
      await this.fixtures.browser.keyboard.type(piece);
      await this.settle(`typing "${piece}"`);
    }
  }

  /** Enter is pressed for each "\n" in `text`, as a person would. */
  async write(text: string) {
    for (const [index, line] of text.split('\n').entries()) {
      if (index > 0) await this.fixtures.browser.keyboard.press('Enter');
      if (line !== '') await this.fixtures.browser.keyboard.type(line);
    }
    await this.settle('writing the note');
  }

  /** What the note is, as saved. */
  async saved() {
    const [note] = await this.fixtures.disk.notes();
    return note!.body;
  }

  /** What the note changed last is, as saved. */
  async savedNewest() {
    const notes = await this.fixtures.disk.notes();
    return notes.at(-1)!.body;
  }

  async expectSaved(expected: string) {
    await expect.poll(() => this.saved(), { message: 'the saved note', timeout: 3000 }).toBe(expected);
  }

  /** The note is as the page shows it. Right for notes of plain text, which is drawn as typed. */
  async expectNote(expected: string) {
    await expect.poll(() => this.shown(), { message: 'the note as shown', timeout: 1500 }).toBe(expected);
  }

  /** The note as the page shows it. The same as the saved note when every row is plain text. */
  async shown() {
    await this.fixtures.page.nextFrame();
    if (fast) await this.seeCursor('the keys pressed');
    return this.fixtures.browser.evaluate(shownInPage);
  }

  /** Where the caret is, from the page alone: the start of the selection. `note` is what the page shows. */
  async caret(note: string) {
    await this.fixtures.page.nextFrame();
    if (fast) await this.seeCursor('the keys pressed');
    const got = await selectionOf(this.fixtures.browser, note.split('\n'), false);
    if ('problem' in got) throw new Error(`the caret cannot be read: ${got.problem}`);
    const [start] = [got.anchor, got.head].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return { row: start![0], col: start![1], selected: got.anchor[0] !== got.head[0] || got.anchor[1] !== got.head[1] };
  }

  async clipboard() {
    return this.fixtures.browser.evaluate(() => navigator.clipboard.readText());
  }

  async fillClipboard(text: string) {
    await this.fixtures.browser.evaluate(async (text: string) => {
      await navigator.clipboard.writeText(text);
      return null;
    }, text);
  }

  /** Whether the cursor can be seen, as `cursorProblem` judges it. */
  async cursorInView() {
    await this.fixtures.page.nextFrame();
    return (await cursorProblem(this.fixtures.browser, 'now')) === null;
  }

  /** Scrolls the page to its end with the wheel, as a person does before clicking in the last block. */
  async scrollToEnd() {
    const { browser, page } = this.fixtures;
    const sheet = await browser.evaluate(() => {
      const box = document.querySelector('.page')!.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    await browser.mouse.move(sheet.x, sheet.y);
    await browser.mouse.wheel(0, 100000);
    await page.nextFrame();
  }
}

/**
 * A second browser for the one thing the test harness cannot send: a click
 * that is the second or third of a quick series. It opens the page as the
 * harness's browser has, on its own empty note, so the note is typed in.
 */
export async function withRawPage(origin: string, body: string, run: (page: RawPage) => Promise<void>) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem('nullpad.markdown', 'off'));
    await page.goto(`${origin}/`);
    const field = page.getByLabel('Note text');
    await field.waitFor();
    await field.click();
    for (const [index, line] of body.split('\n').entries()) {
      if (index > 0) await page.keyboard.press('Enter');
      if (line !== '') await page.keyboard.type(line);
    }
    await page.keyboard.press('Control+Home');
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await run(page);
  } finally {
    await browser.close();
  }
}

/** One double click on a spot, as a hand makes it: two presses, the second counted as the second of a series. */
export async function doubleClick(page: RawPage, spot: Spot) {
  const at = await page.evaluate(centreOf, spot);
  if (!at) throw new Error(`"${spot.word}" is not drawn on the page`);
  await page.mouse.click(at.x, at.y, { clickCount: 2 });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

/** A quick series of clicks on one spot: what a double or triple click is. A hand takes some time between two clicks, so the fast mode keeps that wait. */
export async function clickSeries(page: RawPage, spot: Spot, count: number) {
  const at = await page.evaluate(centreOf, spot);
  if (!at) throw new Error(`"${spot.word}" is not drawn on the page`);
  for (let click = 1; click <= count; click++) {
    await page.mouse.click(at.x, at.y, { clickCount: click });
    if (!fast || click < count) await page.waitForTimeout(70);
  }
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}
