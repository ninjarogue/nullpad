import { expect } from 'e2e';
import { test } from './nullpad.ts';

test.beforeEach(async ({ app, page }) => {
  await app.open('/');
  await expect(page.text).toBeFocused();
});

test('headings show at their level', async ({ page }) => {
  await page.text.fill('# a\n## b\n### c\n#### d\n##### e\n###### f');
  await page.showPage();

  await expect(page.preview.getByRole('heading')).toHaveText(['a', 'b', 'c', 'd', 'e', 'f']);
  for (const [level, name] of ['a', 'b', 'c', 'd', 'e', 'f'].entries()) {
    await expect(page.preview.getByRole('heading', name, { level: level + 1 })).toBeVisible();
  }
  await expect(page.paragraphs).toHaveCount(0);
});

test('lines with no blank line between are one paragraph, a blank line starts the next', async ({
  page,
}) => {
  await page.text.fill('one\ntwo\n\nthree');
  await page.showPage();

  await expect(page.paragraphs).toHaveText(['one two', 'three']);
});

test('more blank lines than one still only separate paragraphs', async ({ page }) => {
  await page.text.fill('one\n\n\n\ntwo\n\n');
  await page.showPage();

  await expect(page.paragraphs).toHaveText(['one', 'two']);
  await expect(page.everything).toHaveCount(2);
});

test('text that only looks like a heading stays a paragraph', async ({ page }) => {
  await page.text.fill('#hashtag\n\n####### seven');
  await page.showPage();

  await expect(page.paragraphs).toHaveText(['#hashtag', '####### seven']);
  await expect(page.preview.getByRole('heading')).toHaveCount(0);
});

test('a heading ends the paragraph above it', async ({ page }) => {
  await page.text.fill('before\n## Middle\nafter');
  await page.showPage();

  await expect(page.paragraphs).toHaveText(['before', 'after']);
  await expect(page.preview.getByRole('heading', 'Middle', { level: 2 })).toBeVisible();
});

test('the page shows the edit made after the last preview', async ({ page }) => {
  await page.text.fill('# First\n\nold words');
  await page.showPage();
  await expect(page.preview.getByRole('heading', 'First', { level: 1 })).toBeVisible();
  await expect(page.paragraphs).toHaveText(['old words']);

  await page.showMarkdown();
  await page.text.fill('## Second\n\nnew words\n\nmore words');
  await page.showPage();

  await expect(page.preview.getByRole('heading')).toHaveText(['Second']);
  await expect(page.preview.getByRole('heading', 'Second', { level: 2 })).toBeVisible();
  await expect(page.paragraphs).toHaveText(['new words', 'more words']);
});

test('Ctrl+E also shows the edit made in the markdown', async ({ page }) => {
  await page.text.fill('# First');
  await page.pressMarkdownShortcut();
  await page.stopEditing();
  await expect(page.preview.getByRole('heading', 'First', { level: 1 })).toBeVisible();

  await page.text.focus();
  await page.pressMarkdownShortcut();
  await page.text.fill('# Second');
  await page.pressMarkdownShortcut();
  await page.stopEditing();

  await expect(page.preview.getByRole('heading')).toHaveText(['Second']);
});

test('bold shows as strong text', async ({ page }) => {
  await page.text.fill('a **b** c');
  await page.showPage();

  await expect(page.strong).toHaveText(['b']);
  await expect(page.paragraphs).toHaveText(['a b c']);
});

test('italic shows as emphasis', async ({ page }) => {
  await page.text.fill('a *b* c');
  await page.showPage();

  await expect(page.emphasis).toHaveText(['b']);
  await expect(page.paragraphs).toHaveText(['a b c']);
});

test('emphasis may open on one line of a paragraph and close on the next', async ({ page }) => {
  await page.text.fill('one *two\nthree* four');
  await page.showPage();

  await expect(page.emphasis).toHaveText(['two three']);
  await expect(page.paragraphs).toHaveText(['one two three four']);
});

test('each line of a paragraph shows on its own line', async ({ browser, page }) => {
  await page.text.fill('milk\neggs\n\nbread');
  await page.showPage();

  await expect(page.paragraphs).toHaveCount(2);
  const shown = () => browser.evaluate(() => document.querySelector('p')?.innerText ?? null);
  await expect.poll(shown).toBe('milk\neggs');
});

test('a note that opens with unclosed bold is listed as its page shows it', async ({ page }) => {
  await page.text.fill('**bold and more');
  await page.showPage();

  await expect(page.paragraphs).toHaveText(['**bold and more']);
  await expect(page.currentRow).toHaveText('**bold and more');
});

test('inline code shows as code', async ({ page }) => {
  await page.text.fill('run `go **build**` now');
  await page.showPage();

  await expect(page.code).toHaveText(['go **build**']);
  await expect(page.strong).toHaveCount(0);
  await expect(page.paragraphs).toHaveText(['run go **build** now']);
});

test('a link opens in a new tab', async ({ page }) => {
  await page.text.fill('see [docs](https://example.com/) here');
  await page.showPage();

  const link = page.preview.getByRole('link', 'docs');
  await expect(link).toHaveAttribute('href', 'https://example.com/');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(page.paragraphs).toHaveText(['see docs here']);
});

test('a link title shows when the pointer rests on the link', async ({ page }) => {
  await page.text.fill('see [docs](https://example.com/ "The manual") here');
  await page.showPage();

  const link = page.preview.getByRole('link', 'docs');
  await expect(link).toHaveAttribute('href', 'https://example.com/');
  await expect(link).toHaveAttribute('title', 'The manual');
  await expect(page.paragraphs).toHaveText(['see docs here']);
});

test('a javascript: link shows as the text typed', async ({ page }) => {
  await page.text.fill('[x](javascript:alert(1))');
  await page.showPage();

  await expect(page.paragraphs).toHaveText(['[x](javascript:alert(1))']);
  await expect(page.preview.getByRole('link')).toHaveCount(0);
  await expect(page.everything).toHaveCount(1);
});

test('a line nested thousands of levels deep still shows', async ({ page }) => {
  await page.text.fill('*a '.repeat(3000) + 'b' + ' a*'.repeat(3000));
  await page.showPage();

  await expect(page.paragraphs).toHaveCount(1);
  await expect(page.emphasis).toHaveCount(32);
});
