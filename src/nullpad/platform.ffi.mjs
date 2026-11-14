// Small browser calls for `nullpad/platform`.

const VIM_SETTING = "nullpad.vim";
const MARKDOWN_SETTING = "nullpad.markdown";

export function setTimeout(ms, run) {
  globalThis.setTimeout(run, ms);
}

// Ctrl plus `key`, or Cmd plus `key` on Apple devices. Ctrl is left alone
// there because Ctrl+E and friends move the cursor in every Mac text field.
export function listenForShortcut(key, run) {
  const apple = /Mac|iPhone|iPad/.test(navigator.platform);
  document.addEventListener("keydown", (event) => {
    const held = apple ? event.metaKey : event.ctrlKey;
    if (!held || event.altKey || !isKey(event, key)) return;
    event.preventDefault();
    run();
  });
}

// A shortcut letter on a keyboard laid out for another alphabet is named
// by where the key sits.
function isKey(event, letter) {
  const typed = event.key.toLowerCase();
  const latin = typed.length === 1 && typed >= "a" && typed <= "z";
  return typed === letter || (!latin && event.code === "Key" + letter.toUpperCase());
}

// Runs when the page is hidden: a switched tab, a closed tab, or a phone
// sending the browser to the background. It is the last moment that is
// certain to run before a page can be thrown away.
export function listenForHide(run) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") run();
  });
}

export function writeClipboard(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

export function hasHardwareKeyboard() {
  const query = "(hover: hover) and (pointer: fine)";
  return matchMedia(query).matches;
}

// Reading or writing localStorage throws when the browser blocks storage.
export function readVimSetting() {
  try {
    return localStorage.getItem(VIM_SETTING) === "on";
  } catch {
    return false;
  }
}

export function writeVimSetting(on) {
  try {
    localStorage.setItem(VIM_SETTING, on ? "on" : "off");
  } catch {}
}

export function readMarkdownSetting() {
  try {
    return localStorage.getItem(MARKDOWN_SETTING) === "on";
  } catch {
    return false;
  }
}

export function writeMarkdownSetting(on) {
  try {
    localStorage.setItem(MARKDOWN_SETTING, on ? "on" : "off");
  } catch {}
}

export function focusElement(id) {
  document.getElementById(id)?.focus();
}

export function below(click) {
  const box = click.target.closest("button").getBoundingClientRect();
  return [box.left, box.bottom + 4];
}
