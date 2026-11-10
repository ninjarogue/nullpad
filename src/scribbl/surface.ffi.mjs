// All editor JavaScript. Nothing here touches `document` at import time
// (gleeunit runs in Node).

// Make the control show `text` with the selection start..end (UTF-16
// offsets). `value` is assigned only when it differs, because assigning
// resets the browser's own undo history.
export function writeControl(id, text, start, end) {
  const control = globalThis.document?.getElementById(id);
  if (!control) return;
  if (control.value !== text) control.value = text;
  if (control.selectionStart !== start || control.selectionEnd !== end) {
    control.setSelectionRange(start, end);
  }
}

export function focusControl(id) {
  const control = globalThis.document?.getElementById(id);
  control?.focus();
  const cursor = control?.parentElement?.querySelector("[data-cursor]");
  cursor?.scrollIntoView({ block: "nearest" });
}

export function utf16Split(text, offset) {
  return [text.slice(0, offset), text.slice(offset)];
}

export function utf16Length(text) {
  return text.length;
}
