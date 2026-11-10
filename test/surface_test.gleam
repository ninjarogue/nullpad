//// The boundary between the browser's numbers and ours. The text field
//// counts in UTF-16 units, where "👋" is 2 and "é" is 1. The buffer counts
//// graphemes, where both are 1.

import scribbl/buffer.{Position}
import scribbl/surface

const text = "héllo 👋\nwörld"

pub fn offsets_become_positions_test() {
  // 8 is just after the wave: h é l l o space (6 units), then 2 for the wave.
  let shown = surface.from_control(text, 8, 8)

  assert buffer.text(shown) == text
  assert buffer.cursor(shown) == Position(row: 0, col: 7)
}

pub fn a_selection_can_span_lines_test() {
  // From before "llo" to after "wö".
  let shown = surface.from_control(text, 2, 11)

  assert buffer.selection(shown)
    == #(Position(row: 0, col: 2), Position(row: 1, col: 2))
}

/// The law from `surface.to_control`: there and back changes nothing.
pub fn there_and_back_test() {
  assert surface.to_control(surface.from_control(text, 0, 0)) == #(text, 0, 0)
  assert surface.to_control(surface.from_control(text, 8, 8)) == #(text, 8, 8)
  assert surface.to_control(surface.from_control(text, 2, 11)) == #(text, 2, 11)
  assert surface.to_control(surface.from_control(text, 14, 14))
    == #(text, 14, 14)
}
