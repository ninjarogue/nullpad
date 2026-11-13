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

// In live view the page scrolls, not the control, which can be taller than
// the window, and a control that already has the focus is not scrolled to by
// `focus`. The page is scrolled to the head of the selection, as a text field
// scrolls to its caret.
export function focusControl(id, liveClass) {
  const control = document.getElementById(id);
  const page = control?.closest("." + liveClass);
  if (!page) {
    control?.focus();
    control?.scrollIntoView({ block: "nearest" });
    return;
  }
  control.focus({ preventScroll: true });
  const place = measure(control);
  const style = getComputedStyle(control);
  const head = control.selectionDirection === "backward" ? control.selectionStart : control.selectionEnd;
  const top = control.getBoundingClientRect().top + parseFloat(style.paddingTop) + place(head).top - place(0).top;
  const box = page.getBoundingClientRect();
  const above = Math.max(box.top, 0) - top;
  const below = top + parseFloat(style.lineHeight) - Math.min(box.bottom, innerHeight);
  if (above > 0) page.scrollTop -= above;
  else if (below > 0) page.scrollTop += below;
}

export function focusInPlace(id) {
  document.getElementById(id)?.focus({ preventScroll: true });
}

// A textarea cannot be told that its caret sits at the end of a wrapped
// line rather than at the start of the next, which share an offset. Moving
// to the line's end does tell it.
export function placeCaret(id, x, y) {
  const control = document.getElementById(id);
  if (!control || document.activeElement !== control) return;
  const offset = control.selectionStart;
  if (offset !== control.selectionEnd || offset === 0 || control.value[offset - 1] === "\n") return;
  const box = control.getBoundingClientRect();
  if (x < box.left || x > box.right || y < box.top || y > box.bottom) return;
  const place = measure(control);
  const line = place(offset).top - place(0).top;
  const pressed = y - box.top - parseFloat(getComputedStyle(control).paddingTop) + control.scrollTop;
  if (place(offset - 1).top === place(offset).top || pressed >= line) return;
  control.setSelectionRange(offset - 1, offset - 1);
  getSelection().modify("move", "forward", "lineboundary");
  if (control.selectionStart !== offset) control.setSelectionRange(offset, offset);
}

// Follows the pointer of a press on the page until it is let go. Once it
// has moved more than `distance` across or down, each move, and each
// scroll of the page under it, names the place it is over. Held near the
// top or bottom of the page, it scrolls the page. A place the page has not
// yet drawn, such as the rows a press has just put in the field, is named
// once it is drawn, and a release waits for that.
let following = false;

export function follow(id, liveClass, rowMark, x, y, distance, moved, released) {
  const page = document.getElementById(id)?.closest("." + liveClass);
  if (!page || following) return;
  following = true;
  let pointer = { x, y };
  let dragging = false;
  let unnamed = false;
  let letGo = false;
  let frame = 0;
  const report = () => {
    if (!page.isConnected) return;
    const [row, visible, atEnd, next] = placeAt(page, pointer.x, pointer.y, rowMark);
    unnamed = row < 0;
    if (!unnamed) moved(row, visible, atEnd, next);
  };
  const move = (event) => {
    if (letGo) return;
    if ((event.buttons & 1) === 0) return stop();
    pointer = { x: event.clientX, y: event.clientY };
    dragging ||= Math.abs(pointer.x - x) > distance || Math.abs(pointer.y - y) > distance;
    if (dragging) report();
  };
  const scrolled = () => {
    if (dragging) report();
  };
  const up = (event) => {
    if (event.button !== 0) return;
    letGo = true;
    if (!unnamed) stop();
  };
  const step = () => {
    frame = requestAnimationFrame(step);
    if (unnamed) report();
    if (letGo) return stop();
    if (!dragging || !page.isConnected) return;
    const box = page.getBoundingClientRect();
    const by = edgeSpeed(pointer.y, Math.max(box.top, 0), Math.min(box.bottom, innerHeight));
    if (by !== 0) page.scrollTop += by;
  };
  function stop() {
    removeEventListener("mousemove", move, true);
    removeEventListener("mouseup", up, true);
    page.removeEventListener("scroll", scrolled);
    cancelAnimationFrame(frame);
    following = false;
    released();
  }
  addEventListener("mousemove", move, true);
  addEventListener("mouseup", up, true);
  page.addEventListener("scroll", scrolled);
  frame = requestAnimationFrame(step);
}

const EDGE = 24;

function edgeSpeed(y, top, bottom) {
  const up = top + EDGE - y;
  const down = y - (bottom - EDGE);
  if (up <= 0 && down <= 0) return 0;
  const speed = (into) => Math.min(Math.ceil(into / 2), 40);
  return up > down ? -speed(up) : speed(down);
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
    return { top: Math.round(box.top), x: box.left - left, right: box.right - left };
  };
}

const COPIED = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariantLigatures",
  "fontKerning", "lineHeight", "letterSpacing", "wordSpacing", "tabSize",
  "textIndent", "whiteSpace", "overflowWrap", "wordBreak", "paddingTop",
  "paddingRight", "paddingBottom", "paddingLeft",
];

export function holdsFocus(id) {
  const control = document.getElementById(id);
  return control !== null && document.activeElement === control;
}

export function drawnInPage(id, liveClass) {
  return document.getElementById(id)?.closest("." + liveClass) != null;
}

export function caretLine(id) {
  const control = document.getElementById(id);
  if (!control) return [false, false, 0];
  const place = measure(control);
  const backward = control.selectionDirection === "backward";
  const head = backward ? control.selectionStart : control.selectionEnd;
  const caret = atLineEnd(control, head, place)
    ? { top: place(head - 1).top, x: place(head - 1).right }
    : place(head);
  return [
    caret.top === place(0).top,
    caret.top === place(control.value.length).top,
    caret.x,
  ];
}

// Where a line wraps, the end of that line and the start of the next share
// an offset, and the caret may be drawn at either. Only a move to the line's
// start tells which, and the selection is put back as it was.
function atLineEnd(control, head, place) {
  const { selectionStart: start, selectionEnd: end, selectionDirection: direction } = control;
  if (head === 0 || control.value[head - 1] === "\n" || document.activeElement !== control) return false;
  if (place(head - 1).top === place(head).top) return false;
  const anchor = direction === "backward" ? end : start;
  getSelection().modify("extend", "backward", "lineboundary");
  const moved = (control.selectionDirection === "backward" ? control.selectionStart : control.selectionEnd) !== head;
  if (moved) {
    const from = head - 1;
    control.setSelectionRange(Math.min(anchor, from), Math.max(anchor, from), from < anchor ? "backward" : "forward");
    getSelection().modify(anchor === head ? "move" : "extend", "forward", "lineboundary");
  }
  return moved;
}

// The field as the last aim left it, so that aiming again can tell
// whether a key has moved the caret since.
const aimed = new WeakMap();

export function aimControl(id, text, start, end, backward, x, lastLine, again) {
  const control = document.getElementById(id);
  if (!control) return ["", 0, 0, false];
  const shown = () => [
    control.value,
    control.selectionStart,
    control.selectionEnd,
    control.selectionDirection === "backward",
  ];
  if (again) {
    const last = aimed.get(control);
    if (!last || last.join("\u0000") !== shown().join("\u0000")) return shown();
    [text, start, end, backward] = last;
  } else {
    const written =
      control.value === text && control.selectionStart === start && control.selectionEnd === end;
    if (!written) return shown();
  }
  const head = backward ? start : end;
  const rowStart = head === 0 ? 0 : text.lastIndexOf("\n", head - 1) + 1;
  const newline = text.indexOf("\n", head);
  const rowEnd = newline < 0 ? text.length : newline;
  const place = measure(control);
  const step = lastLine ? -1 : 1;
  let offset = lastLine ? rowEnd : rowStart;
  const top = place(offset).top;
  let best = offset;
  let gap = Infinity;
  for (; offset >= rowStart && offset <= rowEnd; offset += step) {
    const here = place(offset);
    if (here.top !== top) break;
    if (Math.abs(here.x - x) < gap) {
      gap = Math.abs(here.x - x);
      best = offset;
    }
  }
  const anchor = start === end ? best : backward ? end : start;
  control.setSelectionRange(
    Math.min(anchor, best),
    Math.max(anchor, best),
    best < anchor ? "backward" : "forward",
  );
  control.scrollTop = 0;
  aimed.set(control, shown());
  return shown();
}

// A middle press puts the caret where it is pressed, where Linux pastes on
// its release, as in a text field. The browser keeps one on a link, which it
// opens, and one on the field.
export function locate(press, rowMark) {
  const none = [-1, "", false, "", false];
  const target = press.target;
  const page = press.currentTarget;
  if (press.button > 1 || !(target instanceof Element)) return none;
  // The page's own scrollbar.
  if (target === page && press.offsetX >= target.clientWidth) return none;
  const grabbed = target.closest("a, input, button") !== null;
  if (press.button === 1 && (grabbed || target instanceof HTMLTextAreaElement)) return none;
  const [row, visible, atEnd, next] = placeOn(page, target, press.clientX, press.clientY, rowMark, press);
  return [row, visible, atEnd, next, grabbed];
}

// A point outside the page, as a drag can reach, is taken to the nearest
// place on the page that the window shows.
function placeAt(page, x, y, rowMark) {
  const box = page.getBoundingClientRect();
  const top = Math.max(box.top, 0);
  const bottom = Math.min(box.bottom, innerHeight);
  const inX = Math.min(Math.max(x, box.left + 1), box.left + page.clientWidth - 1);
  const inY = Math.min(Math.max(y, top + 1), bottom - 1);
  const hit = document.elementFromPoint(inX, inY);
  const target = hit && page.contains(hit) ? hit : page;
  return placeOn(page, target, inX, inY, rowMark, null);
}

function placeOn(page, target, x, y, rowMark, press) {
  const none = [-1, "", false, ""];
  const marked = `[data-${rowMark}]`;
  const field = page.querySelector(`textarea${marked}`);
  const band = field?.getBoundingClientRect();
  if (band && y >= band.top && y < band.bottom) {
    return inField(press, x, y, field, band, rowMark);
  }
  // A press in the gap between two blocks is on neither, but the browser
  // still names the nearest text, at its start.
  const placed = target.closest(marked) && drawnAt(x, y, rowMark);
  if (placed) return placed;
  let nearest = null;
  let gap = Infinity;
  let above = false;
  for (const element of page.querySelectorAll(marked)) {
    const box = element.getBoundingClientRect();
    const away = Math.max(box.top - y, y - box.bottom, 0);
    if (away <= gap) {
      gap = away;
      nearest = element;
      above = y < box.top;
    }
  }
  if (!nearest) return none;
  if (gap === 0) {
    // Beside a block, level with one of its lines, is on that line.
    const box = nearest.getBoundingClientRect();
    const beside = drawnAt(Math.min(Math.max(x, box.left + 1), box.right - 1), y, rowMark);
    if (beside) return beside;
  }
  if (above) return [Number(nearest.dataset[rowMark]), "", false, ""];
  return [Number(nearest.dataset[rowMark]), nearest.textContent.replace(/\n$/, ""), true, ""];
}

function drawnAt(x, y, rowMark) {
  const point = caretAt(x, y);
  const inside = point && (point.node instanceof Element ? point.node : point.node.parentElement);
  const holder = inside?.closest(`[data-${rowMark}]`);
  if (!holder || holder instanceof HTMLTextAreaElement) return null;
  const range = document.createRange();
  range.setStart(holder, 0);
  range.setEnd(point.node, point.offset);
  const before = range.toString();
  // An element that draws no text, such as a fence with no code, has no
  // place before its text: the press lands at the end of its row.
  return [Number(holder.dataset[rowMark]), before, holder.textContent === "", charAfter(holder.textContent, before.length)];
}

// A point level with a line of the field, even beside it, is on that line.
// The browser keeps a third click, a touch, and a press on selected text,
// so that a drag can move that text, when they are on the field itself: beside it the browser would only take the focus from it. A
// field the page has not drawn since its text changed may not start at the
// row it is marked with.
function inField(press, x, y, field, band, rowMark) {
  const none = [-1, "", false, ""];
  const point = caretAt(Math.min(Math.max(x, band.left), band.right - 1), y);
  if (point?.node !== field || field.value !== field.defaultValue) return none;
  const { selectionStart: start, selectionEnd: end, value } = field;
  const onSelected = start < point.offset && point.offset < end;
  const kept =
    press?.target === field &&
    (press.detail > 2 || press.sourceCapabilities?.firesTouchEvents || (onSelected && !press.shiftKey));
  if (kept) return none;
  return [Number(field.dataset[rowMark]), value.slice(0, point.offset), false, charAfter(value, point.offset)];
}

// The offset in the field where a plain release lands on its selection, or -1.
export function releasedOnSelection(release) {
  const field = release.currentTarget;
  if (release.detail !== 1 || release.button !== 0 || release.shiftKey) return -1;
  const point = caretAt(release.clientX, release.clientY);
  if (point?.node !== field) return -1;
  const { selectionStart: start, selectionEnd: end } = field;
  return start < point.offset && point.offset < end ? point.offset : -1;
}

function charAfter(text, offset) {
  const code = text.codePointAt(offset);
  return code === undefined ? "" : String.fromCodePoint(code);
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

// Where text dropped on the page lands, the text, and whether the drop
// copies it, which the key a text field copies with says. A drop on the
// field is the browser's.
export function dropped(drop, rowMark) {
  const text = drop.dataTransfer?.getData("text/plain") ?? "";
  if (text === "" || drop.target instanceof HTMLTextAreaElement) return [-1, "", false, "", "", false];
  const [row, visible, atEnd, next] = placeAt(drop.currentTarget, drop.clientX, drop.clientY, rowMark);
  const copy = navigator.platform.startsWith("Mac") ? drop.altKey : drop.ctrlKey;
  return [row, visible, atEnd, next, text, copy];
}
