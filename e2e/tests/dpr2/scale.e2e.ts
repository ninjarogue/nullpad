import { expect } from 'e2e';
import { test } from '../nullpad.ts';

test('this run draws two device pixels to a CSS pixel', async ({ app, browser }) => {
  await app.open('/');
  expect(await browser.evaluate(() => devicePixelRatio)).toBe(2);
  expect(await browser.evaluate(() => innerWidth)).toBe(1280);
});
