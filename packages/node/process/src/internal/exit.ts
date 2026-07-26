// process.exit — terminates the process. On GJS, schedules `system.exit()`
// via `GLib.idle_add` so the syscall fires from a fresh main-loop iteration:
// calling `system.exit()` directly from a microtask continuation (e.g.
// yargs's `parseAsync` resolution) while a `GLib.MainLoop` is parked
// deadlocks the process — the loop never returns control to top-level, the
// syscall never runs.
//
// `ensureMainLoop()` is non-blocking on first call: it registers the loop
// via `setMainLoopHook` so GJS keeps running it after JS module evaluation
// completes. Without this, the idle source would sit queued in the default
// main context but never dispatch (gjs -m exits as soon as JS eval ends),
// and the process would exit with code 0 regardless of `code`.

import { ensureMainLoop, quitMainLoop } from '@gjsify/utils/core';
import { getGjsGlobal } from './gjs.js';

/**
 * Trigger process termination with the given exit code. Returns `never` —
 * the function does not return to its caller under any path. If the GJS
 * idle-scheduled path is taken, this returns a forever-pending Promise so
 * the caller's synchronous control flow stalls until the syscall fires.
 */
export function exitProcess(code: number): never {
    const gjsImports = getGjsGlobal().imports;
    const GLib = gjsImports?.gi?.GLib as Record<string, unknown> | undefined;
    const system = gjsImports?.system;
    const idleAdd = GLib?.idle_add as ((priority: number, fn: () => boolean) => number) | undefined;
    const sourceRemove = GLib?.SOURCE_REMOVE as boolean | undefined;
    const priorityDefault = GLib?.PRIORITY_DEFAULT as number | undefined;

    // GJS path: schedule the exit via GLib.idle_add so the syscall fires
    // from a fresh main-loop iteration. The idle source must be added
    // BEFORE quitting the loop. Quit lives in the idle callback so the
    // source is guaranteed to dispatch before the loop drains.
    if (system?.exit && idleAdd && typeof priorityDefault === 'number' && typeof sourceRemove === 'boolean') {
        ensureMainLoop();
        idleAdd(priorityDefault, () => {
            quitMainLoop();
            system.exit!(code);
            return sourceRemove;
        });
        // Park the JS continuation forever — the idle source will exit the
        // process before this Promise can resolve. Cast satisfies the
        // `never` return type without taking down the synchronous control flow.
        return new Promise<never>(() => {
            /* never */
        }) as unknown as never;
    }

    // GJS without GLib (extremely unlikely) — direct syscall, may deadlock
    // a parked loop but at least exits when no loop is running.
    try {
        if (system?.exit) system.exit(code);
    } catch {
        /* ignore */
    }

    const nativeProcess = globalThis.process;
    if (nativeProcess && typeof nativeProcess.exit === 'function') {
        nativeProcess.exit(code);
    }

    // Fallback
    throw new Error(`process.exit(${code})`);
}
