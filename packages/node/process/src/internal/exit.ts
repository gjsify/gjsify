// process.exit — terminates the process, and does not come back.
//
// WHY THIS IS NOT JUST `system.exit()`
//
// Under GJS `system.exit()` sets an exit flag that GJS acts on when control
// returns to the top level. From a microtask continuation with a main-loop hook
// armed — the shape every CLI reaches after `await parseAsync()` — control never
// returns there, so the syscall never fires and the process HANGS. Measured on
// gjs 1.88, `timeout` killing it at 124 in both variants: with the hook armed,
// and with the hook armed and the loop already quit. `GLib.main_depth()` cannot
// tell those apart from the safe case, so it is not the discriminator it looks
// like — it reads 0 for a plain script where a direct exit works, 0 for both
// hanging shapes, and 1 inside a dispatched callback where a direct exit works
// again.
//
// WHAT DOES WORK, IN EVERY SHAPE
//
// Dispatching the exit from a main-context iteration this function drives
// itself. `system.exit()` fires from inside a dispatch, which is the one
// position measured to terminate in all four arrangements: a plain script with
// no loop, a hook armed with the exit called from a microtask, a callback
// dispatched by someone else's loop, and a real `Adw.Application` exiting from a
// GTK timeout. One path, no bookkeeping, and nothing to keep in sync with the
// dozen `app.runAsync()` call sites across this tree.
//
// AND WHY THE LOOP AT THE END IS THE POINT
//
// The previous implementation scheduled the same idle source and then RETURNED
// a forever-pending Promise cast to `never`. A Promise is not a `never`: the
// caller's SYNCHRONOUS control flow carried straight on to the next statement,
// so `if (bad) process.exit(3)` ran everything after it and only then died with
// the right code. `scripts/bootstrap-native-facades.mjs` carries its own boolean
// return because of this, and its comment records the damage — "a failed facade
// build still printed done in 3.09s … Right exit code, every following line a
// lie". Driving the context blocks instead: the function occupies the caller's
// stack until the process is gone, which is what `never` has to mean.
//
// If the idle never dispatches, this blocks rather than continuing. That is the
// honest failure for a termination request, and the reverse of the one above.

import { getGjsGlobal } from './gjs.js';

/** The `GLib.MainContext` surface this file drives — `default()` plus one blocking step. */
interface MainContextLike {
    iteration: (mayBlock: boolean) => boolean;
}

/**
 * Trigger process termination with the given exit code. Never returns, on any
 * path and under any runtime — the GJS branch blocks in a main-context loop
 * until the scheduled `system.exit()` takes the process down.
 */
export function exitProcess(code: number): never {
    const gjsImports = getGjsGlobal().imports;
    const GLib = gjsImports?.gi?.GLib as Record<string, unknown> | undefined;
    const system = gjsImports?.system;
    const idleAdd = GLib?.idle_add as ((priority: number, fn: () => boolean) => number) | undefined;
    const sourceRemove = GLib?.SOURCE_REMOVE as boolean | undefined;
    const priorityDefault = GLib?.PRIORITY_DEFAULT as number | undefined;
    const mainContext = GLib?.MainContext as { default: () => MainContextLike } | undefined;

    if (
        system?.exit &&
        idleAdd &&
        typeof priorityDefault === 'number' &&
        typeof sourceRemove === 'boolean' &&
        typeof mainContext?.default === 'function'
    ) {
        idleAdd(priorityDefault, () => {
            system.exit!(code);
            return sourceRemove;
        });
        const context = mainContext.default();
        // Not a spin: `iteration(true)` blocks until a source is ready, and the
        // idle above is ready immediately. It is a loop because dispatching one
        // source is not a promise that OURS was the one dispatched.
        for (;;) context.iteration(true);
    }

    // GJS without GLib (extremely unlikely) — direct syscall. There is no main
    // context to dispatch from, so this keeps the pre-existing deadlock risk
    // against a parked loop, and at least exits when none is running.
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
