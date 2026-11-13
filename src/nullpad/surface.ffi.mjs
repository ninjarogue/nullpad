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
// scrolls to its caret, or to where a painted head is drawn.
export function focusControl(id, liveClass, paintedClass) {
  const control = document.getElementById(id);
  const page = control?.closest("." + liveClass);
  if (!page) {
    control?.focus();
    control?.scrollIntoView({ block: "nearest" });
    return;
  }
  control.focus({ preventScroll: true });
  const painted = control.closest("." + paintedClass) ? headPlace() : null;
  let top = painted && painted.box.top + (painted.box.height - painted.line) / 2;
  let line = painted?.line;
  if (!painted) {
    const place = measure(control);
    const style = getComputedStyle(control);
    top = control.getBoundingClientRect().top + parseFloat(style.paddingTop) + headCaret(control, place).top - place(0).top;
    line = parseFloat(style.lineHeight);
  }
  const box = page.getBoundingClientRect();
  const above = Math.max(box.top, 0) - top;
  const below = top + line - Math.min(box.bottom, innerHeight);
  if (above > 0) page.scrollTop -= above;
  else if (below > 0) page.scrollTop += below;
}

export function focusInPlace(id) {
  document.getElementById(id)?.focus({ preventScroll: true });
}

// A textarea cannot be told that its caret sits at the end of a wrapped
// line rather than at the start of the next, which share an offset. Moving
// to the line's end does tell it. A painted field is not where it is drawn.
export function placeCaret(id, paintedClass, x, y) {
  const control = document.getElementById(id);
  if (!control || document.activeElement !== control || control.closest("." + paintedClass)) return;
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
let followedRelease = null;

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
    followedRelease = event;
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

// Whether the page is drawn as the editor last left it. Lustre draws once a
// frame, after the effects of every message since the last.
let drawn = true;

export function isDrawn() {
  return drawn;
}

export function setDrawn(value) {
  drawn = value;
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
    return { top: Math.round(box.top), x: box.left - left, right: box.right - left, height: box.height };
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
  const caret = headCaret(control, place);
  return [
    caret.top === place(0).top,
    caret.top === place(control.value.length).top,
    caret.x,
  ];
}

function headCaret(control, place) {
  const head = control.selectionDirection === "backward" ? control.selectionStart : control.selectionEnd;
  if (!atLineEnd(control, head, place)) return place(head);
  const end = place(head - 1);
  return { top: end.top, x: end.right, height: end.height };
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
  const none = [-1, "", false, "", false, false];
  const target = press.target;
  const page = press.currentTarget;
  if (press.button > 1 || !(target instanceof Element)) return none;
  // The page's own scrollbar.
  if (target === page && press.offsetX >= target.clientWidth) return none;
  const grabbed = target.closest("a, input, button") !== null;
  if (press.button === 1 && (grabbed || target instanceof HTMLTextAreaElement)) return none;
  const [row, visible, atEnd, next] = placeOn(page, target, press.clientX, press.clientY, rowMark, press);
  return [row, visible, atEnd, next, grabbed, onPainted(press.clientX, press.clientY)];
}

function onPainted(x, y) {
  const painted = globalThis.CSS?.highlights?.get(SELECTION);
  const range = painted && [...painted][0];
  const point = range && caretAt(x, y);
  if (!point || range.comparePoint(point.node, point.offset) !== 0) return false;
  const at = (node, offset) => point.node === node && point.offset === offset;
  return !at(range.startContainer, range.startOffset) && !at(range.endContainer, range.endOffset);
}

// A press on a painted selection. Moved, the element pressed drags the
// selected text, as a text field drags its selection. Let go, or dropped,
// it says so. The browser only drags from a press whose default it keeps,
// which takes the focus from the field: the field is given it back once the
// press is taken, and nothing hears it go, as the selection stays.
export function holdSelection(id, x, y, started, released) {
  const control = document.getElementById(id);
  const target = document.elementFromPoint(x, y)?.closest("[draggable], [data-row]");
  if (!control || !target) return released();
  const kept = (event) => {
    if (event.target === control) event.stopImmediatePropagation();
  };
  addEventListener("blur", kept, true);
  setTimeout(() => {
    removeEventListener("blur", kept, true);
    if (document.activeElement !== control) control.focus({ preventScroll: true });
  });
  const draggable = target.getAttribute("draggable");
  target.setAttribute("draggable", "true");
  const done = () => {
    if (draggable === null) target.removeAttribute("draggable");
    else target.setAttribute("draggable", draggable);
    removeEventListener("mouseup", up, true);
    target.removeEventListener("dragstart", start);
    target.removeEventListener("dragend", end);
    released();
  };
  const up = (event) => {
    if (event.button === 0) done();
  };
  const start = (event) => {
    const { value, selectionStart, selectionEnd } = control;
    event.dataTransfer.setData("text/plain", value.slice(selectionStart, selectionEnd));
    event.dataTransfer.effectAllowed = "copyMove";
    started();
  };
  const end = () => done();
  addEventListener("mouseup", up, true);
  target.addEventListener("dragstart", start);
  target.addEventListener("dragend", end);
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

// A place is the row of the element it is in, the text that element draws
// before it, whether it is past an element that draws no text, and the
// character drawn after it: "\n" at the end of a row, and "" beside the text,
// where a list item's marker is drawn.
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
    const beside = drawnAt(Math.min(Math.max(x, box.left + 1), box.right - 1), y, rowMark, x);
    if (beside) return beside;
  }
  if (above) return [Number(nearest.dataset[rowMark]), "", false, characterAt(nearest.textContent, 0)];
  return [Number(nearest.dataset[rowMark]), nearest.textContent.replace(/\n$/, ""), true, "\n"];
}

// Left of a list item's text, where its marker is drawn, no character is
// named after the place.
function drawnAt(x, y, rowMark, pointer = x) {
  const point = caretAt(x, y);
  const inside = point && (point.node instanceof Element ? point.node : point.node.parentElement);
  const holder = inside?.closest(`[data-${rowMark}]`);
  if (!holder || holder instanceof HTMLTextAreaElement) return null;
  const range = document.createRange();
  range.setStart(holder, 0);
  range.setEnd(point.node, point.offset);
  const visible = range.toString();
  let next = characterAt(holder.textContent, visible.length);
  const rowStart = visible === "" || visible.endsWith("\n");
  if (rowStart && holder.closest("li")) {
    const box = letterAfter(holder, point.node, point.offset);
    if (box && pointer < box.left - 1) next = "";
  }
  // An element that draws no text, such as a fence with no code, has no
  // place before its text: the press lands at the end of its row.
  return [Number(holder.dataset[rowMark]), visible, holder.textContent === "", next];
}

// The box of the first letter drawn in `holder` from a point on.
function letterAfter(holder, node, offset) {
  const from = document.createRange();
  from.setStart(node, offset);
  const texts = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
  for (let text = texts.nextNode(); text; text = texts.nextNode()) {
    const start = text === node ? offset : 0;
    if (start >= text.data.length || from.comparePoint(text, start) < 0) continue;
    const letter = document.createRange();
    letter.setStart(text, start);
    letter.setEnd(text, start + 1);
    return letter.getClientRects()[0] ?? null;
  }
  return null;
}

function characterAt(text, offset) {
  return offset < text.length ? String.fromCodePoint(text.codePointAt(offset)) : "\n";
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
  return [Number(field.dataset[rowMark]), value.slice(0, point.offset), false, characterAt(value, point.offset)];
}

// The offset in the field where a plain release lands on its selection, or -1.
// A press the page followed is not one the browser kept.
export function releasedOnSelection(release) {
  const field = release.currentTarget;
  if (release === followedRelease || release.detail !== 1 || release.button !== 0 || release.shiftKey) return -1;
  const point = caretAt(release.clientX, release.clientY);
  if (point?.node !== field) return -1;
  const { selectionStart: start, selectionEnd: end } = field;
  return start < point.offset && point.offset < end ? point.offset : -1;
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

// A selection across blocks is painted over the drawn page with the CSS
// Custom Highlight API, which draws no box for a line break: an element
// whose last line break is selected takes a class instead.
const SELECTION = "nullpad-selection";
const HEAD = "nullpad-head";
const SELECTED = "selected";
const BREAK_SELECTED = "break-selected";
let selectedBreaks = [];

function drawnMarks(id, liveClass, rowMark) {
  const page = document.getElementById(id)?.closest("." + liveClass);
  return page ? [...page.querySelectorAll(`[data-${rowMark}]:not(textarea)`)] : [];
}

// The marks are in the order of the page, and their rows never go down.
function lastAtOrBefore(marks, row, rowMark) {
  let low = 0;
  let high = marks.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (Number(marks[middle].dataset[rowMark]) <= row) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

// The innermost element drawn from `row` or a row above it.
export function holderText(id, liveClass, rowMark, row) {
  const marks = drawnMarks(id, liveClass, rowMark);
  const holder = marks[lastAtOrBefore(marks, row, rowMark)];
  return holder ? [Number(holder.dataset[rowMark]), holder.textContent] : [row, ""];
}

// At the boundary of two pieces of text, the end of the first.
function pointIn(holder, offset) {
  const texts = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
  let last = null;
  for (let text = texts.nextNode(); text; text = texts.nextNode()) {
    if (offset <= text.data.length) return [text, offset];
    offset -= text.data.length;
    last = text;
  }
  return last ? [last, last.data.length] : [holder, 0];
}

export function paintSelection(
  id, liveClass, rowMark, anchorRow, anchorOffset, headRow, headOffset, firstBreak, lastBreak,
) {
  clearBreaks();
  const marks = drawnMarks(id, liveClass, rowMark);
  const holder = (row) => marks[lastAtOrBefore(marks, row, rowMark)];
  const anchorHolder = holder(anchorRow);
  const headHolder = holder(headRow);
  if (!anchorHolder || !headHolder || typeof Highlight !== "function") return;
  const [anchorNode, anchorAt] = pointIn(anchorHolder, anchorOffset);
  const [headNode, headAt] = pointIn(headHolder, headOffset);
  const range = document.createRange();
  range.setStart(anchorNode, anchorAt);
  range.setEnd(anchorNode, anchorAt);
  if (range.comparePoint(headNode, headAt) >= 0) range.setEnd(headNode, headAt);
  else range.setStart(headNode, headAt);
  const head = document.createRange();
  head.setStart(headNode, headAt);
  CSS.highlights.set(SELECTION, new Highlight(range));
  CSS.highlights.set(HEAD, new Highlight(head));
  underStart(document.getElementById(id), range);
  for (let row = firstBreak; row <= lastBreak; row++) {
    const here = holder(row);
    if (!here || here === holder(row + 1)) continue;
    const blank = here.classList.contains("blank");
    here.classList.add(blank ? SELECTED : BREAK_SELECTED);
    selectedBreaks.push(here);
  }
}

function clearBreaks() {
  for (const mark of selectedBreaks) mark.classList.remove(SELECTED, BREAK_SELECTED);
  selectedBreaks = [];
}

// An IME opens its window at the caret of the field, which typing over the
// selection puts at its start, so the hidden field is moved to put that
// caret where the start of the selection is drawn.
let moved = null;

function underStart(control, range) {
  const box = control?.parentElement;
  if (!box) return;
  box.style.translate = "";
  moved = box;
  const place = measure(control);
  const caret = place(control.selectionStart);
  control.scrollTop = caret.top - place(0).top;
  const start = document.createRange();
  start.setStart(range.startContainer, range.startOffset);
  const drawn = caretBox(start);
  const field = control.getBoundingClientRect();
  const top = field.top + caret.top - ruler.getBoundingClientRect().top - control.scrollTop;
  const x = drawn.left - (field.left + caret.x);
  const y = drawn.top + drawn.height / 2 - (top + caret.height / 2);
  box.style.translate = `${x}px ${y}px`;
}

export function clearPaint() {
  if (moved) moved.style.translate = "";
  moved = null;
  clearBreaks();
  globalThis.CSS?.highlights?.delete(SELECTION);
  globalThis.CSS?.highlights?.delete(HEAD);
}

function lineHeight(element) {
  const style = getComputedStyle(element);
  return parseFloat(style.lineHeight) || 1.2 * parseFloat(style.fontSize);
}

function columnLeft(page) {
  return page.getBoundingClientRect().left + parseFloat(getComputedStyle(page).paddingLeft);
}

// A collapsed range has no box at a soft wrap or in an element with no
// text, so the character beside it, or the element, is measured instead.
function caretBox(range) {
  const node = range.startContainer;
  const offset = range.startOffset;
  const element = node instanceof Element ? node : node.parentElement;
  if (node.nodeType === Node.TEXT_NODE) {
    const one = document.createRange();
    if (offset < node.data.length && node.data[offset] !== "\n") {
      one.setStart(node, offset);
      one.setEnd(node, offset + 1);
      const after = one.getClientRects()[0];
      if (after) return new DOMRect(after.left, after.top, 0, after.height);
    }
    if (offset > 0) {
      one.setStart(node, offset - 1);
      one.setEnd(node, offset);
      const before = [...one.getClientRects()].pop();
      if (before) return new DOMRect(before.right, before.top, 0, before.height);
    }
  }
  const box = element.getBoundingClientRect();
  return new DOMRect(box.left, box.top, 0, Math.min(box.height, lineHeight(element)));
}

// The element the head of a painted selection is drawn in, and its text.
export function paintedHead(id, rowMark, paintedClass) {
  const painted = document.getElementById(id)?.closest("." + paintedClass);
  const head = painted && [...(globalThis.CSS?.highlights?.get(HEAD) ?? [])][0];
  const node = head?.startContainer;
  const holder = (node instanceof Element ? node : node?.parentElement)?.closest(`[data-${rowMark}]`);
  return holder ? [Number(holder.dataset[rowMark]), holder.textContent] : [-1, ""];
}

function headPlace() {
  const marker = globalThis.CSS?.highlights?.get(HEAD);
  const head = marker && [...marker][0];
  if (!head) return null;
  const node = head.startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  return { box: caretBox(head), line: lineHeight(element) };
}

function fieldCaret(control) {
  const place = measure(control);
  const caret = headCaret(control, place);
  const box = control.getBoundingClientRect();
  const top = box.top + caret.top - ruler.getBoundingClientRect().top - control.scrollTop;
  return { box: new DOMRect(box.left + caret.x, top, 0, caret.height), line: lineHeight(control) };
}

// Where the head of the selection is drawn: on the first line of the field,
// on its last line, and how far from the left of the text. A painted head is
// on both, so every step is taken on the drawn page.
export function headLine(id, liveClass, paintedClass) {
  const control = document.getElementById(id);
  const page = control?.closest("." + liveClass);
  if (!page) return [false, false, 0];
  if (control.closest("." + paintedClass)) {
    const head = headPlace();
    return head ? [true, true, head.box.left - columnLeft(page)] : [false, false, 0];
  }
  const [first, last, x] = caretLine(id);
  return [first, last, control.getBoundingClientRect().left + x - columnLeft(page)];
}

// The place on the drawn page `x` from the left of the text, one drawn line
// above or below the head, or the head's own place when there is no line
// there. The head is first kept two lines inside the page, because the
// browser names no place off the screen.
export function stepHead(id, liveClass, rowMark, paintedClass, x, up) {
  const none = [-1, "", false, ""];
  const control = document.getElementById(id);
  const page = control?.closest("." + liveClass);
  if (!page) return none;
  const painted = control.closest("." + paintedClass) !== null;
  const head = () => (painted ? headPlace() : fieldCaret(control));
  const before = head();
  if (!before) return none;
  const view = page.getBoundingClientRect();
  const room = 2 * before.line;
  if (before.box.top < view.top + room) page.scrollTop -= view.top + room - before.box.top;
  else if (before.box.bottom > view.bottom - room) {
    page.scrollTop += before.box.bottom - (view.bottom - room);
  }
  const { box, line } = head();
  const left = columnLeft(page) + x;
  const at = (y) => {
    const target = document.elementFromPoint(left, y);
    return placeOn(page, page.contains(target) ? target : page, left, y, rowMark, null);
  };
  const middle = box.top + box.height / 2;
  const here = at(middle);
  for (const reach of [1, 1.5, 2, 3, 4]) {
    const there = at(middle + (up ? -reach : reach) * line);
    if (there[0] >= 0 && there.join("\n") !== here.join("\n")) return there;
  }
  return here;
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
