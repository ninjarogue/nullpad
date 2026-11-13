import type { Browser } from '@e2e-dev/web';

/** The properties that decide where a character of a text field is drawn. */
const placing = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant-ligatures', 'font-kerning', 'font-feature-settings',
  'line-height', 'letter-spacing', 'word-spacing', 'tab-size', 'text-indent', 'text-transform', 'text-align', 'direction',
  'white-space', 'overflow-wrap', 'word-break', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'border-style',
];

/**
 * The cursor of the text field, seen as a person sees it: its box is inside
 * the window and inside the page that scrolls, the field is not clipped
 * around it, and nothing is drawn over it. Returns what is wrong, or null.
 * A text field cannot be asked where its caret is, so a hidden copy of it is
 * laid out at the same place and asked instead. Runs in the page.
 */
function cursorInPage(use: { placing: string[] }): string | null {
  const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]');
  if (!field) return 'there is no text field';
  if (document.activeElement !== field) return 'the text field has no focus, so there is no cursor';
  const rect = field.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return 'the text field has no size';
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
    return `${where}, so it is out of view`;
  }
  if (top < rect.top - 0.5 || bottom > rect.bottom + 0.5) return `${where}, and the text field's box ends at y ${round(rect.top)} to ${round(rect.bottom)}`;
  const hit = document.elementFromPoint(left + 0.5, (top + bottom) / 2);
  if (hit !== field) return `${where}, and ${hit ? `<${hit.tagName.toLowerCase()} class="${hit.className}">` : 'nothing'} is drawn over it`;
  return null;
}

/** Looks at the cursor and names the key after which it was out of view. Null when it is in view. */
export async function cursorProblem(browser: Browser, after: string) {
  const problem = await browser.evaluate(cursorInPage, { placing });
  return problem === null ? null : `after ${after}: ${problem}`;
}
