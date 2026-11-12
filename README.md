# nullpad

A markdown editor written in [Gleam](https://gleam.run) with
[Lustre](https://lustre.build). It runs in the browser and keeps its notes in
the browser's own storage.

## Development

```sh
gleam run -m lustre/dev start         # Serve the app at http://localhost:1234 and reload on change
gleam test                            # Run the unit tests
gleam run -m architecture_test        # Print what each architecture rule in AGENTS.md examined
node test/keystroke_cost.mjs          # Count the parses one key costs, after gleam test
cd e2e && npm install && npm test     # Run the browser tests
gleam format src test                 # Format the code
```

`gleam test` covers the pure modules: the text buffer, the editor's rules,
markdown and note titles. The browser tests build the app and use it in
Chromium through [e2e](https://www.npmjs.com/package/e2e), so they cover
what a person does with it: writing, saving, switching and deleting notes,
ticking task boxes on the page, what the page shows for each markdown
block, and what it shows when storage is slow or fails.

`test/keystroke_cost.mjs` types into notes of 5, 20 and 100 KB in page view
the way the app does, one update and one draw per key. It fails when a typed
character parses the note more than once or a caret move parses it at all,
and prints how long each key took without judging the time.

Both suites and that script run before every `git push`, and a failure stops
the push. Turn that on once per clone:

```sh
git config core.hooksPath .githooks
cd e2e && npm install && npx @e2e-dev/web install chromium
```

The hook tests the files in your working folder, so commit or stash first.
`git push --no-verify` skips it.

## The page

The note is drawn as a page while you write it. The text field holds only the
block the cursor is in, as markdown, and every other block is drawn with its
marks hidden. Arrow keys and clicks move the field from block to block, and
Escape draws the whole note. A blank line of the note is an empty line on
the page and nothing else sets blocks apart, so the words hold still when the
cursor arrives. A list the field splits is still drawn as one list, so the
items below the field are numbered on from the items above it. The Markdown
button, or Ctrl+E, puts the whole
note in the text field as typed, and is remembered. Two things are missing on
the page: undo across blocks, and a selection that leaves the field.

## Markdown

The parser is hand-written and follows [CommonMark](https://spec.commonmark.org/0.31.2/)
for what nullpad supports: headings (`#` and underlined with `===` or `---`),
paragraphs, thematic breaks, block quotes with lazy lines, bullet and ordered
lists (nested, tight or loose), fenced and indented code blocks, emphasis,
code spans, inline links and backslash escapes. From GitHub Flavored Markdown
it adds strikethrough (`~one~` and `~~two~~`), task lists (`- [ ]` and `- [x]`)
and pipe tables. Images, autolinks, link reference definitions, hard line
breaks and character entities are not read, and raw HTML shows as text.

A table is a heading row, a delimiter row of dashes (a colon at either end of
a column's dashes aligns it left, right or in the centre) and then rows, with
or without the pipes at the ends. The rules are cmark-gfm's: a row with too
few cells gets empty ones, a row with too many loses the extra, `\|` is a pipe
inside a cell, a pipe inside a code span still ends the cell, and a blank line
or the start of another block ends the table. A table is not continued by a
lazy line. Padding is bounded: rows stop at 65,536 padded cells, a line past
that starts a paragraph, where cmark-gfm stops at 524,288. A wide table scrolls
inside its own box on the page, and the box takes the keyboard.

On the page a task's box is live. Ticking it changes `[ ]` to `[x]`
(or back) on that line of the note and nowhere else, and the note saves as it
does after any edit.

`gleam test` runs the spec's 652 examples and prints how many pass, 458 on
this commit. An example may fail only when it is listed in
`test/commonmark_test.gleam` under the feature it needs and nullpad lacks, and
a listed example that starts to pass fails the suite until it is taken off the
list. The 32 GFM examples in `test/commonmark/gfm.json` (the table,
strikethrough and task list sections of cmark-gfm's own tests) run the same
way, from `test/gfm_test.gleam`: 29 pass, and the 3 that do not are listed
under link reference definitions, autolinks and raw HTML.

The page differs from the spec's own HTML in three ways. A line break inside a
paragraph, a list item or a heading shows as a line break, not as a space: the
parser keeps the break in the text, and the page's style sheet decides how it
looks. A task's checkbox is not disabled, so it can be ticked. A table sits
inside a box that scrolls sideways, so a wide one never widens the page.

```sh
gleam run -m commonmark_test                 # Pass count for each section of the spec
gleam run -m commonmark_test -- HardBreaks   # The listed examples of one missing feature
gleam run -m gfm_test                        # The same for the GFM examples
gleam build && node test/hostile_input.mjs   # Time the parser on inputs built to be slow
```

`gleam run -m commonmark_test` names the features that can be listed. The
browser tests in `e2e/tests/blocks.e2e.ts`, `tables.e2e.ts`, `tasks.e2e.ts` and
`layout.e2e.ts` check what the page shows for these blocks, where the task
boxes sit and how a wide table scrolls at 390 and 1280 px, in light and dark.

Styles live in `assets/nullpad.css`.
