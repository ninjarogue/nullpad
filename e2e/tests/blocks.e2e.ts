import { expect } from 'e2e';
import { test } from './nullpad.ts';

test.beforeEach(async ({ app, page }) => {
  await app.open('/');
  await expect(page.text).toBeFocused();
});

test('two tildes strike text through', async ({ page }) => {
  await page.text.fill('~~Hi~~ Hello, world!');
  await page.showPage();

  await expect(page.deleted).toHaveText(['Hi']);
  await expect(page.paragraphs).toHaveText(['Hi Hello, world!']);
});

test('one tilde strikes text through', async ({ page }) => {
  await page.text.fill('A proper ~strikethrough~.');
  await page.showPage();

  await expect(page.deleted).toHaveText(['strikethrough']);
  await expect(page.paragraphs).toHaveText(['A proper strikethrough.']);
});

test('three tildes stay text', async ({ page }) => {
  await page.text.fill('~one~ ~~two~~ ~~~three~~~');
  await page.showPage();

  await expect(page.deleted).toHaveText(['one', 'two']);
  await expect(page.paragraphs).toHaveText(['one two ~~~three~~~']);
});

test('strikethrough does not reach across paragraphs', async ({ page }) => {
  await page.text.fill('This ~~has a\n\nnew paragraph~~.');
  await page.showPage();

  await expect(page.deleted).toHaveCount(0);
  await expect(page.paragraphs).toHaveText(['This ~~has a', 'new paragraph~~.']);
});

test('a bullet list shows one item for each line', async ({ page }) => {
  await page.text.fill('- apples\n- pears\n- plums');
  await page.showPage();

  await expect(page.bulletLists).toHaveCount(1);
  await expect(page.items).toHaveText(['apples', 'pears', 'plums']);
  await expect(page.numberedLists).toHaveCount(0);
});

test('a different bullet starts a new list', async ({ page }) => {
  await page.text.fill('- a\n- b\n+ c');
  await page.showPage();

  await expect(page.bulletLists).toHaveCount(2);
  await expect(page.items).toHaveText(['a', 'b', 'c']);
});

test('an ordered list that starts at 3 starts at 3', async ({ page }) => {
  await page.text.fill('3. three\n4. four');
  await page.showPage();

  await expect(page.numberedLists).toHaveCount(1);
  await expect(page.numberedLists).toHaveAttribute('start', '3');
  await expect(page.items).toHaveText(['three', 'four']);
});

test('an ordered list that starts at 0 starts at 0', async ({ page }) => {
  await page.text.fill('0. zero\n1. one');
  await page.showPage();

  await expect(page.numberedLists).toHaveAttribute('start', '0');
});

test('an ordered list that starts at 1 has no start', async ({ page }) => {
  await page.text.fill('1. one\n2. two');
  await page.showPage();

  await expect(page.numberedLists).toHaveCount(1);
  await expect(page.numberedLists).not.toHaveAttribute('start');
});

test('a list nested two spaces in is a list inside the item above', async ({ page }) => {
  await page.text.fill('- a\n  - b\n  - c\n- d');
  await page.showPage();

  await expect(page.bulletLists).toHaveCount(2);
  await expect(page.items).toHaveCount(4);
  await expect(page.inPreview('ul > li > ul > li')).toHaveText(['b', 'c']);
  await expect(page.inPreview('ul > li')).toHaveCount(4);
});

test('an ordered list nests inside a bullet', async ({ page }) => {
  await page.text.fill('- steps\n  1. first\n  2. second');
  await page.showPage();

  await expect(page.inPreview('ul > li > ol > li')).toHaveText(['first', 'second']);
});

test('a tight list has no paragraphs', async ({ page }) => {
  await page.text.fill('- a\n- b\n- c');
  await page.showPage();

  await expect(page.items).toHaveText(['a', 'b', 'c']);
  await expect(page.paragraphs).toHaveCount(0);
});

test('a blank line between items makes a loose list with a paragraph in each item', async ({
  page,
}) => {
  await page.text.fill('- a\n- b\n\n- c');
  await page.showPage();

  await expect(page.items).toHaveText(['a', 'b', 'c']);
  await expect(page.inPreview('li > p')).toHaveText(['a', 'b', 'c']);
});

test('two paragraphs in one item make the whole list loose', async ({ page }) => {
  await page.text.fill('- a\n\n  b\n- c');
  await page.showPage();

  await expect(page.items).toHaveCount(2);
  await expect(page.inPreview('li > p')).toHaveText(['a', 'b', 'c']);
});

test('each line of a tight list item shows on its own line', async ({ page }) => {
  await page.text.fill('- milk\n  eggs\n- bread');
  await page.showPage();

  await expect(page.items).toHaveCount(2);
  await expect.poll(() => page.innerText('li')).toBe('milk\neggs');
});

test('each line of a setext heading shows on its own line', async ({ page }) => {
  await page.text.fill('Foo\nbar\n===');
  await page.showPage();

  await expect(page.preview.getByRole('heading', { level: 1 })).toHaveText(['Foo bar']);
  await expect.poll(() => page.innerText('h1')).toBe('Foo\nbar');
});

test('a quote shows its text inside a quote', async ({ page }) => {
  await page.text.fill('> # Foo\n> bar');
  await page.showPage();

  await expect(page.quotes).toHaveCount(1);
  await expect(page.preview.getByRole('heading', 'Foo', { level: 1 })).toBeVisible();
  await expect(page.inPreview('blockquote > p')).toHaveText(['bar']);
});

test('a line with no > right after a quoted line stays in the quote', async ({ page }) => {
  await page.text.fill('> bar\nbaz');
  await page.showPage();

  await expect(page.quotes).toHaveCount(1);
  await expect(page.paragraphs).toHaveText(['bar baz']);
  await expect(page.inPreview('blockquote > p')).toHaveText(['bar baz']);
});

test('a blank line ends a quote', async ({ page }) => {
  await page.text.fill('> foo\n\n> bar');
  await page.showPage();

  await expect(page.quotes).toHaveCount(2);
  await expect(page.paragraphs).toHaveText(['foo', 'bar']);
});

test('a list inside a quote ends where the quote does', async ({ page }) => {
  await page.text.fill('> - foo\n- bar');
  await page.showPage();

  await expect(page.quotes).toHaveCount(1);
  await expect(page.inPreview('blockquote > ul > li')).toHaveText(['foo']);
  await expect(page.items).toHaveText(['foo', 'bar']);
  await expect(page.bulletLists).toHaveCount(2);
});

test('a lazy line cannot turn a quote into a heading', async ({ page }) => {
  await page.text.fill('> foo\n---');
  await page.showPage();

  await expect(page.quotes).toHaveCount(1);
  await expect(page.paragraphs).toHaveText(['foo']);
  await expect(page.rules).toHaveCount(1);
  await expect(page.preview.getByRole('heading')).toHaveCount(0);
});

test('a fenced code block shows its text as typed, with its language as a class', async ({
  page,
}) => {
  await page.text.fill('```ruby\ndef foo(x)\n  return 3\nend\n```');
  await page.showPage();

  await expect(page.codeBlocks).toHaveCount(1);
  await expect(page.inPreview('pre > code')).toHaveAttribute('class', 'language-ruby');
  await expect.poll(() => page.textContent('pre > code')).toBe('def foo(x)\n  return 3\nend\n');
});

test('only the first word after the fence names the language', async ({ page }) => {
  await page.text.fill('``` ruby startline=3 $%@#$\ndef foo(x)\n```');
  await page.showPage();

  await expect(page.inPreview('pre > code')).toHaveAttribute('class', 'language-ruby');
});

test('a fence with no language has no language class', async ({ page }) => {
  await page.text.fill('```\naaa\n```');
  await page.showPage();

  await expect(page.inPreview('pre > code')).toHaveCount(1);
  await expect(page.inPreview('pre > code')).not.toHaveAttribute('class');
});

test('markdown inside a fence stays text', async ({ page }) => {
  await page.text.fill('```\n# not a heading\n**not bold**\n- not a list\n~~not struck~~\n```');
  await page.showPage();

  await expect.poll(() => page.textContent('pre > code')).toBe(
    '# not a heading\n**not bold**\n- not a list\n~~not struck~~\n',
  );
  await expect(page.preview.getByRole('heading')).toHaveCount(0);
  await expect(page.strong).toHaveCount(0);
  await expect(page.items).toHaveCount(0);
  await expect(page.deleted).toHaveCount(0);
});

test('HTML inside a fence shows as text and makes nothing', async ({ page }) => {
  await page.text.fill('```\n<b>bold</b> <img src=x>\n```');
  await page.showPage();

  await expect.poll(() => page.textContent('pre > code')).toBe('<b>bold</b> <img src=x>\n');
  await expect(page.inPreview('b')).toHaveCount(0);
  await expect(page.inPreview('img')).toHaveCount(0);
});

test('a fence made of tildes is a code block', async ({ page }) => {
  await page.text.fill('~~~\naaa\n~~~');
  await page.showPage();

  await expect.poll(() => page.textContent('pre > code')).toBe('aaa\n');
  await expect(page.deleted).toHaveCount(0);
});

test('a fence that is never closed runs to the end of the note', async ({ page }) => {
  await page.text.fill('```\naaa\n\nbbb');
  await page.showPage();

  await expect.poll(() => page.textContent('pre > code')).toBe('aaa\n\nbbb\n');
  await expect(page.paragraphs).toHaveCount(0);
});

test('lines indented four spaces are a code block', async ({ page }) => {
  await page.text.fill('    a simple\n      indented code block');
  await page.showPage();

  await expect(page.codeBlocks).toHaveCount(1);
  await expect.poll(() => page.textContent('pre > code')).toBe('a simple\n  indented code block\n');
  await expect(page.inPreview('pre > code')).not.toHaveAttribute('class');
});

test('an indented line cannot interrupt a paragraph', async ({ page }) => {
  await page.text.fill('Foo\n    bar');
  await page.showPage();

  await expect(page.paragraphs).toHaveText(['Foo bar']);
  await expect(page.codeBlocks).toHaveCount(0);
});

test('a line of three or more marks is a thematic break', async ({ page }) => {
  await page.text.fill('***\n---\n___');
  await page.showPage();

  await expect(page.rules).toHaveCount(3);
  await expect(page.paragraphs).toHaveCount(0);
});

test('a thematic break splits the text around it', async ({ page }) => {
  await page.text.fill('Foo\n\n---\n\nBar');
  await page.showPage();

  await expect(page.paragraphs).toHaveText(['Foo', 'Bar']);
  await expect(page.rules).toHaveCount(1);
  await expect(page.preview.getByRole('heading')).toHaveCount(0);
});

test('a thematic break ends a list', async ({ page }) => {
  await page.text.fill('- foo\n***\n- bar');
  await page.showPage();

  await expect(page.bulletLists).toHaveCount(2);
  await expect(page.rules).toHaveCount(1);
  await expect(page.items).toHaveText(['foo', 'bar']);
});

test('=== under a line makes a level 1 heading', async ({ page }) => {
  await page.text.fill('Title\n===');
  await page.showPage();

  await expect(page.preview.getByRole('heading')).toHaveText(['Title']);
  await expect(page.preview.getByRole('heading', 'Title', { level: 1 })).toBeVisible();
  await expect(page.paragraphs).toHaveCount(0);
});

test('--- under a line makes a level 2 heading', async ({ page }) => {
  await page.text.fill('Title\n---');
  await page.showPage();

  await expect(page.preview.getByRole('heading')).toHaveText(['Title']);
  await expect(page.preview.getByRole('heading', 'Title', { level: 2 })).toBeVisible();
  await expect(page.rules).toHaveCount(0);
});

test('a line of 10,000 > shows a page and keeps the note as typed', async ({ page }) => {
  const typed = '>'.repeat(10_000);
  await page.text.fill(typed);
  await page.showPage();

  await expect(page.preview).toBeVisible();
  await expect(page.quotes.first()).toBeVisible();

  await page.showMarkdown();
  await expect(page.text).toHaveValue(typed);
});

test('a line of 10,000 "- " is one thematic break', async ({ page }) => {
  const typed = '- '.repeat(10_000);
  await page.text.fill(typed);
  await page.showPage();

  await expect(page.rules).toHaveCount(1);
  await expect(page.items).toHaveCount(0);

  await page.showMarkdown();
  await expect(page.text).toHaveValue(typed);
});

test('a line of 10,000 "- " with text after shows a page and the text', async ({ page }) => {
  await page.text.fill('- '.repeat(10_000) + 'end');
  await page.showPage();

  await expect(page.items.first()).toBeVisible();
  await expect(page.preview).toContainText('end');
});
