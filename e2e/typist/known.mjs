// Every known difference between nullpad and a plain textarea, in one place.
//
//   intended  nullpad differs on purpose. The typist ignores it for good.
//   open      a bug we know about. It must still fail: the pre-push run stops when it
//             starts passing (like test.fixme), and then the entry is deleted.
//
// repro      a minimal script that shows the difference; open entries are re-run every time.
// matches    true for a script whose difference this entry explains. A random script that
//            differs and matches no entry is a new bug, and is shrunk and reported.
//            Keep matches narrow: a loose one hides new bugs.

/** @type {{ id: string, kind: 'intended' | 'open', reason: string, repro: (string | { paste: string })[], matches: (script: (string | { paste: string })[]) => boolean }[]} */
export const known = [];
