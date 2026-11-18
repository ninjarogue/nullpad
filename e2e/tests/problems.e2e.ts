import { expect } from 'e2e';
import { test } from './nullpad.ts';

const stirs = [
  { what: 'console.error', run: () => console.error('planted', 7), reported: 'console.error: planted 7' },
  { what: 'console.warn', run: () => console.warn('planted'), reported: 'console.warning: planted' },
  { what: 'a console.assert that fails', run: () => console.assert(1 + 1 === 3, 'planted'), reported: 'console.assert: planted' },
  { what: 'an error thrown in a timer', run: () => setTimeout(() => { throw new Error('planted'); }), reported: 'uncaught Error: planted' },
  { what: 'a rejection nothing handles', run: () => void Promise.reject(new Error('planted')), reported: 'uncaught Error: planted' },
  { what: 'an error thrown in an event handler', run: () => addEventListener('click', () => { throw new Error('planted'); }, { once: true }), click: true, reported: 'uncaught Error: planted' },
  { what: 'a request the server refuses', run: () => void fetch('/planted'), reported: 'network error: Failed to load resource: the server responded with a status of 404 (Not Found)' },
];

for (const { what, run, click, reported } of stirs) {
  test(`${what} is reported to the test, which fails unless it takes the report`, async ({ app, browser, page }) => {
    await app.open('/');
    await expect(page.text).toBeFocused();
    expect(await page.takeProblems()).toEqual([]);

    await browser.evaluate(`(${run.toString()})(), null`);
    if (click) await page.text.tap();
    await page.nextFrame();
    const problems = await page.takeProblems();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(reported);
  });
}

test('console.log, console.info and console.debug are not problems', async ({ app, browser, page }) => {
  await app.open('/');
  await browser.evaluate(() => {
    console.log('planted');
    console.info('planted');
    console.debug('planted');
    return null;
  });
  await page.nextFrame();
  expect(await page.takeProblems()).toEqual([]);
});

test('an error thrown by the first script of a page is reported', async ({ app, browser, page }) => {
  await browser.addInitScript(() => {
    setTimeout(() => {
      throw new Error('planted at load');
    });
  });
  await app.open('/');
  await expect(page.text).toBeFocused();
  const problems = await page.takeProblems();
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('uncaught Error: planted at load');
});
