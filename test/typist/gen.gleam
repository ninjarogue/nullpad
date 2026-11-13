//// A seeded random generator, so every run of a property test sees the same
//// inputs and a failure can be named by its seed and index.
////
//// The state is the Park-Miller "minimal standard" sequence. Its product
//// stays below 2^53, so it gives the same numbers on the JavaScript target.

import gleam/int
import gleam/list

pub opaque type Rng {
  Rng(state: Int)
}

/// A way to draw one `a` from the random sequence.
pub type Gen(a) =
  fn(Rng) -> #(a, Rng)

const modulus = 2_147_483_647

const multiplier = 48_271

pub fn seed(n: Int) -> Rng {
  Rng(int.absolute_value(n) % { modulus - 1 } + 1)
}

/// The same seed from a seed and an index: each script of a run has its own.
pub fn stream(n: Int, index: Int) -> Rng {
  // Two draws, so that neighbouring indexes do not start neighbouring runs.
  let rng = seed(n * 1_000_003 + index * 7919 + 17)
  let #(_, rng) = next(rng)
  let #(_, rng) = next(rng)
  rng
}

fn next(rng: Rng) -> #(Int, Rng) {
  let state = rng.state * multiplier % modulus
  #(state, Rng(state))
}

pub fn run(gen: Gen(a), rng: Rng) -> a {
  gen(rng).0
}

pub fn constant(value: a) -> Gen(a) {
  fn(rng) { #(value, rng) }
}

pub fn map(gen: Gen(a), with f: fn(a) -> b) -> Gen(b) {
  fn(rng) {
    let #(a, rng) = gen(rng)
    #(f(a), rng)
  }
}

pub fn then(gen: Gen(a), with f: fn(a) -> Gen(b)) -> Gen(b) {
  fn(rng) {
    let #(a, rng) = gen(rng)
    f(a)(rng)
  }
}

/// 0 up to but not including `n`. An `n` of 1 or less is always 0.
pub fn below(n: Int) -> Gen(Int) {
  fn(rng) {
    let #(state, rng) = next(rng)
    // The low bits of this sequence are as good as the high ones.
    #(state % int.max(n, 1), rng)
  }
}

/// `low` to `high`, both included.
pub fn between(low: Int, high: Int) -> Gen(Int) {
  below(high - low + 1) |> map(fn(n) { n + low })
}

pub fn chance(percent: Int) -> Gen(Bool) {
  below(100) |> map(fn(n) { n < percent })
}

pub fn one_of(options: List(a)) -> Gen(a) {
  case options {
    [] -> panic as "one_of needs an option"
    _ ->
      below(list.length(options))
      |> map(fn(index) { at(options, index) })
  }
}

/// One option, each as likely as its weight says.
pub fn weighted(options: List(#(Int, a))) -> Gen(a) {
  let total = list.fold(options, 0, fn(sum, option) { sum + option.0 })
  below(total)
  |> map(fn(roll) { pick(options, roll) })
}

/// One generator, each as likely as its weight says, then what it draws.
pub fn weighted_gen(options: List(#(Int, Gen(a)))) -> Gen(a) {
  then(weighted(options), fn(make) { make })
}

fn pick(options: List(#(Int, a)), roll: Int) -> a {
  case options {
    [] -> panic as "weighted needs an option"
    [#(_, last)] -> last
    [#(weight, option), ..rest] ->
      case roll < weight {
        True -> option
        False -> pick(rest, roll - weight)
      }
  }
}

fn at(options: List(a), index: Int) -> a {
  case list.drop(options, index) {
    [first, ..] -> first
    [] -> panic as "index out of range"
  }
}

pub fn list_of(count: Gen(Int), each: Gen(a)) -> Gen(List(a)) {
  use n <- then(count)
  repeat(n, each)
}

pub fn repeat(n: Int, each: Gen(a)) -> Gen(List(a)) {
  fn(rng) { repeat_loop(n, each, rng, []) }
}

fn repeat_loop(
  n: Int,
  each: Gen(a),
  rng: Rng,
  found: List(a),
) -> #(List(a), Rng) {
  case n <= 0 {
    True -> #(list.reverse(found), rng)
    False -> {
      let #(a, rng) = each(rng)
      repeat_loop(n - 1, each, rng, [a, ..found])
    }
  }
}

/// 0, 1, up to `n - 1`.
pub fn indexes(n: Int) -> List(Int) {
  list.repeat(Nil, int.max(n, 0)) |> list.index_map(fn(_, index) { index })
}
