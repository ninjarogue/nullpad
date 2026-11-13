// All editor JavaScript.

// Make the control show `text` with the selection start..end (UTF-16
// offsets). `value` is assigned only when it differs, because assigning
// resets the browser's own undo history.
export function writeControl(id, text, start, end) {
  const control = document.getElementById(id);
  if (!control) return;
  if (control.value !== text) control.value = text;
  if (control.selectionStart !== start || control.selectionEnd !== end) {
    control.setSelectionRange(start, end);
  }
}

// In live view the page scrolls, not the control, and a control that already
// has the focus is not scrolled to by `focus`.
export function focusControl(id) {
  const control = document.getElementById(id);
  control?.focus();
  control?.scrollIntoView({ block: "nearest" });
}

export function blurControl(id) {
  document.getElementById(id)?.blur();
}

export function utf16Split(text, offset) {
  return [text.slice(0, offset), text.slice(offset)];
}

export function utf16Length(text) {
  return text.length;
}

// A hidden copy of the control, laid out the same way, that can be asked
// where a character is drawn. A textarea cannot be asked.
let ruler = null;

function measure(control) {
  if (!ruler) {
    ruler = document.createElement("div");
    ruler.setAttribute("aria-hidden", "true");
    ruler.style.cssText =
      "position:absolute;top:0;left:-9999px;visibility:hidden;border:0;box-sizing:border-box;height:auto;overflow:hidden";
    ruler.append("");
    document.body.append(ruler);
  }
  const style = getComputedStyle(control);
  for (const property of COPIED) ruler.style[property] = style[property];
  ruler.style.width = control.clientWidth + "px";
  // The extra character gives the end of the text a place of its own.
  ruler.firstChild.data = control.value + "​";
  const range = document.createRange();
  const left = ruler.getBoundingClientRect().left;
  return (offset) => {
    range.setStart(ruler.firstChild, offset);
    range.setEnd(ruler.firstChild, offset + 1);
    const box = range.getClientRects()[0] ?? range.getBoundingClientRect();
    return { top: Math.round(box.top), x: box.left - left };
  };
}

const COPIED = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariantLigatures",
  "fontKerning", "lineHeight", "letterSpacing", "wordSpacing", "tabSize",
  "textIndent", "whiteSpace", "overflowWrap", "wordBreak", "paddingTop",
  "paddingRight", "paddingBottom", "paddingLeft",
];

export function drawnInPage(id, liveClass) {
  return document.getElementById(id)?.closest("." + liveClass) != null;
}

export function caretLine(id) {
  const control = document.getElementById(id);
  if (!control) return [false, false, 0];
  const place = measure(control);
  const caret = place(control.selectionStart);
  return [
    caret.top === place(0).top,
    caret.top === place(control.value.length).top,
    caret.x,
  ];
}

// Gives the control as it is afterwards: [value, selectionStart,
// selectionEnd]. Aims only while the control is as the write left it: by the
// time this runs, a later key may have put other rows in it or moved the caret.
export function aimControl(id, text, start, end, x, lastLine) {
  const control = document.getElementById(id);
  if (!control) return ["", 0, 0];
  const shown = () => [control.value, control.selectionStart, control.selectionEnd];
  const written =
    control.value === text && control.selectionStart === start && control.selectionEnd === end;
  if (!written) return shown();
  const place = measure(control);
  const length = control.value.length;
  const step = lastLine ? -1 : 1;
  let offset = lastLine ? length : 0;
  const top = place(offset).top;
  let best = offset;
  let gap = Infinity;
  for (; offset >= 0 && offset <= length; offset += step) {
    const here = place(offset);
    if (here.top !== top) break;
    if (Math.abs(here.x - x) < gap) {
      gap = Math.abs(here.x - x);
      best = offset;
    }
  }
  control.setSelectionRange(best, best);
  control.scrollTop = 0;
  return shown();
}

// A press on the drawn page: the note row of the element under it, and the
// drawn text from that element's start to the press.
export function locate(press, rowMark) {
  const none = [-1, "", false];
  const target = press.target;
  const page = press.currentTarget;
  const marked = `[data-${rowMark}]`;
  if (press.button !== 0 || !(target instanceof Element)) return none;
  if (target.closest("a, input, button, textarea")) return none;
  // The page's own scrollbar.
  if (target === page && press.offsetX >= target.clientWidth) return none;
  const point = caretAt(press.clientX, press.clientY);
  const inside = point && (point.node instanceof Element ? point.node : point.node.parentElement);
  const holder = inside?.closest(marked);
  // A press in the gap between two blocks is on neither, but the browser
  // still names the nearest text, at its start.
  if (holder && target.closest(marked)) {
    const range = document.createRange();
    range.setStart(holder, 0);
    range.setEnd(point.node, point.offset);
    return [Number(holder.dataset[rowMark]), range.toString(), false];
  }
  // Between blocks, or beside them: the end of the nearest one.
  let nearest = null;
  let gap = Infinity;
  for (const element of page.querySelectorAll(marked)) {
    const box = element.getBoundingClientRect();
    const away = Math.max(box.top - press.clientY, press.clientY - box.bottom, 0);
    if (away <= gap) {
      gap = away;
      nearest = element;
    }
  }
  if (!nearest) return none;
  return [Number(nearest.dataset[rowMark]), nearest.textContent.replace(/\n$/, ""), true];
}

function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const caret = document.caretPositionFromPoint(x, y);
    return caret && { node: caret.offsetNode, offset: caret.offset };
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return range && { node: range.startContainer, offset: range.startOffset };
}

// How wide `text` is in the text field's font, in pixels.
let pen = null;

export function textWidth(text) {
  const root = getComputedStyle(document.documentElement);
  pen ??= document.createElement("canvas").getContext("2d");
  pen.font = `${root.fontSize} ${root.getPropertyValue("--ui-font")}`;
  return pen.measureText(text).width;
}
