import type { CDPSession, Page as Tab } from 'playwright-core';

/** A key an IME takes: the browser reports it as key code 229. */
export const imeKey = (session: CDPSession, type: 'rawKeyDown' | 'keyUp') =>
  session.send('Input.dispatchKeyEvent', { type, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });

export class Ime {
  private constructor(private readonly session: CDPSession) {}

  static async on(tab: Tab) {
    return new Ime(await tab.context().newCDPSession(tab));
  }

  async compose(text: string) {
    await imeKey(this.session, 'rawKeyDown');
    await this.session.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    await imeKey(this.session, 'keyUp');
  }

  async commit(text: string) {
    await this.session.send('Input.insertText', { text });
  }
}
