#!/bin/sh
# Read-only: can this checkout be driven? Prints one line per check.
cd "$(git rev-parse --show-toplevel)" || exit 1
bad=0
say() { echo "$1: $2"; [ "$1" = ok ] || bad=1; }

command -v gleam >/dev/null && say ok "gleam $(gleam --version | cut -d' ' -f2)" || say MISSING "gleam is not on PATH"
[ -d build/packages/lustre ] && say ok "gleam packages downloaded" || say MISSING "run: gleam deps download"
[ -d e2e/node_modules/playwright-core ] && say ok "e2e packages installed" || say MISSING "run: cd e2e && npm ci"
if [ -d e2e/node_modules/playwright-core ]; then
  (cd e2e && node -e '
    const { chromium } = require(process.env.VERIFY_PLAYWRIGHT || "playwright-core");
    require("fs").accessSync(chromium.executablePath());
  ' 2>/dev/null) && say ok "Chromium found" || say MISSING "Chromium for this Playwright. See Launch in SKILL.md"
fi
exit $bad
