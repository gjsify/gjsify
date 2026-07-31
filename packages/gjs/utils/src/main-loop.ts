// GLib MainLoop management for GJS — original implementation
// Provides an implicit event loop analogous to Node.js's built-in event loop.

import type GLib from '@girs/glib-2.0';

/** Sentinel to prevent double-start (a second runAsync() would reject — its main-loop hook is already registered). */
let _started = false;

/** The singleton MainLoop instance, if created. */
let _loop: GLib.MainLoop | null = null;

/**
 * Ensure a GLib MainLoop is running for async I/O dispatch (Soup.Server,
 * Gio.SocketService, etc.). No-op on Node.js. Idempotent.
 *
 * - Called automatically by `http.Server.listen()`, `net.Server.listen()`,
 *   `dgram.Socket.bind()` etc.
 * - GTK apps should NOT call this — they use `Gtk.Application.runAsync()` instead.
 *
 * ## Teardown hazard with top-level `await`
 *
 * This registers a main-loop hook via `runAsync()` → `setMainLoopHook`. With a
 * hook set, GJS's `eval_module` drives the hook's *blocking* `loop.run()`. If
 * the entry module also has a pending top-level `await`, terminating the
 * process with a **bare `imports.system.exit()` from an async/Promise
 * continuation deadlocks**: `system.exit()` only sets GJS's internal exit flag,
 * it does not call `loop.quit()`, so the parked `loop.run()` never returns and
 * `eval_module` never reaches the real `::exit()`. Microtask draining itself is
 * unaffected (the promise-job dispatcher GSource keeps draining); only the exit
 * hangs. See `docs/poc/tla-microtask-draining.md`.
 *
 * Safe teardown: exit through `process.exit()` (which idle-schedules
 * `quitMainLoop()` + `system.exit()` — see `@gjsify/process`'s `exitProcess`)
 * or call {@link quitMainLoop} yourself before exiting. For a long-running
 * server entry, prefer a `main().catch(…)` body over a top-level `await`.
 *
 * @returns The MainLoop instance on GJS, or `undefined` on Node.js.
 */
/** GJS runtime bootstrap shape we read here. Pre-dates `@girs/*` resolution. */
interface _GjsImports {
    imports?: { gi?: { GLib?: typeof GLib } };
}

export function ensureMainLoop(): GLib.MainLoop | undefined {
    const gjsImports = (globalThis as unknown as _GjsImports).imports;
    if (!gjsImports) return undefined; // Not GJS
    if (_started) return _loop!;

    const GLibModule = gjsImports.gi?.GLib;
    if (!GLibModule) return undefined;
    _loop = new GLibModule.MainLoop(null, false);
    _started = true;

    // Only call runAsync() if no mainloop is currently running on the default
    // context. If one is already running (e.g., test runner's mainloop.run()
    // or Gtk.Application.runAsync()), async I/O already works through the
    // shared default context — calling runAsync() would register a
    // setMainLoopHook whose loop.run() blocks forever after tests quit it
    // (g_main_loop_run resets the quit flag on entry).
    if (GLibModule.main_depth() === 0) {
        // GIR types `runAsync(): Promise<void>` since GJS 1.86; the promise
        // settles when the loop quits. GJS's override arms `setMainLoopHook`
        // INSIDE the Promise executor, so a hook that is already registered
        // (e.g. Gtk.Application.runAsync()) surfaces as a REJECTION of this
        // promise — never as a synchronous throw. Swallow exactly that case:
        // an existing hook means async I/O already dispatches, no action
        // needed. Cancellation is via `quitMainLoop()`.
        _loop.runAsync().catch(() => {
            /* main-loop hook already registered — nothing to do */
        });
    }

    return _loop;
}

/**
 * Quit the MainLoop created by `ensureMainLoop()`. Idempotent, no-op on Node.js.
 *
 * Calling `quit()` on a loop that hasn't started yet pre-quits it — when the
 * `setMainLoopHook` later fires and calls `run()`, it returns immediately.
 * This is used by `@gjsify/unit` to prevent the loop from blocking after tests.
 */
export function quitMainLoop(): void {
    if (_loop) {
        _loop.quit();
        _started = false;
        _loop = null;
    }
}
