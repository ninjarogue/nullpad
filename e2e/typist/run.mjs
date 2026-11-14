// Robot typist: random key scripts typed into a plain textarea and into nullpad in real
// Chromium. Any difference in text, cursor or selection is a bug, shrunk to a short script.
//
//   node typist/run.mjs [--count 120] [--seed 1] [--length 40] [--workers 3]
//   node typist/run.mjs --script '["a","Enter","ArrowLeft"]'     replay one script
//   node typist/run.mjs --pace frame|slow|burst|mixed            how fast nullpad is typed at
//   --close-at-once                                               Ctrl+E (source view) sent with the last keys
//   node typist/run.mjs --scripts '[["a"],["b"]]'               compare several scripts, no shrinking
//   node typist/run.mjs --no-known                                ignore known.mjs
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { keyEvents, makeScripts } from './keys.mjs';
import { judged, known, sanitize, skips } from './known.mjs';

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
const caretOf = `(() => {
  const c = document.querySelector('textarea');
  const back = c.selectionDirection === 'backward';
  return { value: c.value, anchor: back ? c.selectionEnd : c.selectionStart, head: back ? c.selectionStart : c.selectionEnd };
})()`;
const sign = (s) => JSON.stringify([s.v, s.s, s.e, s.d]);
/**
 * How fast nullpad is typed at. The plain textarea is always typed at in a burst.
 *   burst  every key at once, as a held key or a fast hand does
 *   frame  the next key after the page drew a frame
 *   slow   the next key 120ms later, after the page has settled
 * A default run mixes them: most scripts burst, many go a frame at a time, a few are slow.
 */
const slowMs = 120;
const paces = ['burst', 'frame', 'slow'];
const closeAtOnce = args['close-at-once'] !== undefined;
const forcedPace = args.pace && args.pace !== 'mixed' ? args.pace : null;
if (forcedPace && !paces.includes(forcedPace)) throw new Error(`--pace ${forcedPace}: one of ${paces.join(', ')}, mixed`);
const paceOf = (i) => forcedPace ?? (i % 16 === 15 ? 'slow' : i % 16 >= 9 ? 'frame' : 'burst');
/** A slow script has a third fewer keys, or the short run would take a minute. */
const slowKeys = 28;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const paste = async (text) => {
    const previous = clipboard;
    let release;
    clipboard = previous.then(() => new Promise((r) => (release = r)));
    await previous;
    try {
      await ev(`navigator.clipboard.writeText(${JSON.stringify(text)})`);
      await send('Control+v');
    } finally {
      release();
    }
  };
  /**
   * The keys of a script that can be compared, found by typing the script into the plain
   * textarea: a key is left out where known.mjs says nullpad cannot be compared to it.
   */
  const prune = async (keys, pace) => {
    await ev(`document.body.innerHTML = ${JSON.stringify(blank)}; document.querySelector('textarea').focus()`);
    const kept = [];
    let pending = [];
    for (const k of keys) {
      if (typeof k === 'string' && judged(k)) {
        await Promise.all(pending);
        pending = [];
        if (skips(k, keys, await ev(caretOf), pace)) continue;
      }
      kept.push(k);
      if (typeof k === 'string') pending.push(send(k));
      else if (k.paste !== undefined) {
        await Promise.all(pending);
        pending = [];
        await paste(k.paste);
      }
    }
    await Promise.all(pending);
    return kept;
  };
  const run = async (keys, pace = 'burst', closeAtOnce = false) => {
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
      if (typeof k === 'object' && k.wait) {
        await drain();
        await settle();
        continue;
      }
      if (typeof k === 'object') {
        await drain();
        await paste(k.paste);
        if (kind === 'nullpad' && pace !== 'burst') {
          await settle();
          if (pace === 'slow') await pause(slowMs);
        }
        continue;
      }
      pending.push(send(k));
      if (kind === 'nullpad' && pace !== 'burst') {
        await drain();
        await settle();
        if (pace === 'slow') await pause(slowMs);
      }
    }
    // Ctrl+E shows the source: the text field is only comparable there. The page gets two frames
    // to finish the last key first, so that the end of every script is not a race with Ctrl+E.
    if (kind === 'nullpad') {
      if (!closeAtOnce) {
        await drain();
        await settle();
        await settle();
      }
      pending.push(send('Control+e'));
    }
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
  return Object.assign(run, { prune });
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
const replayCommand = (keys, pace) => `node typist/run.mjs --pace ${pace} --script '${show(keys).replaceAll("'", "'\\''")}'`;

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
    const compare = async (pair, keys, pace, closeAtOnce = false) => {
      const [a, b] = await Promise.all([pair.plain(keys), pair.nullpad(keys, pace, closeAtOnce)]);
      return { a, b, why: differ(a, b) };
    };
    // A race does not always happen, so a repro that names `tries` is run that often and
    // counts as still differing if any run differs.
    const differs = async (pair, keys, pace, tries = 1, closeAtOnce = false) => {
      let last;
      for (let t = 0; t < tries; t++) {
        last = await compare(pair, keys, pace, closeAtOnce);
        if (last.why) break;
      }
      return last;
    };

    if (args.scripts) {
      for (const keys of JSON.parse(args.scripts)) {
        const { a, b, why } = await compare(pairs[0], keys, forcedPace ?? 'burst', closeAtOnce);
        console.log(`${why ? 'DIFFERS' : 'same   '} ${show(keys)}${why ? `\n    textarea ${show(a.state)}\n    nullpad  ${show(b.state)}` : ''}`);
      }
      return;
    }
    const paceOfScript = (i) => (args.script ? (forcedPace ?? 'burst') : paceOf(i));
    if (process.env.TYPIST_TRACE) console.log(`pages up at ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    const made = args.script ? [JSON.parse(args.script)] : makeScripts(count, length, seed).map((s, i) => (useKnown ? sanitize(paceOfScript(i) === 'slow' ? s.slice(0, slowKeys) : s, paceOfScript(i)) : s));
    // The plain textarea decides which vertical keys can be compared, so it has to type each script first.
    const scripts = args.script || !useKnown ? made : [];
    if (scripts.length === 0) {
      await Promise.all(
        pairs.map(async (pair, w) => {
          for (let i = w; i < made.length; i += workers) scripts[i] = await pair.plain.prune(made[i], paceOfScript(i));
        }),
      );
    }
    const ready = performance.now();
    if (process.env.TYPIST_TRACE) console.log(`ready at ${((ready - t0) / 1000).toFixed(1)}s`);
    const failed = [];
    await Promise.all(
      pairs.map(async (pair, w) => {
        for (let i = w; i < scripts.length; i += workers) {
          const t = performance.now();
          const r = await compare(pair, scripts[i], paceOfScript(i));
          if (process.env.TYPIST_TRACE && performance.now() - t > 1500) console.log(`slow ${((performance.now() - t) / 1000).toFixed(1)}s #${i} ${show(scripts[i]).slice(0, 400)}`);
          if (r.why === null) continue;
          failed.push({ i, why: r.why });
        }
      }),
    );
    const run = performance.now() - ready;
    if (process.env.TYPIST_TRACE) console.log(`scripts done at ${((performance.now() - t0) / 1000).toFixed(1)}s`);

    // Open bugs must still fail, and intended differences must still be there.
    const stale = [];
    if (useKnown && !args.script)
      await Promise.all(
        pairs.map(async (pair, w) => {
          const mine = known.filter((k, i) => k.repro && i % workers === w);
          for (const k of mine) if (!(await differs(pair, k.repro, k.pace ?? 'burst', k.tries, k.closeAtOnce)).why) stale.push(k);
        }),
      );

    const mix = paces.map((p) => `${scripts.filter((_, i) => paceOfScript(i) === p).length} ${p}`).join(', ');
    console.log(`typist: ${scripts.length} scripts of ${length} keys (${mix}), seed ${seed}, ${workers} workers, ${(run / 1000).toFixed(1)}s (${Math.round((scripts.length / run) * 60000)}/min)`);
    for (const e of [...new Set(errors)]) console.log(`  page error: ${e}`);

    failed.sort((x, y) => x.i - y.i);
    const seen = new Set();
    for (const f of failed.slice(0, Number(args.shrink ?? 8))) {
      const pace = paceOfScript(f.i);
      const keys = await shrink(scripts[f.i], async (c) => (await differs(pairs[0], c, pace, 2)).why !== null);
      const text = show(keys);
      if (seen.has(text)) continue;
      seen.add(text);
      const { a, b, why } = await differs(pairs[0], keys, pace, 2);
      console.log(`\nDIFFERENCE (${why}, ${pace}) script #${f.i} of seed ${seed}, shrunk ${scripts[f.i].length} -> ${keys.length} keys`);
      console.log(`  script   ${text}`);
      const sameText = a.state.v === b.state.v;
      const brief = (r) => JSON.stringify(sameText ? { s: r.state.s, e: r.state.e, d: r.state.d } : r.state);
      if (sameText) console.log(`  text     ${JSON.stringify(a.state.v)}`);
      console.log(`  textarea ${brief(a)} undone ${JSON.stringify(a.undone)}`);
      console.log(`  nullpad  ${brief(b)} undone ${JSON.stringify(b.undone)}`);
      console.log(`  replay   ${replayCommand(keys, pace)}`);
    }
    if (failed.length > seen.size) console.log(`\n${failed.length} scripts differ in new ways; ${seen.size} distinct shrunk scripts shown (--shrink N for more)`);
    for (const k of stale) {
      console.log(`\nSTALE known difference "${k.id}" (${k.kind}): its repro ${show(k.repro)} (${k.pace ?? 'burst'}) no longer differs. Delete it from e2e/typist/known.mjs.`);
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
