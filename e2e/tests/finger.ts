import type { Locator } from 'e2e';
import type { CDPSession } from 'playwright-core';
import { live } from '../engine.ts';

export const phone = { width: 390, height: 844, pixelRatio: 3 };

export type Point = { x: number; y: number };

/**
 * A finger on a phone. The browser is made a phone: 390 by 844 CSS pixels at three device pixels
 * each, a coarse pointer and a touch screen. A tap is a real touch, so the browser sends its own
 * touch, pointer, mouse and click events in the order it does for a person, moves focus and places
 * the caret itself, and every event is trusted. Do not mix it with `browser.setViewport`, which
 * puts the window back to a desktop.
 */
export class Finger {
  private constructor(
    private readonly session: CDPSession,
    private readonly nextFrame: () => Promise<unknown>,
  ) {}

  static async onPhone(nextFrame: () => Promise<unknown>) {
    const tab = live().page();
    const session = await tab.context().newCDPSession(tab);
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: phone.width,
      height: phone.height,
      deviceScaleFactor: phone.pixelRatio,
      mobile: true,
    });
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const finger = new Finger(session, nextFrame);
    await nextFrame();
    return finger;
  }

  /** Touches the screen at `point` and lifts the finger, then waits for the page to draw. */
  async tap(point: Point) {
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await this.nextFrame();
  }

  /** Touches the screen at `point`, keeps the finger still for longer than a long press takes, and lifts it. */
  async hold(point: Point, ms = 800) {
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await new Promise((done) => setTimeout(done, ms));
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await this.nextFrame();
  }

  /** Taps the middle of `target`, which has to be on the screen. */
  async tapOn(target: Locator) {
    const box = (await target.boundingBox())!;
    await this.tap({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }

  /**
   * Drags the page under the finger: puts it at `from`, moves it `by` pixels up the screen a little
   * at a time, holds it still for a moment so that the page does not fling on, and lifts it.
   */
  swipeUp(from: Point, by: number) {
    return this.swipe(from, { x: 0, y: -by });
  }

  /** The same, moving what is under the finger `by` pixels to the left. */
  swipeLeft(from: Point, by: number) {
    return this.swipe(from, { x: -by, y: 0 });
  }

  private async swipe(from: Point, along: Point) {
    const by = Math.hypot(along.x, along.y);
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let moved = 0; moved < by; moved += 24) {
      const part = Math.min(moved + 24, by) / by;
      await this.session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from.x + along.x * part, y: from.y + along.y * part }],
      });
      await new Promise((done) => setTimeout(done, 8));
    }
    await new Promise((done) => setTimeout(done, 150));
    await this.session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await this.nextFrame();
  }
}
