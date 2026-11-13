// Robot typist: random key scripts typed into a plain textarea and into nullpad in real
// Chromium. Any difference in text, cursor or selection is a bug, shrunk to a short script.
//
//   node typist/run.mjs [--count 120] [--seed 1] [--length 40] [--workers 3]
//   node typist/run.mjs --script '["a","Enter","ArrowLeft"]'     replay one script
//   node typist/run.mjs --scripts '[["a"],["b"]]'               compare several scripts, no shrinking
//   node typist/run.mjs --no-known                                ignore known.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { keyEvents, makeScripts } from './keys.mjs';
import { known, sanitize } from './known.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? '1' : all[i + 1]] : [])).filter((e) => e.length),
);
const count = Number(args.count ?? process.env.TYPIST_COUNT ?? 120);
const seed = Number(args.seed ?? process.env.TYPIST_SEED ?? 1);
const length = Number(args.length ?? 40);
const workers = Number(args.workers ?? 3);
const useKnown = args['no-known'] === undefined;
const e2eDir = fileURLToPath(new URL('..', import.meta.url));

const blank = `<textarea aria-label="Note text" style="width:700px;height:400px;font:16px/1.6 monospace"></textarea>`;
const frame = 'new Promise((r) => requestAnimationFrame(() => r()))';
const read = `(async () => {
  await ${frame};
  const c = document.querySelector('textarea');
  return { v: c.value, s: c.selectionStart, e: c.selectionEnd, d: c.selectionStart === c.selectionEnd ? 'none' : c.selectionDirection };
})()`;
const sign = (s) => JSON.stringify([s.v, s.s, s.e, s.d]);
const arrowVertical = /Arrow(Up|Down)$/;

async function freePort() {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn('node', ['serve.mjs', String(port)], { cwd: e2eDir, stdio: ['ignore', 'ignore', 'inherit'] });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 1800; i++) {
    try {
      if ((await fetch(url + '/blank')).ok) return { url, stop: () => child.kill() };
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('serve.mjs did not start');
}

// The clipboard belongs to the browser, so only one page may paste at a time.
let clipboard = Promise.resolve();

/** A page that runs a script and answers { state, undone }. kind is 'textarea' or 'nullpad'. */
async function open(browser, url, kind, errors) {
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  const cdp = await context.newCDPSession(page);
  const ev = async (expression) => (await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  const send = (spec) => Promise.all(keyEvents(spec).map((e) => cdp.send('Input.dispatchKeyEvent', e)));
  const settle = () => ev(frame);
  if (kind === 'textarea') await page.goto(url + '/blank');
  else {
    await page.goto(url + '/');
    await page.getByLabel('Note text').click();
  }
  let first = true;
  return async (keys) => {
    if (kind === 'textarea') await ev(`document.body.innerHTML = ${JSON.stringify(blank)}; document.querySelector('textarea').focus()`);
    else if (!first) {
      // Click "New note" and wait for the empty note to take the focus.
      await ev(`(async () => {
        const rows = () => document.querySelectorAll('[data-test-id=note-list] li').length;
        const before = rows();
        document.querySelector('[data-test-id=new-note]').click();
        for (let i = 0; i < 200; i++) {
          await new Promise((r) => requestAnimationFrame(r));
          const c = document.querySelector('textarea');
          if (rows() > before && c && c.value === '' && document.activeElement === c) return;
        }
        throw new Error('new note did not open');
      })()`);
    }
    first = false;
    let pending = [];
    const drain = async () => {
      await Promise.all(pending);
      pending = [];
    };
    for (const k of keys) {
      if (typeof k === 'object') {
        await drain();
        const previous = clipboard;
        let release;
        clipboard = previous.then(() => new Promise((r) => (release = r)));
        await previous;
        try {
          await ev(`navigator.clipboard.writeText(${JSON.stringify(k.paste)})`);
          await send('Control+v');
        } finally {
          release();
        }
        continue;
      }
      const vertical = arrowVertical.test(k);
      if (vertical) {
        await drain();
        await settle();
      }
      pending.push(send(k));
      if (vertical) {
        await drain();
        await settle();
      }
    }
    // Ctrl+E shows the source: the text field is only comparable there.
    if (kind === 'nullpad') pending.push(send('Control+e'));
    await drain();
    const state = await ev(read);
    // Undo steps differ from a textarea's by design, and the native undo stack is not a
    // dependable reference, so only nullpad is checked: undoing everything gives back ''.
    let undone = null;
    if (kind === 'nullpad') {
      for (let i = 0; i < keys.length + 5; i++) pending.push(send('Control+z'));
      await drain();
      undone = (await ev(read)).v;
      await send('Control+e');
    }
    return { state, undone };
  };
}

const differ = (a, b) => (sign(a.state) !== sign(b.state) ? 'text, cursor or selection' : b.undone !== '' ? 'undo everything' : null);

/** Remove chunks of keys, halving the chunk size, while the script still fails. */
async function shrink(keys, fails) {
  for (let size = Math.ceil(keys.length / 2); size >= 1; size = size === 1 ? 0 : Math.ceil(size / 2)) {
    for (let at = 0; at < keys.length; ) {
      const candidate = keys.slice(0, at).concat(keys.slice(at + size));
      if (candidate.length && (await fails(candidate))) keys = candidate;
      else at += size;
    }
  }
  return keys;
}

const show = (keys) => JSON.stringify(keys);
const replayCommand = (keys) => `node typist/run.mjs --script '${show(keys).replaceAll("'", "'\\''")}'`;

async function main() {
  const t0 = performance.now();
  const server = await startServer();
  const errors = [];
  let exit = 0;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chromium' });
    const pairs = await Promise.all(
      Array.from({ length: workers }, async () => {
        const [plain, nullpad] = await Promise.all([open(browser, server.url, 'textarea', errors), open(browser, server.url, 'nullpad', errors)]);
        return { plain, nullpad };
      }),
    );
    const compare = async (pair, keys) => {
      const [a, b] = await Promise.all([pair.plain(keys), pair.nullpad(keys)]);
      return { a, b, why: differ(a, b) };
    };

    if (args.scripts) {
      for (const keys of JSON.parse(args.scripts)) {
        const { a, b, why } = await compare(pairs[0], keys);
        console.log(`${why ? 'DIFFERS' : 'same   '} ${show(keys)}${why ? `\n    textarea ${show(a.state)}\n    nullpad  ${show(b.state)}` : ''}`);
      }
      return;
    }
    const scripts = args.script ? [JSON.parse(args.script)] : makeScripts(count, length, seed).map((s) => (useKnown ? sanitize(s) : s));
    const ready = performance.now();
    const failed = [];
        await Promise.all(
      pairs.map(async (pair, w) => {
        for (let i = w; i < scripts.length; i += workers) {
          const r = await compare(pair, scripts[i]);
          if (r.why === null) continue;
          failed.push({ i, why: r.why });
        }
      }),
    );
    const run = performance.now() - ready;

    // Open bugs must still fail, and intended differences must still be there.
    const stale = [];
    if (useKnown && !args.script)
      for (const k of known) if (k.repro && !(await compare(pairs[0], k.repro)).why) stale.push(k);

    console.log(`typist: ${scripts.length} scripts of ${length} keys, seed ${seed}, ${workers} workers, ${(run / 1000).toFixed(1)}s (${Math.round((scripts.length / run) * 60000)}/min)`);
    for (const e of [...new Set(errors)]) console.log(`  page error: ${e}`);

    failed.sort((x, y) => x.i - y.i);
    const seen = new Set();
    for (const f of failed.slice(0, Number(args.shrink ?? 8))) {
      const keys = await shrink(scripts[f.i], async (c) => (await compare(pairs[0], c)).why !== null);
      const text = show(keys);
      if (seen.has(text)) continue;
      seen.add(text);
      const { a, b, why } = await compare(pairs[0], keys);
      console.log(`\nDIFFERENCE (${why}) script #${f.i} of seed ${seed}, shrunk ${scripts[f.i].length} -> ${keys.length} keys`);
      console.log(`  script   ${text}`);
      console.log(`  textarea ${JSON.stringify(a.state)} undone ${JSON.stringify(a.undone)}`);
      console.log(`  nullpad  ${JSON.stringify(b.state)} undone ${JSON.stringify(b.undone)}`);
      console.log(`  replay   ${replayCommand(keys)}`);
    }
    if (failed.length > seen.size) console.log(`\n${failed.length} scripts differ in new ways; ${seen.size} distinct shrunk scripts shown (--shrink N for more)`);
    for (const k of stale) {
      console.log(`\nSTALE known difference "${k.id}" (${k.kind}): its repro ${show(k.repro)} no longer differs. Delete it from e2e/typist/known.mjs.`);
    }
    if (failed.length || stale.length || errors.length) exit = 1;
    else console.log('typist: no differences');
  } finally {
    await browser?.close();
    server.stop();
  }
  console.log(`total ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(exit);
}

main();
