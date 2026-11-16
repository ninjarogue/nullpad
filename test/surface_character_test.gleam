//// The character the page names after a place, which the editor compares
//// with graphemes.

@external(javascript, "./nullpad/surface.ffi.mjs", "characterAt")
fn character_at(text: String, offset: Int) -> String

pub fn the_character_after_a_place_is_one_whole_grapheme_test() {
  assert character_at("ab", 0) == "a"
  assert character_at("ab", 1) == "b"
  assert character_at("hello world", 0) == "h"
  assert character_at("a👍🏽b", 1) == "👍🏽"
  assert character_at("🇯🇵🇺🇸", 0) == "🇯🇵"
  assert character_at("x👨\u{200d}👩\u{200d}👧", 1) == "👨\u{200d}👩\u{200d}👧"
  assert character_at("xe\u{301}y", 1) == "e\u{301}"
}

pub fn past_the_end_the_character_is_a_line_break_test() {
  assert character_at("ab", 2) == "\n"
  assert character_at("", 0) == "\n"
}

/// A click in Chromium never lands inside a letter, but `visible` is the
/// text before the place, so the character named must start at it.
pub fn the_character_named_starts_at_the_place_even_inside_a_letter_test() {
  assert character_at("ae\u{301}b", 2) == "\u{301}"
}
