// The heading tests again on a screen with two device pixels to a CSS pixel,
// where the browser rounds a line's place to half pixels. Playwright resets
// the scale of a page whose viewport it sets, so the window sets the size.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { web } from '@e2e-dev/web';
import { chromium } from 'playwright-core';

const twice = {
  name: 'chromium at device pixel ratio 2',
  async acquire({ signal }) {
    const profile = await mkdtemp(join(tmpdir(), 'nullpad-dpr2-'));
    const browser = spawn(
      chromium.executablePath(),
      [
        '--headless',
        '--no-sandbox',
        '--force-device-scale-factor=2',
        '--window-size=1280,720',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
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
    return { id: String(browser.pid), cdpEndpoint, browser, profile };
  },
  async release(lease) {
    if (lease.browser.exitCode === null && lease.browser.signalCode === null) {
      const exited = new Promise((resolve) => lease.browser.once('exit', resolve));
      lease.browser.kill();
      await exited;
    }
    await rm(lease.profile, { recursive: true, force: true, maxRetries: 5 });
  },
};

export default {
  tests: ['tests/headings.e2e.ts', 'tests/dpr2/*.e2e.ts'],
  targets: [
    {
      name: 'dpr2',
      engine: web({ testIdAttribute: 'data-test-id', browser: twice, viewport: null }),
      app: {
        url: 'http://127.0.0.1:0',
        command: {
          executable: 'node',
          args: ['serve.mjs', '{port}'],
          startupTimeout: 180_000,
          log: '.e2e/logs/app-dpr2.log',
        },
      },
    },
  ],
};
