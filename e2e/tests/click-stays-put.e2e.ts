import { expect } from 'e2e';
import { clickSeries, Editing, withRawPage } from './editing.ts';
import { drawnWords, drawnWordsInPage, wordAt } from './guards.ts';
import type { Box } from './guards.ts';
import { test } from './nullpad.ts';
import { everyKind } from './stability.ts';

type Sample = { name: string; draws: string[]; note: string; revealMoves?: true };

const samples: Sample[] = [
  {
    name: 'headings',
    draws: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    note: [
      '# ant bee', '## cow dog', '### elk fox', '#### gnu hen', '##### ibis jay', '###### kiwi lynx', '',
      'moth newt', '=========', '', 'owl pig', '-------',
    ].join('\n'),
  },
  {
    name: 'paragraphs and inline marks',
    revealMoves: true,
    draws: ['p', 'strong', 'em', ':not(pre) > code', 'a', 'del'],
    note: [
      'quail rat **seal toad** urial *vole wolf* xerus `yak zebra` [bat cat](http://x.y) ~~emu fig~~ gull', '',
      'hare ibex', 'koala langur', 'mole nutria',
    ].join('\n'),
  },
  {
    name: 'lists',
    revealMoves: true,
    draws: ['ul', 'ol', 'li.task'],
    note: ['- mule nene', '- oryx panda', '  - quokka rhea', '', '1. sable tapir', '2. uguisu vervet', '', '- [ ] wombat xenops', '- [x] yapok zorilla'].join('\n'),
  },
  {
    name: 'quotes and code',
    revealMoves: true,
    draws: ['blockquote', 'pre'],
    note: ['> aphid beetle', '> cicada dingo', '', '```', 'egret finch', 'gecko heron', '```', '', '    impala jackal'].join('\n'),
  },
  {
    name: 'tables and rules',
    revealMoves: true,
    draws: ['table', 'hr'],
    note: ['| koala | llama |', '|-------|-------|', '| magpie | numbat |', '| ocelot | possum |', '', '---', '', 'raven stoat'].join('\n'),
  },
];

const near = (box: Box) => `${box.left.toFixed(1)}, ${box.top.toFixed(1)}`;

async function drawWholeNote(editor: Editing, sample: Sample) {
  const { browser, page } = editor.fixtures;
  await editor.open(sample.note);
  await editor.press('Escape');
  await page.nextFrame();
  const { words, links } = await drawnWords(browser);
  const repeated = words.filter((word) => sample.note.split(word).length !== 2);
  expect(repeated, `words of "${sample.name}" that appear more than once in its note`).toEqual([]);
  expect(words.length, `words of "${sample.name}"`).toBeGreaterThanOrEqual(8);
  return { words, links };
}

const pendingReveal = 'pending the decision on how hidden marks reveal on a click';

for (const sample of samples) {
  test(`a click on a word in ${sample.name} leaves the word where it was`, async (fixtures) => {
    if (sample.revealMoves) test.fail(pendingReveal);
    const editor = new Editing(fixtures);
    const { browser, page } = fixtures;
    const { words } = await drawWholeNote(editor, sample);
    const moved: string[] = [];

    for (const word of words) {
      const before = await wordAt(browser, word);
      if (!before.drawn || !before.aim) {
        moved.push(`"${word}" is not drawn on the page`);
        continue;
      }
      await editor.clickAt(before.aim.x, before.aim.y);
      await page.nextFrame();
      const after = await wordAt(browser, word);
      const now = after.typed ?? after.drawn;
      if (!now) moved.push(`"${word}" is nowhere after the click`);
      else if (Math.abs(now.left - before.drawn.left) > 1 || Math.abs(now.top - before.drawn.top) > 1) {
        moved.push(`"${word}" was at ${near(before.drawn)} and is at ${near(now)}`);
      }
      await editor.press('Escape');
      await page.nextFrame();
    }

    expect(moved, 'words that moved when they were clicked').toEqual([]);
  });

  test(`a double click on a word in ${sample.name} selects the word`, async ({ app, browser }) => {
    await app.open('/blank');
    const origin = new URL(await browser.url()).origin;
    const selected: string[] = [];
    await withRawPage(origin, sample.note, async (raw) => {
      await raw.keyboard.press('Escape');
      await raw.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const { words } = await raw.evaluate(drawnWordsInPage);
      expect(words.length, `words of "${sample.name}"`).toBeGreaterThanOrEqual(8);
      for (const word of words) {
        await raw.evaluate(() => navigator.clipboard.writeText('nothing selected'));
        await clickSeries(raw, { word, at: Math.floor(word.length / 2) }, 2);
        await raw.keyboard.press('Control+c');
        const copied = (await raw.evaluate(() => navigator.clipboard.readText())).trim();
        if (copied !== word) selected.push(`"${word}" double clicked selects ${JSON.stringify(copied)}`);
        await raw.keyboard.press('Escape');
        await raw.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      }
    });
    expect(selected, 'words a double click did not select').toEqual([]);
  });

  test(`a click with a hand that moves a pixel or two on a word in ${sample.name} selects nothing`, async (fixtures) => {
    const editor = new Editing(fixtures);
    const { browser, page } = fixtures;
    const { words } = await drawWholeNote(editor, sample);
    const slips = [
      [2, 0],
      [0, 2],
      [-1, 1],
      [1, -1],
    ] as const;
    const selected: string[] = [];

    for (const [index, word] of words.entries()) {
      const { aim } = await wordAt(browser, word);
      if (!aim) {
        selected.push(`"${word}" is not drawn on the page`);
        continue;
      }
      const [dx, dy] = slips[index % slips.length]!;
      await browser.mouse.move(aim.x, aim.y);
      await browser.mouse.down();
      await browser.mouse.move(aim.x + dx, aim.y + dy);
      await browser.mouse.up();
      await page.nextFrame();
      const held = await browser.evaluate(() => {
        const field = document.querySelector<HTMLTextAreaElement>('[data-test-id="editor"]');
        const inField = field ? field.value.slice(field.selectionStart, field.selectionEnd) : '';
        return { inField, drawn: getSelection()?.toString() ?? '', painted: CSS.highlights.size };
      });
      if (held.inField !== '' || held.drawn !== '' || held.painted > 0) {
        selected.push(`"${word}" pressed and moved by ${dx}, ${dy} selects ${JSON.stringify(held.inField || held.drawn || `${held.painted} painted ranges`)}`);
      }
      await editor.press('Escape');
      await page.nextFrame();
    }

    expect(selected, 'words where a click that slipped selected something').toEqual([]);
  });

  test(`the sample of ${sample.name} draws the kinds it claims`, async (fixtures) => {
    const editor = new Editing(fixtures);
    await drawWholeNote(editor, sample);
    const drawn = await fixtures.browser.evaluate(
      (kinds: string[]) => kinds.filter((kind) => document.querySelector(`[data-test-id="preview"] ${kind}`) !== null),
      everyKind,
    );
    expect(sample.draws.filter((kind) => !drawn.includes(kind)), 'kinds the sample no longer draws').toEqual([]);
  });
}

test('the samples between them draw every kind of block and inline the parser makes', async ({ app }) => {
  await app.open('/blank');
  const claimed = new Set(samples.flatMap((sample) => sample.draws));
  expect(everyKind.filter((kind) => !claimed.has(kind))).toEqual([]);
});

for (const marks of ['#', '###', '######']) {
  test(`a click on a heading of "${marks}" that wraps over lines leaves its words where the page drew them`, async (fixtures) => {
    const { browser, page } = fixtures;
    const editor = new Editing(fixtures);
    const words = Array.from({ length: 40 }, (_, index) => `w${index}x`);
    await editor.open(`${marks} ${words.join(' ')}\n\nbelow`);
    await editor.press('Escape');
    await page.nextFrame();
    const drawn = await Promise.all(words.map((word) => wordAt(browser, word)));
    const rows = new Set(drawn.map((word) => Math.round(word.drawn!.top)));
    expect(rows.size, 'lines the heading is drawn over').toBeGreaterThan(1);
    await editor.clickAt(drawn[0]!.aim!.x, drawn[0]!.aim!.y);
    await page.nextFrame();

    const moved: string[] = [];
    for (const [index, word] of words.entries()) {
      const before = drawn[index]!.drawn!;
      const now = (await wordAt(browser, word)).typed;
      if (!now) moved.push(`"${word}" is not in the field`);
      else if (Math.abs(now.left - before.left) > 1 || Math.abs(now.top - before.top) > 1) moved.push(`"${word}" was at ${near(before)} and is at ${near(now)}`);
    }
    expect(moved, 'words that moved when the heading was clicked').toEqual([]);
  });
}
