import commonmark/report.{type Outcome}
import commonmark/spec
import gleam/int
import gleam/io
import gleam/list
import gleam/string

type Reason {
  // Features nullpad does not have yet.
  ThematicBreaks
  SetextHeadings
  IndentedCode
  FencedCode
  HtmlBlocks
  // Reference definitions and reference-style links.
  LinkReferences
  BlockQuotes
  Lists
  Images
  Autolinks
  // By decision, raw HTML shows as text.
  RawHtml
  HardBreaks
  Entities
}

const example_count = 652

const expected_failures: List(#(Reason, List(Int))) = [
  #(ThematicBreaks, [
    11,
    43,
    47,
    50,
    51,
    52,
    53,
    54,
    58,
    77,
    88,
    96,
    98,
    104,
    105,
  ]),
  #(SetextHeadings, [59, 80, 81, 82, 83, 84, 86, 89, 90, 91, 95, 102, 103, 215]),
  #(IndentedCode, [
    1,
    2,
    3,
    8,
    18,
    36,
    48,
    69,
    85,
    100,
    107,
    110,
    111,
    112,
    114,
    115,
    116,
    117,
    118,
    134,
    211,
    225,
    231,
    272,
    289,
  ]),
  #(FencedCode, [
    19,
    24,
    34,
    119,
    120,
    122,
    123,
    124,
    125,
    126,
    127,
    129,
    130,
    131,
    132,
    133,
    135,
    136,
    137,
    139,
    140,
    141,
    142,
    143,
    144,
    146,
    147,
    212,
  ]),
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
    216,
    217,
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
  #(BlockQuotes, [
    6,
    92,
    93,
    101,
    128,
    174,
    214,
    218,
    228,
    229,
    230,
    232,
    233,
    234,
    235,
    236,
    237,
    238,
    239,
    240,
    241,
    242,
    243,
    244,
    245,
    246,
    247,
    248,
    249,
    250,
    251,
    252,
    253,
    259,
    260,
    292,
    293,
    320,
    321,
  ]),
  #(Lists, [
    4,
    5,
    7,
    9,
    38,
    42,
    57,
    60,
    61,
    94,
    99,
    108,
    109,
    175,
    254,
    255,
    256,
    257,
    258,
    262,
    263,
    264,
    265,
    267,
    268,
    270,
    271,
    273,
    274,
    276,
    277,
    278,
    279,
    280,
    281,
    282,
    283,
    284,
    286,
    287,
    288,
    290,
    291,
    294,
    295,
    296,
    297,
    298,
    299,
    300,
    301,
    302,
    303,
    305,
    306,
    307,
    308,
    309,
    310,
    311,
    312,
    313,
    314,
    315,
    316,
    317,
    318,
    319,
    322,
    323,
    324,
    325,
    326,
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
  #(Entities, [25, 26, 27, 32, 37, 39, 40, 41, 503, 506]),
]

fn listed_numbers() -> List(Int) {
  list.flat_map(expected_failures, fn(entry) { entry.1 })
}

fn is_listed(outcome: Outcome) -> Bool {
  list.contains(listed_numbers(), outcome.example.number)
}

pub fn unlisted_examples_pass_test() {
  let failures =
    report.run()
    |> list.filter(fn(outcome) {
      !report.passed(outcome) && !is_listed(outcome)
    })
  assert failures == []
}

pub fn listed_examples_still_fail_test() {
  let stale =
    report.run()
    |> list.filter(fn(outcome) { report.passed(outcome) && is_listed(outcome) })
    |> list.map(fn(outcome) { outcome.example.number })
  assert stale == []
}

pub fn no_example_is_listed_twice_test() {
  let numbers = listed_numbers()
  let repeated =
    numbers
    |> list.filter(fn(number) {
      list.count(numbers, fn(other) { other == number }) > 1
    })
    |> list.unique
  assert repeated == []
}

pub fn listed_numbers_are_spec_examples_test() {
  let outside_the_spec =
    list.filter(listed_numbers(), fn(number) {
      number < 1 || number > example_count
    })
  assert outside_the_spec == []
}

pub fn spec_has_every_example_test() {
  let numbers = list.map(spec.examples(), fn(example) { example.number })
  assert list.length(numbers) == example_count
  assert numbers == list.index_map(numbers, fn(_, index) { index + 1 })
}

pub fn pass_count_is_printed_test() {
  io.println("\n" <> report.summary_line(report.run()))
}

pub fn main() -> Nil {
  let outcomes = report.run()
  case spec.command_line_arguments() {
    [] -> {
      io.println(report.summary_line(outcomes))
      io.println("")
      report.print_sections(outcomes)
      io.println("")
      print_reason_counts()
    }
    [name] -> print_reason(outcomes, name)
    _ -> io.println("usage: gleam run -m commonmark_test [-- <Reason>]")
  }
}

fn print_reason_counts() -> Nil {
  list.each(expected_failures, fn(entry) {
    io.println(
      string.pad_end(string.inspect(entry.0), 16, " ")
      <> int.to_string(list.length(entry.1)),
    )
  })
}

fn print_reason(outcomes: List(Outcome), name: String) -> Nil {
  case
    list.find(expected_failures, fn(entry) { string.inspect(entry.0) == name })
  {
    Error(Nil) -> {
      io.println("no such reason: " <> name)
      io.println(
        "reasons: "
        <> string.join(
          list.map(expected_failures, fn(entry) { string.inspect(entry.0) }),
          ", ",
        ),
      )
    }
    Ok(#(_, numbers)) ->
      outcomes
      |> list.filter(fn(outcome) {
        list.contains(numbers, outcome.example.number)
      })
      |> list.each(report.print_outcome)
  }
}
