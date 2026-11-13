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

type Cell = [number, number];

type Selection = { problem: string } | { value: string; first: number; anchor: Cell; head: Cell };

/**
 * The cursor and the selection as a person sees them. Runs in the page.
 *
 * While the text field is in sight, they are the field's. A text field cannot
 * be asked where its caret is, so a hidden copy of it is laid out at the same
 * place and asked instead. `lines` are the rows of the note as it should now
 * be: the text field holds the rows between the part drawn above it and the
 * part drawn below it, so the rows below fix where it starts.
 *
 * While a selection across blocks is painted on the drawn page, the field is
 * out of sight, and they are read from the paint: the selection from the
 * `nullpad-selection` highlight, the cursor from the `nullpad-head` one. A
 * place on the drawn page stands for every place of the note drawn there,
 * such as before and after the marks the page hides. Of those, the reader
 * takes the one the text field holds, which is where typing goes, and names
 * the problem when the field holds none of them.
 */
function lookInPage(use: { want: 'cursor' | 'selection'; placing: string[]; lines: string[]; focus: boolean }): Cursor | Selection {
  const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]');
  if (!field) return use.want === 'cursor' ? { at: null, problem: 'there is no text field' } : { problem: 'there is no text field' };
  const focused = document.activeElement === field;
  const backward = field.selectionDirection === 'backward';
  const fieldAt = (offset: number): Cell => {
    const before = field.value.slice(0, offset);
    return [before.split('\n').length - 1, offset - (before.lastIndexOf('\n') + 1)];
  };
  const view = window.visualViewport;
  const sheet = document.querySelector('.page');
  const sheetBox = sheet?.getBoundingClientRect();
  const seen = {
    left: Math.max(0, sheetBox?.left ?? 0),
    top: Math.max(0, sheetBox?.top ?? 0),
    right: Math.min(view?.width ?? innerWidth, sheetBox?.right ?? Infinity),
    bottom: Math.min(view?.height ?? innerHeight, sheetBox?.bottom ?? Infinity),
  };
  const round = (value: number) => Math.round(value * 10) / 10;
  const where = (at: { x: number; top: number; bottom: number }) =>
    `the cursor is at y ${round(at.top)} to ${round(at.bottom)}, x ${round(at.x)}, and the page shows y ${round(seen.top)} to ${round(seen.bottom)}, x ${round(seen.left)} to ${round(seen.right)}`;
  const outOfView = (at: { x: number; top: number; bottom: number }) =>
    at.top < seen.top - 0.5 || at.bottom > seen.bottom + 0.5 || at.x < seen.left - 0.5 || at.x > seen.right + 0.5;
  const named = (element: Element | null) => (element ? `<${element.tagName.toLowerCase()} class="${element.className}">` : 'nothing');

  const paintedRanges = (name: string) => [...((globalThis.CSS?.highlights?.get(name) as Iterable<AbstractRange> | undefined) ?? [])];
  const [selected] = paintedRanges('nullpad-selection');
  const [headMark] = paintedRanges('nullpad-head');
  const fieldSeen = field.checkVisibility({ opacityProperty: true, visibilityProperty: true });

  const both = (problem: string) => (use.want === 'cursor' ? { at: null, problem } : { problem });

  const fieldCursor = (): Cursor => {
    const rect = field.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { at: null, problem: 'the text field has no size' };
    const head = backward ? field.selectionStart : field.selectionEnd;
    const style = getComputedStyle(field);
    const ruler = document.createElement('div');
    ruler.setAttribute('aria-hidden', 'true');
    ruler.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;visibility:hidden;pointer-events:none;overflow:hidden;box-sizing:border-box`;
    for (const name of use.placing) ruler.style.setProperty(name, style.getPropertyValue(name));
    const marker = document.createElement('span');
    marker.textContent = '​';
    ruler.append(field.value.slice(0, head), marker, field.value.slice(head));
    document.body.append(ruler);
    const found = marker.getBoundingClientRect();
    ruler.remove();

    const at = { x: found.left - field.scrollLeft, top: found.top - field.scrollTop, bottom: found.bottom - field.scrollTop };
    if (!focused) return { at, problem: 'the text field has no focus, so there is no cursor' };
    if (outOfView(at)) return { at, problem: `${where(at)}, so it is out of view` };
    if (at.top < rect.top - 0.5 || at.bottom > rect.bottom + 0.5) {
      return { at, problem: `${where(at)}, and the text field's box ends at y ${round(rect.top)} to ${round(rect.bottom)}` };
    }
    const hit = document.elementFromPoint(at.x + 0.5, (at.top + at.bottom) / 2);
    if (hit !== field) return { at, problem: `${where(at)}, and ${named(hit)} is drawn over it` };
    return { at, problem: null };
  };

  const fieldSelection = (): Selection => {
    if (use.focus && !focused) return { problem: 'the text field has no focus' };
    const held = field.value.split('\n');
    const below = document.querySelector<HTMLElement>('[data-test-id="live-below"] [data-row]');
    const fenceBefore = (row: number) => /^[\s>]*(?:(?:[-*+]|\d+[.)])\s+)*(?:`{3,}|~{3,})/.test(use.lines[row - 1] ?? '');
    const firstBelow = below
      ? Number(below.dataset['row']) - (below.tagName === 'PRE' && fenceBefore(Number(below.dataset['row'])) ? 1 : 0)
      : use.lines.length;
    const first = firstBelow - held.length;
    const shift = ([row, col]: Cell): Cell => [first + row, col];
    const [start, end] = [shift(fieldAt(field.selectionStart)), shift(fieldAt(field.selectionEnd))];
    return { value: field.value, first, anchor: backward ? end : start, head: backward ? start : end };
  };

  /** The box of a caret at `range`: the letter after it, else the letter before it, else the element it is in. */
  const caretBox = (range: AbstractRange) => {
    const node = range.startContainer;
    const offset = range.startOffset;
    if (node instanceof Text) {
      const one = document.createRange();
      if (offset < node.data.length && node.data[offset] !== '\n') {
        one.setStart(node, offset);
        one.setEnd(node, offset + 1);
        const after = one.getClientRects()[0];
        if (after) return { x: after.left, top: after.top, bottom: after.bottom };
      }
      if (offset > 0) {
        one.setStart(node, offset - 1);
        one.setEnd(node, offset);
        const before = [...one.getClientRects()].pop();
        if (before) return { x: before.right, top: before.top, bottom: before.bottom };
      }
    }
    const element = node instanceof Element ? node : node.parentElement!;
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const line = parseFloat(style.lineHeight) || 1.2 * parseFloat(style.fontSize);
    return { x: box.left, top: box.top, bottom: box.top + Math.min(box.height, line) };
  };

  const paintedCursor = (head: AbstractRange): Cursor => {
    const at = caretBox(head);
    if (outOfView(at)) return { at, problem: `${where(at)}, so it is out of view` };
    const node = head.startContainer;
    const owner = (node instanceof Element ? node : node.parentElement!).closest('[data-row]') ?? node.parentElement!;
    const hit = document.elementFromPoint(at.x + 0.5, (at.top + at.bottom) / 2);
    if (!hit || !(owner.contains(hit) || hit.contains(owner))) return { at, problem: `${where(at)}, and ${named(hit)} is drawn over it` };
    return { at, problem: null };
  };

  const paintedSelection = (range: AbstractRange, head: AbstractRange): Selection => {
    const lines = use.lines;
    const marks = sheet ? [...sheet.querySelectorAll<HTMLElement>('[data-row]:not(textarea)')] : [];
    const rowOf = (mark: HTMLElement) => Number(mark.dataset['row']);
    const holderOf = (row: number) => marks.filter((mark) => rowOf(mark) <= row).pop();
    const segmenter = new Intl.Segmenter();
    const letters = (text: string) => [...segmenter.segment(text)].map((piece) => piece.segment);

    /** The drawn text from the start of `holder` to where the page draws `col` of `row`, which `holder` draws. */
    const drawnTo = (holder: HTMLElement, row: number, col: number) => {
      const visible = holder.textContent ?? '';
      const drawnRows = visible.split('\n');
      const index = row - rowOf(holder);
      if (index >= drawnRows.length) return visible;
      const typed = letters(lines[row] ?? '');
      const shown = letters(drawnRows[index]!);
      let left = letters((lines[row] ?? '').slice(0, col)).length;
      let taken = '';
      for (let t = 0, s = 0; left > 0 && t < typed.length && s < shown.length; t++, left--) {
        if (typed[t] === shown[s]) taken += shown[s++];
      }
      return [...drawnRows.slice(0, index), taken].join('\n');
    };

    /** Every place of the note that is drawn at the boundary point `node`, `offset`. */
    const placesAt = (node: Node, offset: number) => {
      const found: Cell[] = [];
      for (let row = 0; row < lines.length; row++) {
        const holder = holderOf(row);
        if (!holder || !holder.contains(node)) continue;
        const span = document.createRange();
        span.setStart(holder, 0);
        span.setEnd(node, offset);
        const painted = span.toString();
        const line = lines[row]!;
        for (let col = 0; col <= line.length; col++) if (drawnTo(holder, row, col) === painted) found.push([row, col]);
      }
      return found;
    };

    const show = (cells: Cell[]) => (cells.length === 0 ? 'nowhere in the note' : cells.map(([row, col]) => `row ${row} column ${col}`).join(' or '));
    const same = (a: Cell, b: Cell) => a[0] === b[0] && a[1] === b[1];
    const point = document.createRange();
    point.setStart(head.startContainer, head.startOffset);
    const startRange = document.createRange();
    startRange.setStart(range.startContainer, range.startOffset);
    const atStart = startRange.compareBoundaryPoints(Range.START_TO_START, point) === 0;
    const endRange = document.createRange();
    endRange.setStart(range.endContainer, range.endOffset);
    const atEnd = endRange.compareBoundaryPoints(Range.START_TO_START, point) === 0;
    if (!atStart && !atEnd) return { problem: 'the head of the painted selection is not at either of its ends' };
    const headPlaces = placesAt(head.startContainer, head.startOffset);
    const anchorPlaces = atStart ? placesAt(range.endContainer, range.endOffset) : placesAt(range.startContainer, range.startOffset);

    const held = field.value.split('\n');
    const firsts = lines.flatMap((_, first) => (lines.slice(first, first + held.length).join('\n') === field.value ? [first] : []));
    const ends = (first: number) => {
      const shift = ([row, col]: Cell): Cell => [first + row, col];
      const [start, end] = [shift(fieldAt(field.selectionStart)), shift(fieldAt(field.selectionEnd))];
      return { anchor: backward ? end : start, head: backward ? start : end };
    };
    const painted = `the selection is painted from ${show(anchorPlaces)} to ${show(headPlaces)}`;
    if (firsts.length === 0) return { problem: `${painted}, and the text field holds ${JSON.stringify(field.value)}, which is not rows of the note` };
    for (const first of firsts) {
      const { anchor, head } = ends(first);
      if (anchorPlaces.some((cell) => same(cell, anchor)) && headPlaces.some((cell) => same(cell, head))) {
        return { value: field.value, first, anchor, head };
      }
    }
    const { anchor, head: fieldHead } = ends(firsts[0]!);
    return { problem: `${painted}, and the text field has it from ${show([anchor])} to ${show([fieldHead])}, where typing would go` };
  };

  if (!selected && !headMark) return use.want === 'cursor' ? fieldCursor() : fieldSelection();
  if (!selected || !headMark) return both(`only the ${selected ? 'selection' : 'head'} of a selection is painted on the page`);
  if (fieldSeen) return both('a selection is painted on the page while the text field is in sight too');
  if (!selected.startContainer.isConnected || !headMark.startContainer.isConnected) return both('the selection is painted on text the page no longer draws');
  if (!focused) return both('the text field has no focus, so there is no cursor');
  return use.want === 'cursor' ? paintedCursor(headMark) : paintedSelection(selected, headMark);
}

/** Looks at the cursor and names the key after which it was out of view. Null when it is in view. */
export async function cursorProblem(browser: Browser, after: string) {
  const { problem } = (await browser.evaluate(lookInPage, { want: 'cursor', placing, lines: [], focus: true })) as Cursor;
  return problem === null ? null : `after ${after}: ${problem}`;
}

/** Where the cursor is in the window, or null when there is none. */
export async function cursorAt(browser: Browser) {
  return ((await browser.evaluate(lookInPage, { want: 'cursor', placing, lines: [], focus: true })) as Cursor).at;
}

/**
 * The selection as rows and columns of the note, and what the text field
 * holds. `lines` are the rows of the note as it should now be. `focus: false`
 * reads it even when the field has no focus.
 */
export async function selectionOf(browser: Browser, lines: string[], focus = true) {
  return (await browser.evaluate(lookInPage, { want: 'selection', placing, lines, focus })) as Selection;
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
