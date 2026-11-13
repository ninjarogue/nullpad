// Assigning `value` resets the browser's own undo history, so it is
// assigned only when it differs.
export function writeControl(id, text, start, end, backward) {
  const control = document.getElementById(id);
  if (!control) return;
  if (control.value !== text) control.value = text;
  const direction = backward ? "backward" : "forward";
  const turned = start !== end && control.selectionDirection !== direction;
  if (control.selectionStart !== start || control.selectionEnd !== end || turned) {
    control.setSelectionRange(start, end, direction);
  }
}

export function findControl(id) {
  return document.getElementById(id);
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
  const backward = control.selectionDirection === "backward";
  const caret = place(backward ? control.selectionStart : control.selectionEnd);
  return [
    caret.top === place(0).top,
    caret.top === place(control.value.length).top,
    caret.x,
  ];
}

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

export function locate(press, rowMark) {
  const none = [-1, "", false];
  const target = press.target;
  const page = press.currentTarget;
  const marked = `[data-${rowMark}]`;
  if (press.button !== 0 || !(target instanceof Element)) return none;
  if (target.closest("a, input, button")) return none;
  // The page's own scrollbar.
  if (target === page && press.offsetX >= target.clientWidth) return none;
  const field = page.querySelector(`textarea${marked}`);
  const band = field?.getBoundingClientRect();
  if (band && press.clientY >= band.top && press.clientY < band.bottom) {
    return inField(press, field, band, rowMark);
  }
  const point = caretAt(press.clientX, press.clientY);
  const inside = point && (point.node instanceof Element ? point.node : point.node.parentElement);
  const holder = inside?.closest(marked);
  // A press in the gap between two blocks is on neither, but the browser
  // still names the nearest text, at its start.
  if (holder && holder !== field && target.closest(marked)) {
    const range = document.createRange();
    range.setStart(holder, 0);
    range.setEnd(point.node, point.offset);
    // An element that draws no text, such as a fence with no code, has no
    // place before its text: the press lands at the end of its row.
    return [Number(holder.dataset[rowMark]), range.toString(), holder.textContent === ""];
  }
  let nearest = null;
  let gap = Infinity;
  let above = false;
  for (const element of page.querySelectorAll(marked)) {
    const box = element.getBoundingClientRect();
    const away = Math.max(box.top - press.clientY, press.clientY - box.bottom, 0);
    if (away <= gap) {
      gap = away;
      nearest = element;
      above = press.clientY < box.top;
    }
  }
  if (!nearest) return none;
  if (above) return [Number(nearest.dataset[rowMark]), "", false];
  return [Number(nearest.dataset[rowMark]), nearest.textContent.replace(/\n$/, ""), true];
}

// A point level with a line of the field, even beside it, is on that line.
// The browser keeps a second click, a touch, and a press on text selected
// within one row, so that a drag can move that text. A field the page has not
// drawn since its text changed may not start at the row it is marked with.
function inField(press, field, band, rowMark) {
  const none = [-1, "", false];
  const x = Math.min(Math.max(press.clientX, band.left), band.right - 1);
  const point = caretAt(x, press.clientY);
  if (point?.node !== field || field.value !== field.defaultValue) return none;
  const { selectionStart: start, selectionEnd: end, value } = field;
  const onSelected =
    start < point.offset && point.offset < end && !value.slice(start, end).includes("\n");
  const kept = press.detail > 1 || press.sourceCapabilities?.firesTouchEvents || (onSelected && !press.shiftKey);
  if (press.type === "mousedown" && kept) return none;
  return [Number(field.dataset[rowMark]), value.slice(0, point.offset), false];
}

function caretAt(x, y) {
  if (document.caretPositionFromPoint) {
    const caret = document.caretPositionFromPoint(x, y);
    return caret && { node: caret.offsetNode, offset: caret.offset };
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return range && { node: range.startContainer, offset: range.startOffset };
}

let pen = null;

export function textWidth(text) {
  const root = getComputedStyle(document.documentElement);
  pen ??= document.createElement("canvas").getContext("2d");
  pen.font = `${root.fontSize} ${root.getPropertyValue("--ui-font")}`;
  return pen.measureText(text).width;
}
