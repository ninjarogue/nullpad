import { readFileSync } from "node:fs";
import { toList } from "../gleam.mjs";

export function load() {
  const examples = JSON.parse(readFileSync("test/commonmark/spec.json", "utf8"));
  return toList(
    examples.map((e) => [e.example, e.section, e.markdown, e.html]),
  );
}

export function commandLineArguments() {
  return toList(process.argv.slice(2));
}
