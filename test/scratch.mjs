import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

/** Gives `make`, which creates a directory, and `clean`, which removes every one made so far. Call it at the top level of a test file: it also cleans when the file ends. */
export function useScratch() {
  const made = [];
  const clean = () => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  };
  after(clean);
  return {
    make(prefix) {
      const dir = mkdtempSync(join(tmpdir(), prefix));
      made.push(dir);
      return dir;
    },
    clean,
  };
}
