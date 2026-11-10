import { toList } from "./gleam.mjs";

// Call `run` with a function that records what it is given, and return what
// was recorded by the time `run` came back.
export function collect(run) {
  const collected = [];
  run((value) => {
    collected.push(value);
  });
  return toList(collected);
}
