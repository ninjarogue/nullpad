import type { Browser } from '@e2e-dev/web';

declare const process: { env: Record<string, string | undefined> };

/**
 * `NULLPAD_FAST=1` runs the movement, editing and typing guards the way a
 * hurried hand does: no frame is waited for between two keys, or between a
 * click and the key after it. The page is looked at only where a guard asserts
 * something.
 */
export const fast = process.env['NULLPAD_FAST'] === '1';

/** The properties that decide where a character of a text field is drawn. */
const placing = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-ligatures', 'font-kerning', 'font-feature-settings',
  'line-height', 'letter-spacing', 'word-spacing', 'tab-size', 'text-indent', 'text-transform', 'text-align', 'direction',
  'white-space', 'overflow-wrap', 'word-break', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-style',
];

type Cursor = {
  /** Where the cursor is in the window, or null when there is no open text field to have one. */
  at: { x: number; top: number; bottom: number } | null;
  /** What is wrong with it as a person sees it, or null. */
  problem: string | null;
};

/**
 * The cursor of the text field, seen as a person sees it: its box is inside
 * the window and inside the page that scrolls, the field is not clipped
 * around it, and nothing is drawn over it. A text field cannot be asked where
 * its caret is, so a hidden copy of it is laid out at the same place and
 * asked instead. Runs in the page.
 */
function cursorInPage(use: { placing: string[] }): Cursor {
  const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]');
  if (!field) return { at: null, problem: 'there is no text field' };
  const rect = field.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { at: null, problem: 'the text field has no size' };
  const head = field.selectionDirection === 'backward' ? field.selectionStart : field.selectionEnd;
  const style = getComputedStyle(field);
  const ruler = document.createElement('div');
  ruler.setAttribute('aria-hidden', 'true');
  ruler.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;visibility:hidden;pointer-events:none;overflow:hidden;box-sizing:border-box`;
  for (const name of use.placing) ruler.style.setProperty(name, style.getPropertyValue(name));
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  ruler.append(field.value.slice(0, head), marker, field.value.slice(head));
  document.body.append(ruler);
  const found = marker.getBoundingClientRect();
  ruler.remove();

  const left = found.left - field.scrollLeft;
  const top = found.top - field.scrollTop;
  const bottom = found.bottom - field.scrollTop;
  const at = { x: left, top, bottom };
  if (document.activeElement !== field) return { at, problem: 'the text field has no focus, so there is no cursor' };
  const view = window.visualViewport;
  const sheet = document.querySelector('.page')?.getBoundingClientRect();
  const seen = {
    left: Math.max(0, sheet?.left ?? 0),
    top: Math.max(0, sheet?.top ?? 0),
    right: Math.min(view?.width ?? innerWidth, sheet?.right ?? Infinity),
    bottom: Math.min(view?.height ?? innerHeight, sheet?.bottom ?? Infinity),
  };
  const round = (value: number) => Math.round(value * 10) / 10;
  const where = `the cursor is at y ${round(top)} to ${round(bottom)}, x ${round(left)}, and the page shows y ${round(seen.top)} to ${round(seen.bottom)}, x ${round(seen.left)} to ${round(seen.right)}`;
  if (top < seen.top - 0.5 || bottom > seen.bottom + 0.5 || left < seen.left - 0.5 || left > seen.right + 0.5) {
    return { at, problem: `${where}, so it is out of view` };
  }
  if (top < rect.top - 0.5 || bottom > rect.bottom + 0.5) {
    return { at, problem: `${where}, and the text field's box ends at y ${round(rect.top)} to ${round(rect.bottom)}` };
  }
  const hit = document.elementFromPoint(left + 0.5, (top + bottom) / 2);
  if (hit !== field) {
    return { at, problem: `${where}, and ${hit ? `<${hit.tagName.toLowerCase()} class="${hit.className}">` : 'nothing'} is drawn over it` };
  }
  return { at, problem: null };
}

/** Looks at the cursor and names the key after which it was out of view. Null when it is in view. */
export async function cursorProblem(browser: Browser, after: string) {
  const { problem } = await browser.evaluate(cursorInPage, { placing });
  return problem === null ? null : `after ${after}: ${problem}`;
}

/** Where the cursor is in the window, or null when there is none. */
export async function cursorAt(browser: Browser) {
  return (await browser.evaluate(cursorInPage, { placing })).at;
}

/**
 * The selection of the open text field as rows and columns of the note, and
 * what the field holds. `lines` are the rows of the note as it should now be:
 * the text field holds the rows between the part drawn above it and the part
 * drawn below it, so the rows below fix where it starts. Runs in the page.
 */
function selectionInPage(model: { lines: string[] }): { problem: string } | { value: string; first: number; anchor: [number, number]; head: [number, number] } {
  const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]');
  if (!field) return { problem: 'there is no text field' };
  if (document.activeElement !== field) return { problem: 'the text field has no focus' };
  const held = field.value.split('\n');
  const below = document.querySelector<HTMLElement>('[data-test-id="live-below"] [data-row]');
  const fenceBefore = (row: number) => /^[\s>]*(?:(?:[-*+]|\d+[.)])\s+)*(?:`{3,}|~{3,})/.test(model.lines[row - 1] ?? '');
  const firstBelow = below
    ? Number(below.dataset['row']) - (below.tagName === 'PRE' && fenceBefore(Number(below.dataset['row'])) ? 1 : 0)
    : model.lines.length;
  const first = firstBelow - held.length;
  const at = (offset: number): [number, number] => {
    const before = field.value.slice(0, offset);
    return [first + before.split('\n').length - 1, offset - (before.lastIndexOf('\n') + 1)];
  };
  const backward = field.selectionDirection === 'backward';
  const [start, end] = [at(field.selectionStart), at(field.selectionEnd)];
  return { value: field.value, first, anchor: backward ? end : start, head: backward ? start : end };
}

/** The selection of the open text field, or what is wrong with it. */
export function selectionOf(browser: Browser, lines: string[]) {
  return browser.evaluate(selectionInPage, { lines });
}

export type Box = { left: number; top: number; right: number; bottom: number };

export type Word = {
  /** Where the page draws the word, or null while the text field holds it. */
  drawn: Box | null;
  /** Where the open text field has the word, or null while the page draws it. */
  typed: Box | null;
  /** Where a hand aims at the drawn word: a quarter of the way into its middle letter. */
  aim: { x: number; y: number } | null;
};

/** The first drawn text node holding `word` and the same word in the open text field. Runs in the page. */
function wordInPage(find: { word: string; placing: string[] }): Word {
  const rect = (range: Range): Box => {
    const box = range.getClientRects()[0] ?? range.getBoundingClientRect();
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  };
  let drawn: Box | null = null;
  let aim: { x: number; y: number } | null = null;
  const texts = document.createTreeWalker(document.querySelector('.page')!, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('textarea, .mirror') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let text = texts.nextNode() as Text | null; text && !drawn; text = texts.nextNode() as Text | null) {
    const at = text.data.indexOf(find.word);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + find.word.length);
    drawn = rect(range);
    const middle = at + Math.floor(find.word.length / 2);
    range.setStart(text, middle);
    range.setEnd(text, middle + 1);
    const letter = rect(range);
    aim = { x: letter.left + (letter.right - letter.left) / 4, y: (letter.top + letter.bottom) / 2 };
  }

  let typed: Box | null = null;
  const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]');
  const at = field ? field.value.indexOf(find.word) : -1;
  if (field && at >= 0) {
    const box = field.getBoundingClientRect();
    const style = getComputedStyle(field);
    const ruler = document.createElement('div');
    ruler.setAttribute('aria-hidden', 'true');
    ruler.style.cssText = `position:fixed;left:${box.left}px;top:${box.top - field.scrollTop}px;width:${box.width}px;height:${box.height}px;visibility:hidden;pointer-events:none;box-sizing:border-box`;
    for (const name of find.placing) ruler.style.setProperty(name, style.getPropertyValue(name));
    ruler.append(field.value);
    document.body.append(ruler);
    const range = document.createRange();
    range.setStart(ruler.firstChild!, at);
    range.setEnd(ruler.firstChild!, at + find.word.length);
    typed = rect(range);
    ruler.remove();
  }
  return { drawn, typed, aim };
}

/** Where `word` is, drawn on the page and in the open text field. The word must appear once in the note. */
export function wordAt(browser: Browser, word: string) {
  return browser.evaluate(wordInPage, { word, placing });
}

/** The words drawn on the page, and the ones among them that are link text, which a click follows instead of editing. Runs in the page. */
export function drawnWordsInPage(): { words: string[]; links: string[] } {
  const words: string[] = [];
  const links: string[] = [];
  const texts = document.createTreeWalker(document.querySelector('.page')!, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('textarea, .mirror') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let text = texts.nextNode() as Text | null; text; text = texts.nextNode() as Text | null) {
    for (const found of text.data.matchAll(/[\p{L}\p{N}]{3,}/gu)) (text.parentElement?.closest('a') ? links : words).push(found[0]);
  }
  return { words, links };
}

/** Every run of three or more letters or digits drawn on the page. */
export function drawnWords(browser: Browser) {
  return browser.evaluate(drawnWordsInPage);
}
