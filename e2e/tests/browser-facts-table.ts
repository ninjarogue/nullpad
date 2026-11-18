import { fact } from './browser-facts.ts';
import type { Fact } from './browser-facts.ts';
import type { Page } from 'playwright-core';

const surface = 'src/nullpad/surface.gleam';
const ffi = 'src/nullpad/surface.ffi.mjs';
const platform = 'src/nullpad/platform.ffi.mjs';
const markdown = 'src/nullpad/markdown.gleam';
const css = 'assets/nullpad.css';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const instead = (what: string, expected: unknown, seen: unknown) => `${what} was ${JSON.stringify(seen)}, and the app expects ${JSON.stringify(expected)}`;

export const systems: [agent: RegExp, platform: RegExp, system: string][] = [
  [/iPhone/, /^iPhone/, 'an iPhone'],
  [/iPad/, /^iPad/, 'an iPad'],
  [/Macintosh/, /^Mac/, 'a Mac'],
  [/Android/, /^Linux/, 'Android'],
  [/CrOS/, /^Linux/, 'ChromeOS'],
  [/Windows/, /^Win/, 'Windows'],
  [/^(?!.*(Android|CrOS)).*Linux/, /^Linux/, 'Linux'],
];

const mediaAnswers = (seen: { matches: boolean; always: boolean; never: boolean; touchPoints: number } | undefined) => {
  if (typeof seen?.matches !== 'boolean' || typeof seen.always !== 'boolean' || typeof seen.never !== 'boolean' || !finite(seen.touchPoints)) {
    return `matchMedia and the touch points were read as ${JSON.stringify(seen)}`;
  }
  if (!seen.always || seen.never) return `matchMedia answers ${seen.always} to a query that is always true and ${seen.never} to one that is never true, so this looked at nothing`;
  return null;
};

const dragPage =
  '<div id="src" draggable="true" style="position:absolute;left:20px;top:20px;width:100px;height:40px">drag</div>' +
  '<div id="dst" style="position:absolute;left:300px;top:200px;width:200px;height:100px">drop</div>';

async function dragWith(page: Page, held: string[][]) {
  await page.evaluate(() => {
    const log: { dropped: boolean; text: string; ctrl: boolean; alt: boolean }[] = [];
    (window as unknown as { drops: typeof log }).drops = log;
    document.getElementById('src')!.addEventListener('dragstart', (event) => {
      event.dataTransfer!.setData('text/plain', 'carried text');
      event.dataTransfer!.effectAllowed = 'copyMove';
    });
    const target = document.getElementById('dst')!;
    target.addEventListener('dragover', (event) => event.preventDefault());
    target.addEventListener('drop', (event) => {
      event.preventDefault();
      log.push({ dropped: true, text: event.dataTransfer!.getData('text/plain'), ctrl: event.ctrlKey, alt: event.altKey });
    });
  });
  const seen: { dropped: boolean; text: string; ctrl: boolean; alt: boolean }[] = [];
  for (const keys of held) {
    const before = await page.evaluate(() => (window as unknown as { drops: unknown[] }).drops.length);
    await page.mouse.move(60, 40);
    for (const key of keys) await page.keyboard.down(key);
    await page.mouse.down();
    await page.mouse.move(200, 120, { steps: 5 });
    await page.mouse.move(400, 250, { steps: 5 });
    await page.mouse.up();
    for (const key of keys) await page.keyboard.up(key);
    const drops = await page.evaluate(() => (window as unknown as { drops: typeof seen }).drops);
    seen.push(drops.length > before ? drops[drops.length - 1]! : { dropped: false, text: '', ctrl: false, alt: false });
  }
  return seen;
}

const finite = (...values: unknown[]) => values.every((value) => typeof value === 'number' && Number.isFinite(value));

export const facts: Fact[] = [
  fact({
    id: 'value-write-resets-undo',
    says: "Assigning a different value to a text field empties the browser's own undo history, and assigning the value it already has leaves it alone.",
    relied: [{ file: ffi, text: 'if (control.value !== text) control.value = text;' }],
    html: '<textarea id="t"></textarea>',
    observe: async (page) => {
      const read = () => page.evaluate(() => (document.getElementById('t') as HTMLTextAreaElement).value);
      const write = (value: string) =>
        page.evaluate((next) => {
          (document.getElementById('t') as HTMLTextAreaElement).value = next;
        }, value);
      await page.focus('#t');
      await page.keyboard.type('abc');
      await write('xyz');
      await page.keyboard.press('Control+z');
      const afterDifferent = await read();
      await write('');
      await page.focus('#t');
      await page.keyboard.type('abc');
      await write(await read());
      await page.keyboard.press('Control+z');
      return { afterDifferent, afterSame: await read() };
    },
    holds: (seen) => {
      if (seen.afterDifferent !== 'xyz') return instead('the text after Ctrl+Z, once a different value was assigned', 'xyz', seen.afterDifferent);
      if (seen.afterSame !== '') return instead('the text after Ctrl+Z, once the same value was assigned', '', seen.afterSame);
      return null;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        const own = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!;
        Object.defineProperty(HTMLTextAreaElement.prototype, 'value', {
          ...own,
          set(this: HTMLTextAreaElement, next: string) {
            own.set!.call(this, `${next}\u0000`);
            own.set!.call(this, next);
          },
        });
      });
    },
  }),

  fact({
    id: 'undo-events',
    says: 'Ctrl+Z in a text field sends beforeinput and then input, both of type historyUndo, and an undo from the Edit menu sends input alone.',
    relied: [
      { file: surface, text: '"historyUndo", _ -> on_event(editor.UndoAsked)' },
      { file: surface, text: 'event.on("input", typed),' },
    ],
    html: '<textarea id="t"></textarea>',
    observe: async (page) => {
      await page.evaluate(() => {
        const log: string[] = [];
        (window as unknown as { log: string[] }).log = log;
        const field = document.getElementById('t')!;
        for (const type of ['beforeinput', 'input']) {
          field.addEventListener(type, (event) => log.push(`${type}:${(event as InputEvent).inputType}`));
        }
        field.focus();
      });
      const taken = () =>
        page.evaluate(() => {
          const { log } = window as unknown as { log: string[] };
          return log.splice(0);
        });
      await page.keyboard.type('a');
      await taken();
      await page.keyboard.press('Control+z');
      const keyboard = await taken();
      await page.keyboard.type('b');
      await taken();
      const done = await page.evaluate(() => document.execCommand('undo'));
      return { keyboard, menu: await taken(), done };
    },
    holds: (seen) => {
      if (!same(seen.keyboard, ['beforeinput:historyUndo', 'input:historyUndo'])) {
        return instead('the events of Ctrl+Z', ['beforeinput:historyUndo', 'input:historyUndo'], seen.keyboard);
      }
      if (!seen.done) return 'the Edit menu undo (execCommand) did nothing';
      if (!same(seen.menu, ['input:historyUndo'])) return instead('the events of an undo from the Edit menu', ['input:historyUndo'], seen.menu);
      return null;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        const real = document.execCommand.bind(document);
        document.execCommand = (command: string, showUi?: boolean, value?: string) => {
          if (command === 'undo') {
            document.activeElement?.dispatchEvent(new InputEvent('beforeinput', { inputType: 'historyUndo', cancelable: true, bubbles: true }));
          }
          return real(command, showUi, value);
        };
      });
    },
  }),

  fact({
    id: 'undo-can-be-cancelled',
    says: 'Cancelling the beforeinput of a Ctrl+Z stops the text field undoing anything, so the editor can undo in its own way.',
    relied: [{ file: surface, text: 'on_event(asked)\n      |> event.handler(prevent_default: True, stop_propagation: False)' }],
    html: '<textarea id="t"></textarea>',
    observe: async (page) => {
      await page.evaluate(() => {
        const log: string[] = [];
        (window as unknown as { log: string[] }).log = log;
        const field = document.getElementById('t')!;
        field.addEventListener('beforeinput', (event) => {
          const { inputType, cancelable } = event as InputEvent;
          log.push(`beforeinput:${inputType}:${cancelable ? 'cancelable' : 'fixed'}`);
          if (inputType === 'historyUndo') event.preventDefault();
        });
        field.addEventListener('input', (event) => log.push(`input:${(event as InputEvent).inputType}`));
        field.focus();
      });
      await page.keyboard.type('abc');
      await page.evaluate(() => (window as unknown as { log: string[] }).log.splice(0));
      await page.keyboard.press('Control+z');
      return page.evaluate(() => ({
        log: (window as unknown as { log: string[] }).log,
        value: (document.getElementById('t') as HTMLTextAreaElement).value,
      }));
    },
    holds: (seen) => {
      if (!same(seen.log, ['beforeinput:historyUndo:cancelable'])) {
        return instead('the events of Ctrl+Z, whose beforeinput was cancelled', ['beforeinput:historyUndo:cancelable'], seen.log);
      }
      if (seen.value !== 'abc') return instead('the text after a cancelled undo', 'abc', seen.value);
      return null;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        const real = Event.prototype.preventDefault;
        Event.prototype.preventDefault = function (this: Event) {
          if ((this as InputEvent).inputType !== 'historyUndo') real.call(this);
        };
      });
    },
  }),

  fact({
    id: 'focus-scrolls-unless-told-not-to',
    says: 'focus() scrolls the page to a text field that is out of view, focus({ preventScroll: true }) does not, and focus() on a field that already has the focus does not.',
    relied: [
      { file: ffi, text: 'document.getElementById(id)?.focus({ preventScroll: true });' },
      { file: ffi, text: 'control.focus({ preventScroll: true });\n  const painted' },
    ],
    html: '<div style="height:3000px"></div><textarea id="t"></textarea><div style="height:200px"></div>',
    observe: (page) =>
      page.evaluate(() => {
        const field = document.getElementById('t')!;
        field.focus();
        const plain = Math.round(scrollY);
        field.blur();
        scrollTo(0, 0);
        field.focus({ preventScroll: true });
        const prevented = Math.round(scrollY);
        scrollTo(0, 0);
        field.focus();
        return { plain, prevented, alreadyFocused: Math.round(scrollY) };
      }),
    holds: (seen) => {
      if (seen.plain <= 0) return `focus() left the page at ${seen.plain}, and the app expects it to scroll to the field`;
      if (seen.prevented !== 0) return `focus({ preventScroll: true }) scrolled the page to ${seen.prevented}`;
      if (seen.alreadyFocused !== 0) return `focus() on a field that had the focus scrolled the page to ${seen.alreadyFocused}`;
      return null;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        const real = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function (this: HTMLElement) {
          real.call(this);
        };
      });
    },
  }),

  fact({
    id: 'selection-direction',
    says: 'A text field remembers whether its selection runs backward, a collapsed selection reads forward, and a selection set with no direction is forward.',
    relied: [{ file: ffi, text: 'const turned = start !== end && control.selectionDirection !== direction;' }],
    html: '<textarea id="t">hello world</textarea>',
    observe: (page) =>
      page.evaluate(() => {
        const field = document.getElementById('t') as HTMLTextAreaElement;
        field.focus();
        field.setSelectionRange(2, 7, 'backward');
        const backward = field.selectionDirection;
        field.setSelectionRange(2, 7, 'forward');
        const forward = field.selectionDirection;
        field.setSelectionRange(2, 7);
        const defaulted = field.selectionDirection;
        field.setSelectionRange(3, 3, 'backward');
        return { backward, forward, defaulted, collapsed: field.selectionDirection };
      }),
    holds: (seen) =>
      same(seen, { backward: 'backward', forward: 'forward', defaulted: 'forward', collapsed: 'forward' })
        ? null
        : instead('the directions read back', { backward: 'backward', forward: 'forward', defaulted: 'forward', collapsed: 'forward' }, seen),
    breaks: async (page) => {
      await page.evaluate(() => {
        Object.defineProperty(HTMLTextAreaElement.prototype, 'selectionDirection', { get: () => 'none', configurable: true });
      });
    },
  }),

  fact({
    id: 'modify-extends-a-text-field',
    says: 'Selection.modify extends the selection of a focused text field by a character or a word, either way, and the field reports it with its direction.',
    relied: [{ file: ffi, text: 'selection.modify("extend", direction, granularity);' }],
    html: '<textarea id="t">hello world</textarea>',
    observe: (page) =>
      page.evaluate(() => {
        const field = document.getElementById('t') as HTMLTextAreaElement;
        const selection = getSelection()!;
        const now = () => [field.selectionStart, field.selectionEnd, field.selectionDirection];
        field.focus();
        field.setSelectionRange(5, 5);
        selection.modify('extend', 'backward', 'character');
        const backByCharacter = now();
        field.setSelectionRange(5, 5);
        selection.modify('extend', 'forward', 'word');
        return { backByCharacter, forwardByWord: now() };
      }),
    holds: (seen) =>
      same(seen, { backByCharacter: [4, 5, 'backward'], forwardByWord: [5, 11, 'forward'] })
        ? null
        : instead('the selection after extending by a character back and by a word forward', { backByCharacter: [4, 5, 'backward'], forwardByWord: [5, 11, 'forward'] }, seen),
    breaks: async (page) => {
      await page.evaluate(() => {
        Selection.prototype.modify = () => {};
      });
    },
  }),

  fact({
    id: 'wrap-affinity-by-line-boundary',
    says: 'Where a line wraps, the end of one line and the start of the next share an offset, and moving to the line boundary tells which one the caret is at.',
    relied: [
      { file: ffi, text: 'getSelection().modify("move", "forward", "lineboundary");' },
      { file: ffi, text: 'getSelection().modify("extend", "backward", "lineboundary");' },
    ],
    html: '<textarea id="t" style="width:120px;height:200px;font:16px monospace;padding:4px;border:0;overflow:hidden">aaaa bbbb cccc dddd eeee</textarea>',
    observe: (page) =>
      page.evaluate(() => {
        const field = document.getElementById('t') as HTMLTextAreaElement;
        const selection = getSelection()!;
        const now = () => [field.selectionStart, field.selectionEnd, field.selectionDirection];
        field.focus();
        field.setSelectionRange(0, 0);
        selection.modify('move', 'forward', 'lineboundary');
        const wrap = field.selectionStart;
        field.setSelectionRange(wrap, wrap);
        selection.modify('extend', 'backward', 'lineboundary');
        const startOfNextLine = now();
        field.setSelectionRange(wrap - 1, wrap - 1);
        selection.modify('move', 'forward', 'lineboundary');
        selection.modify('extend', 'backward', 'lineboundary');
        return { wrap, startOfNextLine, endOfFirstLine: now() };
      }),
    holds: (seen) => {
      const expected = { wrap: 10, startOfNextLine: [10, 10, 'forward'], endOfFirstLine: [0, 10, 'backward'] };
      return same(seen, expected) ? null : instead('the offset of the wrap and the selections taken from either side of it', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        const real = Selection.prototype.modify;
        Selection.prototype.modify = function (this: Selection, alter: string, direction: string, granularity: string) {
          if (granularity !== 'lineboundary') real.call(this, alter, direction, granularity);
        };
      });
    },
  }),

  fact({
    id: 'vertical-goal-in-whole-pixels',
    says: "ArrowDown aims at the caret's left edge rounded down to a whole device pixel, and takes the place on the line below nearest that.",
    relied: [{ file: ffi, text: 'return Math.floor(left * ratio) / ratio - origin;' }],
    html: `<textarea id="t" style="width:400px;height:200px;font:16px monospace;letter-spacing:0.3px;text-indent:5.4px;padding:0;border:0;overflow:hidden">${'a'.repeat(30)}\n${'a'.repeat(30)}</textarea>`,
    observe: async (page) => {
      const cases = await page.evaluate(() => {
        const field = document.getElementById('t') as HTMLTextAreaElement;
        const style = getComputedStyle(field);
        const ruler = document.createElement('div');
        ruler.style.cssText = `position:absolute;left:0;top:300px;width:${field.clientWidth}px;white-space:pre-wrap;font:${style.font};letter-spacing:${style.letterSpacing};text-indent:${style.textIndent}`;
        ruler.textContent = `${field.value}​`;
        document.body.append(ruler);
        const text = ruler.firstChild as Text;
        const range = document.createRange();
        const left = ruler.getBoundingClientRect().left;
        const x = (offset: number) => {
          range.setStart(text, offset);
          range.setEnd(text, offset + 1);
          return range.getClientRects()[0]!.left - left;
        };
        const below = field.value.indexOf('\n') + 1;
        const nearest = (goal: number) => {
          let best = below;
          for (let offset = below; offset <= field.value.length; offset++) if (Math.abs(x(offset) - goal) < Math.abs(x(best) - goal)) best = offset;
          return best;
        };
        const found: { col: number; exact: number; floored: number }[] = [];
        for (let col = 1; col < below - 1; col++) {
          const exact = nearest(x(col));
          const floored = nearest(Math.floor(x(col)));
          if (exact !== floored) found.push({ col, exact, floored });
        }
        ruler.remove();
        (window as unknown as { exact: Record<number, number> }).exact = Object.fromEntries(found.map((each) => [each.col, each.exact]));
        return found;
      });
      const landed: { col: number; floored: number; landed: number }[] = [];
      for (const { col, floored } of cases) {
        await page.evaluate((col: number) => {
          const field = document.getElementById('t') as HTMLTextAreaElement;
          field.focus();
          field.setSelectionRange(col, col);
        }, col);
        await page.keyboard.press('ArrowDown');
        landed.push({ col, floored, landed: await page.evaluate(() => (document.getElementById('t') as HTMLTextAreaElement).selectionStart) });
      }
      return { landed };
    },
    holds: (seen) => {
      if (seen.landed.length === 0) return 'no letter of the first line has a left edge whose rounding changes the nearest place below, so this looked at nothing';
      const missed = seen.landed.filter((each) => each.landed !== each.floored);
      return missed.length === 0 ? null : instead('where ArrowDown landed from letters whose left edge has a fraction of a pixel', missed.map((each) => ({ col: each.col, landed: each.floored })), missed);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        document.addEventListener('keydown', (event) => {
          const field = document.getElementById('t') as HTMLTextAreaElement;
          const exact = (window as unknown as { exact?: Record<number, number> }).exact?.[field.selectionStart];
          if (event.key !== 'ArrowDown' || exact === undefined) return;
          event.preventDefault();
          field.setSelectionRange(exact, exact);
        });
      });
    },
  }),

  fact({
    id: 'selection-at-a-wrap-moves-from-the-next-line',
    says: 'A selection the field made that runs to where a line wraps has its head at the start of the line below: ArrowUp to the start, then ArrowDown, lands at the start of the second line, where from a caret at the end of the first line it lands at the end of the second.',
    relied: [{ file: ffi, text: 'if (!extending || !stepsFromLineAbove(control, head, place)) return place(head);' }],
    html: '<textarea id="t" style="width:120px;height:200px;font:16px monospace;padding:4px;border:0;overflow:hidden">aaaa bbbb cccc dddd eeee</textarea>',
    observe: async (page) => {
      const from = async (keys: string[]) => {
        await page.evaluate(() => {
          const field = document.getElementById('t') as HTMLTextAreaElement;
          field.focus();
          field.setSelectionRange(0, 0);
        });
        for (const key of keys) await page.keyboard.press(key);
        return page.evaluate(() => {
          const field = document.getElementById('t') as HTMLTextAreaElement;
          return [field.selectionStart, field.selectionEnd];
        });
      };
      return { selected: await from(['Shift+End', 'ArrowUp', 'ArrowDown']), caret: await from(['End', 'ArrowUp', 'ArrowDown']) };
    },
    holds: (seen) => {
      const expected = { selected: [10, 10], caret: [20, 20] };
      return same(seen, expected) ? null : instead('the caret after Shift+End or End, then ArrowUp and ArrowDown', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        document.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowDown') event.preventDefault();
        });
      });
    },
  }),

  fact({
    id: 'backward-selection-at-a-wrap-extends-from-the-line-above',
    says: 'Shift+ArrowUp on a backward selection whose head is where a line wraps moves the head on from the line above that wrap, aiming at the start of the line below, so it lands at the start of the line two above; on a forward selection, or from a caret, it moves on from the line below.',
    relied: [{ file: ffi, text: 'if (control.selectionDirection !== "backward" || head === 0 || control.value[head - 1] === "\\n") return false;' }],
    html: '<textarea id="t" style="width:120px;height:200px;font:16px monospace;padding:4px;border:0;overflow:hidden">aaaa bbbb cccc dddd eeee</textarea>',
    observe: async (page) => {
      const from = async (at: number, keys: string[]) => {
        await page.evaluate((at: number) => {
          const field = document.getElementById('t') as HTMLTextAreaElement;
          field.focus();
          field.setSelectionRange(at, at);
        }, at);
        for (const key of keys) await page.keyboard.press(key);
        return page.evaluate(() => {
          const field = document.getElementById('t') as HTMLTextAreaElement;
          return [field.selectionStart, field.selectionEnd];
        });
      };
      return {
        backward: await from(24, ['Shift+Home', 'Shift+ArrowUp']),
        forward: await from(14, ['Shift+End', 'Shift+ArrowUp']),
        caret: await from(24, ['Home', 'Shift+ArrowUp']),
      };
    },
    holds: (seen) => {
      const expected = { backward: [0, 24], forward: [10, 14], caret: [10, 20] };
      return same(seen, expected) ? null : instead('the selection after Shift+Home, Shift+End or Home, then Shift+ArrowUp', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        document.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowUp' && event.shiftKey) event.preventDefault();
        });
      });
    },
  }),

  fact({
    id: 'text-with-no-key-can-be-held',
    says: 'Text put in with no key, as an IME commits outside a composition, sends beforeinput of type insertText with the text as its data and isComposing false, and cancelling it leaves the field as it was.',
    relied: [{ file: surface, text: 'kind == "insertText"' }],
    html: '<textarea id="t">hello</textarea>',
    observe: async (page) => {
      const session = await page.context().newCDPSession(page);
      await page.evaluate(() => {
        const log: string[] = [];
        (window as unknown as { log: string[] }).log = log;
        const field = document.getElementById('t') as HTMLTextAreaElement;
        field.addEventListener('beforeinput', (event) => {
          log.push(`beforeinput:${event.inputType}:${event.data}:composing=${event.isComposing}`);
          event.preventDefault();
        });
        for (const type of ['keydown', 'input']) field.addEventListener(type, () => log.push(type));
        field.focus();
        field.setSelectionRange(5, 5);
      });
      await session.send('Input.insertText', { text: 'X' });
      return page.evaluate(() => ({ events: (window as unknown as { log: string[] }).log, value: (document.getElementById('t') as HTMLTextAreaElement).value }));
    },
    holds: (seen) => {
      const expected = { events: ['beforeinput:insertText:X:composing=false'], value: 'hello' };
      return same(seen, expected) ? null : instead('the events of text put in with no key, cancelled, and the text left', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        addEventListener('beforeinput', (event) => event.stopImmediatePropagation(), true);
      });
    },
  }),

  fact({
    id: 'arrow-down-drops-a-selection-at-a-wrap',
    says: 'ArrowDown in a text field whose selection runs forward to where a line wraps drops the selection and leaves the caret at its end, at the start of the line below, while from a selection that ends inside a line it goes a line down.',
    relied: [{ file: surface, text: '&& ends_at_wrap(control_id),' }],
    html: '<textarea id="t" style="width:120px;height:200px;font:16px monospace;padding:4px;border:0;overflow:hidden">aaaa bbbb cccc dddd eeee</textarea>',
    observe: async (page) => {
      const from = async (keys: string[]) => {
        await page.evaluate(() => {
          const field = document.getElementById('t') as HTMLTextAreaElement;
          field.focus();
          field.setSelectionRange(0, 0);
        });
        for (const key of [...keys, 'ArrowDown']) await page.keyboard.press(key);
        return page.evaluate(() => {
          const field = document.getElementById('t') as HTMLTextAreaElement;
          return [field.selectionStart, field.selectionEnd];
        });
      };
      return { toTheWrap: await from(['Shift+End']), insideTheLine: await from(['Shift+ArrowRight', 'Shift+ArrowRight']) };
    },
    holds: (seen) => {
      const expected = { toTheWrap: [10, 10], insideTheLine: [12, 12] };
      return same(seen, expected) ? null : instead('the caret after ArrowDown from a selection to the wrap and from one inside the first line', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        document.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowDown') event.preventDefault();
        });
      });
    },
  }),

  fact({
    id: 'modify-crosses-hidden-blocks',
    says: 'Selection.modify on the page steps over blocks that draw nothing (display:none, visibility:hidden) to the next drawn text, stops at the end of the page, and keeps a caret still when there is nowhere to go.',
    relied: [
      { file: ffi, text: 'selection.modify("move", direction, granularity);' },
      { file: ffi, text: 'const stuck = now.node === before.node && now.offset === before.offset;' },
    ],
    html:
      '<p id="a" style="margin:0">ab</p><p id="h" style="margin:0;display:none">XX</p><p id="c" style="margin:0">cd</p>' +
      '<p id="v" style="margin:0;visibility:hidden">HH</p><p id="e" style="margin:0">ef</p>',
    observe: (page) =>
      page.evaluate(() => {
        const selection = getSelection()!;
        const where = () => `${selection.focusNode!.parentElement!.id}:${selection.focusOffset}`;
        const text = (id: string) => document.getElementById(id)!.firstChild!;
        selection.collapse(text('a'), 2);
        const byCharacter = [where()];
        for (let step = 0; step < 6; step++) {
          selection.modify('move', 'forward', 'character');
          byCharacter.push(where());
        }
        selection.collapse(text('a'), 0);
        selection.modify('move', 'forward', 'line');
        const byLine = [where()];
        selection.modify('move', 'forward', 'line');
        byLine.push(where());
        selection.collapse(text('e'), 2);
        selection.modify('move', 'forward', 'character');
        const atTheEnd = where();
        selection.collapse(text('e'), 1);
        selection.modify('move', 'forward', 'lineboundary');
        const lineEnd = where();
        selection.modify('move', 'backward', 'lineboundary');
        return { byCharacter, byLine, atTheEnd, lineEnd, lineStart: where() };
      }),
    holds: (seen) => {
      const expected = {
        byCharacter: ['a:2', 'c:0', 'c:1', 'c:2', 'e:0', 'e:1', 'e:2'],
        byLine: ['c:0', 'e:0'],
        atTheEnd: 'e:2',
        lineEnd: 'e:2',
        lineStart: 'e:0',
      };
      return same(seen, expected) ? null : instead('the places a caret steps through over hidden blocks', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        const real = Selection.prototype.modify;
        Selection.prototype.modify = function (this: Selection, alter: string, direction: string, granularity: string) {
          const { focusNode, focusOffset } = this;
          real.call(this, alter, direction, granularity);
          if (focusNode && this.focusNode !== focusNode) this.collapse(focusNode, focusOffset);
        };
      });
    },
  }),

  fact({
    id: 'ruler-wraps-like-the-field',
    says: 'A div given the properties the app copies from a text field wraps the same text into the same number of lines at every width, so it can say where a character is drawn.',
    relied: [
      {
        file: ffi,
        text:
          'const COPIED = [\n' +
          '  "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariantLigatures",\n' +
          '  "fontKerning", "lineHeight", "letterSpacing", "wordSpacing", "tabSize",\n' +
          '  "textIndent", "whiteSpace", "overflowWrap", "wordBreak", "paddingTop",\n' +
          '  "paddingRight", "paddingBottom", "paddingLeft",\n' +
          '];',
      },
      { file: ffi, text: 'ruler.style.width = control.clientWidth + "px";' },
    ],
    html:
      '<textarea id="t" style="font:16px/1.5 serif;padding:7px 11px;border:0;overflow:hidden;height:30px;letter-spacing:0.3px;word-spacing:2px"></textarea><div id="r"></div>',
    observe: (page) =>
      page.evaluate(() => {
        const copied = [
          'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariantLigatures',
          'fontKerning', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize',
          'textIndent', 'whiteSpace', 'overflowWrap', 'wordBreak', 'paddingTop',
          'paddingRight', 'paddingBottom', 'paddingLeft',
        ] as const;
        const field = document.getElementById('t') as HTMLTextAreaElement;
        field.value =
          'The quick brown fox jumps over the lazy dog, and supercalifragilisticexpialidocious_words_without_breaks keep going.\n\n' +
          'Second   paragraph with   spaces\tand a tab.';
        const ruler = document.getElementById('r') as HTMLDivElement;
        ruler.style.cssText = 'position:absolute;top:0;left:-9999px;visibility:hidden;border:0;box-sizing:border-box;height:auto;overflow:hidden';
        ruler.append('');
        const style = getComputedStyle(field);
        for (const property of copied) ruler.style[property] = style[property];
        const line = parseFloat(style.lineHeight);
        const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        const mismatches: number[][] = [];
        const counts = new Set<number>();
        for (let width = 150; width <= 420; width += 13) {
          field.style.width = `${width}px`;
          ruler.style.width = `${field.clientWidth}px`;
          (ruler.firstChild as Text).data = `${field.value}​`;
          const inField = Math.round((field.scrollHeight - padding) / line);
          const inRuler = Math.round((ruler.getBoundingClientRect().height - padding) / line);
          counts.add(inField);
          if (inField !== inRuler) mismatches.push([width, inField, inRuler]);
        }
        return { mismatches, counts: counts.size };
      }),
    holds: (seen) => {
      if (seen.counts < 4) return `the text wrapped into only ${seen.counts} different numbers of lines over the widths tried, so this looked at too little`;
      if (seen.mismatches.length > 0) return `the ruler and the field disagreed on the number of lines at [width, field, ruler]: ${JSON.stringify(seen.mismatches)}`;
      return null;
    },
    breaks: async (page) => {
      await page.addStyleTag({ content: '#t { font-variant-caps: all-small-caps !important; }' });
    },
  }),

  fact({
    id: 'caret-position-from-point',
    says: 'document.caretPositionFromPoint exists, names the text field itself with an offset into its value over a text field, and a text node over drawn text.',
    relied: [
      { file: ffi, text: 'if (document.caretPositionFromPoint) {' },
      { file: ffi, text: 'if (point?.node !== field || field.value !== field.defaultValue) return none;' },
    ],
    html:
      '<textarea id="t" style="position:absolute;left:20px;top:20px;width:300px;height:80px;font:16px monospace;border:0;padding:0">0123456789</textarea>' +
      '<p id="p" style="position:absolute;left:20px;top:200px;margin:0;font:16px monospace">abcdefghij</p>',
    observe: (page) =>
      page.evaluate(() => {
        const probe = document.createElement('span');
        probe.style.font = '16px monospace';
        probe.textContent = '0000000000';
        document.body.append(probe);
        const width = probe.getBoundingClientRect().width / 10;
        probe.remove();
        const named = (caret: CaretPosition | null) => caret && { node: caret.offsetNode.nodeName, offset: caret.offset };
        return {
          type: typeof document.caretPositionFromPoint,
          inField: named(document.caretPositionFromPoint(20 + width * 3.4, 30)),
          inText: named(document.caretPositionFromPoint(20 + width * 4.6, 210)),
        };
      }),
    holds: (seen) => {
      const expected = { type: 'function', inField: { node: 'TEXTAREA', offset: 3 }, inText: { node: '#text', offset: 5 } };
      return same(seen, expected) ? null : instead('what caretPositionFromPoint names', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        document.caretPositionFromPoint = () => ({ offsetNode: document.body, offset: 0, getClientRect: () => null }) as unknown as CaretPosition;
      });
    },
  }),

  fact({
    id: 'default-value-follows-text-content',
    says: 'The text inside a textarea is its default value: it is the value until the field is edited, and after that it changes the default value and leaves the value alone.',
    relied: [
      { file: surface, text: '[element.text(buffer.text(editor.field_buffer(editor)))],' },
      { file: ffi, text: 'field.value !== field.defaultValue' },
    ],
    html: '<textarea id="t">a</textarea>',
    observe: async (page) => {
      const state = () =>
        page.evaluate(() => {
          const field = document.getElementById('t') as HTMLTextAreaElement;
          return [field.value, field.defaultValue];
        });
      await page.evaluate(() => {
        document.getElementById('t')!.textContent = 'b';
      });
      const beforeEdit = await state();
      await page.focus('#t');
      await page.keyboard.type('x');
      const typed = await state();
      await page.evaluate(() => {
        document.getElementById('t')!.textContent = 'zzz';
      });
      return { beforeEdit, typed, afterText: await state() };
    },
    holds: (seen) => {
      const expected = { beforeEdit: ['b', 'b'], typed: ['xb', 'b'], afterText: ['xb', 'zzz'] };
      return same(seen, expected) ? null : instead('the [value, defaultValue] of the field before an edit, after it, and after the text changed', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        Object.defineProperty(HTMLTextAreaElement.prototype, 'defaultValue', {
          get(this: HTMLTextAreaElement) {
            return this.value;
          },
          set(this: HTMLTextAreaElement, next: string) {
            this.value = next;
          },
          configurable: true,
        });
      });
    },
  }),

  fact({
    id: 'script-writes-fire-no-input',
    says: 'Writing the value of a text field from script fires no beforeinput or input, so what the app writes is not heard as typing. (The same field does fire both for a typed key, so a field that heard nothing would not pass.)',
    relied: [{ file: ffi, text: 'if (control.value !== text) control.value = text;' }],
    html: '<textarea id="t">hello</textarea>',
    observe: async (page) => {
      const heard = () => page.evaluate(() => (window as unknown as { log: string[] }).log.splice(0).filter((type) => type !== 'select'));
      await page.evaluate(() => {
        const log: string[] = [];
        (window as unknown as { log: string[] }).log = log;
        const field = document.getElementById('t') as HTMLTextAreaElement;
        for (const type of ['beforeinput', 'input', 'change', 'select']) field.addEventListener(type, () => log.push(type));
        field.focus();
        field.value = 'other text';
        field.setSelectionRange(2, 5, 'backward');
      });
      // Setting the selection fires select, a moment later, and anything else would come with it.
      await page.waitForFunction(() => (window as unknown as { log: string[] }).log.includes('select'), undefined, { timeout: 1000 }).catch(() => {});
      const scripted = await heard();
      await page.keyboard.type('x');
      return { scripted, typed: await heard() };
    },
    holds: (seen) => {
      if (!Array.isArray(seen?.scripted) || !Array.isArray(seen?.typed)) return `the events of the field were read as ${JSON.stringify(seen)}`;
      if (!seen.typed.includes('beforeinput') || !seen.typed.includes('input')) return `a typed key fired ${JSON.stringify(seen.typed)}, so this field heard nothing and looked at nothing`;
      return seen.scripted.length === 0 ? null : `writing the field fired ${JSON.stringify(seen.scripted)}`;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        const own = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!;
        Object.defineProperty(HTMLTextAreaElement.prototype, 'value', {
          ...own,
          set(this: HTMLTextAreaElement, next: string) {
            own.set!.call(this, next);
            this.dispatchEvent(new Event('input', { bubbles: true }));
          },
        });
      });
    },
  }),

  fact({
    id: 'typing-event-order',
    says: 'A typed character sends keydown, beforeinput and input, then keyup, with the old text in the first two and the new text in input.',
    relied: [
      { file: surface, text: 'event.on("input", typed),' },
      { file: surface, text: 'decode.one_of(history_decoder(on_event), [' },
    ],
    html: '<textarea id="t">hello</textarea>',
    observe: async (page) => {
      await page.evaluate(() => {
        const log: string[] = [];
        (window as unknown as { log: string[] }).log = log;
        const field = document.getElementById('t') as HTMLTextAreaElement;
        for (const type of ['keydown', 'beforeinput', 'input', 'keyup']) field.addEventListener(type, () => log.push(`${type}:${field.value}`));
        field.focus();
        field.setSelectionRange(5, 5);
      });
      await page.keyboard.type('x');
      return page.evaluate(() => (window as unknown as { log: string[] }).log);
    },
    holds: (seen) => {
      const expected = ['keydown:hello', 'beforeinput:hello', 'input:hellox', 'keyup:hellox'];
      return same(seen, expected) ? null : instead('the events of typing "x" after "hello", with the text each saw', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        addEventListener('beforeinput', (event) => event.stopImmediatePropagation(), true);
      });
    },
  }),

  fact({
    id: 'caret-keys-say-nothing',
    says: 'An arrow key moves the caret of a text field before keyup, with no beforeinput or input, and Shift with an arrow fires select.',
    relied: [
      { file: surface, text: 'event.on("keyup", moved),' },
      { file: surface, text: 'if !composing\n      -> changed' },
      { file: surface, text: 'event.on("select", changed),' },
    ],
    html: '<textarea id="t">hello</textarea>',
    observe: async (page) => {
      await page.evaluate(() => {
        const log: string[] = [];
        (window as unknown as { log: string[] }).log = log;
        const field = document.getElementById('t') as HTMLTextAreaElement;
        for (const type of ['keydown', 'keyup', 'beforeinput', 'input', 'select']) {
          field.addEventListener(type, (event) => {
            const key = (event as KeyboardEvent).key;
            if (!type.startsWith('key')) log.push(type);
            else if (key.startsWith('Arrow')) log.push(`${type}:caret=${field.selectionStart}-${field.selectionEnd}`);
          });
        }
        field.focus();
        field.setSelectionRange(5, 5);
      });
      const taken = () => page.evaluate(() => (window as unknown as { log: string[] }).log.splice(0));
      const heard = (type: string) =>
        page.waitForFunction((wanted) => (window as unknown as { log: string[] }).log.includes(wanted), type, { timeout: 1000 }).catch(() => {});
      // Setting the selection from script fires select, a moment later.
      await heard('select');
      await taken();
      await page.keyboard.press('ArrowLeft');
      const arrow = await taken();
      await page.keyboard.press('Shift+ArrowLeft');
      await heard('select');
      const shiftArrow = await taken();
      // Whether select comes before the keyup is for the browser to say.
      return { arrow, shiftArrow: shiftArrow.filter((event) => event !== 'select'), selects: shiftArrow.filter((event) => event === 'select').length };
    },
    holds: (seen) => {
      const expected = { arrow: ['keydown:caret=5-5', 'keyup:caret=4-4'], shiftArrow: ['keydown:caret=4-4', 'keyup:caret=3-4'], selects: 1 };
      return same(seen, expected) ? null : instead('the events of ArrowLeft and Shift+ArrowLeft from the end of "hello", with the caret each saw', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        addEventListener('keydown', (event) => event.key.startsWith('Arrow') && event.preventDefault(), true);
      });
    },
  }),

  fact({
    id: 'focus-events',
    says: 'Moving the focus sends blur, focusout, focus and focusin in that order with the body active during blur, and pressing on plain text blurs the field and leaves the body active.',
    relied: [
      { file: surface, text: 'event.on("focus", focus_changed(True)),' },
      { file: ffi, text: 'return !active || active === document.body || active.id === id || active === focusAsked;' },
    ],
    html: '<input id="a"><input id="b"><div id="d" style="position:absolute;top:100px;width:100px;height:40px">plain</div>',
    observe: async (page) => {
      const taken = () => page.evaluate(() => (window as unknown as { log: string[] }).log.splice(0));
      await page.evaluate(() => {
        const log: string[] = [];
        (window as unknown as { log: string[] }).log = log;
        for (const id of ['a', 'b']) {
          const field = document.getElementById(id)!;
          for (const type of ['blur', 'focusout', 'focus', 'focusin']) {
            field.addEventListener(type, () => log.push(`${type}:${id}:active=${document.activeElement!.id || document.activeElement!.nodeName}`));
          }
        }
        document.getElementById('a')!.focus();
      });
      await taken();
      await page.evaluate(() => document.getElementById('b')!.focus());
      const moved = await taken();
      await page.mouse.click(20, 120);
      const pressed = await taken();
      return { moved, pressed, active: await page.evaluate(() => document.activeElement!.nodeName) };
    },
    holds: (seen) => {
      const expected = {
        moved: ['blur:a:active=BODY', 'focusout:a:active=BODY', 'focus:b:active=b', 'focusin:b:active=b'],
        pressed: ['blur:b:active=BODY', 'focusout:b:active=BODY'],
        active: 'BODY',
      };
      return same(seen, expected) ? null : instead('the focus events when the focus moves and when plain text is pressed', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        addEventListener('mousedown', (event) => event.preventDefault(), true);
      });
    },
  }),

  fact({
    id: 'touch-sends-pointerup-before-the-mouse-press',
    says: 'A tap sends pointerdown, touchstart, pointerup, touchend, and only then the mouse events, which say they come from a touch, while a mouse click says it does not.',
    relied: [
      { file: surface, text: 'event.advanced("mouseup", released_decoder(on_event)),' },
      { file: ffi, text: 'press.sourceCapabilities?.firesTouchEvents' },
    ],
    context: { hasTouch: true },
    html: '<textarea id="t" style="position:absolute;left:10px;top:10px;width:300px;height:100px">hello world</textarea>',
    observe: async (page) => {
      await page.evaluate(() => {
        const log: string[] = [];
        (window as unknown as { log: string[] }).log = log;
        const field = document.getElementById('t')!;
        for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'touchstart', 'touchend']) {
          field.addEventListener(type, (event) => {
            const capabilities = (event as MouseEvent & { sourceCapabilities?: { firesTouchEvents: boolean } }).sourceCapabilities;
            log.push(capabilities ? `${type}:fires-touch=${capabilities.firesTouchEvents}` : type);
          });
        }
      });
      const taken = () => page.evaluate(() => (window as unknown as { log: string[] }).log.splice(0));
      const clicked = () =>
        page.waitForFunction(() => (window as unknown as { log: string[] }).log.some((event) => event.startsWith('click')), undefined, { timeout: 3000 }).catch(() => {});
      await page.touchscreen.tap(50, 30);
      await clicked();
      const touch = await taken();
      await page.mouse.click(50, 30);
      await clicked();
      return { touch, mouse: await taken() };
    },
    holds: (seen) => {
      const expected = {
        touch: ['pointerdown', 'touchstart:fires-touch=true', 'pointerup', 'touchend:fires-touch=true', 'mousedown:fires-touch=true', 'mouseup:fires-touch=true', 'click:fires-touch=true'],
        mouse: ['pointerdown', 'mousedown:fires-touch=false', 'pointerup', 'mouseup:fires-touch=false', 'click:fires-touch=false'],
      };
      return same(seen, expected) ? null : instead('the events of a tap and of a mouse click', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        Object.defineProperty(MouseEvent.prototype, 'sourceCapabilities', { get: () => null, configurable: true });
      });
    },
  }),

  fact({
    id: 'press-then-drag-needs-draggable',
    says: 'An element made draggable in its mousedown handler can be dragged by that press, and the press takes the focus from a text field.',
    relied: [
      { file: ffi, text: 'target.setAttribute("draggable", "true");' },
      { file: ffi, text: 'if (document.activeElement !== control) control.focus({ preventScroll: true });' },
    ],
    html:
      '<textarea id="t" style="position:absolute;left:10px;top:10px;width:200px;height:50px">text</textarea>' +
      '<p id="p" style="position:absolute;left:10px;top:100px;margin:0;font:16px monospace">selectable words here</p>',
    observe: async (page) => {
      await page.evaluate(() => {
        const log: string[] = [];
        (window as unknown as { log: string[] }).log = log;
        const field = document.getElementById('t')!;
        field.addEventListener('blur', () => log.push('blur'));
        field.focus();
        const drawn = document.getElementById('p')!;
        drawn.addEventListener('mousedown', () => drawn.setAttribute('draggable', 'true'));
        for (const type of ['dragstart', 'dragend']) drawn.addEventListener(type, () => log.push(type));
      });
      await page.mouse.move(20, 108);
      await page.mouse.down();
      const active = await page.evaluate(() => document.activeElement!.nodeName);
      await page.mouse.move(60, 140, { steps: 5 });
      await page.mouse.move(120, 160, { steps: 5 });
      await page.mouse.up();
      await page.waitForFunction(() => (window as unknown as { log: string[] }).log.includes('dragend'), undefined, { timeout: 3000 }).catch(() => {});
      return { active, log: await page.evaluate(() => (window as unknown as { log: string[] }).log) };
    },
    holds: (seen) => {
      const expected = { active: 'BODY', log: ['blur', 'dragstart', 'dragend'] };
      return same(seen, expected) ? null : instead('the active element after the press, and the events of the press and drag', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        const real = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function (this: Element, name: string, value: string) {
          if (name !== 'draggable') real.call(this, name, value);
        };
      });
    },
  }),

  fact({
    id: 'ime-composition-events',
    says: 'An IME starts with a keydown of keyCode 229 that is not yet composing, then every key, beforeinput and input of the composition says it is composing, and compositionend comes last.',
    relied: [
      { file: surface, text: '_, True -> on_event(editor.Composing(shown:))' },
      { file: surface, text: 'event.on("compositionend", composed),' },
    ],
    html: '<textarea id="t"></textarea>',
    observe: async (page) => {
      const session = await page.context().newCDPSession(page);
      await page.evaluate(() => {
        const log: string[] = [];
        (window as unknown as { log: string[] }).log = log;
        const field = document.getElementById('t')!;
        for (const type of ['keydown', 'keyup', 'compositionstart', 'compositionupdate', 'compositionend', 'beforeinput', 'input']) {
          field.addEventListener(type, (event) => {
            const key = event as KeyboardEvent;
            const typed = event as InputEvent;
            const composing = typed.isComposing === undefined ? '' : ` composing=${typed.isComposing}`;
            log.push(`${type}${typed.inputType ? `:${typed.inputType}` : ''}${composing}${type.startsWith('key') ? ` keyCode=${key.keyCode}` : ''}`);
          });
        }
        field.focus();
      });
      const key = (type: 'keyDown' | 'keyUp', code: string) =>
        session.send('Input.dispatchKeyEvent', { type, key: 'Process', code, windowsVirtualKeyCode: 229 });
      await key('keyDown', 'KeyN');
      await session.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
      await key('keyUp', 'KeyN');
      await key('keyDown', 'KeyI');
      await session.send('Input.imeSetComposition', { text: '你', selectionStart: 1, selectionEnd: 1 });
      await key('keyUp', 'KeyI');
      await session.send('Input.insertText', { text: '你' });
      await page
        .waitForFunction(() => (window as unknown as { log: string[] }).log.some((event) => event.startsWith('compositionend')), undefined, { timeout: 3000 })
        .catch(() => {});
      return page.evaluate(() => (window as unknown as { log: string[] }).log);
    },
    holds: (seen) => {
      if (seen[0] !== 'keydown composing=false keyCode=229') return instead('the first event of an IME', 'keydown composing=false keyCode=229', seen[0]);
      const last = seen.at(-1)!;
      if (!last.startsWith('compositionend')) return `the last event of the composition was ${JSON.stringify(last)}, and the app expects compositionend`;
      for (const [index, event] of seen.entries()) {
        const composed = /^(beforeinput|input):insertCompositionText/.test(event) || (index > 0 && /^key(down|up) /.test(event));
        if (composed && !event.includes('composing=true')) return `${JSON.stringify(event)} (event ${index + 1} of ${seen.length}) says it is not composing`;
        if (/^key(down|up) /.test(event) && !event.endsWith('keyCode=229')) return `${JSON.stringify(event)} has a keyCode other than 229`;
      }
      if (!seen.some((event) => event.startsWith('input:insertCompositionText'))) return 'the composition sent no input of type insertCompositionText';
      return null;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        for (const kind of [InputEvent, KeyboardEvent]) Object.defineProperty(kind.prototype, 'isComposing', { get: () => false, configurable: true });
      });
    },
  }),

  fact({
    id: 'href-schemes-after-stripping',
    says: 'A link still has the javascript: scheme with spaces or control characters before it or tabs and newlines inside it, and not with a no-break space, a zero-width space, or a control character inside the scheme.',
    relied: [
      { file: markdown, text: 'code if code <= 0x20 -> True' },
    ],
    observe: (page) =>
      page.evaluate(() => {
        const protocol = (href: string) => {
          const link = document.createElement('a');
          link.setAttribute('href', href);
          return link.protocol;
        };
        const hrefs = {
          space: ' javascript:x',
          control: '\u0001javascript:x',
          controlThenSpace: '\u001f javascript:x',
          tab: 'java\tscript:x',
          newline: 'java\nscript:x',
          nul: '\u0000javascript:x',
          capitals: 'JaVaScRiPt:x',
          noBreakSpace: ' javascript:x',
          zeroWidthSpace: '​javascript:x',
          controlInside: 'jav\u0001ascript:x',
        };
        return Object.fromEntries(Object.entries(hrefs).map(([name, href]) => [name, protocol(href)]));
      }),
    holds: (seen) => {
      const scripted = ['space', 'control', 'controlThenSpace', 'tab', 'newline', 'nul', 'capitals'];
      const harmless = ['noBreakSpace', 'zeroWidthSpace', 'controlInside'];
      const wrong = [
        ...scripted.filter((name) => seen[name] !== 'javascript:').map((name) => `${name} is no longer javascript: (${JSON.stringify(seen[name])})`),
        ...harmless.filter((name) => seen[name] === 'javascript:').map((name) => `${name} is now javascript:`),
      ];
      return wrong.length === 0 ? null : wrong.join('; ');
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        Object.defineProperty(HTMLAnchorElement.prototype, 'protocol', { get: () => ':', configurable: true });
      });
    },
  }),

  fact({
    id: 'range-boxes',
    says: 'A range over the line break that ends a line of a pre has a box at the end of that line, and a range over any one character, the space at a soft wrap too, has a box.',
    relied: [
      { file: ffi, text: 'const end = letter.getClientRects()[0];' },
      { file: ffi, text: 'const after = one.getClientRects()[0];' },
    ],
    html:
      '<pre id="pre" style="margin:0;font:16px monospace;width:200px">ab\ncd\n</pre>' +
      '<p id="wrap" style="margin:0;font:16px monospace;width:80px">aaaa bbbb cccc</p>',
    observe: (page) =>
      page.evaluate(() => {
        const text = document.getElementById('pre')!.firstChild!;
        const over = (node: Node, from: number, to: number) => {
          const range = document.createRange();
          range.setStart(node, from);
          range.setEnd(node, to);
          return [...range.getClientRects()].map((box) => ({ left: box.left, top: box.top, width: box.width }));
        };
        const wrapped = document.getElementById('wrap')!.firstChild!;
        const withNoBox: number[] = [];
        for (let offset = 0; offset < 14; offset++) if (over(wrapped, offset, offset + 1).length === 0) withNoBox.push(offset);
        return { lineBreak: over(text, 2, 3), letterBefore: over(text, 1, 2), withNoBox };
      }),
    holds: (seen) => {
      if (seen.lineBreak.length === 0) return 'a range over the line break at the end of a line has no box';
      const [lineBreak] = seen.lineBreak;
      const [letter] = seen.letterBefore;
      if (lineBreak.top !== letter.top || lineBreak.left < letter.left + letter.width - 1) {
        return `the line break is boxed at ${JSON.stringify(lineBreak)}, and the app expects it at the end of the line of the letter before it, ${JSON.stringify(letter)}`;
      }
      if (seen.withNoBox.length > 0) return `a range over one character has no box at offsets ${JSON.stringify(seen.withNoBox)} of the wrapped text`;
      return null;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
      });
    },
  }),

  fact({
    id: 'collapsed-range-in-an-empty-element',
    says: 'A collapsed range in an element with no text has no box, so a caret there is measured from the element. (A collapsed range at a soft wrap does have a box in Chromium, which the comment in caretBox denies.) A range over a letter of the same page does have one, so a page that measures nothing would not pass.',
    relied: [{ file: ffi, text: 'return new DOMRect(box.left, box.top, 0, Math.min(box.height, lineHeight(element)));' }],
    html: '<p id="empty" style="margin:0;font:16px monospace"></p><p id="letters" style="margin:0;font:16px monospace">abc</p>',
    observe: (page) =>
      page.evaluate(() => {
        const boxes = (element: HTMLElement, from: number, to: number) => {
          const range = document.createRange();
          range.setStart(element.firstChild ?? element, from);
          range.setEnd(element.firstChild ?? element, to);
          return range.getClientRects().length;
        };
        return { empty: boxes(document.getElementById('empty')!, 0, 0), letter: boxes(document.getElementById('letters')!, 0, 1) };
      }),
    holds: (seen) => {
      if (!finite(seen?.empty, seen?.letter)) return `the boxes of the ranges were read as ${JSON.stringify(seen)}`;
      if (seen.letter < 1) return `a range over a letter has ${seen.letter} boxes, so this looked at nothing`;
      return seen.empty === 0 ? null : `a collapsed range in an empty element has ${seen.empty} boxes`;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        Range.prototype.getClientRects = () => [new DOMRect(0, 0, 1, 1)] as unknown as DOMRectList;
      });
    },
  }),

  fact({
    id: 'lh-unit',
    says: 'The lh unit is the computed line height of the element.',
    relied: [{ file: css, text: 'margin-top: calc((1lh - 1em) / 2);' }],
    html: '<div id="a" style="font:20px/30px serif;margin-top:1lh">x</div>',
    observe: (page) => page.evaluate(() => getComputedStyle(document.getElementById('a')!).marginTop),
    holds: (seen) => (seen === '30px' ? null : instead('1lh on an element with a line height of 30px', '30px', seen)),
    breaks: async (page) => {
      await page.addStyleTag({ content: '#a { margin-top: 0 !important; }' });
    },
  }),

  fact({
    id: 'translate-property',
    says: 'The individual translate property moves an element, and reads back as written.',
    relied: [{ file: ffi, text: 'box.style.translate = `${x}px ${y}px`;' }],
    html: '<div id="a" style="position:relative;margin:0;translate:10px 20px">x</div>',
    observe: (page) =>
      page.evaluate(() => {
        const box = document.getElementById('a')!;
        const { left, top } = box.getBoundingClientRect();
        box.style.translate = '';
        const home = box.getBoundingClientRect();
        return { computed: getComputedStyle(box).translate, moved: [left - home.left, top - home.top] };
      }),
    holds: (seen) => (same(seen, { computed: 'none', moved: [10, 20] }) ? null : instead('the translate once cleared, and how far it had moved the element', { computed: 'none', moved: [10, 20] }, seen)),
    breaks: async (page) => {
      await page.addStyleTag({ content: '#a { translate: none !important; }' });
    },
  }),

  fact({
    id: 'highlight-system-colours',
    says: 'Highlight and HighlightText are two different colours, and a gradient of one system colour is accepted as a background.',
    relied: [
      { file: css, text: '  background-color: Highlight;\n  color: HighlightText;' },
      { file: ffi, text: '"linear-gradient(Highlight, Highlight)"' },
    ],
    observe: (page) =>
      page.evaluate(() => {
        const computed = (style: string) => {
          const box = document.createElement('div');
          box.setAttribute('style', style);
          document.body.append(box);
          const { color, backgroundImage } = getComputedStyle(box);
          box.remove();
          return { color, backgroundImage };
        };
        return {
          highlight: computed('color:Highlight').color,
          text: computed('color:HighlightText').color,
          gradient: computed('background-image:linear-gradient(Highlight, Highlight)').backgroundImage,
        };
      }),
    holds: (seen) => {
      if (seen.highlight === seen.text) return `Highlight and HighlightText are both ${seen.highlight}`;
      if (!/^rgba?\(/.test(seen.highlight) || !/^rgba?\(/.test(seen.text)) return `the system colours are ${seen.highlight} and ${seen.text}, not colours`;
      if (!seen.gradient.startsWith('linear-gradient(')) return `a gradient of Highlight computed to ${JSON.stringify(seen.gradient)}`;
      return null;
    },
    breaks: async (page) => {
      await page.addStyleTag({ content: 'div { color: rgb(0, 0, 0) !important; background-image: none !important; }' });
    },
  }),

  fact({
    id: 'normal-line-height-is-a-word',
    says: 'A line height of normal computes to the word normal, not to a length, so code that reads it as a length has to fall back to the font size.',
    relied: [{ file: ffi, text: 'return parseFloat(style.lineHeight) || 1.2 * parseFloat(style.fontSize);' }],
    html: '<p id="n" style="font:20px serif">x</p><p id="p" style="font:20px/30px serif">x</p>',
    observe: (page) =>
      page.evaluate(() => ({
        normal: getComputedStyle(document.getElementById('n')!).lineHeight,
        length: getComputedStyle(document.getElementById('p')!).lineHeight,
      })),
    holds: (seen) => (same(seen, { normal: 'normal', length: '30px' }) ? null : instead('the computed line heights of a font with normal and with 30px', { normal: 'normal', length: '30px' }, seen)),
    breaks: async (page) => {
      await page.addStyleTag({ content: 'p { line-height: 25px !important; }' });
    },
  }),

  fact({
    id: 'canvas-text-width-matches-the-page',
    says: 'The width canvas measureText gives for a text in a font is the width the page draws it at, kerning pairs included.',
    relied: [{ file: ffi, text: 'return pen.measureText(text).width;' }],
    html: '<span id="s" style="font:20px serif;white-space:pre"></span>',
    observe: (page) =>
      page.evaluate(() => {
        const pen = document.createElement('canvas').getContext('2d')!;
        pen.font = '20px serif';
        const span = document.getElementById('s')!;
        const worst = { text: '', gap: 0 };
        for (const text of ['AV', 'To', 'Ty', 'LT', 'AVAVAV', '- ', '10. ', '- [ ] ', '. ', 'Hello, world']) {
          span.textContent = text;
          const gap = Math.abs(pen.measureText(text).width - span.getBoundingClientRect().width);
          if (gap > worst.gap) {
            worst.text = text;
            worst.gap = gap;
          }
        }
        return worst;
      }),
    holds: (seen) => (seen.gap < 0.05 ? null : `canvas measured ${JSON.stringify(seen.text)} ${seen.gap.toFixed(3)}px away from the page`),
    breaks: async (page) => {
      await page.evaluate(() => {
        const real = CanvasRenderingContext2D.prototype.measureText;
        CanvasRenderingContext2D.prototype.measureText = function (this: CanvasRenderingContext2D, text: string) {
          return { width: real.call(this, text).width * 1.1 } as TextMetrics;
        };
      });
    },
  }),

  fact({
    id: 'click-count-in-detail',
    says: 'The mousedown of a quick triple click has a detail of 1, 2 and 3.',
    relied: [{ file: ffi, text: 'press.detail > 2' }],
    html: '<textarea id="t" style="position:absolute;left:10px;top:10px;width:300px;height:100px;font:16px monospace;padding:0;border:0">hello world foo</textarea>',
    observe: async (page) => {
      await page.evaluate(() => {
        const log: number[] = [];
        (window as unknown as { log: number[] }).log = log;
        document.getElementById('t')!.addEventListener('mousedown', (event) => log.push(event.detail));
      });
      await page.mouse.click(77, 18, { clickCount: 3 });
      return page.evaluate(() => (window as unknown as { log: number[] }).log);
    },
    holds: (seen) => (same(seen, [1, 2, 3]) ? null : instead('the detail of the three mousedowns of a triple click', [1, 2, 3], seen)),
    breaks: async (page) => {
      await page.evaluate(() => {
        Object.defineProperty(MouseEvent.prototype, 'detail', { get: () => 1, configurable: true });
      });
    },
  }),

  fact({
    id: 'double-and-triple-click-selection',
    says: 'A double click in a text field selects the word under it without the space after, and a triple click selects its whole line with the line break.',
    relied: [{ file: ffi, text: 'press.detail > 2' }],
    html: '<textarea id="t" style="position:absolute;left:10px;top:10px;width:300px;height:100px;font:16px monospace;padding:0;border:0">hello world foo\nsecond line</textarea>',
    observe: async (page) => {
      const selected = () =>
        page.evaluate(() => {
          const field = document.getElementById('t') as HTMLTextAreaElement;
          return field.value.slice(field.selectionStart, field.selectionEnd);
        });
      await page.mouse.click(77, 18, { clickCount: 2 });
      const word = await selected();
      await page.mouse.click(77, 18, { clickCount: 3 });
      return { word, line: await selected() };
    },
    holds: (seen) => (same(seen, { word: 'world', line: 'hello world foo\n' }) ? null : instead('the text selected by a double and a triple click on "world"', { word: 'world', line: 'hello world foo\n' }, seen)),
    breaks: async (page) => {
      await page.evaluate(() => {
        addEventListener('mousedown', (event) => event.preventDefault(), true);
      });
    },
  }),

  fact({
    id: 'invisible-field-keeps-the-focus',
    says: 'A text field with no height, no opacity and its overflow hidden can be focused and typed into, and one that is display:none or visibility:hidden cannot.',
    relied: [{ file: css, text: '.editor.part.idle {' }],
    html:
      '<div id="idle" style="height:0;margin:0;opacity:0;overflow:hidden"><textarea id="a"></textarea></div>' +
      '<div style="display:none"><textarea id="b"></textarea></div>' +
      '<div style="visibility:hidden"><textarea id="c"></textarea></div>',
    observe: async (page) => {
      const typedInto = async (id: string) => {
        await page.evaluate((target) => document.getElementById(target)!.focus(), id);
        await page.keyboard.type('x');
        return page.evaluate((target) => ({ focused: document.activeElement!.id === target, value: (document.getElementById(target) as HTMLTextAreaElement).value }), id);
      };
      return { idle: await typedInto('a'), displayNone: await typedInto('b'), visibilityHidden: await typedInto('c') };
    },
    holds: (seen) => {
      const expected = { idle: { focused: true, value: 'x' }, displayNone: { focused: false, value: '' }, visibilityHidden: { focused: false, value: '' } };
      return same(seen, expected) ? null : instead('whether each field took the focus and the typing', expected, seen);
    },
    breaks: async (page) => {
      await page.addStyleTag({ content: '#idle { display: none !important; }' });
    },
  }),

  fact({
    id: 'page-selection-leaves-the-field-focused',
    says: "Putting the page's selection in drawn text leaves a text field focused and resets its own selection to the start, and setSelectionRange puts it back with its direction.",
    relied: [
      { file: ffi, text: 'selection.collapse(node, offset);' },
      { file: ffi, text: 'control.setSelectionRange(selectionStart, selectionEnd, selectionDirection);' },
    ],
    html: '<p id="p">some drawn text</p><textarea id="t">hello world</textarea>',
    observe: (page) =>
      page.evaluate(() => {
        const field = document.getElementById('t') as HTMLTextAreaElement;
        const now = () => [field.selectionStart, field.selectionEnd, field.selectionDirection];
        field.focus();
        field.setSelectionRange(2, 5, 'backward');
        getSelection()!.collapse(document.getElementById('p')!.firstChild, 3);
        const focusedAfter = document.activeElement === field;
        const reset = now();
        field.setSelectionRange(2, 5, 'backward');
        return { focusedAfter, reset, restored: now(), focusedAfterRestore: document.activeElement === field };
      }),
    holds: (seen) => {
      const expected = { focusedAfter: true, reset: [0, 0, 'forward'], restored: [2, 5, 'backward'], focusedAfterRestore: true };
      return same(seen, expected) ? null : instead('the field after the page selection moved, and after its own selection was put back', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        const real = Selection.prototype.collapse;
        Selection.prototype.collapse = function (this: Selection, node: Node | null, offset?: number) {
          real.call(this, node, offset);
          (document.activeElement as HTMLElement).blur();
        };
      });
    },
  }),

  fact({
    id: 'highlight-api',
    says: 'The CSS Custom Highlight API paints a range with the colours of ::highlight, and draws nothing for the line break at the end of a line.',
    relied: [
      { file: platform, text: 'return typeof Highlight === "function" && globalThis.CSS?.highlights !== undefined;' },
      { file: ffi, text: 'CSS.highlights.set(SELECTION, new Highlight(range));' },
      { file: css, text: '::highlight(nullpad-selection) {' },
    ],
    html:
      '<style>body{margin:0;background:#fff;color:#000} ::highlight(h){background-color:rgb(255,0,0);color:rgb(0,0,255)} ' +
      '.b{font:20px monospace;white-space:pre;width:300px;height:30px;line-height:30px}</style>' +
      '<div class="b" id="one">aaa</div><div class="b" id="two">bbb</div>',
    observe: async (page) => {
      const api = await page.evaluate(() => {
        const first = document.getElementById('one')!;
        const range = new Range();
        range.setStart(first.firstChild!, 1);
        range.setEnd(document.getElementById('two')!.firstChild!, 2);
        CSS.highlights.set('h', new Highlight(range));
        return { highlight: typeof Highlight, registry: typeof CSS.highlights, background: getComputedStyle(first, '::highlight(h)').backgroundColor };
      });
      const png = await page.screenshot({ clip: { x: 0, y: 0, width: 300, height: 60 }, type: 'png' });
      const red = await page.evaluate(async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        const { data, width } = context.getImageData(0, 0, bitmap.width, bitmap.height);
        const isRed = (x: number) => data[(15 * width + x) * 4]! > 200 && data[(15 * width + x) * 4 + 1]! < 60;
        let inside = 0;
        let pastText = 0;
        for (let x = 12; x < 36; x++) if (isRed(x)) inside++;
        for (let x = 40; x < 300; x++) if (isRed(x)) pastText++;
        return { inside, pastText };
      }, png.toString('base64'));
      return { ...api, ...red };
    },
    holds: (seen) => {
      if (seen.highlight !== 'function' || seen.registry !== 'object') return `Highlight is a ${seen.highlight} and CSS.highlights is a ${seen.registry}`;
      if (seen.background !== 'rgb(255, 0, 0)') return `the ::highlight background computed to ${JSON.stringify(seen.background)}`;
      if (seen.inside === 0) return 'the highlighted text was not painted';
      if (seen.pastText > 0) return `${seen.pastText} pixels were painted past the end of the first line, where its line break is`;
      return null;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        CSS.highlights.set = function (this: HighlightRegistry) {
          return this;
        };
      });
    },
  }),

  fact({
    id: 'desktop-has-hover',
    says: 'A desktop browser matches (hover: hover) and (pointer: fine), and has no touch points.',
    relied: [{ file: platform, text: 'const query = "(hover: hover) and (pointer: fine)";' }],
    observe: (page) =>
      page.evaluate(() => ({
        matches: matchMedia('(hover: hover) and (pointer: fine)').matches,
        always: matchMedia('(min-width: 1px)').matches,
        never: matchMedia('(min-width: 100000px)').matches,
        touchPoints: navigator.maxTouchPoints,
      })),
    holds: (seen) => {
      const asked = mediaAnswers(seen);
      if (asked) return asked;
      if (seen.touchPoints !== 0) return `this browser has ${seen.touchPoints} touch points, so it is not a desktop one and this looked at nothing`;
      return seen.matches ? null : 'a desktop browser does not match (hover: hover) and (pointer: fine)';
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        const ask = window.matchMedia.bind(window);
        window.matchMedia = (query: string) => (query.includes('hover: hover') ? ({ matches: false, media: query } as MediaQueryList) : ask(query));
      });
    },
  }),

  fact({
    id: 'touch-device-has-no-hover',
    says: 'A touch device does not match (hover: hover) and (pointer: fine), so it is not taken to have a keyboard.',
    relied: [{ file: platform, text: 'const query = "(hover: hover) and (pointer: fine)";' }],
    context: { hasTouch: true, isMobile: true },
    observe: (page) =>
      page.evaluate(() => ({
        matches: matchMedia('(hover: hover) and (pointer: fine)').matches,
        always: matchMedia('(min-width: 1px)').matches,
        never: matchMedia('(min-width: 100000px)').matches,
        touchPoints: navigator.maxTouchPoints,
      })),
    holds: (seen) => {
      const asked = mediaAnswers(seen);
      if (asked) return asked;
      if (!(seen.touchPoints > 0)) return `this browser has ${seen.touchPoints} touch points, so it is not a touch device and this looked at nothing`;
      return seen.matches ? 'a touch device matches (hover: hover) and (pointer: fine)' : null;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        const ask = window.matchMedia.bind(window);
        window.matchMedia = (query: string) => (query.includes('hover: hover') ? ({ matches: true, media: query } as MediaQueryList) : ask(query));
      });
    },
  }),

  fact({
    id: 'platform-names-apple-devices',
    says: 'navigator.platform names the operating system the user agent names, and starts with Mac, iPhone or iPad on exactly the Apple ones, so Ctrl is not taken for Cmd anywhere else. Only the Chromium this runs in can be looked at: an override of the user agent leaves navigator.platform as it was.',
    relied: [
      { file: platform, text: 'return /Mac|iPhone|iPad/.test(navigator.platform);' },
      { file: ffi, text: 'navigator.platform.startsWith("Mac")' },
    ],
    observe: (page) =>
      page.evaluate(() => ({
        platform: navigator.platform,
        agent: navigator.userAgent,
      })),
    holds: (seen) => {
      if (typeof seen?.platform !== 'string' || typeof seen?.agent !== 'string') return `navigator.platform and the user agent were read as ${JSON.stringify(seen)}`;
      const [named, ...rest] = systems.filter(([inAgent]) => inAgent.test(seen.agent));
      if (!named) return `the user agent ${JSON.stringify(seen.agent)} names no operating system this knows, so this looked at nothing`;
      if (rest.length > 0) return `the user agent ${JSON.stringify(seen.agent)} names ${[named, ...rest].map(([, , system]) => system).join(' and ')}, so this cannot tell which system to hold navigator.platform to`;
      const [, byPlatform, system] = named;
      return byPlatform.test(seen.platform) ? null : `navigator.platform is ${JSON.stringify(seen.platform)}, and the user agent names ${system}`;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel', configurable: true });
        Object.defineProperty(Navigator.prototype, 'userAgent', { get: () => 'Mozilla/5.0 (X11; Linux x86_64)', configurable: true });
      });
    },
  }),

  fact({
    id: 'shortcut-keys-have-key-and-code',
    says: 'Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y send keydown with key z, Z and y and code KeyZ, KeyZ and KeyY.',
    relied: [
      { file: platform, text: 'const typed = event.key.toLowerCase();' },
      { file: platform, text: 'event.code === "Key" + letter.toUpperCase()' },
      { file: surface, text: 'editor.is_key(name, code, "z"),\n    editor.is_key(name, code, "y")' },
    ],
    html: '<textarea id="t"></textarea>',
    observe: async (page) => {
      await page.evaluate(() => {
        const log: string[][] = [];
        (window as unknown as { log: string[][] }).log = log;
        const field = document.getElementById('t')!;
        field.addEventListener('keydown', (event) => {
          if (event.key.length === 1) log.push([event.key, event.code]);
        });
        field.focus();
      });
      for (const key of ['Control+z', 'Control+Shift+Z', 'Control+y']) await page.keyboard.press(key);
      return page.evaluate(() => (window as unknown as { log: string[][] }).log);
    },
    holds: (seen) => {
      const expected = [['z', 'KeyZ'], ['Z', 'KeyZ'], ['y', 'KeyY']];
      return same(seen, expected) ? null : instead('the [key, code] of Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        Object.defineProperty(KeyboardEvent.prototype, 'code', { get: () => '', configurable: true });
      });
    },
  }),

  fact({
    id: 'marker-line-height-zero',
    says: 'li::marker { line-height: 0 } stops the marker making a list item taller than its content.',
    relied: [{ file: css, text: 'li::marker' }],
    html:
      '<style>ul{margin:0;padding-left:30px;font:16px/1.7 serif} li h6{font:10px/1.2 serif;margin:0} .zero li::marker{line-height:0}</style>' +
      '<ul id="a"><li><h6>x</h6></li></ul><ul id="b" class="zero"><li><h6>x</h6></li></ul>',
    observe: (page) =>
      page.evaluate(() => {
        const height = (selector: string) => Math.round(document.querySelector(selector)!.getBoundingClientRect().height * 100) / 100;
        return { withMarker: height('#a li'), zeroMarker: height('#b li'), content: height('#a h6') };
      }),
    holds: (seen) => {
      if (!finite(seen?.withMarker, seen?.zeroMarker, seen?.content) || !(seen.content > 0)) return `the heights of the list items were read as ${JSON.stringify(seen)}, so this looked at nothing`;
      if (seen.zeroMarker !== seen.content) return `a list item with a zero line-height marker is ${seen.zeroMarker}px tall, and its content is ${seen.content}px`;
      if (seen.withMarker <= seen.content) return `a list item with an ordinary marker is ${seen.withMarker}px tall, no taller than its content at ${seen.content}px, so this looked at nothing`;
      return null;
    },
    breaks: async (page) => {
      await page.addStyleTag({ content: '.zero li::marker { line-height: 1.7 !important; }' });
    },
  }),

  fact({
    id: 'hidden-page-fires-visibilitychange',
    says: 'A page that is hidden gets a visibilitychange event on its document, and document.visibilityState already says hidden when it runs. Headless Chromium does not hide a page for another tab brought in front of it, so closing the page is the hiding that is looked at.',
    relied: [
      { file: platform, text: 'document.addEventListener("visibilitychange", () => {' },
      { file: platform, text: 'if (document.visibilityState === "hidden") run();' },
    ],
    observe: async (page) => {
      const heard: string[] = [];
      page.on('console', (message) => heard.push(message.text()));
      await page.evaluate(() => {
        document.addEventListener('visibilitychange', () => console.log(`visibilitychange ${document.visibilityState}`));
        console.log('listening');
      });
      await page.close();
      for (let wait = 0; wait < 40 && !heard.includes('visibilitychange hidden'); wait++) await new Promise((done) => setTimeout(done, 50));
      return heard;
    },
    holds: (seen) => {
      if (!Array.isArray(seen) || !seen.includes('listening')) return `the console of the page said ${JSON.stringify(seen)}, so nothing could be heard and this looked at nothing`;
      const changes = seen.filter((message) => typeof message === 'string' && message.startsWith('visibilitychange'));
      return changes.includes('visibilitychange hidden') ? null : `closing the page fired ${JSON.stringify(changes)}, and no visibilitychange said hidden`;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        const add = document.addEventListener.bind(document);
        document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
          if (type !== 'visibilitychange') add(type, listener, options);
        }) as unknown as typeof document.addEventListener;
      });
    },
  }),

  fact({
    id: 'clipboard-write-is-a-promise-and-secure-only',
    says: 'navigator.clipboard.writeText returns a promise and throws nothing, whether the page may write or not, and writes the text when it may. A page that is not a secure context has no navigator.clipboard, so the call is skipped.',
    relied: [{ file: platform, text: 'navigator.clipboard?.writeText(text).catch(() => {});' }],
    url: 'https://nullpad.test/',
    observe: async (page) => {
      const write = () =>
        page.evaluate(async () => {
          let promise: Promise<void> | undefined;
          try {
            promise = navigator.clipboard.writeText('nullpad');
          } catch (error) {
            return { threw: String(error), returned: 'nothing', settled: 'never' };
          }
          const returned = typeof promise?.then;
          try {
            await promise;
            return { threw: '', returned, settled: 'resolved' };
          } catch (error) {
            return { threw: '', returned, settled: `rejected ${(error as Error).name}` };
          }
        });
      const refused = await write();
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://nullpad.test' });
      const allowed = await write();
      const read = await page.evaluate(() => navigator.clipboard.readText());
      const plain = await page.context().newPage();
      await plain.setContent('<!doctype html><body></body>');
      const insecure = await plain.evaluate(() => ({ secure: isSecureContext, clipboard: typeof navigator.clipboard }));
      return { refused, allowed, read, insecure };
    },
    holds: (seen) => {
      if (typeof seen?.refused?.returned !== 'string' || typeof seen?.allowed?.settled !== 'string' || typeof seen?.insecure?.clipboard !== 'string') {
        return `the clipboard was read as ${JSON.stringify(seen)}`;
      }
      if (seen.insecure.secure !== false) return 'the page that was to be insecure is a secure context, so this looked at nothing';
      if (seen.insecure.clipboard !== 'undefined') return `a page that is not a secure context has navigator.clipboard as a ${seen.insecure.clipboard}`;
      if (seen.refused.threw !== '' || seen.refused.returned !== 'function') return `a write that was not allowed ${seen.refused.threw ? `threw ${seen.refused.threw}` : `returned ${seen.refused.returned}`}, and the app expects a promise`;
      if (seen.allowed.settled !== 'resolved') return `a write that was allowed ${seen.allowed.settled}`;
      return seen.read === 'nullpad' ? null : `the clipboard held ${JSON.stringify(seen.read)} after the text was written`;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        Object.defineProperty(Clipboard.prototype, 'writeText', {
          value: () => {
            throw new DOMException('not allowed', 'NotAllowedError');
          },
          configurable: true,
        });
      });
    },
  }),

  fact({
    id: 'scroll-into-view-nearest-moves-least',
    says: 'scrollIntoView({ block: "nearest" }) leaves the page where it is when the element is in view, and otherwise scrolls only until the element touches the edge it came from: the bottom edge for an element below, the top edge for one above.',
    relied: [{ file: ffi, text: 'control?.scrollIntoView({ block: "nearest" });' }],
    html: '<body style="margin:0"><div style="height:3000px"></div><textarea id="t" style="display:block;height:100px;width:300px"></textarea><div style="height:3000px"></div></body>',
    observe: (page) =>
      page.evaluate(() => {
        const field = document.getElementById('t')!;
        scrollTo(0, 0);
        field.scrollIntoView({ block: 'nearest' });
        const fromAbove = { bottom: field.getBoundingClientRect().bottom, viewport: innerHeight };
        scrollTo(0, field.offsetTop - 100);
        const before = scrollY;
        field.scrollIntoView({ block: 'nearest' });
        const inView = { before, after: scrollY };
        scrollTo(0, field.offsetTop + 2000);
        field.scrollIntoView({ block: 'nearest' });
        return { fromAbove, inView, fromBelow: { top: field.getBoundingClientRect().top } };
      }),
    holds: (seen) => {
      if (!finite(seen?.fromAbove?.bottom, seen?.fromAbove?.viewport, seen?.inView?.before, seen?.inView?.after, seen?.fromBelow?.top)) {
        return `the scroll positions were read as ${JSON.stringify(seen)}`;
      }
      if (!(seen.inView.before > 0)) return `the page was at ${seen.inView.before} before the element in view was scrolled to, so this looked at nothing`;
      if (seen.inView.after !== seen.inView.before) return `an element in view moved the page from ${seen.inView.before} to ${seen.inView.after}`;
      if (Math.abs(seen.fromAbove.bottom - seen.fromAbove.viewport) > 1) return `an element below the window ended with its bottom at ${seen.fromAbove.bottom}, and the window is ${seen.fromAbove.viewport} tall`;
      return Math.abs(seen.fromBelow.top) <= 1 ? null : `an element above the window ended with its top at ${seen.fromBelow.top}, and the app expects 0`;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        const scroll = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (this: Element) {
          scroll.call(this, { block: 'center' });
        };
      });
    },
  }),

  fact({
    id: 'scroll-is-heard-before-the-frames-callbacks',
    says: 'A scroll of an element that happens before a frame is drawn is told by its scroll event before the requestAnimationFrame callbacks of that frame run, so a listener that holds the page until that callback undoes it.',
    relied: [{ file: ffi, text: 'page.addEventListener("scroll", keep);\n  requestAnimationFrame(() => page.removeEventListener("scroll", keep));' }],
    html: '<div id="page" style="height:200px;overflow:auto"><div style="height:2000px"></div></div>',
    observe: (page) =>
      page.evaluate(
        () =>
          new Promise<string[]>((done) => {
            const page = document.getElementById('page')!;
            const heard: string[] = [];
            page.addEventListener('scroll', () => heard.push('scroll'));
            requestAnimationFrame(() => {
              heard.push('frame');
              setTimeout(() => done(heard), 100);
            });
            page.scrollTop = 300;
          }),
      ),
    holds: (seen) => {
      const expected = ['scroll', 'frame'];
      return same(seen, expected) ? null : instead('what the page heard of a scroll and of the next frame, in order', expected, seen);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        window.requestAnimationFrame = (callback: FrameRequestCallback) => {
          queueMicrotask(() => callback(0));
          return 0;
        };
      });
    },
  }),

  fact({
    id: 'element-from-point-sees-through-pointer-events-none',
    says: 'document.elementFromPoint takes a point of the window, scrolled containers included, and names the element drawn there, passing over one with pointer-events: none that covers it.',
    relied: [
      { file: ffi, text: 'const target = document.elementFromPoint(x, y)?.closest("[draggable], [data-row]");' },
      { file: ffi, text: 'const hit = document.elementFromPoint(inX, inY);' },
    ],
    html:
      '<div id="page" style="position:absolute;left:0;top:0;width:300px;height:200px;overflow:auto">' +
      '<div id="r1" style="height:100px">one</div><div id="r2" style="height:100px">two</div><div id="r3" style="height:100px">three</div><div id="r4" style="height:100px">four</div></div>' +
      '<div id="cover" style="position:fixed;left:0;top:100px;width:300px;height:100px;pointer-events:none"></div>',
    observe: (page) =>
      page.evaluate(() => {
        const id = (x: number, y: number) => document.elementFromPoint(x, y)?.id ?? null;
        document.getElementById('page')!.scrollTop = 150;
        const throughCover = id(10, 120);
        const above = id(10, 20);
        const cover = document.getElementById('cover')!;
        cover.style.pointerEvents = 'auto';
        const onCover = id(10, 120);
        cover.style.pointerEvents = 'none';
        return { throughCover, above, onCover };
      }),
    holds: (seen) => {
      if (seen?.onCover !== 'cover') return `the cover was found as ${JSON.stringify(seen?.onCover)} where it is drawn, so this looked at nothing`;
      const expected = { throughCover: 'r3', above: 'r2' };
      const got = { throughCover: seen.throughCover, above: seen.above };
      return same(got, expected) ? null : instead('the elements at two points of a page scrolled by 150, one under a pointer-events: none cover', expected, got);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        const hit = document.elementFromPoint.bind(document);
        document.elementFromPoint = (x: number, y: number) => {
          const cover = document.getElementById('cover')!;
          cover.style.pointerEvents = 'auto';
          const found = hit(x, y);
          cover.style.pointerEvents = 'none';
          return found;
        };
      });
    },
  }),

  fact({
    id: 'element-from-point-is-null-outside-the-window',
    says: 'document.elementFromPoint gives null for a point outside the window, as a drag that left it reaches, and an element for a point inside.',
    relied: [{ file: ffi, text: 'const target = document.elementFromPoint(x, y)?.closest("[draggable], [data-row]");' }],
    html: '<body style="margin:0"><div id="all" style="width:100vw;height:100vh"></div></body>',
    observe: (page) =>
      page.evaluate(() => {
        const at = (x: number, y: number) => document.elementFromPoint(x, y)?.tagName ?? null;
        return { inside: at(10, 10), outside: [at(-5, 10), at(10, -5), at(innerWidth + 5, 10), at(10, innerHeight + 5)] };
      }),
    holds: (seen) => {
      if (typeof seen?.inside !== 'string' || !Array.isArray(seen.outside)) return `the elements at the points were read as ${JSON.stringify(seen)}`;
      const expected = [null, null, null, null];
      return same(seen.outside, expected) ? null : instead('the elements at four points just outside the window', expected, seen.outside);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        document.elementFromPoint = () => document.body;
      });
    },
  }),

  fact({
    id: 'drop-carries-the-dragged-text',
    says: 'Text that a dragstart handler sets as text/plain, with effectAllowed copyMove, is what getData("text/plain") gives on the drop event of another element.',
    relied: [
      { file: ffi, text: 'event.dataTransfer.setData("text/plain", value.slice(selectionStart, selectionEnd));' },
      { file: ffi, text: 'const text = drop.dataTransfer?.getData("text/plain") ?? "";' },
    ],
    html: dragPage,
    observe: async (page) => (await dragWith(page, [[]]))[0],
    holds: (seen) => {
      if (typeof seen !== 'object' || seen === null || !('dropped' in seen) || seen.dropped !== true) return `no drop was heard (${JSON.stringify(seen)}), so this looked at nothing`;
      return seen.text === 'carried text' ? null : `the drop gave ${JSON.stringify(seen.text)} for the text that was set as carried text`;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        DataTransfer.prototype.getData = () => '';
      });
    },
  }),

  fact({
    id: 'drop-reports-the-copy-key',
    says: 'The drop event of a drag made with Control held has ctrlKey and not altKey, one made with Alt held has altKey and not ctrlKey, and one made with neither has neither, so the key that a text field copies with can be read from it. That Alt is the key on a Mac is the platform and not a page that can look.',
    relied: [{ file: ffi, text: 'const copy = navigator.platform.startsWith("Mac") ? drop.altKey : drop.ctrlKey;' }],
    html: dragPage,
    observe: async (page) => {
      const [plain, control, alt] = await dragWith(page, [[], ['Control'], ['Alt']]);
      return { plain, control, alt };
    },
    holds: (seen) => {
      for (const drop of [seen?.plain, seen?.control, seen?.alt]) {
        if (drop?.dropped !== true) return `a drop was not heard (${JSON.stringify(seen)}), so this looked at nothing`;
      }
      const expected = { plain: [false, false], control: [true, false], alt: [false, true] };
      const got = { plain: [seen.plain.ctrl, seen.plain.alt], control: [seen.control.ctrl, seen.control.alt], alt: [seen.alt.ctrl, seen.alt.alt] };
      return same(got, expected) ? null : instead('the [ctrlKey, altKey] of a drop made with no key, with Control and with Alt', expected, got);
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        Object.defineProperty(MouseEvent.prototype, 'ctrlKey', { get: () => false, configurable: true });
      });
    },
  }),

  fact({
    id: 'middle-release-pastes-on-linux',
    says: 'A middle press on a text field gives mousedown and mouseup with button 1, and on Linux the release is followed by a paste event and a beforeinput and input of type insertFromPaste, which scroll the page to the field. Off Linux only the first half is looked at. The text that is pasted is the primary selection, which headless Chromium has none of, so only the events can be looked at.',
    relied: [
      { file: ffi, text: 'if (press.button === 1 && (grabbed || target instanceof HTMLTextAreaElement)) return none;' },
      { file: ffi, text: 'requestAnimationFrame(() => page.removeEventListener("scroll", keep));' },
    ],
    html: '<textarea id="t" style="width:300px;height:100px">abc</textarea>',
    observe: async (page) => {
      await page.evaluate(() => {
        const log: string[] = [];
        (window as unknown as { log: string[] }).log = log;
        for (const type of ['mousedown', 'mouseup', 'auxclick', 'paste', 'beforeinput', 'input']) {
          document.addEventListener(
            type,
            (event) => log.push(`${type}${(event as MouseEvent).button === 1 ? ':1' : ''}${(event as InputEvent).inputType ? `:${(event as InputEvent).inputType}` : ''}`),
            true,
          );
        }
      });
      await page.click('#t', { button: 'middle' });
      await page.waitForFunction(() => (window as unknown as { log: string[] }).log.includes('input:insertFromPaste'), undefined, { timeout: 500 }).catch(() => {});
      return page.evaluate(() => ({ linux: navigator.platform.startsWith('Linux'), events: (window as unknown as { log: string[] }).log }));
    },
    holds: (seen) => {
      if (typeof seen?.linux !== 'boolean' || !Array.isArray(seen.events)) return `the events of a middle press were read as ${JSON.stringify(seen)}`;
      if (!seen.events.includes('mousedown:1') || !seen.events.includes('mouseup:1')) return `a middle press fired ${JSON.stringify(seen.events)}, with no mousedown and mouseup of button 1, so this looked at nothing`;
      const pasted = ['paste', 'beforeinput:insertFromPaste', 'input:insertFromPaste'].every((type) => seen.events.includes(type));
      if (!seen.linux) return null;
      if (!pasted) return `a middle release on Linux fired ${JSON.stringify(seen.events)}, and no paste`;
      return seen.events.indexOf('paste') > seen.events.indexOf('mouseup:1') ? null : `the paste came before the release (${JSON.stringify(seen.events)})`;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        const add = EventTarget.prototype.addEventListener;
        const heard = navigator.platform.startsWith('Linux') ? ['paste', 'beforeinput', 'input'] : ['mouseup'];
        EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
          if (!heard.includes(type)) add.call(this, type, listener, options);
        } as typeof EventTarget.prototype.addEventListener;
      });
    },
  }),
  fact({
    id: 'click-on-a-cut-line-keeps-the-scroll',
    says: 'A click that puts the caret on a line a text field shows only part of scrolls nothing: not the page around a field taller than it, and not a field that scrolls itself.',
    relied: [
      { file: 'src/nullpad/editor.gleam', text: 'True -> Outcome(..outcome, sync: InSyncInPlace)' },
      { file: 'src/nullpad/editor.gleam', text: 'sync: WriteInPlace(field_buffer(clicked)),' },
    ],
    html:
      '<style>textarea{font:16px/20px monospace;padding:0;border:0;resize:none;width:200px;display:block}</style>' +
      '<div id="page" style="position:absolute;left:20px;top:20px;height:100px;overflow:auto"><textarea id="tall" style="height:400px;overflow:hidden"></textarea></div>' +
      '<textarea id="own" style="position:absolute;left:300px;top:20px;height:100px;overflow:auto"></textarea>',
    observe: async (page) => {
      const cut = await page.evaluate(() => {
        const text = Array.from({ length: 20 }, (_, line) => `line ${line}`).join('\n');
        const page = document.getElementById('page')!;
        const tall = document.getElementById('tall') as HTMLTextAreaElement;
        const own = document.getElementById('own') as HTMLTextAreaElement;
        tall.value = text;
        own.value = text;
        page.scrollTop = 50;
        own.scrollTop = 50;
        return { page: page.getBoundingClientRect(), own: own.getBoundingClientRect(), start: text.indexOf('line 2'), end: text.indexOf('line 3') };
      });
      const clickAt = async (box: { left: number; top: number }, id: string) => {
        await page.mouse.click(box.left + 20, box.top + 5);
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        return page.evaluate((id: string) => {
          const field = document.getElementById(id) as HTMLTextAreaElement;
          return { caret: field.selectionStart, page: document.getElementById('page')!.scrollTop, own: (document.getElementById('own') as HTMLTextAreaElement).scrollTop };
        }, id);
      };
      return { start: cut.start, end: cut.end, tall: await clickAt(cut.page, 'tall'), own: await clickAt(cut.own, 'own') };
    },
    holds: (seen) => {
      const read = (one: { caret: number; page: number; own: number } | undefined) => one && finite(one.caret) && finite(one.page) && finite(one.own);
      if (!finite(seen?.start) || !finite(seen?.end) || !read(seen.tall) || !read(seen.own)) return `the clicks were read as ${JSON.stringify(seen)}`;
      for (const [name, one] of [['the field the page holds', seen.tall], ['the field that scrolls itself', seen.own]] as const) {
        if (one.caret < seen.start || one.caret >= seen.end) return `the click on the cut line of ${name} put the caret at ${one.caret}, not on that line (${seen.start} to ${seen.end}), so this looked at nothing`;
      }
      if (seen.tall.page !== 50) return instead('the scroll of the page after a click on the cut line of the field it holds', 50, seen.tall.page);
      if (seen.own.own !== 50) return instead('the scroll of a field after a click on its cut line', 50, seen.own.own);
      return null;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        document.addEventListener('selectionchange', () => {
          document.getElementById('page')!.scrollTop = 0;
          document.getElementById('own')!.scrollTop = 0;
        });
      });
    },
  }),
];
