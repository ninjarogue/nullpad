import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';

export default {
  targets: [
    {
      engine: web({ testIdAttribute: 'data-test-id' }),
      app: {
        url: 'http://127.0.0.1:0',
        permissions: { 'clipboard-read': 'grant', 'clipboard-write': 'grant' },
        command: {
          executable: 'node',
          args: ['serve.mjs', '{port}'],
          startupTimeout: 180_000,
          log: '.e2e/logs/app.log',
        },
      },
    },
  ],
} satisfies E2EConfig;
