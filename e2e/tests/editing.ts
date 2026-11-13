import type { Browser } from '@e2e-dev/web';
import { expect } from 'e2e';
import type { App } from 'e2e';
import { chromium } from 'playwright-core';
import type { Page as RawPage } from 'playwright-core';
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

/** The note as the page shows it: the part above the text field, the field, and the part below. */
function shownInPage() {
  const rows = (part: Element | null) => (part ? [...part.children].map((row) => row.textContent ?? '') : []);
  const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
  return [
    ...rows(document.querySelector('[data-test-id="live-above"]')),
    field.value,
    ...rows(document.querySelector('[data-test-id="live-below"]')),
  ].join('\n');
}

function caretInPage(model: { lines: string[] }) {
  const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
  const held = field.value.split('\n');
  const below = document.querySelector<HTMLElement>('[data-test-id="live-below"] [data-row]');
  const fenceBefore = (row: number) => /^[\s>]*(?:(?:[-*+]|\d+[.)])\s+)*(?:`{3,}|~{3,})/.test(model.lines[row - 1] ?? '');
  const firstBelow = below
    ? Number(below.dataset['row']) - (below.tagName === 'PRE' && fenceBefore(Number(below.dataset['row'])) ? 1 : 0)
    : model.lines.length;
  const first = firstBelow - held.length;
  const before = field.value.slice(0, field.selectionStart);
  const rowsBefore = before.split('\n');
  return { row: first + rowsBefore.length - 1, col: rowsBefore[rowsBefore.length - 1]!.length, selected: field.selectionStart !== field.selectionEnd };
}

/** Drives the page view of one note the way a person does: the pointer, the keyboard and the clipboard. */
export class Editing {
  constructor(readonly fixtures: Fixtures) {}

  /** Seeds the note and leaves the browser on a blank page, where `plainField` can run. */
  async seed(body: string) {
    await this.fixtures.disk.seed([{ key: 'edit', title: null, body }]);
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

  /**
   * What a plain text field holding `body` does to its text when `keys` are
   * pressed from `start`, and `typed` is typed after them. Runs on the blank
   * page, so the page under test is not in the way.
   */
  async plainField(body: string, start: number, keys: string[], typed: string) {
    const { browser } = this.fixtures;
    await browser.evaluate(
      (put: { body: string; start: number }) => {
        const field = document.createElement('textarea');
        field.style.cssText = 'position:fixed;top:0;left:0;width:2400px;height:600px;white-space:pre;font:16px monospace';
        document.body.append(field);
        field.value = put.body;
        field.focus();
        field.setSelectionRange(put.start, put.start);
        return null;
      },
      { body, start },
    );
    for (const key of keys) await browser.keyboard.press(key);
    await browser.keyboard.type(typed);
    return browser.evaluate(() => {
      const field = document.querySelector('textarea')!;
      const value = field.value;
      field.remove();
      return value;
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

  /** Presses the pointer at a place in the window. */
  async clickAt(x: number, y: number) {
    const { browser, page } = this.fixtures;
    await browser.mouse.move(x, y);
    await browser.mouse.down();
    await browser.mouse.up();
    await page.nextFrame();
  }

  async click(spot: Spot) {
    const { browser } = this.fixtures;
    const { x, y } = await this.point(spot);
    await browser.mouse.move(x, y);
    await browser.mouse.down();
    await browser.mouse.up();
    await this.fixtures.page.nextFrame();
  }

  async shiftClick(spot: Spot) {
    const { browser } = this.fixtures;
    const { x, y } = await this.point(spot);
    await browser.keyboard.down('Shift');
    await browser.mouse.move(x, y);
    await browser.mouse.down();
    await browser.mouse.up();
    await browser.keyboard.up('Shift');
    await this.fixtures.page.nextFrame();
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
    await this.fixtures.page.nextFrame();
  }

  async press(...keys: string[]) {
    for (const key of keys) await this.fixtures.browser.keyboard.press(key);
    await this.fixtures.page.nextFrame();
  }

  async type(text: string) {
    await this.fixtures.browser.keyboard.type(text);
    await this.fixtures.page.nextFrame();
  }

  /** Enter is pressed for each "\n" in `text`, as a person would. */
  async write(text: string) {
    for (const [index, line] of text.split('\n').entries()) {
      if (index > 0) await this.fixtures.browser.keyboard.press('Enter');
      if (line !== '') await this.fixtures.browser.keyboard.type(line);
    }
    await this.fixtures.page.nextFrame();
  }

  /** What the note is, as saved. */
  async saved() {
    const [note] = await this.fixtures.disk.notes();
    return note!.body;
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
    return this.fixtures.browser.evaluate(shownInPage);
  }

  /** Where the caret is, from the page alone. `note` is what the page shows. */
  async caret(note: string) {
    await this.fixtures.page.nextFrame();
    return this.fixtures.browser.evaluate(caretInPage, { lines: note.split('\n') });
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

  /** Whether the text field is inside the page that scrolls, as the caret is when it can be seen. */
  async fieldInView() {
    await this.fixtures.page.nextFrame();
    return this.fixtures.browser.evaluate(() => {
      const box = document.querySelector('[data-test-id="editor"]')!.getBoundingClientRect();
      const sheet = document.querySelector('.page')!.getBoundingClientRect();
      return box.top >= Math.max(sheet.top, 0) && box.bottom <= Math.min(sheet.bottom, innerHeight);
    });
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

/** A quick series of clicks on one spot: what a double or triple click is. */
export async function clickSeries(page: RawPage, spot: Spot, count: number) {
  const at = await page.evaluate(centreOf, spot);
  if (!at) throw new Error(`"${spot.word}" is not drawn on the page`);
  for (let click = 1; click <= count; click++) {
    await page.mouse.click(at.x, at.y, { clickCount: click });
    await page.waitForTimeout(70);
  }
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}
