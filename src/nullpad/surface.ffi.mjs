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

// A key pressed before the next render acts on the field as it is laid out.
// Written with other rows, it takes their type at once, and keeps the line
// height and margins of the rows it was drawn with, as a row typed as another
// kind of block does, so nothing around it moves until the render. The
// render sets the classes only when they changed since the last one, so
// held classes it did not replace go back to the ones it drew. The held
// marker width has its own property for the same reason.
let drawnRows = "";
let held = null;

export function holdControl(id, classes, rows, marker) {
  const holder = document.getElementById(id)?.parentElement;
  if (!holder || drawnRows === "") return;
  if (!held) {
    held = { holder, drawn: holder.className };
    requestAnimationFrame(releaseControl);
  }
  held.classes = `${classes}${drawnRows === rows ? "" : ` held framed-${drawnRows}`} holding`;
  holder.className = held.classes;
  setMarker(holder, marker);
}

function releaseControl() {
  if (!held) return;
  if (held.holder.className === held.classes) held.holder.className = held.drawn;
  held.holder.style.removeProperty("--held-marker");
  held = null;
}

export function drawnControl(rows) {
  drawnRows = rows;
}

function setMarker(holder, marker) {
  if (marker === "") holder.style.removeProperty("--held-marker");
  else holder.style.setProperty("--held-marker", marker);
}

let focusAsked = null;

export function askFocus() {
  focusAsked = document.activeElement;
}

export function focusStayed(id) {
  const active = document.activeElement;
  return !active || active === document.body || active.id === id || active === focusAsked;
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
  revealOnPage(page, top, top + line);
}

// Scrolls the page just enough to show what is drawn from `top` to `bottom`
// in the window, and on the first or last row also the page's padding, as a
// text field does.
function revealOnPage(page, top, bottom) {
  const view = page.getBoundingClientRect();
  const style = getComputedStyle(page);
  let to = page.scrollTop;
  if (bottom > Math.min(view.bottom, innerHeight)) to += Math.ceil(bottom - Math.min(view.bottom, innerHeight));
  else if (top < Math.max(view.top, 0)) to -= Math.ceil(Math.max(view.top, 0) - top);
  const fromStart = top - view.top + page.scrollTop;
  const toEnd = page.scrollHeight - (bottom - view.top + page.scrollTop);
  if (fromStart <= parseFloat(style.paddingTop) + 1) to = 0;
  else if (toEnd <= parseFloat(style.paddingBottom) + 1) to = page.scrollHeight - page.clientHeight;
  if (to !== page.scrollTop) page.scrollTop = to;
}

// A press writes the field at once, but the page draws it where it was
// pressed only on the next frame. A key, or the paste Linux does on a middle
// release, before then scrolls the page to where the field was drawn, so the
// page is held where it is until then.
export function holdPage(id, liveClass) {
  const page = document.getElementById(id)?.closest("." + liveClass);
  if (!page) return;
  const top = page.scrollTop;
  const keep = () => {
    page.scrollTop = top;
  };
  page.addEventListener("scroll", keep);
  requestAnimationFrame(() => page.removeEventListener("scroll", keep));
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
// frame, after the effects of every message since the last. Once drawn, the
// page has placed the field a press put rows in.
let drawn = true;

export function setDrawn(value) {
  drawn = value;
  if (value) pressed = null;
}

// A step the page must draw before it is taken, and the editor that asked
// for it. Only that editor's paint takes it: the paint of an earlier step in
// the same frame starts from a head the editor has since left.
let heldStep = null;

export function holdStep(held, editor) {
  heldStep = held ? editor : null;
}

export function takeHeldStep(editor) {
  if (heldStep !== editor) return false;
  heldStep = null;
  return true;
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

// `line` is 0 for the first drawn line of the head's row, 1 for its last, and
// 2 or 3 for the drawn line above or below the head's. Aimed again, a step
// to the line beside stays on the line it reached. The answer starts with
// whether the field was aimed: a key that moved the caret since the field
// was written, or aimed, keeps its place and its own column.
export function aimControl(id, text, start, end, backward, x, line, again) {
  const control = document.getElementById(id);
  if (!control) return [false, "", 0, 0, false];
  const shown = () => [
    control.value,
    control.selectionStart,
    control.selectionEnd,
    control.selectionDirection === "backward",
  ];
  if (again) {
    const last = aimed.get(control);
    if (!last || last.join("\u0000") !== shown().join("\u0000")) return [false, ...shown()];
    [text, start, end, backward] = last;
  } else {
    const written =
      control.value === text && control.selectionStart === start && control.selectionEnd === end;
    if (!written) return [false, ...shown()];
  }
  const head = backward ? start : end;
  const place = measure(control);
  const lineFrom = (offset, step) => {
    const top = place(offset).top;
    while (offset + step >= 0 && offset + step <= text.length && place(offset + step).top === top) offset += step;
    return offset;
  };
  let from;
  if (line === 0) from = head === 0 ? 0 : text.lastIndexOf("\n", head - 1) + 1;
  else if (line === 1) from = lineFrom(text.indexOf("\n", head) < 0 ? text.length : text.indexOf("\n", head), -1);
  else if (again) from = lineFrom(head, -1);
  else if (line === 2) {
    from = lineFrom(head, -1) - 1;
    if (from < 0) return [true, ...shown()];
    from = lineFrom(from, -1);
  } else {
    from = lineFrom(head, 1) + 1;
    if (from > text.length) return [true, ...shown()];
  }
  const top = place(from).top;
  let best = from;
  let gap = Infinity;
  for (let offset = from; offset <= text.length && place(offset).top === top; offset++) {
    if (Math.abs(place(offset).x - x) < gap) {
      gap = Math.abs(place(offset).x - x);
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
  return [true, ...shown()];
}

// The browser keeps the column of its own moves up and down, not of an aim,
// so the editor takes the next one while the field is as the aim left it.
export function isAimed(id) {
  const control = document.getElementById(id);
  const last = control && aimed.get(control);
  if (!last) return false;
  const now = [control.value, control.selectionStart, control.selectionEnd, control.selectionDirection === "backward"];
  return last.join("\u0000") === now.join("\u0000");
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
  const drawn = nearest.textContent;
  return [Number(nearest.dataset[rowMark]), drawn.endsWith("\n") ? drawn.slice(0, -1) : drawn, true, "\n"];
}

// Left of a list item's text, where its marker is drawn, no character is
// named after the place.
function drawnAt(x, y, rowMark, pointer = x) {
  const point = caretAt(x, y);
  return point && placeOfPoint(point, rowMark, pointer);
}

// The place a point on the drawn page names, or null outside every element
// that draws a row.
function placeOfPoint(point, rowMark, pointer = Infinity, fromRowStart = false) {
  const inside = point.node instanceof Element ? point.node : point.node.parentElement;
  const holder = inside?.closest(`[data-${rowMark}]`);
  if (!holder || holder instanceof HTMLTextAreaElement) return null;
  const range = document.createRange();
  range.setStart(holder, 0);
  range.setEnd(point.node, point.offset);
  const visible = range.toString();
  // A table row draws its cells with nothing between them, so the end of
  // one cell and the start of the next are told apart by the cell.
  const cell = inside.closest("td, th") ?? holder;
  const after = document.createRange();
  after.setStart(point.node, point.offset);
  after.setEnd(cell, cell.childNodes.length);
  const rest = after.toString();
  let next = rest !== "" ? characterAt(rest, 0) : cell === holder ? "\n" : "";
  // At the start of a row, a pointer left of its text is on a list item's
  // marker, and a step from the start of a row that lands no further right
  // stays before the marks the page hides, as in a text field. A table row
  // starts in its first cell.
  const rowStart = visible === "" || visible.endsWith("\n");
  const margin = fromRowStart && cell === holder ? 1 : holder.closest("li") ? -1 : null;
  let before = false;
  if (rowStart && margin !== null) {
    const box = letterAfter(holder, point.node, point.offset);
    before = box ? pointer < box.left + margin : fromRowStart;
  }
  if (before) next = "";
  // Otherwise an element that draws no text, such as a fence with no code,
  // has no place before its text: the press lands at the end of its row.
  return [Number(holder.dataset[rowMark]), visible, holder.textContent === "" && !before, next];
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

// The elements drawn from rows, in the order of the page, and their rows,
// which never go down. They are found again only once the page outside the
// field has changed, so that a step over a long note does not read them all.
let knownMarks = null;

function drawnMarks(id, liveClass, rowMark) {
  const control = document.getElementById(id);
  const page = control?.closest("." + liveClass);
  if (!page) return { marks: [], rows: [] };
  const outside = (records) => records.some((record) => !control.parentElement?.contains(record.target));
  const known = knownMarks;
  if (known?.page === page && known.rowMark === rowMark && !known.stale && !outside(known.watch.takeRecords())) {
    return known;
  }
  known?.watch.disconnect();
  const marks = [...page.querySelectorAll(`[data-${rowMark}]:not(textarea)`)];
  const watch = new MutationObserver((records) => {
    if (outside(records)) entry.stale = true;
  });
  watch.observe(page, { childList: true, subtree: true, attributes: true, attributeFilter: [`data-${rowMark}`] });
  const entry = { page, rowMark, marks, rows: marks.map((mark) => Number(mark.dataset[rowMark])), watch, stale: false };
  knownMarks = entry;
  return entry;
}

function lastAtOrBefore(rows, row) {
  let low = 0;
  let high = rows.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (rows[middle] <= row) {
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
  const { marks, rows } = drawnMarks(id, liveClass, rowMark);
  const at = lastAtOrBefore(rows, row);
  return at >= 0 ? [rows[at], marks[at].textContent] : [row, ""];
}

// At the boundary of two pieces of text, the end of the first, unless the
// first ends a line or the place is `onward`, after marks the page hides.
function pointIn(holder, offset, onward = false) {
  const texts = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
  let last = null;
  for (let text = texts.nextNode(); text; text = texts.nextNode()) {
    const on = onward || text.data.endsWith("\n");
    if (offset < text.data.length || (offset === text.data.length && !on)) return [text, offset];
    offset -= text.data.length;
    last = text;
  }
  return last ? [last, last.data.length] : [holder, 0];
}

export function paintSelection(
  id, liveClass, rowMark, anchorRow, anchorOffset, anchorOnward, headRow, headOffset, headOnward,
  firstBreak, lastBreak,
) {
  const known = drawnMarks(id, liveClass, rowMark);
  const holder = (row) => known.marks[lastAtOrBefore(known.rows, row)];
  const anchorHolder = holder(anchorRow);
  const headHolder = holder(headRow);
  if (!anchorHolder || !headHolder || typeof Highlight !== "function") return clearBreaks();
  const [anchorNode, anchorAt] = pointIn(anchorHolder, anchorOffset, anchorOnward);
  const [headNode, headAt] = pointIn(headHolder, headOffset, headOnward);
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
  paintBreaks(known, rowMark, firstBreak, lastBreak);
  paintCode(document.getElementById(id).closest("." + liveClass), range);
}

// The element that draws the last of each row from `first` to `last` takes
// a class that paints its line break. An element with rows of its own
// drawn inside it, such as a list item with a list in it, is told where
// its own text ends.
let paintedBreaks = null;

function paintBreaks(known, rowMark, first, last) {
  const { marks, rows } = known;
  const same = paintedBreaks?.known === known && paintedBreaks.first === first && paintedBreaks.last === last;
  if (!same) {
    const kept = new Set();
    const nested = [];
    let index = lastAtOrBefore(rows, first);
    for (let row = first; row <= last; ) {
      while (index + 1 < rows.length && rows[index + 1] <= row) index++;
      const following = index + 1 < rows.length ? rows[index + 1] : Infinity;
      if (index >= 0 && following - 1 <= last) {
        const mark = marks[index];
        kept.add(mark);
        const blank = mark.classList.contains("blank");
        if (!mark.classList.contains(blank ? SELECTED : BREAK_SELECTED)) {
          mark.classList.add(blank ? SELECTED : BREAK_SELECTED);
        }
        if (index + 1 < marks.length && mark.contains(marks[index + 1])) nested.push(mark);
      }
      row = following;
    }
    for (const mark of selectedBreaks) {
      if (!kept.has(mark)) unpaintBreak(mark);
    }
    selectedBreaks = [...kept];
    paintedBreaks = { known, first, last, nested };
  }
  for (const mark of paintedBreaks.nested) ownEnd(mark, rowMark);
}

function ownEnd(mark, rowMark) {
  const texts = document.createTreeWalker(mark, NodeFilter.SHOW_TEXT);
  let own = null;
  for (let text = texts.nextNode(); text; text = texts.nextNode()) {
    if (text.parentElement.closest(`[data-${rowMark}]`) === mark) own = text;
  }
  if (!own) return;
  const end = caretBox(own, own.data.length);
  const box = mark.getBoundingClientRect();
  mark.style.setProperty("--break-left", `${end.left - box.left - mark.clientLeft}px`);
  mark.style.setProperty("--break-top", `${end.top - box.top - mark.clientTop}px`);
}

function unpaintBreak(mark) {
  mark.classList.remove(SELECTED, BREAK_SELECTED);
  mark.style.removeProperty("--break-left");
  mark.style.removeProperty("--break-top");
}

// The Highlight API paints no line break, so each one selected inside a
// code block, but for its last, is painted as a bar behind the text where
// it ends a line.
let paintedCode = [];

function paintCode(page, range) {
  clearCode();
  for (const pre of page?.querySelectorAll("pre") ?? []) {
    if (!range.intersectsNode(pre)) continue;
    const text = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT).nextNode();
    if (!text) continue;
    const from = range.startContainer === text ? range.startOffset : 0;
    const to = range.endContainer === text ? range.endOffset : text.data.length;
    const box = pre.getBoundingClientRect();
    const letter = document.createRange();
    const at = [];
    const size = [];
    for (let index = text.data.indexOf("\n", from); index >= 0 && index < Math.min(to, text.data.length - 1); index = text.data.indexOf("\n", index + 1)) {
      letter.setStart(text, index);
      letter.setEnd(text, index + 1);
      const end = letter.getClientRects()[0];
      if (!end) continue;
      at.push(`${end.left - box.left - pre.clientLeft + pre.scrollLeft}px ${end.top - box.top - pre.clientTop + pre.scrollTop}px`);
      size.push(`0.5em ${end.height}px`);
    }
    if (at.length === 0) continue;
    pre.style.backgroundImage = at.map(() => "linear-gradient(Highlight, Highlight)").join(", ");
    pre.style.backgroundPosition = at.join(", ");
    pre.style.backgroundSize = size.join(", ");
    pre.style.backgroundRepeat = "no-repeat";
    pre.style.backgroundAttachment = "local";
    paintedCode.push(pre);
  }
}

function clearCode() {
  for (const pre of paintedCode) {
    for (const property of ["background-image", "background-position", "background-size", "background-repeat", "background-attachment"]) {
      pre.style.removeProperty(property);
    }
  }
  paintedCode = [];
}

function clearBreaks() {
  for (const mark of selectedBreaks) unpaintBreak(mark);
  selectedBreaks = [];
  paintedBreaks = null;
  clearCode();
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
  const drawn = caretBox(range.startContainer, range.startOffset);
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
// text, so the character beside it, or the element, is measured instead. A
// line break is drawn at the end of the line it ends.
function caretBox(node, offset) {
  const element = node instanceof Element ? node : node.parentElement;
  if (node.nodeType === Node.TEXT_NODE) {
    const one = document.createRange();
    if (offset < node.data.length) {
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

// Whether the editor paints its selection, as the last message left it. The
// page shows the paint of the last frame drawn, which keys pressed since may
// have taken off, so a key steps over the paint only when both say so, and
// the field takes it otherwise.
let painted = false;

export function notePainted(value) {
  painted = value;
}

export function isPainted(id, paintedClass) {
  return painted && document.getElementById(id)?.closest("." + paintedClass) != null;
}

function headPlace() {
  const marker = globalThis.CSS?.highlights?.get(HEAD);
  const head = marker && [...marker][0];
  if (!head) return null;
  const node = head.startContainer;
  const element = node instanceof Element ? node : node.parentElement;
  return { box: caretBox(node, head.startOffset), line: lineHeight(element) };
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
  const head = isPainted(id, paintedClass) && headPlace();
  if (head) return [true, true, head.box.left - columnLeft(page)];
  if (undrawn(control)) return [true, true, 0];
  const [first, last, x] = caretLine(id);
  return [first, last, control.getBoundingClientRect().left + x - columnLeft(page)];
}

// A press puts rows in the field that the page has not yet set it for, so
// until the frame that draws them the field's caret is not where it will be
// drawn. A step taken in that frame starts from the caret once drawn. A key
// that takes the caret out of the field cannot wait for that, and aims from
// where the press landed on the page, from the left of the text.
let pressed = null;

export function notePress(id, liveClass, x, y) {
  const control = document.getElementById(id);
  const page = control?.closest("." + liveClass);
  const point = page && caretAt(x, y);
  const drawn = point && point.node !== control && page.contains(point.node);
  const landed = { x: drawn ? caretBox(point.node, point.offset).left - columnLeft(page) : null };
  pressed = landed;
  requestAnimationFrame(() => {
    if (pressed === landed) pressed = null;
  });
}

export function pressLanding() {
  return [pressed !== null, pressed?.x ?? -1, pressed?.x != null];
}

// The field's text has changed since the page was drawn, so its lines are
// not the lines the reader sees, and its own steps would miss them.
function undrawn(control) {
  const mirror = control.parentElement.querySelector(".mirror")?.firstChild;
  return mirror != null && mirror.data.slice(0, -1) !== control.value;
}

// The head steps over the drawn page as the browser moves a caret over it,
// so tables, the lines of code and wrapped lines are stepped as they are
// drawn. It is stepped from where it is drawn, or from the edge of the field
// when it is in the field, and a step of a line then goes to the place on
// that line nearest `x` from the left of the text, or nearest where the head
// is drawn when `x` is below 0. A line step into the rows the field holds,
// which the browser does not step into, lands on the line of the field's
// mirror that it reaches, also with nothing drawn past the field: the mirror
// holds the field's text as last drawn.
// The browser's selection is put back in the field after. A step returns
// the place it reaches and the `x` it aimed at, or a row of -1 for no page,
// -2 for nothing past the head, -3 when the page must be drawn first, as
// the field's text changed since it was drawn or a press in this frame put
// the field where the page has not placed it, and -4 when the head was in
// the field and the field took the step: a step of a letter or a line
// boundary, or of a line from any line of the field but the last it steps
// past. A `page` step scrolls the page by a window and takes the place that
// is then where the head was.
export function stepHead(id, liveClass, rowMark, headRow, headOffset, onward, rowStart, granularity, forward, select, x) {
  const answer = (row, place = ["", false, ""]) => [row, ...place, x];
  const control = document.getElementById(id);
  const page = control?.closest("." + liveClass);
  if (!page) return answer(-1);
  const part = control.parentElement;
  const mirror = part.querySelector(".mirror")?.firstChild;
  const first = control.dataset[rowMark];
  const held = first === undefined || !mirror ? null : [Number(first), Number(first) + mirror.data.split("\n").length - 1];
  const inField = held !== null && headRow >= held[0] && headRow <= held[1];
  if (inField && undrawn(control)) return answer(-3);
  if (pressed !== null && first === undefined) return answer(-3);
  const edge = granularity !== "line" || caretLine(id)[forward ? 1 : 0];
  if (inField && granularity !== "page" && !edge) {
    getSelection().modify(select ? "extend" : "move", forward ? "forward" : "backward", granularity);
    return answer(-4);
  }
  const { marks, rows } = drawnMarks(id, liveClass, rowMark);
  if (granularity === "page") {
    let box;
    if (inField) box = fieldCaret(control).box;
    else {
      const holder = marks[lastAtOrBefore(rows, headRow)];
      if (!holder) return answer(-1);
      box = caretBox(...pointIn(holder, headOffset, onward));
    }
    if (x < 0) x = box.left - columnLeft(page);
    const place = pageStep(page, rowMark, box, forward, columnLeft(page) + x);
    return place ? [...place, x] : answer(-2);
  }
  const selection = getSelection();
  const { selectionStart, selectionEnd, selectionDirection } = control;
  try {
    let landed;
    if (inField) {
      if (x < 0) {
        const place = measure(control);
        x = control.getBoundingClientRect().left + headCaret(control, place).x - columnLeft(page);
      }
      landed = beside(marks, part, forward);
    } else {
      const holder = marks[lastAtOrBefore(rows, headRow)];
      if (!holder) return answer(-1);
      const [node, offset] = pointIn(holder, headOffset, onward);
      if (x < 0) x = caretBox(node, offset).left - columnLeft(page);
      selection.collapse(node, offset);
      landed = step(selection, page, rowMark, granularity, forward);
      const from = { node, offset };
      const past = landed ? crosses(part, from, landed) : after(part, from) !== forward;
      if (held && granularity === "line" && past) {
        return [held[0], ...mirrorPlace(mirror, !forward, columnLeft(page) + x), x];
      }
    }
    if (!landed) return answer(-2);
    const line = granularity === "line";
    if (line) landed = toward(selection, landed, columnLeft(page) + x, rowMark);
    const place = placeOfPoint(landed, rowMark, line ? columnLeft(page) + x : Infinity, line && rowStart);
    return place ? [...place, x] : answer(-1);
  } finally {
    control.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
  }
}

// The place on the mirror's last line, or its first, nearest `goal`, named
// as for `placeOfPoint` from the first row the field holds. The mirror ends
// in a character of its own that gives the end of the text a place.
function mirrorPlace(mirror, last, goal) {
  const letter = document.createRange();
  const box = (offset) => {
    letter.setStart(mirror, offset);
    letter.setEnd(mirror, offset + 1);
    return letter.getClientRects()[0] ?? letter.getBoundingClientRect();
  };
  const end = mirror.data.length - 1;
  const top = Math.round(box(last ? end : 0).top);
  let best = last ? end : 0;
  for (let offset = best; offset >= 0 && offset <= end; offset += last ? -1 : 1) {
    const here = box(offset);
    if (Math.round(here.top) !== top) break;
    if (Math.abs(here.left - goal) < Math.abs(box(best).left - goal)) best = offset;
  }
  return [mirror.data.slice(0, best), false, ""];
}

function here(selection) {
  return { node: selection.focusNode, offset: selection.focusOffset };
}

function holds(point, rowMark) {
  const element = point.node instanceof Element ? point.node : point.node?.parentElement;
  const holder = element?.closest(`[data-${rowMark}]`);
  return holder != null && !(holder instanceof HTMLTextAreaElement);
}

function middle(box) {
  return box.top + box.height / 2;
}

// Each move the browser makes that lands between drawn elements, such as
// after a table, or on the line the head is on, or where the head is drawn,
// is moved on from.
function step(selection, page, rowMark, granularity, forward) {
  const direction = forward ? "forward" : "backward";
  const from = here(selection);
  const start = caretBox(from.node, from.offset);
  for (let tries = 0; tries < 400; tries++) {
    const before = here(selection);
    selection.modify("move", direction, granularity);
    const now = here(selection);
    const stuck = now.node === before.node && now.offset === before.offset;
    if (stuck || !page.contains(now.node)) return granularity === "lineboundary" ? from : null;
    if (!holds(now, rowMark)) continue;
    if (granularity === "lineboundary") return now;
    if (granularity === "character" ? shows(from, now, rowMark) : beyond(now, start, forward)) return now;
  }
  return null;
}

function beyond(point, start, forward) {
  const box = caretBox(point.node, point.offset);
  return forward ? middle(box) > start.bottom - 1 : middle(box) < start.top + 1;
}

// Whether a head moved from one place to the other paints something else:
// the text between them, or the line break of another row.
function shows(from, to, rowMark) {
  const between = document.createRange();
  between.setStart(from.node, from.offset);
  between.setEnd(from.node, from.offset);
  if (between.comparePoint(to.node, to.offset) >= 0) between.setEnd(to.node, to.offset);
  else between.setStart(to.node, to.offset);
  if (between.toString() !== "") return true;
  const row = (point) => {
    const place = placeOfPoint(point, rowMark);
    return place ? place[0] + place[1].split("\n").length - 1 : -1;
  };
  return row(from) !== row(to);
}

// Along the line `landed` is drawn on, the place nearest `goal`.
function toward(selection, landed, goal, rowMark) {
  const line = caretBox(landed.node, landed.offset);
  const direction = line.left < goal ? "forward" : "backward";
  let best = landed;
  let gap = Math.abs(line.left - goal);
  selection.collapse(landed.node, landed.offset);
  for (let tries = 0; tries < 2000 && gap > 0.5; tries++) {
    const before = here(selection);
    selection.modify("move", direction, "character");
    const now = here(selection);
    if ((now.node === before.node && now.offset === before.offset) || !holds(now, rowMark)) break;
    const box = caretBox(now.node, now.offset);
    if (Math.abs(middle(box) - middle(line)) > line.height / 2) break;
    const away = Math.abs(box.left - goal);
    if (away >= gap) break;
    best = now;
    gap = away;
  }
  return best;
}

// The first place drawn after the field, or the last before it.
function beside(marks, part, forward) {
  let low = 0;
  let high = marks.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (part.compareDocumentPosition(marks[middle]) & Node.DOCUMENT_POSITION_FOLLOWING) high = middle;
    else low = middle + 1;
  }
  const mark = marks[forward ? low : low - 1];
  if (!mark) return null;
  const texts = document.createTreeWalker(mark, NodeFilter.SHOW_TEXT);
  if (forward) {
    const text = texts.nextNode();
    return text ? { node: text, offset: 0 } : { node: mark, offset: 0 };
  }
  let text = null;
  for (let next = texts.nextNode(); next; next = texts.nextNode()) text = next;
  if (!text) return { node: mark, offset: 0 };
  return { node: text, offset: text.data.length - (text.data.endsWith("\n") ? 1 : 0) };
}

// The place a window up or down the page from `box`, `left` from the left
// of the window, or null past the first or last row. The head is first kept
// two lines inside the page, because the browser names no place off the
// screen.
function pageStep(page, rowMark, box, forward, left) {
  const line = box.height || lineHeight(page);
  const view = page.getBoundingClientRect();
  const room = 2 * line;
  const start = page.scrollTop;
  if (box.top < view.top + room) page.scrollTop -= view.top + room - box.top;
  else if (box.bottom > view.bottom - room) page.scrollTop += box.bottom - (view.bottom - room);
  const middle = box.top + box.height / 2 - (page.scrollTop - start);
  const top = Math.max(view.top, 0);
  const bottom = Math.min(view.bottom, innerHeight);
  const distance = Math.max(bottom - top - 2 * line, line);
  const was = page.scrollTop;
  page.scrollTop += forward ? distance : -distance;
  const y = middle + (forward ? distance : -distance) - (page.scrollTop - was);
  const drawn = [...page.querySelectorAll(`[data-${rowMark}]`)].map((row) => row.getBoundingClientRect());
  if (forward ? y > Math.max(...drawn.map((row) => row.bottom)) : y < Math.min(...drawn.map((row) => row.top))) {
    return null;
  }
  const at = (y) => {
    const target = document.elementFromPoint(left, y);
    return placeOn(page, page.contains(target) ? target : page, left, y, rowMark, null);
  };
  const there = at(Math.min(Math.max(y, top + line / 2), bottom - line / 2));
  return there[0] >= 0 ? there : at(middle);
}

function after(part, point) {
  return (part.compareDocumentPosition(point.node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

function crosses(part, from, to) {
  return after(part, from) !== after(part, to) || part.contains(from.node) || part.contains(to.node);
}

// A task runs after the browser's own action for the event being handled.
export function afterDefault(run) {
  setTimeout(run, 0);
}

// Scrolls the page just enough to show the caret of the focused field.
export function revealCaret(id, liveClass, paintedClass) {
  const control = document.getElementById(id);
  const page = control?.closest("." + liveClass);
  if (!page || document.activeElement !== control || control.closest("." + paintedClass)) return;
  const { box } = fieldCaret(control);
  revealOnPage(page, box.top, box.bottom);
}

// The browser's own line move, from the first or last line to the start or
// end of the field, remembers the column for the next one, as a key does.
export function moveLine(id, up) {
  const control = document.getElementById(id);
  if (!control || document.activeElement !== control) return;
  getSelection().modify("move", up ? "backward" : "forward", "line");
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
