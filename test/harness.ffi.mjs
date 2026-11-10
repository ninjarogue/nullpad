import { toList } from "./gleam.mjs";

export function collect(run) {
  const collected = [];
  run((value) => {
    collected.push(value);
  });
  return toList(collected);
}
