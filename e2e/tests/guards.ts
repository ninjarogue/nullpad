import type { Browser } from '@e2e-dev/web';

declare const process: { env: Record<string, string | undefined> };

export const fast = process.env['NULLPAD_FAST'] === '1';

export const placing = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-ligatures', 'font-kerning', 'font-feature-settings',
  'line-height', 'letter-spacing', 'word-spacing', 'tab-size', 'text-indent', 'text-transform', 'text-align', 'direction',
  'white-space', 'overflow-wrap', 'word-break', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-style',
];

type Cursor = {
  at: { x: number; top: number; bottom: number } | null;
  problem: string | null;
};

type Cell = [number, number];

type Selection = { problem: string } | { value: string; first: number; anchor: Cell; head: Cell };

/**
 * A text field cannot be asked where its caret is, so a hidden copy of it is
 * laid out at the same place and asked instead.
 */
function lookInPage(use: { want: 'cursor' | 'selection'; placing: string[]; lines: string[]; focus: boolean; cut?: boolean }): Cursor | Selection {
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
    (use.cut ? at.bottom <= seen.top + 0.5 || at.top >= seen.bottom - 0.5 : at.top < seen.top - 0.5 || at.bottom > seen.bottom + 0.5) ||
    at.x < seen.left - 0.5 ||
    at.x > seen.right + 0.5;
  const shownMiddle = (at: { top: number; bottom: number }) => (Math.max(at.top, seen.top) + Math.min(at.bottom, seen.bottom)) / 2;
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
    const letter = field.value[head];
    const after = letter === undefined || letter === '\n' ? '' : letter;
    marker.textContent = after === '' ? '​' : after;
    ruler.append(field.value.slice(0, head), marker, field.value.slice(head + after.length));
    document.body.append(ruler);
    const found = marker.getBoundingClientRect();
    ruler.remove();

    const at = { x: found.left - field.scrollLeft, top: found.top - field.scrollTop, bottom: found.bottom - field.scrollTop };
    if (!focused) return { at, problem: 'the text field has no focus, so there is no cursor' };
    if (outOfView(at)) return { at, problem: `${where(at)}, so it is out of view` };
    if (at.top < rect.top - 0.5 || at.bottom > rect.bottom + 0.5) {
      return { at, problem: `${where(at)}, and the text field's box ends at y ${round(rect.top)} to ${round(rect.bottom)}` };
    }
    const hit = document.elementFromPoint(Math.min(at.x + 0.5, rect.right - 0.5), shownMiddle(at));
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
    const hit = document.elementFromPoint(at.x + 0.5, shownMiddle(at));
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

/**
 * After a click, a cursor on a line the page shows only part of is in view:
 * a text field does not scroll to a caret a click puts there. After keys it
 * has to show whole.
 */
export async function cursorProblem(browser: Browser, after: string, clicked = false) {
  const { problem } = (await browser.evaluate(lookInPage, { want: 'cursor', placing, lines: [], focus: true, cut: clicked })) as Cursor;
  return problem === null ? null : `after ${after}: ${problem}`;
}

export async function cursorStartsLine(browser: Browser) {
  return (await browser.evaluate(startsLineInPage, placing)) as boolean;
}

function startsLineInPage(placing: string[]) {
  const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]');
  const top = (box: DOMRect | undefined) => Math.round(box?.top ?? NaN);
  const [painted] = [...((globalThis.CSS?.highlights?.get('nullpad-head') as Iterable<AbstractRange> | undefined) ?? [])];
  if (painted && !field?.checkVisibility({ opacityProperty: true, visibilityProperty: true })) {
    const node = painted.startContainer;
    const offset = painted.startOffset;
    if (!(node instanceof Text) || offset === 0 || offset >= node.data.length) return offset === 0;
    const letter = (from: number) => {
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, from + 1);
      return range.getClientRects()[0];
    };
    return top(letter(offset - 1)) !== top(letter(offset));
  }
  if (!field) return false;
  const head = field.selectionDirection === 'backward' ? field.selectionStart : field.selectionEnd;
  if (head === 0 || field.value[head - 1] === '\n') return true;
  const rect = field.getBoundingClientRect();
  const style = getComputedStyle(field);
  const ruler = document.createElement('div');
  ruler.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;visibility:hidden;box-sizing:border-box`;
  for (const name of placing) ruler.style.setProperty(name, style.getPropertyValue(name));
  const before = document.createElement('span');
  before.textContent = field.value[head - 1]!;
  const after = document.createElement('span');
  after.textContent = field.value[head] === undefined || field.value[head] === '\n' ? '​' : field.value[head]!;
  ruler.append(field.value.slice(0, head - 1), before, after, field.value.slice(head + 1));
  document.body.append(ruler);
  const starts = top(before.getClientRects()[0]) !== top(after.getClientRects()[0]);
  ruler.remove();
  return starts;
}

export async function cursorAt(browser: Browser) {
  return ((await browser.evaluate(lookInPage, { want: 'cursor', placing, lines: [], focus: true })) as Cursor).at;
}

export async function selectionOf(browser: Browser, lines: string[], focus = true) {
  return (await browser.evaluate(lookInPage, { want: 'selection', placing, lines, focus })) as Selection;
}

export type Box = { left: number; top: number; right: number; bottom: number };

export type Word = {
  drawn: Box | null;
  typed: Box | null;
  aim: { x: number; y: number } | null;
};

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

export function wordAt(browser: Browser, word: string) {
  return browser.evaluate(wordInPage, { word, placing });
}

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

export function drawnWords(browser: Browser) {
  return browser.evaluate(drawnWordsInPage);
}
