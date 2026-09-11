// The CLI has TWO ways to fail, and until now only one of them reached the shell
// under GJS.
//
// A command handler either THROWS — `index.ts` catches it, prints, and calls
// `gjsExit(1)` — or it REPORTS the failure by assigning `process.exitCode` and
// returning normally. The second shape is the documented Node idiom (streams
// flush, the process ends naturally) and the CLI uses it wherever a failure has
// already been printed in full: `gjsify gresource`/`gjsify gsettings` propagate
// the code `glib-compile-*` exited with, `gjsify barrels --check` reports drift,
// `setOxcExitCode` propagates a formatter's verdict.
//
// **Under GJS that assignment is a REPORT and nothing more.** There is no atexit
// hook, so nothing reads `process.exitCode` back at natural shutdown and the
// process ends 0. Measured on the v0.49.0 bundle, same argv, same broken input:
//
//     $ node lib/index.js  gresource broken.gresource.xml   → exit 1
//     $ gjs -m dist/cli.gjs.mjs gresource broken.gresource.xml → exit 0
//       ("[gjsify gresource] glib-compile-resources failed (exit 1)" printed)
//
// and the same split for `gjsify gsettings` and `gjsify barrels --check`. The
// consequence is not a cosmetic status: a package script chaining on it runs the
// next step over an artifact that was never written —
//
//     "build:resources": "gjsify gresource … && echo SECOND"
//       → SECOND printed, script exits 0   (JumpLink/Learn6502#180)
//
// — which is exactly the shape `&&` is supposed to protect. `gjsify run`'s
// in-process fast path was already immune (it reads `process.exitCode` back
// itself, #1568), so the hole survived precisely in the SPAWNED command, i.e.
// in every chained script and every direct CI invocation.
//
// This module is the missing half of the entry's exit funnel, and a sibling of
// `force-exit.ts`: that one is for a caller that knows the code it wants NOW,
// this one for the status a settled run left behind. The rule is pure so it can
// be stated as a test without driving a process to its death.
//
// Related, and deliberately distinct: `gjsify/deferred-process-exit` (oxlint)
// covers the OTHER GJS exit trap, a bare `process.exit()` that does not halt.
// No lint rule could have caught this one — every `process.exitCode = …` site
// is correct; the entry was not reading them.

import { gjsExit } from '@gjsify/rolldown-plugin-gjsify/runtime';
import { isDaemonCommand } from './daemon-command.js';

/**
 * The status a settled CLI run still owes the shell, or `null` when it owes
 * none.
 *
 * @param exitCode what `process.exitCode` holds now — `number | string | null |
 *   undefined`, the full set Node accepts for that property.
 * @param isDaemon whether the command declared itself a daemon. A watch loop
 *   RESOLVES as soon as it is armed and keeps running, so its resolution is not
 *   an ending to exit on — the same rule `gjsify run`'s fast path applies, and
 *   the incident behind it (`gjsify run dev` killing the loop it had just
 *   started) is in `daemon-command.ts`.
 */
export function pendingFailureCode(exitCode: number | string | null | undefined, isDaemon: boolean): number | null {
    if (isDaemon) return null;
    if (exitCode === null || exitCode === undefined) return null;
    const code = Number(exitCode);
    // A non-finite value cannot be assigned to `process.exitCode` on Node at
    // all, so there is no failure here to invent one from.
    return Number.isFinite(code) && code !== 0 ? code : null;
}

/**
 * End a settled CLI run on the status its handler reported, on both runtimes.
 *
 * No-op unless a handler actually reported a failure. On Node it is a no-op
 * even then — `gjsExit` finds no `imports.system` and the runtime honours
 * `process.exitCode` at natural shutdown by itself, which is why this does NOT
 * reach for `process.exit()`: that would cut short the stdout flush Node's own
 * idiom exists to allow.
 */
export function exitOnReportedFailure(): void {
    const code = pendingFailureCode(process.exitCode, isDaemonCommand());
    if (code !== null) gjsExit(code);
}
