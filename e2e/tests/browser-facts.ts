import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'oxc-parser';
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

/** Code of the app that a fact lets it rely on: a file under `src/` or `assets/` from the repository root, and text that is in it exactly once. */
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
  /** An https address the page is served at, so that it is a secure context, as the clipboard needs. Without one, the page has no address. */
  url?: string;
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

type Span = [start: number, end: number];

/** Where in a file the text is not code: comments, strings and regular expressions, and for CSS the rules that code is in. */
type Reading = { comments: Span[]; strings: Span[]; rules?: Span[]; regexes?: Span[] };

type Node = { type: string; start: number; end: number; value?: unknown; [key: string]: unknown };

function visit(node: Node, run: (node: Node) => void) {
  run(node);
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child !== null && typeof child === 'object' && typeof (child as Node).type === 'string') visit(child as Node, run);
    }
  }
}

function readScript(file: string, source: string): Reading {
  const { program, comments, errors } = parseSync(file, source);
  if (errors.length > 0) throw new Error(`${file} cannot be parsed (${errors[0]!.message}), so it cannot be told what is code. ${moved}`);
  const strings: Span[] = [];
  const regexes: Span[] = [];
  visit(program as unknown as Node, (node) => {
    if (node.type === 'Literal' && typeof node.value === 'string') strings.push([node.start + 1, node.end - 1]);
    if (node.type === 'Literal' && node.regex) regexes.push([node.start, node.end]);
    if (node.type === 'TemplateElement') strings.push([node.start, node.end]);
  });
  return { comments: comments.map((comment) => [comment.start, comment.end]), strings, regexes };
}

/** The end of the string that starts at `at`, after its closing quote. */
function endOfString(source: string, at: number): number {
  const quote = source[at];
  for (let index = at + 1; index < source.length; index++) {
    if (source[index] === '\\') index++;
    else if (source[index] === quote) return index + 1;
  }
  return source.length;
}

function readGleam(source: string): Reading {
  const comments: Span[] = [];
  const strings: Span[] = [];
  for (let at = 0; at < source.length; at++) {
    if (source[at] === '"') {
      const end = endOfString(source, at);
      strings.push([at + 1, end - 1]);
      at = end - 1;
    } else if (source.startsWith('//', at)) {
      const newline = source.indexOf('\n', at);
      const end = newline < 0 ? source.length : newline;
      comments.push([at, end]);
      at = end - 1;
    }
  }
  return { comments, strings };
}

function readCss(source: string): Reading {
  const comments: Span[] = [];
  const strings: Span[] = [];
  const rules: Span[] = [];
  let depth = 0;
  let statement: number | null = null;
  for (let at = 0; at < source.length; at++) {
    const char = source[at]!;
    if (source.startsWith('/*', at)) {
      const close = source.indexOf('*/', at + 2);
      const end = close < 0 ? source.length : close + 2;
      comments.push([at, end]);
      at = end - 1;
      continue;
    }
    if (/\s/.test(char)) continue;
    if (depth === 0 && statement === null) statement = at;
    if (char === '"' || char === "'") {
      const end = endOfString(source, at);
      strings.push([at + 1, end - 1]);
      at = end - 1;
    } else if (char === '{') {
      depth++;
    } else if (char === '}' && depth > 0) {
      depth--;
      if (depth === 0 && statement !== null) rules.push([statement, at + 1]);
      if (depth === 0) statement = null;
    } else if (char === ';' && depth === 0) {
      statement = null;
    }
  }
  return { comments, strings, rules };
}

/** How to tell code from what is not in `file`, by its kind. */
function reader(file: string): (source: string) => Reading {
  if (/\.[cm]?[jt]s$/.test(file)) return (source) => readScript(file, source);
  if (file.endsWith('.gleam')) return readGleam;
  if (file.endsWith('.css')) return readCss;
  throw new Error(`${file}: cannot tell code from comments in this kind of file. Rely on a .mjs, .ts, .gleam or .css file.`);
}

/** `file` as a path from the repository root, or an error when it is not under `src/` or `assets/`, which is where the code of the app is. */
function inApp(file: string): string {
  const path = posix.normalize(file);
  if (!['src/', 'assets/'].some((folder) => path.startsWith(folder))) {
    throw new Error(`${file} is not under src/ or assets/, so it is not code of the app. A fact about a test, a tool or a build output holds whether or not the app relies on it.`);
  }
  return path;
}

const within = (spans: Span[], start: number, end: number) => spans.some(([from, to]) => from <= start && end <= to);
const overlaps = (spans: Span[], start: number, end: number) => spans.some(([from, to]) => start < to && from < end);

type Found = { source: string; code: number[]; elsewhere: string[] };

/** Where `text` is in `file`: the offsets where it is code, and for each place it is not, why not. */
function find({ file, text }: Reliance, root: string): Found {
  const reading = reader(file);
  const path = inApp(file);
  let source: string;
  try {
    source = readFileSync(join(root, path), 'utf8');
  } catch {
    throw new Error(`${file} is not there. ${moved}`);
  }
  const at: number[] = [];
  for (let index = source.indexOf(text); index >= 0; index = source.indexOf(text, index + 1)) at.push(index);
  if (at.length === 0) return { source, code: [], elsewhere: [] };
  const reads = reading(source);
  const code: number[] = [];
  const elsewhere = new Set<string>();
  for (const start of at) {
    const end = start + text.length;
    if (overlaps(reads.comments, start, end)) elsewhere.add('in a comment');
    else if (reads.rules && !within(reads.rules, start, end)) elsewhere.add('where it is not in a rule');
    else if (within(reads.strings, start, end)) elsewhere.add('in a string');
    else if (reads.regexes && within(reads.regexes, start, end)) elsewhere.add('in a regular expression');
    else code.push(start);
  }
  return { source, code, elsewhere: [...elsewhere] };
}

const lineOf = (source: string, offset: number) => source.slice(0, offset).split('\n').length;

/**
 * The line, counted from 1, where `text` starts in `file`. It has to be code,
 * and there once: text in a comment, a string or a regular expression, or in
 * CSS outside a rule, is not code that relies on anything, and is not counted.
 * CSS counts as a rule wherever braces make one, so a rule in `@media not all`
 * or in an `@supports` that never matches is counted as one that applies.
 */
export function locate(reliance: Reliance, root = repoRoot): { file: string; line: number } {
  const { file, text } = reliance;
  const { source, code, elsewhere } = find(reliance, root);
  if (code.length === 0 && elsewhere.length > 0) {
    throw new Error(`${file} has this only ${elsewhere.join(' and ')}, which is not code:\n${indented(text)}\n${moved}`);
  }
  if (code.length === 0) throw new Error(`${file} no longer contains:\n${indented(text)}\n${moved}`);
  if (code.length > 1) throw new Error(`${file} contains this ${code.length} times, so it names no line:\n${indented(text)}\nUse text that is in it once.`);
  return { file, line: lineOf(source, code[0]!) };
}

/**
 * `file:line` of each piece of code that relies on `fact`. A pending fact has
 * none yet, and fails once any code of it is there, because then it is not
 * pending any more.
 */
export function sources(fact: Fact, root = repoRoot): string[] {
  if (fact.pending) {
    const landed = fact.relied.flatMap((reliance) => {
      try {
        const { source, code } = find(reliance, root);
        return code.map((offset) => `${reliance.file}:${lineOf(source, offset)}`);
      } catch {
        return [];
      }
    });
    if (landed.length > 0) {
      throw new Error(
        `[${fact.id}] pending fact now holds in source: un-pend it\n` +
          `  The code is at ${landed.join(', ')}, so the fact is no longer waiting for a branch (${fact.pending}).\n` +
          `  Remove its pending reason, so that it names where the app relies on it.`,
      );
    }
    return [];
  }
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
    const html = fact.html ?? '<!doctype html><body></body>';
    if (fact.url) {
      await page.route(fact.url, (route) => route.fulfill({ contentType: 'text/html', body: html }));
      await page.goto(fact.url);
    } else {
      await page.setContent(html);
    }
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

/** What a look at a page never gives. A `holds` that takes one of these for a fact that holds passes without looking at anything. */
export const nothingSeen: unknown[] = [undefined, null, {}, [], 0, NaN, '', 'x', false, true, 1, [0], [null], { a: 1 }, { a: [] }, { platform: '', agent: '' }, { platform: 'Linux', agent: 'x' }];

/** The values of `nothingSeen` that the fact's `holds` takes for a fact that holds. One that throws on them does not take them. */
export function takenForNothing(entry: Fact): string[] {
  return nothingSeen
    .filter((value) => {
      try {
        return entry.holds(value) === null;
      } catch {
        return false;
      }
    })
    .map((value) => (typeof value === 'number' && Number.isNaN(value) ? 'NaN' : (JSON.stringify(value) ?? 'undefined')));
}

/** What is wrong with the table as a whole: the same id twice, a fact that cannot be shown to fail, one that has no code to name or names a file outside `src/` and `assets/`, one that holds for what no look at a page gives. */
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
    for (const { file } of entry.relied) {
      try {
        inApp(file);
      } catch (error) {
        problems.push(`[${entry.id}] ${(error as Error).message}`);
      }
    }
    const taken = takenForNothing(entry);
    if (taken.length > 0) problems.push(`[${entry.id}] holds takes what no look at a page gives, so it would pass without looking: ${taken.slice(0, 4).join(', ')}${taken.length > 4 ? ', ...' : ''}`);
  }
  return problems;
}
