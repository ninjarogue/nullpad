import commonmark/expected.{
  type Listing, Autolinks, Entities, HardBreaks, HtmlBlocks, Images,
  LinkReferences, RawHtml,
}
import commonmark/report.{type Outcome}
import commonmark/spec
import gleam/io
import gleam/list

const name = "CommonMark 0.31.2"

const example_count = 652

const expected_failures: Listing = [
  #(HtmlBlocks, [
    21,
    31,
    148,
    149,
    150,
    151,
    152,
    153,
    154,
    155,
    156,
    157,
    158,
    159,
    160,
    161,
    162,
    163,
    164,
    165,
    166,
    167,
    169,
    170,
    171,
    172,
    173,
    174,
    175,
    176,
    177,
    178,
    179,
    180,
    181,
    182,
    183,
    184,
    185,
    186,
    188,
    189,
    190,
    191,
    308,
    309,
  ]),
  #(LinkReferences, [
    23,
    33,
    192,
    193,
    194,
    195,
    196,
    198,
    200,
    202,
    203,
    204,
    205,
    206,
    207,
    208,
    210,
    214,
    215,
    216,
    217,
    218,
    317,
    527,
    528,
    529,
    530,
    531,
    532,
    533,
    534,
    535,
    536,
    537,
    538,
    539,
    540,
    541,
    542,
    543,
    544,
    545,
    549,
    550,
    553,
    554,
    555,
    556,
    557,
    558,
    559,
    560,
    561,
    562,
    563,
    564,
    565,
    566,
    567,
    568,
    569,
    570,
    571,
    573,
    576,
    577,
    582,
    583,
    584,
    585,
    586,
    587,
    588,
    589,
    591,
    592,
    593,
  ]),
  #(Images, [517, 520, 572, 574, 575, 578, 579, 580, 581]),
  #(Autolinks, [
    20,
    346,
    480,
    481,
    526,
    594,
    595,
    596,
    597,
    598,
    599,
    600,
    601,
    603,
    604,
    605,
  ]),
  #(RawHtml, [
    168,
    187,
    201,
    344,
    475,
    476,
    477,
    491,
    494,
    524,
    613,
    614,
    615,
    616,
    617,
    623,
    625,
    626,
    627,
    628,
    629,
    630,
    631,
    642,
    643,
  ]),
  #(HardBreaks, [16, 226, 633, 634, 635, 636, 637, 638, 639]),
  #(Entities, [25, 26, 27, 32, 34, 37, 38, 39, 40, 41, 503, 506]),
]

fn outcomes() -> List(Outcome) {
  report.run(spec.commonmark_file)
}

pub fn unlisted_examples_pass_test() {
  assert expected.unlisted_failures(outcomes(), expected_failures) == []
}

pub fn listed_examples_still_fail_test() {
  assert expected.stale(outcomes(), expected_failures) == []
}

pub fn no_example_is_listed_twice_test() {
  assert expected.repeated(expected_failures) == []
}

pub fn listed_numbers_are_spec_examples_test() {
  assert expected.unknown(outcomes(), expected_failures) == []
}

pub fn spec_has_every_example_test() {
  let numbers =
    list.map(spec.examples(spec.commonmark_file), fn(example) { example.number })
  assert list.length(numbers) == example_count
  assert numbers == list.index_map(numbers, fn(_, index) { index + 1 })
}

pub fn pass_count_is_printed_test() {
  io.println("\n" <> report.summary_line(name, outcomes()))
}

pub fn main() -> Nil {
  expected.print_report(name, outcomes(), expected_failures, "commonmark_test")
}
