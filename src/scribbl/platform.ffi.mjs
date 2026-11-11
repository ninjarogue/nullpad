// Small browser calls for `scribbl/platform`.

const VIM_SETTING = "scribbl.vim";

export function setTimeout(ms, run) {
  globalThis.setTimeout(run, ms);
}

// Ctrl plus `key`, or Cmd plus `key` on Apple devices. Ctrl is left alone
// there because Ctrl+E and friends move the cursor in every Mac text field.
export function listenForShortcut(key, run) {
  const apple = /Mac|iPhone|iPad/.test(navigator.platform);
  document.addEventListener("keydown", (event) => {
    const held = apple ? event.metaKey : event.ctrlKey;
    if (!held || event.altKey || event.key.toLowerCase() !== key) return;
    event.preventDefault();
    run();
  });
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
