import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { fact, locate, noticed, problemsWithTable, sources, verify } from './browser-facts.ts';
import type { Fact } from './browser-facts.ts';

/**
 * Break cases for the machinery under `browser-facts.e2e.ts`: how a fact
 * finds the code that relies on it, how it fails when Chromium changes, and
 * how its own sabotage proves it can fail. Each uses a toy fact on a plain
 * page, so that a fact that is wrong is not hidden by a table that is right.
 */

async function inSource(files: Record<string, string>, run: (root: string) => Promise<void> | void) {
  const root = mkdtempSync(join(tmpdir(), 'facts-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, name)), { recursive: true });
      writeFileSync(join(root, name), text);
    }
    await run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** What the promise failed with. A promise that is kept is itself the failure. */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('it did not fail');
}

const toySource = { 'src/toy.mjs': 'let one = 1;\nconst two = 1 + 1;\nexport { one, two };\n' };

type Answer = { answer?: number };

const toy = (over: Partial<Fact> = {}): Fact => ({
  ...fact<number>({
    id: 'toy-addition',
    says: 'one plus one is two',
    relied: [{ file: 'src/toy.mjs', text: 'const two = 1 + 1;' }],
    observe: (page) => page.evaluate(() => (globalThis as Answer).answer ?? 1 + 1),
    holds: (seen) => (seen === 2 ? null : `it added up to ${seen}`),
    breaks: async (page) => {
      await page.evaluate(() => {
        (globalThis as Answer).answer = 3;
      });
    },
  }),
  ...over,
});

test('locate: names the line of a snippet, counted from 1', async () => {
  await inSource(toySource, (root) => {
    expect(locate({ file: 'src/toy.mjs', text: 'const two = 1 + 1;' }, root)).toEqual({ file: 'src/toy.mjs', line: 2 });
    expect(locate({ file: 'src/toy.mjs', text: 'let one = 1;' }, root)).toEqual({ file: 'src/toy.mjs', line: 1 });
  });
});

test('locate: names the first line of a snippet that spans lines', async () => {
  await inSource(toySource, (root) => {
    expect(locate({ file: 'src/toy.mjs', text: 'const two = 1 + 1;\nexport' }, root)).toEqual({ file: 'src/toy.mjs', line: 2 });
  });
});

test('locate: a snippet that is no longer in the file says so and what to do about it', async () => {
  await inSource(toySource, (root) => {
    let message = '';
    try {
      locate({ file: 'src/toy.mjs', text: 'const two = 2;' }, root);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('src/toy.mjs');
    expect(message).toContain('const two = 2;');
    expect(message).toMatch(/update the fact|remove the fact/);
  });
});

test('locate: a snippet that is in the file twice cannot name a line', async () => {
  await inSource({ 'src/twice.mjs': 'a();\nb();\na();\n' }, (root) => {
    let message = '';
    try {
      locate({ file: 'src/twice.mjs', text: 'a();' }, root);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/2 times|twice/);
    expect(message).toContain('src/twice.mjs');
  });
});

test('locate: a file that is not there is named', async () => {
  await inSource(toySource, (root) => {
    let message = '';
    try {
      locate({ file: 'src/gone.mjs', text: 'x' }, root);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('src/gone.mjs');
  });
});

test('sources: file and line of each reliance, and none for a pending fact', async () => {
  await inSource(toySource, (root) => {
    const both = toy({ relied: [{ file: 'src/toy.mjs', text: 'const two = 1 + 1;' }, { file: 'src/toy.mjs', text: 'let one = 1;' }] });
    expect(sources(both, root)).toEqual(['src/toy.mjs:2', 'src/toy.mjs:1']);
    const pending = toy({ pending: 'it is for a branch that is not merged', relied: [{ file: 'src/gone.mjs', text: 'x' }] });
    expect(sources(pending, root)).toEqual([]);
  });
});

test('verify: a fact that holds passes', async () => {
  await inSource(toySource, async (root) => {
    await verify(toy(), root);
  });
});

test('verify: a fact Chromium no longer holds fails, saying which Chromium, which fact, what it did, and where the app relies on it', async () => {
  await inSource(toySource, async (root) => {
    const changed = toy({ observe: async () => 5 });
    const message = await failure(verify(changed, root));
    expect(message).toMatch(/Chromium \d+\.\d+\.\d+\.\d+/);
    expect(message).toContain('toy-addition');
    expect(message).toContain('one plus one is two');
    expect(message).toContain('it added up to 5');
    expect(message).toContain('src/toy.mjs:2');
  });
});

test('verify: a source that moved fails before the browser is asked anything', async () => {
  await inSource({ 'src/toy.mjs': 'const two = 2;\n' }, async (root) => {
    let asked = false;
    const moved = toy({
      observe: async () => {
        asked = true;
        return 2;
      },
    });
    const message = await failure(verify(moved, root));
    expect(message).toContain('src/toy.mjs');
    expect(message).toMatch(/update the fact|remove the fact/);
    expect(asked).toBe(false);
  });
});

test('verify: a pending fact needs no source, and says it is pending when it fails', async () => {
  await inSource({}, async (root) => {
    const pending = toy({ pending: 'the branch that adds it is not merged', relied: [{ file: 'src/gone.mjs', text: 'x' }] });
    await verify(pending, root);
    const failing = toy({ pending: 'the branch that adds it is not merged', observe: async () => 7 });
    const message = await failure(verify(failing, root));
    expect(message).toContain('the branch that adds it is not merged');
    expect(message).toContain('it added up to 7');
  });
});

test('noticed: gives what the fact said once the sabotage made it fail', async () => {
  expect(await noticed(toy())).toBe('it added up to 3');
});

test('noticed: fails when the sabotage does not make the fact fail, so the fact would not have seen the change either', async () => {
  const blind = toy({ breaks: async () => {} });
  const message = await failure(noticed(blind));
  expect(message).toContain('toy-addition');
  expect(message).toMatch(/did not notice/);
});

test('noticed: fails for a fact that has no sabotage', async () => {
  const bare = toy({ breaks: undefined });
  const message = await failure(noticed(bare));
  expect(message).toContain('toy-addition');
  expect(message).toMatch(/no sabotage|unbreakable/);
});

test('problemsWithTable: a clean table has none', () => {
  const second = toy({ id: 'toy-other', breaks: undefined, unbreakable: 'nothing can make this fail' });
  const pending = toy({ id: 'toy-pending', pending: 'not merged yet' });
  expect(problemsWithTable([toy(), second, pending])).toEqual([]);
});

test('problemsWithTable: names a repeated id, a fact that cannot be shown to fail, one that claims both, and one with no source', () => {
  const problems = problemsWithTable([
    toy(),
    toy({ says: 'the same id again' }),
    toy({ id: 'toy-no-way', breaks: undefined }),
    toy({ id: 'toy-both', unbreakable: 'but it has a sabotage too' }),
    toy({ id: 'toy-no-source', relied: [] }),
  ]);
  const all = problems.join('\n');
  expect(all).toMatch(/toy-addition.*(twice|more than once|repeated)/s);
  expect(all).toMatch(/toy-no-way.*(sabotage|unbreakable)/s);
  expect(all).toMatch(/toy-both.*(both|sabotage)/s);
  expect(all).toMatch(/toy-no-source.*(relied|source)/s);
  expect(problems).toHaveLength(4);
});
