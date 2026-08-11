// The one way to end the CLI with a chosen exit code on BOTH runtimes.
//
// Node exits at natural shutdown once `process.exitCode` is set. GJS has no
// atexit hook, and its `process.exit()` is not immediate — `exitProcess`
// idle-schedules `quitMainLoop()` + `imports.system.exit()`. From an async
// continuation (a `child.on('close'|'error')` handler, a `setTimeout`, a promise
// callback) that idle can lose the race with module shutdown, and gjs then exits
// **0** no matter what code was requested. `imports.system.exit` has no such
// gap: SpiderMonkey raises its uncatchable exit exception from any context.
//
// Incident: `gjsify tsc` ended its `close` and `error` handlers with a bare
// `process.exit(…)`, so under the GJS bundle the command reported SUCCESS
// whatever the compiler did — a type error exited 0, and so did "no compiler
// could be spawned at all". A release-cut then died two steps later, in
// `set-bin-mode.mjs`, on a `lib/index.js` that `tsc` had never written.

import { gjsExit } from '@gjsify/rolldown-plugin-gjsify/runtime';

/**
 * Exit the process with `code`, honoured on Node and GJS alike.
 *
 * Safe to call from any context, including an async callback where a bare
 * `process.exit()` would be dropped under GJS. Does not return.
 */
export function forceExit(code: number): never {
    // Set first, so a host that somehow reaches natural shutdown anyway still
    // reports the right code.
    process.exitCode = code;
    // Under GJS this does not return — `imports.system.exit` unwinds via
    // SpiderMonkey's uncatchable exit exception.
    if (gjsExit(code)) return undefined as never;
    return process.exit(code);
}
