import { test as base } from '@e2e-dev/web';
import type { Browser } from '@e2e-dev/web';
import { expect } from 'e2e';
import type { App, Locator, Screen } from 'e2e';

export type Note = { key: string; title: string | null; body: string };

/** Where a row of the note is drawn, and in what type, by the element that starts there. */
export type Placed = { row: number; top: number; height: number; size: string; family: string };

export const trip: Note = { key: 'trip', title: null, body: '# Trip' };
export const groceries: Note = { key: 'groceries', title: 'Groceries', body: 'milk' };
export const newNote = { key: expect.any(String), title: null, body: '' };

export const autosaveMs = 800;
export const retryMs = 5000;
/** A browser timer can fire a little early by the test's clock. */
export const timerSlackMs = 50;

export const contrast = (a: number, b: number) =>
  (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type PageDisk = {
  seed(notes: Note[]): Promise<null>;
  notes(): Promise<Note[]>;
  remove(key: string): Promise<null>;
  hold(): Promise<null>;
};

declare global {
  var testDisk: PageDisk;
}

function installTestDisk() {
  type Stored = Note & { modified: number };
  type Request = (this: IDBObjectStore, ...args: unknown[]) => IDBRequest;
  const failing = 'testDisk.failing';
  const held = 'testDisk.held';
  const mine = new WeakSet<IDBTransaction>();

  const requests = IDBObjectStore.prototype as unknown as Record<string, Request>;
  for (const name of ['getAll', 'get', 'put', 'add', 'delete']) {
    const real = requests[name];
    requests[name] = function (...args) {
      const request = real.apply(this, args);
      if (localStorage.getItem(failing) && !mine.has(this.transaction)) {
        request.addEventListener('success', () => this.transaction.abort());
      }
      return request;
    };
  }

  // The app commits its writes at once. A failing disk must not: its request
  // has to succeed first, so that the abort above can run.
  const commit = IDBTransaction.prototype.commit;
  IDBTransaction.prototype.commit = function () {
    if (!localStorage.getItem(failing) || mine.has(this)) commit.call(this);
  };

  const transact = <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => T) =>
    new Promise<T>((resolve, reject) => {
      const open = indexedDB.open('nullpad', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('notes', { keyPath: 'key' });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const transaction = open.result.transaction('notes', mode);
        mine.add(transaction);
        const result = run(transaction.objectStore('notes'));
        transaction.onabort = () => reject(transaction.error);
        transaction.oncomplete = () => {
          open.result.close();
          resolve(result);
        };
      };
    });

  globalThis.testDisk = {
    seed: (notes) =>
      transact('readwrite', (store) => {
        notes.forEach((note, age) => store.put({ ...note, modified: age + 1 }));
        return null;
      }),
    notes: async () => {
      const all = await transact('readonly', (store) => store.getAll() as IDBRequest<Stored[]>);
      return all.result
        .sort((a, b) => a.modified - b.modified)
        .map(({ key, title, body }) => ({ key, title, body }));
    },
    remove: (key) =>
      transact('readwrite', (store) => {
        store.delete(key);
        return null;
      }),
    hold: () =>
      new Promise((holding) => {
        localStorage.setItem(held, 'yes');
        void transact('readwrite', (store) => {
          // A transaction commits as soon as it has no request waiting, and
          // every later one on the store waits for it to commit.
          const keepOpen = () => {
            if (localStorage.getItem(held)) store.count().onsuccess = keepOpen;
          };
          keepOpen();
          holding(null);
        });
      }),
  };
}

function recordCrashes() {
  const record = (event: ErrorEvent | PromiseRejectionEvent) => {
    const crash = 'reason' in event ? String(event.reason) : event.message;
    localStorage.setItem('testPage.crash', crash);
  };
  addEventListener('error', record);
  addEventListener('unhandledrejection', record);
}

export class Disk {
  constructor(
    private readonly app: App,
    private readonly browser: Browser,
  ) {}

  /** Oldest first. Leaves the browser on a blank page. */
  async seed(notes: Note[]) {
    await this.app.open('/blank');
    await this.browser.evaluate((notes: Note[]) => testDisk.seed(notes), notes);
  }

  /** Oldest change first. Does not answer while the disk is held. */
  notes() {
    return this.browser.evaluate(() => testDisk.notes());
  }

  async remove(key: string) {
    await this.browser.evaluate((key: string) => testDisk.remove(key), key);
  }

  async fail() {
    await this.browser.evaluate(() => {
      localStorage.setItem('testDisk.failing', 'yes');
      return null;
    });
  }

  async recover() {
    await this.browser.evaluate(() => {
      localStorage.removeItem('testDisk.failing');
      return null;
    });
  }

  async hold() {
    await this.browser.evaluate(() => testDisk.hold());
  }

  async release() {
    await this.browser.evaluate(() => {
      localStorage.removeItem('testDisk.held');
      return null;
    });
  }
}

export class Page {
  readonly text: Locator;
  readonly title: Locator;
  readonly saveState: Locator;
  readonly problem: Locator;
  readonly list: Locator;
  readonly rows: Locator;
  readonly currentRow: Locator;
  readonly newNote: Locator;
  readonly markdown: Locator;
  readonly preview: Locator;
  readonly paragraphs: Locator;
  readonly everything: Locator;
  readonly blanks: Locator;
  readonly strong: Locator;
  readonly emphasis: Locator;
  readonly code: Locator;
  readonly deleted: Locator;
  readonly bulletLists: Locator;
  readonly numberedLists: Locator;
  readonly items: Locator;
  readonly boxes: Locator;
  readonly quotes: Locator;
  readonly codeBlocks: Locator;
  readonly rules: Locator;
  readonly tables: Locator;
  readonly tableBoxes: Locator;
  readonly headers: Locator;
  readonly cells: Locator;
  readonly noteActions: Locator;
  readonly noteMenu: Locator;
  readonly delete: Locator;
  readonly undoToast: Locator;
  readonly undo: Locator;
  readonly vimSwitch: Locator;
  readonly vimMode: Locator;
  readonly above: Locator;
  readonly below: Locator;

  constructor(
    screen: Screen,
    private readonly browser: Browser,
  ) {
    this.text = screen.getByLabel('Note text');
    this.title = screen.getByLabel('Title');
    this.saveState = screen.getByRole('status');
    this.problem = screen.getByRole('alert');
    this.list = screen.getByTestId('note-list');
    this.rows = browser.locator('[data-test-id="note-list"] [data-test-id^="note-"]');
    this.currentRow = browser.locator('[aria-current="true"]');
    this.newNote = screen.getByRole('button', 'New note');
    this.markdown = screen.getByRole('button', 'Markdown');
    this.preview = screen.getByTestId('preview');
    this.paragraphs = this.inPreview('p');
    this.everything = this.inPreview(':not(.blank)');
    this.blanks = this.inPreview('.blank');
    this.strong = this.inPreview('strong');
    this.emphasis = this.inPreview('em');
    this.code = this.inPreview('code');
    this.deleted = this.inPreview('del');
    this.bulletLists = this.inPreview('ul');
    this.numberedLists = this.inPreview('ol');
    this.items = this.preview.getByRole('listitem');
    this.boxes = this.preview.getByRole('checkbox');
    this.quotes = this.inPreview('blockquote');
    this.codeBlocks = this.inPreview('pre');
    this.rules = this.preview.getByRole('separator');
    this.tables = this.inPreview('table');
    this.tableBoxes = this.preview.getByRole('region', 'Table');
    this.headers = this.preview.getByRole('columnheader');
    this.cells = this.preview.getByRole('cell');
    this.noteActions = screen.getByTestId('row-actions');
    this.noteMenu = screen.getByTestId('note-menu');
    this.delete = screen.getByTestId('delete-note');
    this.undoToast = screen.getByTestId('undo-toast');
    this.undo = screen.getByTestId('undo-delete');
    this.vimSwitch = screen.getByLabel('Vim');
    this.vimMode = screen.getByTestId('mode');
    this.above = screen.getByTestId('live-above');
    this.below = screen.getByTestId('live-below');
  }

  /** An element of the note drawn around the text field. */
  drawn(selector: string) {
    return this.browser.locator(`.page.live .part ${selector}`);
  }

  /** Elements of the part drawn above or below the text field. */
  drawnIn(part: 'live-above' | 'live-below', selector: string) {
    return this.browser.locator(`[data-test-id="${part}"] ${selector}`);
  }

  /** Right-click the note's row, as a mouse does. */
  rightClick(title: string) {
    return this.browser.evaluate((title: string) => {
      const row = [...document.querySelectorAll('[data-test-id="note-list"] [data-test-id^="note-"]')].find(
        (row) => row.textContent === title,
      )!;
      const box = row.getBoundingClientRect();
      row.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: box.left + 20,
          clientY: box.top + 10,
        }),
      );
      return null;
    }, title);
  }

  /** How far down the page of the note is scrolled. */
  scrolled() {
    return this.browser.evaluate(() => document.querySelector('.page')!.scrollTop);
  }

  /** Where the text field is in the window. */
  fieldBox() {
    return this.browser.evaluate(() => {
      const box = document.querySelector('[data-test-id="editor"]')!.getBoundingClientRect();
      return { top: box.top, height: box.height };
    });
  }

  /** How far down the window the last element matching `selector` starts. */
  topOf(selector: string) {
    return this.browser.evaluate((selector: string) => {
      const found = [...document.querySelectorAll(selector)];
      return found[found.length - 1].getBoundingClientRect().top;
    }, selector);
  }

  /** Where `word` starts on the page, drawn or in the text field, however far the page is scrolled. */
  placeOf(word: string) {
    return this.browser.evaluate((word: string) => {
      const sheet = document.querySelector('.page')!;
      const texts = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
      for (let text = texts.nextNode() as Text | null; text; text = texts.nextNode() as Text | null) {
        const at = text.data.indexOf(word);
        if (at < 0) continue;
        const range = document.createRange();
        range.setStart(text, at);
        range.setEnd(text, at + word.length);
        const box = range.getClientRects()[0];
        return { left: box.left, top: box.top - sheet.getBoundingClientRect().top + sheet.scrollTop };
      }
      return null;
    }, word);
  }

  /**
   * Presses `keys` one after another while the page draws nothing, as on a
   * device too busy to draw between two key presses. Then lets it draw.
   */
  async pressBeforeRedraw(...keys: string[]) {
    await this.beforeRedraw(async () => {
      for (const key of keys) await this.browser.keyboard.press(key);
    });
  }

  /** Does what `act` does while the page draws nothing, as on a busy device. Then lets it draw. */
  async beforeRedraw(act: () => Promise<void>) {
    await this.nextFrame();
    await this.browser.evaluate(() => {
      const real = window.requestAnimationFrame;
      const held: FrameRequestCallback[] = [];
      window.requestAnimationFrame = (run) => held.push(run);
      (globalThis as { redraw?: () => void }).redraw = () => {
        window.requestAnimationFrame = real;
        for (const run of held) real(run);
      };
      return null;
    });
    await act();
    await this.browser.evaluate(() => {
      (globalThis as { redraw?: () => void }).redraw!();
      return null;
    });
    await this.nextFrame();
  }

  /** Waits until the page has drawn a frame and run what it does before painting. */
  nextFrame() {
    return this.browser.evaluate(
      () =>
        new Promise<null>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done(null))),
        ),
    );
  }

  /** A point near the left edge of the first letter of `word`, in the window, drawn or in the text field. */
  pointAt(word: string) {
    return this.browser.evaluate((word: string) => {
      const texts = document.createTreeWalker(document.querySelector('.page')!, NodeFilter.SHOW_TEXT);
      for (let text = texts.nextNode() as Text | null; text; text = texts.nextNode() as Text | null) {
        const at = text.data.indexOf(word);
        if (at < 0 || text.parentElement!.closest('textarea')) continue;
        const range = document.createRange();
        range.setStart(text, at);
        range.setEnd(text, at + 1);
        const box = range.getBoundingClientRect();
        return { x: box.left + box.width / 4, y: box.top + box.height / 2 };
      }
      throw new Error(`"${word}" is not on the page`);
    }, word);
  }

  /** Presses the mouse at one point, moves it to another and lets go. */
  async drag(from: { x: number; y: number }, to: { x: number; y: number }) {
    await this.browser.mouse.move(from.x, from.y);
    await this.browser.mouse.down();
    await this.nextFrame();
    await this.browser.mouse.move(to.x, to.y);
    await this.nextFrame();
    await this.browser.mouse.up();
  }

  /** The text painted as selected on the drawn page, or null when nothing is. */
  painted() {
    return this.browser.evaluate(() => {
      const painted = globalThis.CSS?.highlights?.get('nullpad-selection');
      const ranges = painted ? [...painted] : [];
      return ranges.length === 0 ? null : ranges.map((range) => range.toString()).join('');
    });
  }

  /** The rows of each blank line of the page that shows the selection colour. */
  paintedBlanks() {
    return this.browser.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.page.live .part .blank')]
        .filter((blank) =>
          [getComputedStyle(blank), getComputedStyle(blank, '::before')].some(
            (style) => style.backgroundColor !== 'rgba(0, 0, 0, 0)',
          ),
        )
        .map((blank) => Number(blank.dataset.row)),
    );
  }

  /** The first row of each drawn element whose last line break shows the selection colour after its text. */
  paintedBreaks() {
    return this.browser.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.page.live .part [data-row]:not(.blank)')]
        .filter((element) => getComputedStyle(element, '::after').backgroundColor !== 'rgba(0, 0, 0, 0)')
        .map((element) => Number(element.dataset.row)),
    );
  }

  /**
   * Every element the page draws a row of the note in, and the text field
   * while it can be seen, in the order of the page.
   */
  layout() {
    return this.browser.evaluate(() => {
      const sheet = document.querySelector('.page')!;
      const field = document.querySelector<HTMLElement>('[data-test-id="editor"]')!;
      const seen = getComputedStyle(field.parentElement!).opacity !== '0';
      const drawn = [...sheet.querySelectorAll<HTMLElement>('.preview.part [data-row]')];
      const shown = seen && field.dataset.row !== undefined ? [field, ...drawn] : drawn;
      return shown
        .map((element) => {
          const box = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            row: Number(element.dataset.row),
            top: box.top - sheet.getBoundingClientRect().top + sheet.scrollTop,
            height: box.height,
            size: style.fontSize,
            family: style.fontFamily,
          };
        })
        .sort((a, b) => a.row - b.row || a.top - b.top);
    });
  }

  /** The text field's text, the part of it selected, and whether it was selected backwards. */
  selection() {
    return this.browser.evaluate(() => {
      const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
      return {
        text: field.value,
        selected: field.value.slice(field.selectionStart, field.selectionEnd),
        backward: field.selectionDirection === 'backward',
      };
    });
  }

  /** How the text field sets its text, once the page has drawn. */
  async fieldFont() {
    await this.nextFrame();
    return this.browser.evaluate(() => {
      const style = getComputedStyle(document.querySelector('[data-test-id="editor"]')!);
      return {
        size: style.fontSize,
        family: style.fontFamily,
        weight: style.fontWeight,
        ligatures: style.fontVariantLigatures,
      };
    });
  }

  /** The text field's text with `|` where the caret is. */
  caret() {
    return this.browser.evaluate(() => {
      const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]')!;
      return `${field.value.slice(0, field.selectionStart)}|${field.value.slice(field.selectionEnd)}`;
    });
  }

  inPreview(selector: string) {
    return this.browser.locator(`[data-test-id="preview"] ${selector}`);
  }

  row(title: string) {
    return this.list.getByRole('button', title);
  }

  box(name: string) {
    return this.preview.getByRole('checkbox', name);
  }

  innerText(selector: string) {
    return this.browser.evaluate(
      (selector: string) =>
        document.querySelector<HTMLElement>(`[data-test-id="preview"] ${selector}`)?.innerText ??
        null,
      selector,
    );
  }

  textContent(selector: string) {
    return this.browser.evaluate(
      (selector: string) =>
        document.querySelector(`[data-test-id="preview"] ${selector}`)?.textContent ?? null,
      selector,
    );
  }

  measureTask(nth: number) {
    return this.browser.evaluate((nth: number) => {
      const item = document.querySelectorAll('[data-test-id="preview"] li.task')[nth];
      const box = item.querySelector('input')!.getBoundingClientRect();
      const words = document.createTreeWalker(item, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      range.selectNodeContents(words.nextNode()!);
      const line = range.getClientRects()[0];
      return {
        width: box.width,
        height: box.height,
        gap: line.left - box.right,
        boxMiddle: (box.top + box.bottom) / 2,
        lineTop: line.top,
        lineBottom: line.bottom,
        marker: getComputedStyle(item).listStyleType,
      };
    }, nth);
  }

  /** The room left of the nth `th` or `td`'s text and right of it, inside the cell's padding. */
  measureCell(tag: 'th' | 'td', nth: number) {
    return this.browser.evaluate(
      (which: { tag: string; nth: number }) => {
        const cell = document.querySelectorAll(`[data-test-id="preview"] ${which.tag}`)[which.nth];
        const words = document.createRange();
        words.selectNodeContents(cell);
        const text = words.getBoundingClientRect();
        const box = cell.getBoundingClientRect();
        const style = getComputedStyle(cell);
        return {
          before: text.left - (box.left + parseFloat(style.paddingLeft)),
          after: box.right - parseFloat(style.paddingRight) - text.right,
        };
      },
      { tag, nth },
    );
  }

  /** How far the page, the rendered page and each table's box overflow sideways. */
  measureTables() {
    return this.browser.evaluate(() => {
      const preview = document.querySelector('[data-test-id="preview"]')!;
      const boxes = [...preview.querySelectorAll('.table-scroll')];
      return {
        window: innerWidth,
        page: document.documentElement.scrollWidth,
        previewClient: preview.clientWidth,
        previewScroll: preview.scrollWidth,
        boxRights: boxes.map((box) => box.getBoundingClientRect().right),
        boxOverflow: boxes.map((box) => box.scrollWidth - box.clientWidth),
        boxScrolled: boxes.map((box) => box.scrollLeft),
      };
    });
  }

  /** The relative luminance of each CSS colour given, as the eye weighs it. */
  luminances(colors: string[]) {
    return this.browser.evaluate((colors: string[]) => {
      const canvas = document.createElement('canvas').getContext('2d')!;
      return colors.map((color) => {
        canvas.fillStyle = color;
        canvas.fillRect(0, 0, 1, 1);
        const [r, g, b] = [...canvas.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((channel) => {
          const unit = channel / 255;
          return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      });
    }, colors);
  }

  async hide() {
    // Headless Chromium never hides its one page, so the state is faked
    // around a real event.
    await this.browser.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      Reflect.deleteProperty(document, 'visibilityState');
      document.dispatchEvent(new Event('visibilitychange'));
      return null;
    });
  }

  pressMarkdownShortcut() {
    return this.browser.keyboard.press('ControlOrMeta+e');
  }

  /** From the markdown to the page, with nothing being edited, so the whole note is drawn. */
  async showPage() {
    await expect(this.markdown).toHaveAttribute('aria-pressed', 'true');
    await this.markdown.tap();
    await this.stopEditing();
  }

  /** On the page: leave the text field, so the whole note is drawn. */
  async stopEditing() {
    await expect(this.text).toBeFocused();
    await this.browser.keyboard.press('Escape');
    await expect(this.preview).toBeVisible();
  }

  /** From the page to the whole note as typed. */
  async showMarkdown() {
    await expect(this.markdown).toHaveAttribute('aria-pressed', 'false');
    await this.markdown.tap();
    await expect(this.markdown).toHaveAttribute('aria-pressed', 'true');
  }
}

export const test = base.extend<{ disk: Disk; page: Page }>({
  disk: async ({ app, browser }, use) => {
    await browser.addInitScript(installTestDisk);
    await use(new Disk(app, browser));
  },
  page: async ({ screen, browser }, use) => {
    await browser.addInitScript(recordCrashes);
    // Most tests type and read whole notes, so they start with Markdown on.
    await browser.addInitScript(() => {
      try {
        if (localStorage.getItem('nullpad.markdown') === null) {
          localStorage.setItem('nullpad.markdown', 'on');
        }
      } catch {
        // A blank page has no storage.
      }
    });
    await use(new Page(screen, browser));
    const crash = await browser.evaluate(() => localStorage.getItem('testPage.crash'));
    expect(crash, 'the page threw an error nothing caught').toBeNull();
  },
});
