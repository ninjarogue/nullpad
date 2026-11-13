import { expect } from 'e2e';
import { drawnKinds, openEmptyNote, report, typeAndMeasure, typedText } from './stability.ts';
import { test } from './nullpad.ts';

/** Types notes of prose, headings, lists and quotes one key at a time. The rule they are held to is in `stability.ts`. */

for (const group of typedText) {
  test(`typing ${group.name} changes only the caret's row`, async ({ app, browser, page }) => {
    await app.open('/');
    await page.markdown.tap();
    const fixtures = { browser, page };
    const failures: string[] = [];
    const drawn = new Set<string>();
    for (const [index, sample] of group.samples.entries()) {
      await openEmptyNote(fixtures, index === 0);
      const { hits, problems } = await typeAndMeasure(browser, '', sample.keys);
      for (const line of report(hits, problems)) failures.push(`[${sample.name}] ${line}`);
      for (const kind of await drawnKinds(fixtures)) drawn.add(kind);
    }
    expect(group.draws.filter((kind) => !drawn.has(kind)), 'the samples no longer draw these kinds').toEqual([]);
    expect(failures).toEqual([]);
  });
}
