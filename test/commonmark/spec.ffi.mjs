import { readFileSync } from "node:fs";
import { toList } from "../gleam.mjs";

export function load(file) {
  const examples = JSON.parse(readFileSync(file, "utf8"));
  return toList(
    examples.map((e) => [e.example, e.section, e.markdown, e.html]),
  );
}

export function commandLineArguments() {
  return toList(process.argv.slice(2));
}
