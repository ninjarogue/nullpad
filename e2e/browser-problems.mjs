// What a page tells the browser's developer tools that nobody asked for: an error or a rejection
// nothing caught, console.error and console.warn, a console.assert that failed, and the browser's
// own error and warning lines (a request that failed, a deprecation, a policy violation). The e2e
// tests and the robot typist both listen through this module, so both fail on the same things.

const loud = new Set(['error', 'warning', 'assert']);

/**
 * Browser lines that say nothing about nullpad. A line is let through only when a pattern matches
 * all of it, and each pattern says why it is allowed.
 * @type {{ pattern: RegExp, why: string }[]}
 */
export const noise = [];

const shown = (value) => value.value ?? value.description ?? `[${value.type}]`;
const place = (url, line) => (url ? ` (${url}${line === undefined ? '' : `:${line + 1}`})` : '');
const firstLines = (text) => text.split('\n').slice(0, 3).join('\n');

/**
 * Starts telling `report` every problem the page behind `cdp` shows, from now on and from what it
 * showed before the call that the browser still holds. Resolves once the browser has been asked
 * to send them.
 * @param {{ on(event: string, handler: (params: any) => void): unknown, send(method: string): Promise<unknown> }} cdp
 * @param {(problem: string) => void} report
 */
export async function listen(cdp, report) {
  const found = (problem) => {
    if (!noise.some(({ pattern }) => pattern.exec(problem)?.[0] === problem)) report(problem);
  };
  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) =>
    found(`uncaught ${firstLines(d.exception?.description ?? d.text)}${place(d.url, d.lineNumber)}`),
  );
  cdp.on('Runtime.consoleAPICalled', ({ type, args, stackTrace }) => {
    if (!loud.has(type)) return;
    const top = stackTrace?.callFrames[0];
    found(`console.${type}: ${args.map(shown).join(' ')}${place(top?.url, top?.lineNumber)}`);
  });
  cdp.on('Log.entryAdded', ({ entry }) => {
    if (entry.level === 'error' || entry.level === 'warning') {
      found(`${entry.source} ${entry.level}: ${entry.text}${place(entry.url, entry.lineNumber)}`);
    }
  });
  await Promise.all([cdp.send('Runtime.enable'), cdp.send('Log.enable')]);
}
