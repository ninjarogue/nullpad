// The two Unicode classes the CommonMark emphasis rules need. Gleam's stdlib
// cannot ask a code point for its general category.

const whitespace = /^[\p{Zs}\t\n\f\r]$/u;
const punctuation = /^[\p{P}\p{S}]$/u;

export function isUnicodeWhitespace(char) {
  return whitespace.test(char);
}

export function isUnicodePunctuation(char) {
  return punctuation.test(char);
}
