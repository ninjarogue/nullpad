// Run through `node test/pick.mjs map`, which sets PICK_COVERAGE_DIR (and PICK_DPR2 for e2e.dpr2.config.mjs).
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { web } from '@e2e-dev/web';
import { chromium } from 'playwright-core';

const dir = process.env.PICK_COVERAGE_DIR;
const dpr2 = process.env.PICK_DPR2 === '1';
const compiled = /^https?:\/\/[^/]+\/nullpad\/(.+?)(?:\.ffi)?\.mjs(?:[?#].*)?$/;

async function collect(endpoint) {
  const connection = await chromium.connectOverCDP(endpoint);
  const called = new Map();
  const watched = new Map();
  let busy = Promise.resolve();
  const note = (scripts) => {
    for (const script of scripts) {
      const found = script.url.match(compiled);
      if (!found) continue;
      const names = called.get(found[1]) ?? new Set();
      script.functions.forEach((fn, at) => {
        const wrapper = at === 0 && fn.functionName === '' && fn.ranges[0].startOffset === 0;
        if (!wrapper && fn.functionName !== '' && fn.ranges[0].count > 0) names.add(fn.functionName);
      });
      called.set(found[1], names);
    }
  };
  const tick = async () => {
    for (const context of connection.contexts()) {
      for (const page of context.pages()) {
        if (watched.has(page)) continue;
        const session = await context.newCDPSession(page).catch(() => null);
        if (session === null) continue;
        watched.set(page, session);
        await session.send('Profiler.enable').catch(() => {});
        await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false }).catch(() => {});
      }
    }
    for (const [page, session] of watched) {
      if (page.isClosed()) {
        watched.delete(page);
        continue;
      }
      const taken = await session.send('Profiler.takePreciseCoverage').catch(() => null);
      if (taken) note(taken.result);
    }
  };
  const timer = setInterval(() => {
    busy = busy.then(tick);
  }, 100);
  return {
    async stop() {
      clearInterval(timer);
      await busy;
      await tick();
      await connection.close().catch(() => {});
      const named = Object.fromEntries([...called].map(([name, fns]) => [name, [...fns].sort()]));
      await writeFile(join(dir, `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`), JSON.stringify(named));
    },
  };
}

const lease = {
  name: 'chromium with precise coverage',
  async acquire({ signal }) {
    const profile = await mkdtemp(join(tmpdir(), 'nullpad-coverage-'));
    const browser = spawn(
      chromium.executablePath(),
      ['--headless', '--no-sandbox', ...(dpr2 ? ['--force-device-scale-factor=2'] : []), '--window-size=1280,720', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
      { stdio: ['ignore', 'ignore', 'pipe'], signal },
    );
    const cdpEndpoint = await new Promise((resolve, reject) => {
      let said = '';
      browser.stderr.on('data', (chunk) => {
        said += chunk;
        const at = said.indexOf('ws://');
        const end = said.indexOf('\n', at);
        if (at >= 0 && end > at) resolve(said.slice(at, end).trim());
      });
      browser.on('error', reject);
      browser.on('exit', () => reject(new Error(`chromium exited before it listened:\n${said}`)));
    });
    return { id: String(browser.pid), cdpEndpoint, browser, profile, collector: await collect(cdpEndpoint) };
  },
  async release(lease) {
    await lease.collector.stop();
    if (lease.browser.exitCode === null && lease.browser.signalCode === null) {
      const exited = new Promise((resolve) => lease.browser.once('exit', resolve));
      lease.browser.kill();
      await exited;
    }
    await rm(lease.profile, { recursive: true, force: true, maxRetries: 5 });
  },
};

export default {
  tests: ['tests/**/*.e2e.ts'],
  targets: [
    {
      engine: web({ testIdAttribute: 'data-test-id', browser: lease, ...(dpr2 ? { viewport: null } : {}) }),
      app: {
        url: 'http://127.0.0.1:0',
        permissions: { 'clipboard-read': 'grant', 'clipboard-write': 'grant' },
        command: { executable: 'node', args: ['serve.mjs', '{port}'], startupTimeout: 180_000, log: '.e2e/logs/app-coverage.log' },
      },
    },
  ],
};
