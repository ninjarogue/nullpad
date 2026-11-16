import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import type { BrowserContextOptions, Page } from 'playwright-core';

/**
 * Things the app assumes about Chromium, each a fact that is looked at on a
 * plain page and not in the app, so that when Chromium changes one, the fact
 * fails first and says which, before anything that stands on it does.
 *
 * `holds` takes what `observe` saw and gives null when the fact holds, and
 * otherwise what Chromium did instead. `breaks` plants, on the page, the
 * change in Chromium the fact exists to notice: a fact that still holds
 * after it would not have seen the change either. A fact that no page can
 * be made to break says why in `unbreakable`.
 */

/** Code of the app that a fact lets it rely on: a file from the repository root, and text that is in it exactly once. */
export type Reliance = { file: string; text: string };

export type Fact = {
  id: string;
  /** What the app assumes, as a sentence. */
  says: string;
  relied: Reliance[];
  /** Why no code relies on it yet, when it is for a branch that is not merged. */
  pending?: string;
  /** The page the fact is looked at on. */
  html?: string;
  context?: BrowserContextOptions;
  observe(page: Page): Promise<unknown>;
  holds(seen: any): string | null;
  breaks?(page: Page): Promise<void>;
  unbreakable?: string;
};

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/** Types `observe` and `holds` to each other, and lets facts about different things share a table. */
export function fact<Seen>(
  entry: Omit<Fact, 'observe' | 'holds'> & { observe(page: Page): Promise<Seen>; holds(seen: Seen): string | null },
): Fact {
  return entry as Fact;
}

const moved = 'Update the fact to the code that relies on it now, or remove the fact if nothing does.';
const indented = (text: string) => text.split('\n').map((line) => `    ${line}`).join('\n');

/** The line, counted from 1, where `text` starts in `file`. It has to be there once, or no line is named. */
export function locate({ file, text }: Reliance, root = repoRoot): { file: string; line: number } {
  let source: string;
  try {
    source = readFileSync(join(root, file), 'utf8');
  } catch {
    throw new Error(`${file} is not there. ${moved}`);
  }
  const first = source.indexOf(text);
  if (first < 0) throw new Error(`${file} no longer contains:\n${indented(text)}\n${moved}`);
  let count = 1;
  for (let at = source.indexOf(text, first + 1); at >= 0; at = source.indexOf(text, at + 1)) count++;
  if (count > 1) throw new Error(`${file} contains this ${count} times, so it names no line:\n${indented(text)}\nUse text that is in it once.`);
  return { file, line: source.slice(0, first).split('\n').length };
}

/** `file:line` of each piece of code that relies on `fact`. A pending fact has none yet. */
export function sources(fact: Fact, root = repoRoot): string[] {
  if (fact.pending) return [];
  return fact.relied.map((reliance) => {
    const { file, line } = locate(reliance, root);
    return `${file}:${line}`;
  });
}

async function look(fact: Fact, sabotage: boolean) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 600 }, ...fact.context });
    const page = await context.newPage();
    await page.setContent(fact.html ?? '<!doctype html><body></body>');
    if (sabotage) await fact.breaks!(page);
    const seen = await fact.observe(page);
    return { version: browser.version(), problem: fact.holds(seen) };
  } finally {
    await browser.close();
  }
}

/** Fails, saying what Chromium did instead, when the fact does not hold. A source that moved fails first. */
export async function verify(fact: Fact, root = repoRoot): Promise<void> {
  const where = sources(fact, root);
  const { version, problem } = await look(fact, false);
  if (problem === null) return;
  const reliedOn = fact.pending ? `nothing yet: ${fact.pending}` : where.join(', ');
  throw new Error(
    `Chromium ${version} no longer does what nullpad relies on [${fact.id}]\n` +
      `  nullpad relies on this: ${fact.says}\n` +
      `  Chromium now: ${problem}\n` +
      `  Relied on by: ${reliedOn}`,
  );
}

/** What the fact says once its sabotage is planted. Fails when it still holds, or when it has no sabotage. */
export async function noticed(fact: Fact): Promise<string> {
  if (!fact.breaks) {
    throw new Error(`[${fact.id}] has no sabotage to show it can fail${fact.unbreakable ? ` (unbreakable: ${fact.unbreakable})` : ''}`);
  }
  const { problem } = await look(fact, true);
  if (problem === null) throw new Error(`[${fact.id}] did not notice its sabotage: it still holds when Chromium is made to do otherwise, so it would not see a real change`);
  return problem;
}

/** What is wrong with the table as a whole: the same id twice, a fact that cannot be shown to fail, one that has no code to name. */
export function problemsWithTable(facts: Fact[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const { id } of facts) {
    if (seen.has(id) && !problems.some((problem) => problem.startsWith(`[${id}] is in the table`))) {
      problems.push(`[${id}] is in the table more than once`);
    }
    seen.add(id);
  }
  for (const entry of facts) {
    if (!entry.breaks && !entry.unbreakable) problems.push(`[${entry.id}] has no sabotage to show it can fail, and no unbreakable reason`);
    if (entry.breaks && entry.unbreakable) problems.push(`[${entry.id}] has a sabotage and says it is unbreakable: it cannot be both`);
    if (entry.relied.length === 0 && !entry.pending) problems.push(`[${entry.id}] names no code that relies on it (relied), and is not pending`);
  }
  return problems;
}
