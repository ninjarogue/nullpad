import type { BrowserContextOptions, Page } from 'playwright-core';

/** Code of the app that a fact lets it rely on: a file from the repository root, and text that is in it exactly once. */
export type Reliance = { file: string; text: string };

export type Fact = {
  id: string;
  says: string;
  relied: Reliance[];
  pending?: string;
  html?: string;
  context?: BrowserContextOptions;
  observe(page: Page): Promise<unknown>;
  holds(seen: any): string | null;
  breaks?(page: Page): Promise<void>;
  unbreakable?: string;
};

const unwritten = (): never => {
  throw new Error('not written yet');
};

export const repoRoot = '';

export function fact<Seen>(
  entry: Omit<Fact, 'observe' | 'holds'> & { observe(page: Page): Promise<Seen>; holds(seen: Seen): string | null },
): Fact {
  return entry as Fact;
}

export function locate(_reliance: Reliance, _root?: string): { file: string; line: number } {
  return unwritten();
}

export function sources(_fact: Fact, _root?: string): string[] {
  return unwritten();
}

export async function verify(_fact: Fact, _root?: string): Promise<void> {
  return unwritten();
}

export async function noticed(_fact: Fact): Promise<string> {
  return unwritten();
}

export function problemsWithTable(_facts: Fact[]): string[] {
  return unwritten();
}
