import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { fact, locate, noticed, problemsWithTable, sources, takenForNothing, verify } from './browser-facts.ts';
import type { Fact, Reliance } from './browser-facts.ts';
import { facts } from './browser-facts-table.ts';

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

/** What `locate` said when it could not name a line. A snippet that is found is itself the failure. */
function missed(reliance: Reliance, root: string): string {
  try {
    locate(reliance, root);
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error(`${reliance.file} was found to contain ${reliance.text}`);
}

/** What a call that must throw said. */
function thrown(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('it did not throw');
}

test('locate: text that is only in a comment is not code that relies on anything', async () => {
  await inSource(
    {
      'src/line.mjs': '// requestAnimationFrame(keep);\nrun();\n',
      'src/block.mjs': '/* requestAnimationFrame(keep); */\nrun();\n',
      'src/tail.mjs': 'run(); // then requestAnimationFrame(keep)\n',
      'src/inside.ts': 'const a: number = /* requestAnimationFrame(keep) */ 1;\n',
      'src/line.gleam': '// list.map(rows)\npub fn a() { 1 }\n',
      'src/doc.gleam': '/// a doc comment that says list.map(rows)\npub fn a() { 1 }\n',
      'src/tail.gleam': 'pub fn a() { 1 } // list.map(rows)\n',
    },
    (root) => {
      for (const [file, text] of [
        ['src/line.mjs', 'requestAnimationFrame(keep);'],
        ['src/block.mjs', 'requestAnimationFrame(keep);'],
        ['src/tail.mjs', 'requestAnimationFrame(keep)'],
        ['src/inside.ts', 'requestAnimationFrame(keep)'],
        ['src/line.gleam', 'list.map(rows)'],
        ['src/doc.gleam', 'list.map(rows)'],
        ['src/tail.gleam', 'list.map(rows)'],
      ]) {
        const message = missed({ file, text }, root);
        expect(message, `${file}: ${message}`).toMatch(/only in a comment/);
        expect(message).toContain(file);
      }
    },
  );
});

test('locate: a snippet that is in a comment and once in code names the code', async () => {
  await inSource(
    {
      'src/both.mjs': '// keep();\nrun();\nkeep();\n/* keep(); */\n',
      'src/both.gleam': '// list.map(rows)\npub fn a() {\n  list.map(rows)\n}\n',
    },
    (root) => {
      expect(locate({ file: 'src/both.mjs', text: 'keep();' }, root)).toEqual({ file: 'src/both.mjs', line: 3 });
      expect(locate({ file: 'src/both.gleam', text: 'list.map(rows)' }, root)).toEqual({ file: 'src/both.gleam', line: 3 });
    },
  );
});

test('locate: text that is in code twice is still twice when a comment also has it', async () => {
  await inSource({ 'src/twice.mjs': 'keep();\n// keep();\nkeep();\n' }, (root) => {
    expect(missed({ file: 'src/twice.mjs', text: 'keep();' }, root)).toMatch(/2 times/);
  });
});

test('locate: a comment marker inside a string does not start a comment, and a string inside a comment does not start one', async () => {
  await inSource(
    {
      'src/url.mjs': 'const url = "http://example.test"; run();\n',
      'src/quote.mjs': '// it\'s a "quote\nrun();\n',
      'src/url.gleam': 'pub fn a() { "http://example.test" |> run }\n',
      'src/quote.gleam': '// a "quote\npub fn a() { run }\n',
    },
    (root) => {
      expect(locate({ file: 'src/url.mjs', text: 'run();' }, root).line).toBe(1);
      expect(locate({ file: 'src/quote.mjs', text: 'run();' }, root).line).toBe(2);
      expect(locate({ file: 'src/url.gleam', text: '|> run' }, root).line).toBe(1);
      expect(locate({ file: 'src/quote.gleam', text: 'pub fn a() { run }' }, root).line).toBe(2);
    },
  );
});

test('locate: text that is only inside a string is a message and not code that relies on anything', async () => {
  await inSource(
    {
      'src/message.mjs': 'const hint = "call requestAnimationFrame(keep) first";\nrun();\n',
      'src/template.mjs': 'const hint = `call requestAnimationFrame(keep) ${1} first`;\n',
      'src/message.gleam': 'pub fn a() { "list.map(rows) is slow" }\n',
    },
    (root) => {
      for (const [file, text] of [
        ['src/message.mjs', 'requestAnimationFrame(keep)'],
        ['src/template.mjs', 'requestAnimationFrame(keep)'],
        ['src/message.gleam', 'list.map(rows)'],
      ]) {
        const message = missed({ file, text }, root);
        expect(message, `${file}: ${message}`).toMatch(/only in a string/);
      }
    },
  );
});

test('locate: code is found where it sits next to strings, and in the code of a template', async () => {
  await inSource(
    {
      'src/call.mjs': 'on("input", () => run());\n',
      'src/template.mjs': 'const a = `x ${ run() } y`;\n',
      'src/arm.gleam': 'case key {\n  "historyUndo", _ -> on_event(editor.UndoAsked)\n}\n',
    },
    (root) => {
      expect(locate({ file: 'src/call.mjs', text: 'on("input", () => run());' }, root).line).toBe(1);
      expect(locate({ file: 'src/template.mjs', text: 'run()' }, root).line).toBe(1);
      expect(locate({ file: 'src/arm.gleam', text: '"historyUndo", _ -> on_event(editor.UndoAsked)' }, root).line).toBe(2);
    },
  );
});

test('locate: a script that cannot be parsed, and a file it cannot tell code from comment in, are named', async () => {
  await inSource({ 'src/broken.mjs': 'const = ;\n', 'notes.md': 'requestAnimationFrame(keep)\n' }, (root) => {
    expect(missed({ file: 'src/broken.mjs', text: 'const' }, root)).toMatch(/cannot be parsed/);
    expect(missed({ file: 'notes.md', text: 'requestAnimationFrame(keep)' }, root)).toMatch(/cannot tell code from comments/);
  });
});

test('locate: CSS that is only in a comment, or in no rule, is not a rule', async () => {
  await inSource(
    {
      'assets/comment.css': '/* li::marker { line-height: 0 } */\nul { margin: 0 }\n',
      'assets/stray.css': 'ul { margin: 0 }\nli::marker\n',
      'assets/import.css': '@import "li::marker";\nul { margin: 0 }\n',
      'assets/within.css': 'ul { margin: 0 /* li::marker */ }\n',
    },
    (root) => {
      expect(missed({ file: 'assets/comment.css', text: 'li::marker' }, root)).toMatch(/only in a comment/);
      expect(missed({ file: 'assets/within.css', text: 'li::marker' }, root)).toMatch(/only in a comment/);
      expect(missed({ file: 'assets/stray.css', text: 'li::marker' }, root)).toMatch(/not in a rule/);
      expect(missed({ file: 'assets/import.css', text: 'li::marker' }, root)).toMatch(/not in a rule/);
    },
  );
});

test('locate: CSS in a real rule is found, in a media block, after a comment, and past braces in strings and comments', async () => {
  await inSource(
    {
      'assets/media.css': '@media (min-width: 600px) {\n  li::marker { line-height: 0 }\n}\n',
      'assets/after.css': '/* li::marker */\nli::marker { line-height: 0 }\n',
      'assets/braces.css': '.a { /* } */ color: red }\n.b::before { content: "}" }\n.c { color: blue }\n',
    },
    (root) => {
      expect(locate({ file: 'assets/media.css', text: 'li::marker' }, root).line).toBe(2);
      expect(locate({ file: 'assets/after.css', text: 'li::marker' }, root).line).toBe(2);
      expect(locate({ file: 'assets/braces.css', text: 'color: red' }, root).line).toBe(1);
      expect(locate({ file: 'assets/braces.css', text: 'color: blue' }, root).line).toBe(3);
    },
  );
});

test('sources: a pending fact whose code has landed fails, and says to un-pend it', async () => {
  await inSource(toySource, async (root) => {
    const landed = toy({ pending: 'the branch that adds it is not merged', relied: [{ file: 'src/toy.mjs', text: 'const two = 1 + 1;' }] });
    const message = thrown(() => sources(landed, root));
    expect(message).toContain('pending fact now holds in source: un-pend it');
    expect(message).toContain('toy-addition');
    expect(message).toContain('src/toy.mjs:2');
    let asked = false;
    const message2 = await failure(
      verify(
        {
          ...landed,
          observe: async () => {
            asked = true;
            return 2;
          },
        },
        root,
      ),
    );
    expect(message2).toContain('un-pend it');
    expect(asked).toBe(false);
  });
});

test('sources: a pending fact stays pending while its text is only in a comment, and when it is not there at all', async () => {
  await inSource({ 'src/toy.mjs': '// const two = 1 + 1;\nexport {};\n' }, async (root) => {
    const inComment = toy({ pending: 'not merged', relied: [{ file: 'src/toy.mjs', text: 'const two = 1 + 1;' }] });
    expect(sources(inComment, root)).toEqual([]);
    await verify(inComment, root);
    const absent = toy({ pending: 'not merged', relied: [{ file: 'src/toy.mjs', text: 'const three = 3;' }] });
    expect(sources(absent, root)).toEqual([]);
  });
});

test('sources: a pending fact fails when only one of the things it relies on has landed', async () => {
  await inSource(toySource, (root) => {
    const half = toy({ pending: 'not merged', relied: [{ file: 'src/toy.mjs', text: 'const three = 3;' }, { file: 'src/toy.mjs', text: 'let one = 1;' }] });
    expect(thrown(() => sources(half, root))).toContain('un-pend it');
  });
});

test('problemsWithTable: names a fact whose holds takes what no look at a page gives', () => {
  const lax = toy({ id: 'toy-lax', holds: (seen: any) => (seen > 2 ? `it added up to ${seen}` : null) });
  const quiet = toy({ id: 'toy-quiet', holds: (seen: any) => (seen?.sum === 2 ? null : 'it did not add up') });
  const problems = problemsWithTable([toy(), lax, quiet]);
  expect(problems.join('\n')).toMatch(/toy-lax.*(takes|accepts)/s);
  expect(problems).toHaveLength(1);
});

test('problemsWithTable: a holds that throws on what no look gives is not lax, and one that takes a list of nothing is', () => {
  const throwing = toy({ id: 'toy-throws', holds: (seen: any) => (seen.sum === 2 ? null : 'it did not add up') });
  expect(problemsWithTable([throwing])).toEqual([]);
  const empty = toy({ id: 'toy-empty', holds: (seen: any) => (Array.isArray(seen) && seen.length === 0 ? null : 'it fired events') });
  expect(problemsWithTable([empty]).join('\n')).toContain('toy-empty');
});

for (const id of [
  'platform-names-apple-devices',
  'marker-line-height-zero',
  'script-writes-fire-no-input',
  'collapsed-range-in-an-empty-element',
  'desktop-has-hover',
  'touch-device-has-no-hover',
]) {
  test(`${id}: holds takes nothing that no look at a page gives`, () => {
    const entry = facts.find((candidate) => candidate.id === id)!;
    expect(takenForNothing(entry)).toEqual([]);
  });
}

test('verify: a fact with a url is looked at on a page served at that https address, so on a secure context with that html', async () => {
  const look = (page: { evaluate<T>(run: () => T): Promise<T> }) =>
    page.evaluate(() => ({ href: location.href, secure: isSecureContext, text: document.getElementById('x')?.textContent ?? null }));
  const served = (over: Partial<Fact> = {}) =>
    toy({
      id: 'toy-served',
      html: '<p id="x">served</p>',
      observe: look,
      holds: (seen: any) =>
        seen?.href === 'https://toy.test/' && seen.secure === true && seen.text === 'served' ? null : `the page was ${JSON.stringify(seen)}`,
      ...over,
    });
  await inSource(toySource, async (root) => {
    await verify(Object.assign(served(), { url: 'https://toy.test/' }), root);
    const message = await failure(verify(served(), root));
    expect(message).toContain('the page was');
  });
});

test('noticed: the sabotage of a fact with a url is planted on the page served there', async () => {
  const where = toy({
    id: 'toy-served-sabotage',
    html: '<p id="x">served</p>',
    observe: (page) => page.evaluate(() => ({ href: location.href, answer: (globalThis as { answer?: number }).answer ?? null })),
    holds: (seen: any) => {
      if (seen?.href !== 'https://toy.test/') return `the page was at ${seen?.href}`;
      return seen.answer === null ? null : `the page said ${seen.answer}`;
    },
    breaks: async (page) => {
      await page.evaluate(() => {
        (globalThis as { answer?: number }).answer = 3;
      });
    },
  });
  expect(await noticed(Object.assign(where, { url: 'https://toy.test/' }))).toBe('the page said 3');
});
