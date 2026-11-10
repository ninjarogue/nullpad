// Small browser calls for `scribbl/platform`. Nothing here may touch
// `document`, `window` or `localStorage` at import time (gleeunit runs in
// Node), and each function must do nothing harmful when they are missing.

// globalThis.setTimeout(run, ms);
export function setTimeout(ms, run) {
  throw new Error("not implemented");
}

// One document "keydown" listener per key: if (ctrlKey || metaKey) and
// event.key === key, preventDefault and call run().
export function listenForShortcut(key, run) {
  throw new Error("not implemented");
}

// navigator.clipboard.writeText(text), ignoring a rejected promise.
export function writeClipboard(text) {
  throw new Error("not implemented");
}

// matchMedia("(hover: hover) and (pointer: fine)").matches; false in Node.
export function hasHardwareKeyboard() {
  throw new Error("not implemented");
}

// localStorage.getItem("scribbl.vim") === "on"; false if storage is blocked.
export function readVimSetting() {
  throw new Error("not implemented");
}

// localStorage.setItem("scribbl.vim", on ? "on" : "off"), ignoring errors.
export function writeVimSetting(on) {
  throw new Error("not implemented");
}
