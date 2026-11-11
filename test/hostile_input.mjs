// Times the parser and the note title rule on inputs built to make them slow,
// at one size and at double that size. Linear code doubles its time. Quadratic
// code takes four times as long, and this exits 1.
//
//   gleam build && node test/hostile_input.mjs
//
// Not part of `gleam test`: timings are too noisy for CI.

import { parse } from "../build/dev/javascript/nullpad/nullpad/markdown.mjs";
import { display_title } from "../build/dev/javascript/nullpad/nullpad/storage.mjs";
import { None } from "../build/dev/javascript/gleam_stdlib/gleam/option.mjs";

const SIZE = 20_000;
const RUNS = 7;
const WORST_RATIO = 3.3;
const WORST_MS = 2_000;

const inputs = {
  "plain text": (n) => "word ".repeat(n),
  "nested emphasis": (n) => "*a ".repeat(n) + "b" + " a*".repeat(n),
  "nested strong": (n) => "**a ".repeat(n) + "b" + " a**".repeat(n),
  "unclosed emphasis": (n) => "*a ".repeat(n),
  "closers without openers": (n) => "a* ".repeat(n),
  "openers of one symbol, closers of the other": (n) =>
    "_a ".repeat(n) + "b" + " a*".repeat(n),
  "openers of mixed length": (n) => "*a **b ".repeat(n) + "c*",
  "long runs between words": (n) => "a***".repeat(n),
  "one run that never ends": (n) => "*".repeat(n * 4),
  "runs that open and close": (n) => "a*b_c".repeat(n),
  "unclosed brackets": (n) => "[".repeat(n * 4),
  "nested brackets, no link": (n) => "[".repeat(n) + "x" + "]".repeat(n),
  "nested brackets, link at each level": (n) =>
    "[".repeat(n) + "x" + "](u)".repeat(n),
  "bracket pairs, no link": (n) => "[a] ".repeat(n),
  "many links": (n) => "[a](b) ".repeat(n),
  "link ends without a start": (n) => "](a) ".repeat(n),
  "link tails that never close": (n) => "[a](".repeat(n),
  "pointy destinations that never close": (n) => "[a](<b".repeat(n),
  "titles that never close": (n) => '[a](u "'.repeat(n),
  "titles in three quote styles": (n) => "[a](u \"[a](u '[a](u (".repeat(n),
  "deep parentheses in a destination": (n) => "[a](" + "(".repeat(n * 4),
  "emphasis inside many link texts": (n) => "[*a* **b**](u) ".repeat(n),
  "brackets inside deep emphasis": (n) =>
    "*a ".repeat(n) + "[b](u)" + " a*".repeat(n),
  "code spans inside deep emphasis": (n) =>
    "*`c` ".repeat(n) + "b" + " `c`*".repeat(n),
  "brackets left open before a link": (n) => "[a ".repeat(n) + "[b](u)",
  "one link around a long text": (n) => "[" + "a *b* ".repeat(n) + "](u)",
  "code spans": (n) => "`a` ".repeat(n),
  "backticks that never close": (n) => "`a ".repeat(n),
  "backslashes": (n) => "\\".repeat(n * 4),
  "escapes": (n) => "\\*".repeat(n * 2),
  "many short lines in one paragraph": (n) => "a *b*\n".repeat(n),
  "many headings": (n) => "# a *b* #\n".repeat(n),
  "many paragraphs": (n) => "a *b*\n\n".repeat(n),
  "long runs of spaces": (n) => ("a" + " ".repeat(50) + "b\n").repeat(n / 10),
  "unclosed strikes": (n) => "~a ".repeat(n),
  "nested strikes": (n) => "~~a ".repeat(n) + "b" + " a~~".repeat(n),
  "strikes of mixed length": (n) => "~a ~~b ".repeat(n) + "c~",
  "strike closers of the other length": (n) =>
    "~a ".repeat(n) + "b" + " a~~".repeat(n),
  "long tilde runs": (n) => "a~~~".repeat(n),
  "many strikes": (n) => "~~a~~ ".repeat(n),
  "setext underlines": (n) => "a\n---\n".repeat(n),
  "a long setext underline": (n) => "a\n" + "=".repeat(n * 2),
  "rules": (n) => "---\n".repeat(n),
  "a long rule": (n) => "- ".repeat(n * 2),
  "a long line that almost makes a rule": (n) => "- ".repeat(n * 2) + "a",
  "quote marks on one line": (n) => "> ".repeat(n) + "a",
  "quote marks, no spaces": (n) => ">".repeat(n * 2) + "a",
  "deep quotes on every line": (n) => ("> ".repeat(40) + "a\n").repeat(n / 40),
  "lazy continuation lines": (n) => "> a\n" + "b\n".repeat(n),
  "quotes opening and closing": (n) => "> a\n\n".repeat(n),
  "bullets on one line": (n) => "- ".repeat(n) + "a",
  "stars that almost make a rule": (n) => "* ".repeat(n) + "a",
  "ordered markers on one line": (n) => "1. ".repeat(n) + "a",
  "quote marks and list markers on one line": (n) => "> 1. ".repeat(n) + "a",
  "many items": (n) => "- a\n".repeat(n),
  "many loose items": (n) => "- a\n\n".repeat(n),
  "many lists": (n) => "- a\n+ b\n".repeat(n),
  "empty items": (n) => "-\n".repeat(n),
  "empty items, blank lines": (n) => "-\n\n".repeat(n),
  "deep spaces inside nested lists": (n) =>
    Array.from({ length: 30 }, (_, i) => "  ".repeat(i) + "- a\n").join("") +
    (" ".repeat(200) + "b\n").repeat(n / 100),
  "nested lists, a staircase 200 deep": (n) =>
    Array.from({ length: 200 }, (_, i) => "  ".repeat(i) + "- a\n")
      .join("")
      .repeat(n / 10_000),
  "many tasks": (n) => "- [ ] a\n".repeat(n),
  "boxes alone": (n) => "- [x]\n".repeat(n),
  "an unclosed fence": (n) => "```\n" + "a\n".repeat(n),
  "fences that open and close": (n) => "```\na\n```\n".repeat(n),
  "fence closers of the other mark": (n) => "````\n" + "```\n~~~~\n".repeat(n),
  "a long fence": (n) => "`".repeat(n * 4),
  "indented code, blank lines between": (n) => "    a\n\n".repeat(n),
  "indented code, blank lines after": (n) => "    a\n" + "\n".repeat(n),
  "tabs": (n) => "\t".repeat(n) + "a",
  "tabs after a bullet": (n) => "-" + "\t".repeat(n) + "a",
};

const titles = {
  "title of a line with a long gap": (n) => "a" + " ".repeat(n * 2) + "b",
  "title of a long first line": (n) => "*a* [b](c) ".repeat(n),
  "title after many blank lines": (n) => " \n".repeat(n) + "a",
  "title of a line of nested markers": (n) => "> - [ ] 1. ".repeat(n) + "a",
  "title of a line of digits": (n) => "1".repeat(n * 4) + ". a",
  "title after many rules": (n) => "---\n".repeat(n) + "a",
  "title after many empty items": (n) => "-\n".repeat(n) + "a",
  "title after many quote marks": (n) => ">\n".repeat(n) + "a",
  "title of a long first paragraph": (n) => "a\n".repeat(n),
  "title inside a fence after blank lines": (n) =>
    "```\n" + "\n".repeat(n) + "a",
};

function time(work, source) {
  let fastest = Infinity;
  for (let run = 0; run < RUNS; run++) {
    const start = performance.now();
    work(source);
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
}

let failed = false;
const rows = [];
const cases = [
  ...Object.entries(inputs).map(([name, build]) => [name, build, parse]),
  ...Object.entries(titles).map(([name, build]) => [
    name,
    build,
    (body) => display_title(new None(), body),
  ]),
];

for (const [name, build, work] of cases) {
  try {
    time(work, build(SIZE / 4));
    const once = time(work, build(SIZE));
    const twice = time(work, build(SIZE * 2));
    const ratio = twice / Math.max(once, 1);
    const slow = ratio > WORST_RATIO || twice > WORST_MS;
    failed ||= slow;
    rows.push({
      input: name,
      "ms at n": once.toFixed(1),
      "ms at 2n": twice.toFixed(1),
      ratio: ratio.toFixed(2),
      verdict: slow ? "TOO SLOW" : "ok",
    });
  } catch (error) {
    failed = true;
    rows.push({ input: name, verdict: `CRASHED: ${error.message}` });
  }
}

console.table(rows);
console.log(`n = ${SIZE} repeats, fastest of ${RUNS} runs`);
process.exit(failed ? 1 : 0);
