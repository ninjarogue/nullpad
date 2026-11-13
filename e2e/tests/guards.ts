import type { Browser } from '@e2e-dev/web';

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
