import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { noticed, problemsWithTable, verify } from './browser-facts.ts';
import type { Fact } from './browser-facts.ts';
import { facts } from './browser-facts-table.ts';

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
