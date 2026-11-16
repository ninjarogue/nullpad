import { fact } from './browser-facts.ts';
import type { Fact } from './browser-facts.ts';

/**
 * What nullpad assumes about Chromium, found by reading the `.ffi.mjs` files,
 * the CSS, and the comments in `src` that say the browser forces something.
 * Each fact is looked at on a plain page, and `relied` names the code that
 * stands on it, so a failure says where the damage would be. `breaks` plants
 * the change in Chromium that the fact is there to see.
 *
 * Add a fact when code starts to rely on something the browser does and a
 * spec does not promise. Remove one when nothing relies on it any more: its
 * `relied` text then fails to be found, and says so.
 */

const surface = 'src/nullpad/surface.gleam';
const ffi = 'src/nullpad/surface.ffi.mjs';
const platform = 'src/nullpad/platform.ffi.mjs';
const markdown = 'src/nullpad/markdown.gleam';
const css = 'assets/nullpad.css';

// `Selection.modify` is not in the DOM typings.
type Modifiable = Selection & { modify(alter: string, direction: string, granularity: string): void };

const unwritten = { observe: async () => null, holds: () => null };

export const facts: Fact[] = [
  fact({
    id: 'value-write-resets-undo',
    says: "Assigning a different value to a text field empties the browser's own undo history, and assigning the value it already has leaves it alone.",
    relied: [{ file: ffi, text: 'if (control.value !== text) control.value = text;' }],
    html: '<textarea id="t"></textarea>',
    ...unwritten,
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
      { file: surface, text: '// Chromium sends no `beforeinput` for an undo from a menu: it undoes the' },
    ],
    html: '<textarea id="t"></textarea>',
    ...unwritten,
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
    ...unwritten,
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
      { file: ffi, text: '// the window, and a control that already has the focus is not scrolled to by' },
    ],
    html: '<div style="height:3000px"></div><textarea id="t"></textarea><div style="height:200px"></div>',
    ...unwritten,
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
    ...unwritten,
    breaks: async (page) => {
      await page.evaluate(() => {
        Object.defineProperty(HTMLTextAreaElement.prototype, 'selectionDirection', { get: () => 'none', configurable: true });
      });
    },
  }),

  fact({
    id: 'modify-extends-a-text-field',
    says: 'Selection.modify extends the selection of a focused text field by a character or a word, either way, and the field reports it with its direction.',
    relied: [{ file: ffi, text: 'getSelection().modify("extend", forward ? "forward" : "backward", granularity);' }],
    html: '<textarea id="t">hello world</textarea>',
    ...unwritten,
    breaks: async (page) => {
      await page.evaluate(() => {
        (Selection.prototype as Modifiable).modify = () => {};
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
    ...unwritten,
    breaks: async (page) => {
      await page.evaluate(() => {
        const real = (Selection.prototype as Modifiable).modify;
        (Selection.prototype as Modifiable).modify = function (this: Selection, alter: string, direction: string, granularity: string) {
          if (granularity !== 'lineboundary') real.call(this, alter, direction, granularity);
        };
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
    ...unwritten,
    breaks: async (page) => {
      await page.evaluate(() => {
        const real = (Selection.prototype as Modifiable).modify;
        (Selection.prototype as Modifiable).modify = function (this: Selection, alter: string, direction: string, granularity: string) {
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
    ...unwritten,
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
    ...unwritten,
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
      { file: surface, text: '// Child text is only the *default* value: a brand-new DOM node starts' },
      { file: ffi, text: 'field.value !== field.defaultValue' },
    ],
    html: '<textarea id="t">a</textarea>',
    ...unwritten,
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
    says: 'Writing the value of a text field from script fires no beforeinput or input, so what the app writes is not heard as typing.',
    relied: [{ file: ffi, text: 'if (control.value !== text) control.value = text;' }],
    html: '<textarea id="t">hello</textarea>',
    ...unwritten,
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
      { file: surface, text: 'event.advanced("beforeinput", history_decoder(on_event)),' },
    ],
    html: '<textarea id="t">hello</textarea>',
    ...unwritten,
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
      { file: surface, text: '// The browser moves the caret for these keys and says nothing, so the' },
      { file: surface, text: 'event.on("select", changed),' },
    ],
    html: '<textarea id="t">hello</textarea>',
    ...unwritten,
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
    ...unwritten,
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
      { file: surface, text: '// A touch sends `pointerup` before the mouse press that moves the' },
      { file: ffi, text: 'press.sourceCapabilities?.firesTouchEvents' },
    ],
    context: { hasTouch: true },
    html: '<textarea id="t" style="position:absolute;left:10px;top:10px;width:300px;height:100px">hello world</textarea>',
    ...unwritten,
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
      { file: ffi, text: '// which takes the focus from the field: the field is given it back once the' },
    ],
    html:
      '<textarea id="t" style="position:absolute;left:10px;top:10px;width:200px;height:50px">text</textarea>' +
      '<p id="p" style="position:absolute;left:10px;top:100px;margin:0;font:16px monospace">selectable words here</p>',
    ...unwritten,
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
      { file: surface, text: 'event.on("compositionend", changed),' },
    ],
    html: '<textarea id="t"></textarea>',
    ...unwritten,
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
      { file: markdown, text: '/// Browsers drop some spaces and control characters before they read the' },
      { file: markdown, text: 'code if code <= 0x20 -> True' },
    ],
    ...unwritten,
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
    ...unwritten,
    breaks: async (page) => {
      await page.evaluate(() => {
        Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
      });
    },
  }),

  fact({
    id: 'collapsed-range-in-an-empty-element',
    says: 'A collapsed range in an element with no text has no box, so a caret there is measured from the element. (A collapsed range at a soft wrap does have a box in Chromium, which the comment in caretBox denies.)',
    relied: [{ file: ffi, text: '// A collapsed range has no box at a soft wrap or in an element with no' }],
    html: '<p id="empty" style="margin:0;font:16px monospace"></p>',
    ...unwritten,
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
    ...unwritten,
    breaks: async (page) => {
      await page.addStyleTag({ content: '#a { margin-top: 0 !important; }' });
    },
  }),

  fact({
    id: 'translate-property',
    says: 'The individual translate property moves an element, and reads back as written.',
    relied: [{ file: ffi, text: 'box.style.translate = `${x}px ${y}px`;' }],
    html: '<div id="a" style="position:relative;margin:0;translate:10px 20px">x</div>',
    ...unwritten,
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
    ...unwritten,
    breaks: async (page) => {
      await page.addStyleTag({ content: 'div { color: rgb(0, 0, 0) !important; background-image: none !important; }' });
    },
  }),

  fact({
    id: 'normal-line-height-is-a-word',
    says: 'A line height of normal computes to the word normal, not to a length, so code that reads it as a length has to fall back to the font size.',
    relied: [{ file: ffi, text: 'return parseFloat(style.lineHeight) || 1.2 * parseFloat(style.fontSize);' }],
    html: '<p id="n" style="font:20px serif">x</p><p id="p" style="font:20px/30px serif">x</p>',
    ...unwritten,
    breaks: async (page) => {
      await page.addStyleTag({ content: 'p { line-height: 25px !important; }' });
    },
  }),

  fact({
    id: 'canvas-text-width-matches-the-page',
    says: 'The width canvas measureText gives for a text in a font is the width the page draws it at, kerning pairs included.',
    relied: [{ file: ffi, text: 'return pen.measureText(text).width;' }],
    html: '<span id="s" style="font:20px serif;white-space:pre"></span>',
    ...unwritten,
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
    ...unwritten,
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
    ...unwritten,
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
    ...unwritten,
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
    ...unwritten,
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
      { file: ffi, text: '// A selection across blocks is painted over the drawn page with the CSS' },
      { file: css, text: '::highlight(nullpad-selection) {' },
    ],
    html:
      '<style>body{margin:0;background:#fff;color:#000} ::highlight(h){background-color:rgb(255,0,0);color:rgb(0,0,255)} ' +
      '.b{font:20px monospace;white-space:pre;width:300px;height:30px;line-height:30px}</style>' +
      '<div class="b" id="one">aaa</div><div class="b" id="two">bbb</div>',
    ...unwritten,
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
    says: 'A desktop browser matches (hover: hover) and (pointer: fine).',
    relied: [{ file: platform, text: 'const query = "(hover: hover) and (pointer: fine)";' }],
    ...unwritten,
    breaks: async (page) => {
      await page.evaluate(() => {
        window.matchMedia = (query: string) => ({ matches: false, media: query }) as MediaQueryList;
      });
    },
  }),

  fact({
    id: 'touch-device-has-no-hover',
    says: 'A touch device does not match (hover: hover) and (pointer: fine), so it is not taken to have a keyboard.',
    relied: [{ file: platform, text: 'const query = "(hover: hover) and (pointer: fine)";' }],
    context: { hasTouch: true, isMobile: true },
    ...unwritten,
    breaks: async (page) => {
      await page.evaluate(() => {
        window.matchMedia = (query: string) => ({ matches: true, media: query }) as MediaQueryList;
      });
    },
  }),

  fact({
    id: 'platform-names-apple-devices',
    says: 'navigator.platform starts with Mac, iPhone or iPad on exactly the devices whose user agent says so, so Ctrl is not taken for Cmd anywhere else.',
    relied: [
      { file: platform, text: 'const apple = /Mac|iPhone|iPad/.test(navigator.platform);' },
      { file: ffi, text: 'navigator.platform.startsWith("Mac")' },
    ],
    ...unwritten,
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
      { file: surface, text: 'is_key(name, code, "z"), is_key(name, code, "y")' },
    ],
    html: '<textarea id="t"></textarea>',
    ...unwritten,
    breaks: async (page) => {
      await page.evaluate(() => {
        Object.defineProperty(KeyboardEvent.prototype, 'code', { get: () => '', configurable: true });
      });
    },
  }),

  fact({
    id: 'marker-line-height-zero',
    says: 'li::marker { line-height: 0 } stops the marker making a list item taller than its content.',
    pending: 'the rule is added by the branch of PR #30 and main has no ::marker rule, so no code relies on it here yet',
    relied: [{ file: css, text: 'li::marker' }],
    html:
      '<style>ul{margin:0;padding-left:30px;font:16px/1.7 serif} li h6{font:10px/1.2 serif;margin:0} .zero li::marker{line-height:0}</style>' +
      '<ul id="a"><li><h6>x</h6></li></ul><ul id="b" class="zero"><li><h6>x</h6></li></ul>',
    ...unwritten,
    breaks: async (page) => {
      await page.addStyleTag({ content: '.zero li::marker { line-height: 1.7 !important; }' });
    },
  }),
];
