import { test as base } from '@e2e-dev/web';
import type { Browser } from '@e2e-dev/web';
import { expect } from 'e2e';
import type { App, Locator, Screen } from 'e2e';

export type Note = { key: string; title: string | null; body: string };

export const trip: Note = { key: 'trip', title: null, body: '# Trip' };
export const groceries: Note = { key: 'groceries', title: 'Groceries', body: 'milk' };
export const newNote = { key: expect.any(String), title: null, body: '' };

export const autosaveMs = 800;
export const retryMs = 5000;
/** A browser timer can fire a little early by the test's clock. */
export const timerSlackMs = 50;

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

class Disk {
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

class Page {
  readonly text: Locator;
  readonly title: Locator;
  readonly saveState: Locator;
  readonly problem: Locator;
  readonly list: Locator;
  readonly rows: Locator;
  readonly currentRow: Locator;
  readonly newNote: Locator;
  readonly showPreview: Locator;
  readonly showSource: Locator;
  readonly preview: Locator;
  readonly paragraphs: Locator;
  readonly everything: Locator;
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
  readonly delete: Locator;
  readonly confirmDelete: Locator;
  readonly keep: Locator;
  readonly vimSwitch: Locator;
  readonly vimMode: Locator;

  constructor(
    screen: Screen,
    private readonly browser: Browser,
  ) {
    this.text = screen.getByLabel('Note text');
    this.title = screen.getByLabel('Title');
    this.saveState = screen.getByRole('status');
    this.problem = screen.getByRole('alert');
    this.list = screen.getByTestId('note-list');
    this.rows = this.list.getByRole('button');
    this.currentRow = browser.locator('[aria-current="true"]');
    this.newNote = screen.getByRole('button', 'New note');
    this.showPreview = screen.getByRole('button', 'Preview');
    this.showSource = screen.getByRole('button', 'Edit');
    this.preview = screen.getByTestId('preview');
    this.paragraphs = this.inPreview('p');
    this.everything = this.inPreview('*');
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
    this.delete = screen.getByTestId('delete-note');
    this.confirmDelete = screen.getByTestId('confirm-delete');
    this.keep = screen.getByRole('button', 'Keep');
    this.vimSwitch = screen.getByLabel('Vim');
    this.vimMode = screen.getByTestId('mode');
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

  pressPreviewShortcut() {
    return this.browser.keyboard.press('ControlOrMeta+e');
  }
}

export const test = base.extend<{ disk: Disk; page: Page }>({
  disk: async ({ app, browser }, use) => {
    await browser.addInitScript(installTestDisk);
    await use(new Disk(app, browser));
  },
  page: async ({ screen, browser }, use) => {
    await browser.addInitScript(recordCrashes);
    await use(new Page(screen, browser));
    const crash = await browser.evaluate(() => localStorage.getItem('testPage.crash'));
    expect(crash, 'the page threw an error nothing caught').toBeNull();
  },
});
