import { toList, Ok, Error } from "./gleam.mjs";

export function newCell(value) {
  return { value };
}

export function read(cell) {
  return cell.value;
}

export function write(cell, value) {
  cell.value = value;
}

export function collect(run) {
  const collected = [];
  run((value) => {
    collected.push(value);
  });
  return toList(collected);
}

export function newBrowser(keyboard) {
  return {
    keyboard,
    now: 0,
    timers: [],
    listeners: [],
    control: newControl(),
    settings: new Map(),
    visibility: "visible",
  };
}

function newControl() {
  return {
    value: "",
    selectionStart: 0,
    selectionEnd: 0,
    focused: false,
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    focus() {
      this.focused = true;
    },
  };
}

function fakes(browser) {
  return {
    setTimeout: (callback, ms) => {
      browser.timers.push({ due: browser.now + ms, callback });
    },
    document: {
      get visibilityState() {
        return browser.visibility;
      },
      addEventListener: (type, listener) => {
        browser.listeners.push({ type, listener });
      },
      getElementById: (_id) => browser.control,
    },
    localStorage: {
      getItem: (key) => browser.settings.get(key) ?? null,
      setItem: (key, value) => browser.settings.set(key, String(value)),
    },
    matchMedia: (_query) => ({ matches: browser.keyboard }),
    // Node's own navigator reports the host, and on a Mac the shortcut key is
    // Cmd.
    navigator: { platform: "Linux x86_64" },
  };
}

export function inBrowser(browser, run) {
  const swapped = Object.entries(fakes(browser)).map(([name, fake]) => {
    const real = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      value: fake,
      configurable: true,
      writable: true,
    });
    return [name, real];
  });
  try {
    return run();
  } finally {
    for (const [name, real] of swapped) {
      if (real) Object.defineProperty(globalThis, name, real);
      else delete globalThis[name];
    }
  }
}

export function unload(browser) {
  browser.timers = [];
  browser.listeners = [];
  browser.control = newControl();
}

export function nextTimer(browser, deadline) {
  const due = browser.timers.filter((timer) => timer.due <= deadline);
  if (due.length === 0) {
    browser.now = deadline;
    return new Error(undefined);
  }
  const first = due.reduce((a, b) => (b.due < a.due ? b : a));
  browser.timers.splice(browser.timers.indexOf(first), 1);
  browser.now = first.due;
  return new Ok(first.callback);
}

export function now(browser) {
  return browser.now;
}

export function hide(browser) {
  browser.visibility = "hidden";
  emit(browser, "visibilitychange", {});
  browser.visibility = "visible";
}

export function shortcut(browser, key) {
  emit(browser, "keydown", {
    key,
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    preventDefault() {},
  });
}

function emit(browser, type, event) {
  for (const entry of [...browser.listeners]) {
    if (entry.type === type) entry.listener(event);
  }
}

export function typeAtCaret(browser, text) {
  const control = browser.control;
  const before = control.value.slice(0, control.selectionStart);
  const after = control.value.slice(control.selectionEnd);
  control.value = before + text + after;
  control.selectionStart = control.selectionEnd = before.length + text.length;
}

export function selectAll(browser) {
  browser.control.selectionStart = 0;
  browser.control.selectionEnd = browser.control.value.length;
}

export function control(browser) {
  const { value, selectionStart, selectionEnd, focused } = browser.control;
  return [value, selectionStart, selectionEnd, focused];
}

export function blur(browser) {
  browser.control.focused = false;
}

// Lustre keeps paint effects out of `effect.perform`, so this reads Effect's
// own fields.
export function performPaint(effect, dispatch) {
  if (!effect.before_paint || !effect.after_paint) {
    throw new globalThis.Error("lustre Effect changed shape");
  }
  const actions = {
    dispatch,
    emit() {},
    select() {},
    root: () => undefined,
    provide() {},
    subscribe() {},
    unsubscribe() {},
  };
  for (const run of [...effect.before_paint, ...effect.after_paint]) {
    run(actions);
  }
}
