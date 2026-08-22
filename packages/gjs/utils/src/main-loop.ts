// GLib MainLoop management: an implicit event loop analogous to Node's.

import type GLib from '@girs/glib-2.0';

/** The single loop this module owns. `null` until something first asks for one. */
let _loop: GLib.MainLoop | null = null;

/** Guards double-creation: the arming decision below is made once, at creation. */
let _created = false;

/**
 * Whether `runAsync()` has registered the GJS main-loop hook for {@link _loop}.
 * Separate from "a loop exists": {@link ensureMainLoop} creates one it may
 * decline to arm, and {@link holdMainLoop} then has to arm THAT loop rather than
 * conclude from its existence that the hook is already set.
 */
let _armed = false;

/** GJS runtime bootstrap shape we read here. Pre-dates `@girs/*` resolution. */
interface _GjsImports {
    imports?: { gi?: { GLib?: typeof GLib } };
}

/** The GJS `GLib` binding, or `undefined` when not running under GJS. */
function glib(): typeof GLib | undefined {
    return (globalThis as unknown as _GjsImports).imports?.gi?.GLib;
}

/** Register the GJS main-loop hook, once. */
function arm(loop: GLib.MainLoop): void {
    if (_armed) return;
    _armed = true;
    // GJS arms `setMainLoopHook` INSIDE the Promise executor, so an
    // already-registered hook surfaces as a REJECTION here, never as a
    // synchronous throw. Swallow exactly that: whoever registered first
    // (a `Gtk.Application.runAsync()`) is already driving the loop.
    loop.runAsync().catch(() => {
        /* main-loop hook already registered — nothing to do */
    });
}

/**
 * Ensure a GLib MainLoop is running for async I/O dispatch (Soup.Server,
 * Gio.SocketService, …). No-op on Node.js. Idempotent.
 *
 * Called automatically by `http.Server.listen()`, `net.Server.listen()`,
 * `dgram.Socket.bind()`. GTK apps must NOT call it — they use
 * `Gtk.Application.runAsync()` instead. A supervisor that must OUTLIVE its entry
 * module wants {@link holdMainLoop} instead; see there for why this one cannot
 * serve it.
 *
 * Teardown hazard: with a main-loop hook set, GJS's `eval_module` drives the
 * hook's *blocking* `loop.run()`, so terminating from an async continuation with
 * a bare `imports.system.exit()` DEADLOCKS — it only sets GJS's internal exit
 * flag, never calls `loop.quit()`, so the parked `loop.run()` never returns.
 * Microtask draining is unaffected; only the exit hangs
 * (`docs/poc/tla-microtask-draining.md`). Calling {@link quitMainLoop} first
 * does NOT lift it — measured, the bare exit still hangs afterwards. Exit
 * through `process.exit()`, which schedules the syscall on an idle source and
 * then drives the default main context until it fires, so the exit happens
 * from inside a dispatch where it works and the call never returns
 * (`tests/e2e/process-exit-terminates`).
 */
export function ensureMainLoop(): GLib.MainLoop | undefined {
    const GLibModule = glib();
    if (!GLibModule) return undefined; // Not GJS
    if (_created) return _loop!;
    _loop = new GLibModule.MainLoop(null, false);
    _created = true;

    // A loop already running on the default context (test runner's
    // `mainloop.run()`, `Gtk.Application.runAsync()`) already dispatches our async
    // I/O; adding a setMainLoopHook on top gives a `loop.run()` that blocks
    // forever once tests quit it, because g_main_loop_run resets the quit flag on
    // entry.
    if (GLibModule.main_depth() === 0) arm(_loop);

    return _loop;
}

/**
 * Keep this process alive on the GLib main loop AFTER its entry module settles —
 * for a command that SUPERVISES rather than finishes (a watch loop, a daemon).
 * No-op on Node.js, where pending handles do this job. Idempotent.
 *
 * {@link ensureMainLoop} cannot serve that case, and the difference is the whole
 * reason this exists: it declines to arm the hook at `main_depth() !== 0`, and
 * under a GJS *module* entry point that depth is routinely 1. GJS spins the
 * default main context itself while the entry module's top-level await is
 * pending, so every continuation resumed from a dispatched source — a timer, a
 * `Gio` async callback, anything but the first microtask drain — runs inside
 * that spin. `ensureMainLoop()` then silently arms nothing, the spin ends when
 * the module promise settles, and the process exits.
 *
 * Measured on gjs 1.88.1: a module that spawns a child and arms an `fs.watch`
 * from such a continuation prints its startup lines and exits 0 the moment its
 * top-level await settles, orphaning the child; the same code with the spawn
 * BEFORE the first await stays alive. So the depth guard is not a safety net
 * here, it is the defect.
 *
 * Arming regardless of depth is why this is opt-in rather than the default: only
 * a caller that knows it will never unwind may stack a loop under one that may
 * already be running. Exit through `process.exit()` — see {@link ensureMainLoop}
 * for why a bare `imports.system.exit()` deadlocks.
 */
export function holdMainLoop(): GLib.MainLoop | undefined {
    const loop = ensureMainLoop();
    if (loop) arm(loop);
    return loop;
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
        _created = false;
        _armed = false;
        _loop = null;
    }
}
