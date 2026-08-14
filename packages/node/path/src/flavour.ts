// Which flavour a host gets — the decision on its own, so a Linux runner can check it.
//
// Kept out of `index.ts` because on a POSIX host "selected per host" and "posix
// hardcoded" produce identical values, so nothing observable at runtime tells them
// apart — and no GJS-on-Windows host exists yet to notice. Taking the OS as an
// ARGUMENT makes the decision itself assertable from anywhere, which is the only half
// of this that a Linux runner can hold.

import * as posix from './posix.js';
import * as win32 from './win32.js';

/** The two flavours, by the names Node exposes them under. */
export type PathFlavour = typeof posix | typeof win32;

/**
 * The flavour for `os`, which is `hostOs()`'s answer in production.
 *
 * Anything that is not `'win32'` — including `undefined`, which is what a browser
 * answers — gets posix. That default is deliberate rather than incidental: it is both
 * the behaviour this package had before it selected at all, and the right answer for
 * every host that is not Windows.
 */
export function selectFlavour(os: string | undefined): PathFlavour {
    return os === 'win32' ? win32 : posix;
}
