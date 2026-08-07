// The one way to end the CLI with a chosen exit code on BOTH runtimes.
//
// Node exits at natural shutdown once `process.exitCode` is set. GJS does not:
// it has no atexit hook, and `process.exit()` there is not immediate — its
// `exitProcess` IDLE-SCHEDULES `quitMainLoop()` + `imports.system.exit()` (see
// `utils/spawn.ts` for the main-loop machinery this rides on). From inside an
// asynchronous continuation — a `child.on('close'|'error')` handler, a
// `setTimeout`, a promise callback — that idle can lose the race with the
// module's own shutdown, and gjs then exits **0** no matter what code was
// requested. `imports.system.exit` has no such gap: SpiderMonkey raises its
// uncatchable exit exception from any context.
//
// This is not theoretical. `gjsify tsc` spawned the compiler and ended both its
// `close` and `error` handlers with a bare `process.exit(…)`. Under the GJS
// bundle every one of those exits was dropped, so the command reported SUCCESS
// whatever the compiler did — a type error exited 0, and so did "no compiler
// could be spawned at all". A release-cut on a cold tree then ran
// `node scripts/process-template.mjs && gjsify tsc && node scripts/set-bin-mode.mjs`
// to completion and died in `set-bin-mode.mjs` on a `lib/index.js` that `tsc`
// had never written — pointing the blame two steps past the actual failure.
//
// Two copies of this logic already existed (`commands/install.ts`'s local
// `forceExit`, `utils/oxc-resolve.ts`'s `setOxcExitCode`) and a third call site
// simply did without. One exported helper is the point: a new async exit path
// gets it right by importing it rather than by remembering the rule.

import { gjsExit } from '@gjsify/rolldown-plugin-gjsify/runtime';

/**
 * Exit the process with `code`, honoured on Node and GJS alike.
 *
 * Safe to call from any context, including an async callback where a bare
 * `process.exit()` would be dropped under GJS. Does not return.
 *
 * `process.exitCode` is set FIRST so that a host which somehow reaches natural
 * shutdown anyway still reports the right code.
 */
export function forceExit(code: number): never {
    process.exitCode = code;
    // Under GJS this does not return — `imports.system.exit` unwinds via
    // SpiderMonkey's uncatchable exit exception.
    if (gjsExit(code)) return undefined as never;
    return process.exit(code);
}
