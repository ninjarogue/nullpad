import { Ok, Error } from "./gleam.mjs";

export function cell() {
  return { full: false, value: undefined };
}

export function put(cell, value) {
  cell.full = true;
  cell.value = value;
}

export function take(cell) {
  return cell.full ? new Ok(cell.value) : new Error(undefined);
}
