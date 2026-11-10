// All editor JavaScript: four functions, about fifteen lines once written.
// Nothing here may touch `document` at import time (gleeunit runs in node).

// Make the control show `text` with selection start..end (UTF-16 offsets)
// and give it focus. Assign `value` only if it differs (assigning resets
// native undo); set the selection only if it differs. Do nothing if the
// element is missing.
export function writeControl(id, text, start, end) {
  throw new Error("not implemented");
}

// Scroll the mirror's [data-cursor] (a sibling of the control) into view.
export function revealCursor(id) {
  throw new Error("not implemented");
}

// return [text.slice(0, offset), text.slice(offset)];
export function utf16Split(text, offset) {
  throw new Error("not implemented");
}

// return text.length;
export function utf16Length(text) {
  throw new Error("not implemented");
}
