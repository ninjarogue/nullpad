#!/usr/bin/env node
// Runs one journey against a private copy of the app and records it.
//   node .claude/skills/verify-scribbl/drive.mjs <journey.mjs> [name]
// Evidence lands in .verify/<name>/: session.webm, shots/*.png, report.json.

import { spawn } from "node:child_process";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const [journeyPath, name = "session"] = process.argv.slice(2);
if (!journeyPath) {
  console.error("usage: drive.mjs <journey.mjs> [name]");
  process.exit(2);
}

// VERIFY_PLAYWRIGHT names another Playwright to use, for machines whose
// installed browsers belong to it and not to the one in e2e/.
const { chromium } = createRequire(join(repo, "e2e/package.json"))(
  process.env.VERIFY_PLAYWRIGHT ?? "playwright-core",
);
const journey = (await import(pathToFileURL(resolve(journeyPath)).href)).default;
const evidence = join(repo, ".verify", name);
await rm(evidence, { recursive: true, force: true });
await mkdir(join(evidence, "shots"), { recursive: true });

const port = await new Promise((done) => {
  const probe = createServer().listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => done(port));
  });
});
const url = `http://127.0.0.1:${port}/`;
const server = spawn("node", [join(repo, "e2e/serve.mjs"), String(port)], { stdio: "inherit" });

async function ready() {
  for (let tries = 0; tries < 120; tries++) {
    if (server.exitCode !== null) throw new Error("the server stopped, see its output above");
    try {
      const app = await fetch(url + "scribbl/scribbl.mjs");
      if (app.ok) return;
    } catch {}
    await new Promise((wait) => setTimeout(wait, 500));
  }
  throw new Error("the app did not answer within 60 s");
}

const checks = [];
const errors = [];
let browser;
let failed = false;
try {
  await ready();
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: evidence, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(String(error.message)));
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  await page.goto(url);

  let shots = 0;
  const tools = {
    page,
    url,
    look: (ms = 1200) => page.waitForTimeout(ms),
    type: (text) => page.keyboard.type(text, { delay: 35 }),
    shot: (label) =>
      page.screenshot({ path: join(evidence, "shots", `${String(++shots).padStart(2, "0")}-${label}.png`) }),
    async check(label, run) {
      try {
        await run();
        checks.push({ label, pass: true });
      } catch (error) {
        checks.push({ label, pass: false, why: String(error.message).split("\n")[0] });
      }
    },
  };
  await journey(tools);
  await context.close();
} catch (error) {
  failed = true;
  errors.push("journey stopped: " + error.message);
} finally {
  await browser?.close();
  server.kill();
}

const videos = (await readdir(evidence)).filter((file) => file.endsWith(".webm"));
if (videos.length === 1) await rename(join(evidence, videos[0]), join(evidence, "session.webm"));
else errors.push(`expected one video, found ${videos.length}. The ffmpeg does not match this Playwright.`);
await writeFile(join(evidence, "report.json"), JSON.stringify({ checks, errors }, null, 2));
for (const check of checks) console.log(check.pass ? "pass" : "FAIL", check.label, check.why ?? "");
for (const error of errors) console.log("error:", error);
console.log("evidence:", evidence);
process.exit(failed || errors.length || checks.some((check) => !check.pass) ? 1 : 0);
