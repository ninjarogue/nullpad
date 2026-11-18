import { surfaceOf, web } from '@e2e-dev/web';
import type { WebOptions } from '@e2e-dev/web';

let built: ReturnType<typeof web> | undefined;

/**
 * The engine of the config being run. A config builds its engine here, and the tests, which share
 * this module with the config, reach the browser it started through `live`.
 */
export function nullpadEngine(options: WebOptions = {}) {
  built = web({ testIdAttribute: 'data-test-id', ...options });
  return built;
}

/** The browser of the attempt that is running, whichever config built the engine. */
export function live() {
  if (built === undefined) throw new Error('no config has built its engine with nullpadEngine');
  return surfaceOf(built)!;
}
