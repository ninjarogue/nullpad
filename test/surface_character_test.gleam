@external(javascript, "./nullpad/surface.ffi.mjs", "graphemeAt")
fn grapheme_at(text: String, offset: Int) -> String

pub fn the_character_after_a_place_is_one_whole_grapheme_test() {
  assert grapheme_at("ab", 0) == "a"
  assert grapheme_at("ab", 1) == "b"
  assert grapheme_at("hello world", 0) == "h"
  assert grapheme_at("a👍🏽b", 1) == "👍🏽"
  assert grapheme_at("🇯🇵🇺🇸", 0) == "🇯🇵"
  assert grapheme_at("x👨\u{200d}👩\u{200d}👧", 1) == "👨\u{200d}👩\u{200d}👧"
  assert grapheme_at("xe\u{301}y", 1) == "e\u{301}"
}

pub fn past_the_end_the_character_is_a_line_break_test() {
  assert grapheme_at("ab", 2) == "\n"
  assert grapheme_at("", 0) == "\n"
}

pub fn the_character_named_starts_at_the_place_even_inside_a_letter_test() {
  assert grapheme_at("ae\u{301}b", 2) == "\u{301}"
}
