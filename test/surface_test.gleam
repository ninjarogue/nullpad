import scribbl/buffer.{Position}
import scribbl/surface

const text = "héllo 👋\nwörld"

const utf16_start = 0

const utf16_before_llo = 2

const utf16_after_wave = 8

const utf16_after_wo = 11

const utf16_end = 14

pub fn offsets_become_positions_test() {
  let shown = surface.from_control(text, utf16_after_wave, utf16_after_wave)

  assert buffer.text(shown) == text
  assert buffer.cursor(shown) == Position(row: 0, col: 7)
}

pub fn a_selection_can_span_lines_test() {
  let shown = surface.from_control(text, utf16_before_llo, utf16_after_wo)

  assert buffer.selection(shown)
    == #(Position(row: 0, col: 2), Position(row: 1, col: 2))
}

pub fn there_and_back_test() {
  assert there_and_back(utf16_start, utf16_start)
  assert there_and_back(utf16_after_wave, utf16_after_wave)
  assert there_and_back(utf16_before_llo, utf16_after_wo)
  assert there_and_back(utf16_end, utf16_end)
}

fn there_and_back(start: Int, end: Int) -> Bool {
  surface.to_control(surface.from_control(text, start, end))
  == #(text, start, end)
}
