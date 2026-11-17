// Text shift. After every key of a script typed a frame at a time or slowly, nullpad must not move
// what the key did not touch. The typist reads where the page paints every block of the note and
// its lines (DOMSnapshot.captureSnapshot, about 2ms) once the page has stopped drawing, and judges
// the blocks the key left alone. A key touches the cursor's block as it was and as it is, and every
// block whose text changed.
//   - A block left alone does not move sideways, and does not move up or down by itself: its lines
//     stay where they were to within half a pixel, wrapped into the same lines.
//   - Blocks above the touched ones do not move. Blocks below move together, by exactly the height
//     the touched blocks gained or lost, so two blocks left alone never drift apart. The first
//     touched block starts where it started.
//   - A key that changes no text (an arrow, Home, Shift, Ctrl+A) changes no height. The block the
//     cursor enters is as tall as it was drawn, so nothing below it moves.
//   - A key that changes text moves the blocks below by a whole number of lines, when the touched
//     blocks are all set in one line height. A line that turns into a heading, or a paste of several
//     kinds of block, changes the line height, and then any height is allowed.
// A script typed in a burst has no frame between its keys to look in, so it is not watched.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { listen } from '../browser-problems.mjs';
import { editsText, keyEvents, makeScripts, tours } from './keys.mjs';
import { judged, known, sanitize, skips } from './known.mjs';
import { capture, judge } from './shifts.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? '1' : all[i + 1]] : [])).filter((e) => e.length),
);
const count = Number(args.count ?? process.env.TYPIST_COUNT ?? 120);
const seed = Number(args.seed ?? process.env.TYPIST_SEED ?? 1);
const length = Number(args.length ?? 40);
const workers = Number(args.workers ?? 3);
const phoneOnly = args.phone !== undefined;
const tourCount = Number(args.tours ?? 3);
const phoneCount = phoneOnly || args.script ? 0 : Number(args['phone-count'] ?? 12);
/** The phone pass types shorter scripts: a row of the note wraps at 390px where the plain textarea does not. */
const phoneLength = 24;
const useKnown = args['no-known'] === undefined;
const useShifts = args['no-shifts'] === undefined;
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
const anchorOf = `document.querySelector('textarea')?.dataset.typistAnchor ?? null`;
const movesAnchor = (k) => typeof k === 'string' && k.includes('Shift+');
const slowMs = 120;
const paces = ['burst', 'frame', 'slow'];
const closeAtOnce = args['close-at-once'] !== undefined;
const forcedPace = args.pace && args.pace !== 'mixed' ? args.pace : null;
if (forcedPace && !paces.includes(forcedPace)) throw new Error(`--pace ${forcedPace}: one of ${paces.join(', ')}, mixed`);
const paceOf = (i) => forcedPace ?? (i % 16 === 15 ? 'slow' : i % 16 >= 9 ? 'frame' : 'burst');
const phonePaceOf = (i) => forcedPace ?? (i % 3 === 0 ? 'burst' : 'frame');
const phoneDevice = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
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

async function open(browser, url, kind, errors, phone) {
  const context = await browser.newContext(phone ? phoneDevice : {});
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await listen(cdp, (problem) => errors.push(problem));
  const ev = async (expression) => (await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
  const send = (spec) => Promise.all(keyEvents(spec).map((e) => cdp.send('Input.dispatchKeyEvent', e)));
  const settle = () => ev(frame);
  /** Where the page paints each block of the note once it has finished drawing: two reads a frame apart that agree. */
  const painted = async () => {
    let was = await capture(cdp);
    for (let again = 0; again < 8; again++) {
      await settle();
      const now = await capture(cdp);
      if (JSON.stringify(now) === JSON.stringify(was)) return now;
      was = now;
    }
    return was;
  };
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
    const anchorMoves = [];
    const shifts = [];
    const found = [];
    const watching = kind === 'nullpad' && pace !== 'burst' && useShifts;
    let drawn = null;
    if (watching) {
      await settle();
      drawn = await painted();
    }
    const watch = async (k, step) => {
      const now = await painted();
      if (drawn && now)
        for (const problem of judge(drawn, now, { typed: editsText(k) })) {
          found.push(problem);
          if (!useKnown || !known.some((entry) => entry.shift?.(problem))) shifts.push(`key ${step + 1} (${typeof k === 'string' ? k : 'paste'}): ${problem.text}`);
        }
      drawn = now ?? drawn;
    };
    for (const [step, k] of keys.entries()) {
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
        if (watching) await watch(k, step);
        continue;
      }
      const watched = kind === 'nullpad' && pace !== 'burst' && movesAnchor(k);
      const before = watched ? (await drain(), await settle(), await ev(anchorOf)) : null;
      pending.push(send(k));
      if (kind === 'nullpad' && pace !== 'burst') {
        await drain();
        await settle();
        if (watched) await settle();
        if (pace === 'slow') await pause(slowMs);
      }
      if (watched) {
        const after = await ev(anchorOf);
        if (after !== before) anchorMoves.push(`${k} moved the anchor from ${before} to ${after}`);
      }
      if (watching) await watch(k, step);
    }
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
    let undone = null;
    if (kind === 'nullpad') {
      for (let i = 0; i < keys.length + 5; i++) pending.push(send('Control+z'));
      await drain();
      undone = (await ev(read)).v;
      await send('Control+e');
    }
    return { state, undone, anchorMoves, shifts, found };
  };
  return Object.assign(run, { prune });
}

const differ = (a, b) =>
  b.anchorMoves?.length
    ? 'anchor moved on a Shift key'
    : sign(a.state) !== sign(b.state)
      ? 'text, cursor or selection'
      : b.undone !== ''
        ? 'undo everything'
        : b.shifts?.length
          ? 'text shifted'
          : null;

async function shrink(keys, fails, comparable = async (candidate) => candidate) {
  for (let size = Math.ceil(keys.length / 2); size >= 1; size = size === 1 ? 0 : Math.ceil(size / 2)) {
    for (let at = 0; at < keys.length; ) {
      const candidate = await comparable(keys.slice(0, at).concat(keys.slice(at + size)));
      if (candidate.length && (await fails(candidate))) keys = candidate;
      else at += size;
    }
  }
  return keys;
}

const show = (keys) => JSON.stringify(keys);
const replayCommand = (keys, pace, phone) => `node typist/run.mjs${phone ? ' --phone' : ''} --pace ${pace} --script '${show(keys).replaceAll("'", "'\\''")}'`;

async function main() {
  const t0 = performance.now();
  const server = await startServer();
  const errors = [];
  let exit = 0;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chromium' });
    const makePair = async (phone) => {
      const [plain, nullpad] = await Promise.all([open(browser, server.url, 'textarea', errors, phone), open(browser, server.url, 'nullpad', errors, phone)]);
      return { plain, nullpad, phone };
    };
    const [phonePair, ...pairs] = await Promise.all([
      phoneCount > 0 ? makePair(true) : null,
      ...Array.from({ length: workers }, () => makePair(phoneOnly)),
    ]);
    const compare = async (pair, keys, pace, closeAtOnce = false) => {
      const [a, b] = await Promise.all([pair.plain(keys), pair.nullpad(keys, pace, closeAtOnce)]);
      return { a, b, why: differ(a, b) };
    };
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
        for (const moved of b.anchorMoves ?? []) console.log(`    ${moved}`);
      }
      return;
    }
    if (process.env.TYPIST_TRACE) console.log(`pages up at ${((performance.now() - t0) / 1000).toFixed(1)}s`);
    const job = (keys, pace, phone = false) => ({ keys: useKnown && !args.script ? sanitize(pace === 'slow' ? keys.slice(0, slowKeys) : keys, pace) : keys, pace, phone });
    const phoneTours = Math.min(2, tourCount);
    const made = args.script
      ? [job(JSON.parse(args.script), forcedPace ?? 'burst')]
      : [
          ...makeScripts(count, length, seed).map((keys, i) => job(keys, paceOf(i))),
          ...tours(tourCount, seed).map((keys) => job(keys, forcedPace ?? 'frame')),
          ...(phonePair
            ? [
                ...makeScripts(phoneCount, phoneLength, seed + 1000).map((keys, i) => job(keys, phonePaceOf(i), true)),
                ...tours(phoneTours, seed + 1000).map((keys) => job(keys, forcedPace ?? 'frame', true)),
              ]
            : []),
        ];
    const lanes = [...pairs, ...(phonePair ? [phonePair] : [])].map((pair) => ({ pair, jobs: [] }));
    made.forEach((each, i) => lanes[each.phone ? lanes.length - 1 : i % workers].jobs.push(i));
    const laneOf = (i) => lanes.find((lane) => lane.jobs.includes(i)).pair;
    const paceOfScript = (i) => made[i].pace;
    const scripts = made.map((each) => each.keys);
    if (useKnown && !args.script) {
      await Promise.all(
        lanes.map(async ({ pair, jobs }) => {
          for (const i of jobs) scripts[i] = await pair.plain.prune(scripts[i], paceOfScript(i));
        }),
      );
    }
    const ready = performance.now();
    if (process.env.TYPIST_TRACE) console.log(`ready at ${((ready - t0) / 1000).toFixed(1)}s`);
    const failed = [];
    await Promise.all(
      lanes.map(async ({ pair, jobs }) => {
        for (const i of jobs) {
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

    const stale = [];
    if (useKnown && !args.script && !phoneOnly)
      await Promise.all(
        pairs.map(async (pair, w) => {
          const mine = known.filter((k, i) => k.repro && i % workers === w);
          for (const k of mine) {
            const typed = await differs(pair, k.repro, k.pace ?? 'burst', k.tries, k.closeAtOnce);
            if (k.shift ? !typed.b.found.some(k.shift) : !typed.why) stale.push(k);
          }
        }),
      );

    const mix = paces.map((p) => `${scripts.filter((_, i) => paceOfScript(i) === p).length} ${p}`).join(', ');
    const keysTyped = scripts.reduce((sum, script) => sum + script.length, 0);
    const kinds = `${count} random of ${length} keys and ${tourCount} block tours${phonePair ? `, on a phone ${phoneCount} random of ${phoneLength} keys and ${phoneTours} tours` : ''}${phoneOnly ? ', all on a phone' : ''}`;
    console.log(`typist: ${scripts.length} scripts (${kinds}; ${mix}), seed ${seed}, ${workers} workers, ${(run / 1000).toFixed(1)}s (${Math.round((scripts.length / run) * 60000)}/min, ${keysTyped} keys, ${Math.round((keysTyped / run) * 60000)} keys/min)`);
    for (const e of [...new Set(errors)]) console.log(`  browser reported: ${e}`);

    failed.sort((x, y) => x.i - y.i);
    const seen = new Set();
    for (const f of failed.slice(0, Number(args.shrink ?? 8))) {
      const pace = paceOfScript(f.i);
      const pair = laneOf(f.i);
      const comparable = useKnown && !args.script ? (c) => pair.plain.prune(c, pace) : undefined;
      const keys = await shrink(scripts[f.i], async (c) => (await differs(pair, c, pace, 2)).why !== null, comparable);
      const text = show(keys);
      if (seen.has(text)) continue;
      seen.add(text);
      const { a, b, why } = await differs(pair, keys, pace, 2);
      console.log(`\nDIFFERENCE (${why}, ${pace}${pair.phone ? ', phone' : ''}) script #${f.i} of seed ${seed}, shrunk ${scripts[f.i].length} -> ${keys.length} keys`);
      console.log(`  script   ${text}`);
      const sameText = a.state.v === b.state.v;
      const brief = (r) => JSON.stringify(sameText ? { s: r.state.s, e: r.state.e, d: r.state.d } : r.state);
      if (sameText) console.log(`  text     ${JSON.stringify(a.state.v)}`);
      console.log(`  textarea ${brief(a)} undone ${JSON.stringify(a.undone)}`);
      console.log(`  nullpad  ${brief(b)} undone ${JSON.stringify(b.undone)}`);
      for (const moved of b.anchorMoves ?? []) console.log(`  ${moved}`);
      for (const shifted of (b.shifts ?? []).slice(0, 3)) console.log(`  shifted  ${shifted}`);
      console.log(`  replay   ${replayCommand(keys, pace, pair.phone)}`);
    }
    if (failed.length > seen.size) console.log(`\n${failed.length} scripts differ in new ways; ${seen.size} distinct shrunk scripts shown (--shrink N for more)`);
    for (const k of stale) {
      console.log(`\nSTALE known difference "${k.id}" (${k.kind}): its repro ${show(k.repro)} (${k.pace ?? 'burst'}) no longer differs. Delete it from e2e/typist/known.mjs.`);
    }
    if (failed.length || stale.length || errors.length) exit = 1;
    else console.log('typist: no differences');
  } catch (error) {
    // A page that does not come up has usually said why.
    for (const e of [...new Set(errors)]) console.log(`  browser reported: ${e}`);
    throw error;
  } finally {
    await browser?.close();
    server.stop();
  }
  console.log(`total ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(exit);
}

main();
