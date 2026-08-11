// GLib MainLoop management: an implicit event loop analogous to Node's.

import type GLib from '@girs/glib-2.0';

/** Guards double-start: a second `runAsync()` rejects, its hook is already registered. */
let _started = false;

let _loop: GLib.MainLoop | null = null;

/** GJS runtime bootstrap shape we read here. Pre-dates `@girs/*` resolution. */
interface _GjsImports {
    imports?: { gi?: { GLib?: typeof GLib } };
}

/**
 * Ensure a GLib MainLoop is running for async I/O dispatch (Soup.Server,
 * Gio.SocketService, …). No-op on Node.js. Idempotent.
 *
 * Called automatically by `http.Server.listen()`, `net.Server.listen()`,
 * `dgram.Socket.bind()`. GTK apps must NOT call it — they use
 * `Gtk.Application.runAsync()` instead.
 *
 * Teardown hazard: with a main-loop hook set, GJS's `eval_module` drives the
 * hook's *blocking* `loop.run()`, so terminating from an async continuation with
 * a bare `imports.system.exit()` DEADLOCKS — it only sets GJS's internal exit
 * flag, never calls `loop.quit()`, so the parked `loop.run()` never returns.
 * Microtask draining is unaffected; only the exit hangs
 * (`docs/poc/tla-microtask-draining.md`). Exit through `process.exit()` (which
 * idle-schedules `quitMainLoop()` + `system.exit()`) or call {@link quitMainLoop}
 * yourself first.
 */
export function ensureMainLoop(): GLib.MainLoop | undefined {
    const gjsImports = (globalThis as unknown as _GjsImports).imports;
    if (!gjsImports) return undefined; // Not GJS
    if (_started) return _loop!;

    const GLibModule = gjsImports.gi?.GLib;
    if (!GLibModule) return undefined;
    _loop = new GLibModule.MainLoop(null, false);
    _started = true;

    // A loop already running on the default context (test runner's
    // `mainloop.run()`, `Gtk.Application.runAsync()`) already dispatches our async
    // I/O; adding a setMainLoopHook on top gives a `loop.run()` that blocks
    // forever once tests quit it, because g_main_loop_run resets the quit flag on
    // entry.
    if (GLibModule.main_depth() === 0) {
        // GJS arms `setMainLoopHook` INSIDE the Promise executor, so an
        // already-registered hook surfaces as a REJECTION here, never as a
        // synchronous throw. Swallow exactly that: async I/O already dispatches.
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
