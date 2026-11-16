import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { noticed, problemsWithTable, verify } from './browser-facts.ts';
import type { Fact } from './browser-facts.ts';
import { facts } from './browser-facts-table.ts';

/**
 * What nullpad assumes about Chromium, one test per fact, on a plain page and
 * not in the app, so that a change in Chromium fails here first and says
 * which. Then the same facts again, each with its sabotage planted: a fact
 * that still holds then would not have seen a real change either.
 * `browser-facts-table.ts` has the facts, and `browser-facts.ts` what they run on.
 */

const files = (fact: Fact) => [...new Set(fact.relied.map((reliance) => reliance.file.split('/').pop()))].join(', ');

test('the table of facts has no repeated id, and every fact can be shown to fail', () => {
  expect(problemsWithTable(facts)).toEqual([]);
});

for (const fact of facts) {
  test(`${fact.id} (${files(fact)}): ${fact.says}`, async () => {
    await verify(fact);
  });
}

for (const fact of facts.filter((candidate) => candidate.breaks)) {
  test(`${fact.id}: is noticed when Chromium stops doing it`, async () => {
    await noticed(fact);
  });
}
