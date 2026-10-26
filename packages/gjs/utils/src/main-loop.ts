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

/**
 * Live holds opened by {@link acquireMainLoop} — Node's active-handle count.
 * Only this count reaches {@link releaseMainLoop}'s quit decision; the
 * uncounted {@link ensureMainLoop} / {@link holdMainLoop} callers park
 * forever by contract and leave it untouched. Reset with the loop it
 * describes.
 */
let _holds = 0;

/**
 * Whether the live holds alone own the loop: {@link acquireMainLoop} created it
 * and no uncounted {@link ensureMainLoop} / {@link holdMainLoop} caller has
 * joined since. Only then may the last release end the process; a loop someone
 * else created or also depends on (a listening server, a GTK application) must
 * outlive the holds, as it does on Node.
 */
let _ownsLoop = false;

/**
 * Referenced timers (`setTimeout`/`setInterval`) pending right now — Node's
 * active timer handles. Never creates or arms a loop: it only DEFERS the exit
 * a drained {@link acquireMainLoop} owner would otherwise take, so a timer in
 * an app without counted holds changes nothing. Independent of the loop's
 * lifetime (a timer outlives {@link quitMainLoop}), hence not reset by it.
 */
let _timers = 0;

/**
 * The counted holds drained to 0 on a loop we own, but the exit was postponed
 * (the entry module is still evaluating, or a timer is pending). Keeps
 * {@link _ownsLoop} from being recomputed by the next {@link acquireMainLoop}:
 * the loop already exists by then, which would read as "someone else's".
 */
let _owed = false;

/** A poller waiting for the parked hook to start is already scheduled. */
let _polling = false;

/** GJS runtime bootstrap shape we read here. Pre-dates `@girs/*` resolution. */
interface _GjsImports {
    imports?: { gi?: { GLib?: typeof GLib } };
    process?: { versions?: { gjs?: string } };
}

/**
 * The GJS `GLib` binding, or `undefined` when not running under GJS.
 *
 * Keyed on the RUNTIME, not on `imports.gi` being present: `@gjsify/node-gi`
 * injects `imports.gi` on Node, Bun and Deno, whose own event loop already
 * dispatches the default main context, so there is no loop to arm. Keyed on
 * presence, `ensureMainLoop()` called GJS's `GLib.MainLoop.prototype.runAsync`
 * there, an override node-gi does not have, and the TypeError surfaced as
 * `EIO: e.runAsync is not a function` from `net.Server.listen()`.
 */
function glib(): typeof GLib | undefined {
    const host = globalThis as unknown as _GjsImports;
    // `@gjsify/runtime`'s detectRuntime() GJS branches, inlined: this module
    // sits in build:infra's bundler-free prefix, before @gjsify/runtime is
    // built, and the CLI loads it. A bare GJS program has no `process`; one
    // with @gjsify/process sets `versions.gjs`, which node-gi never does.
    const isGjs = typeof host.process?.versions?.gjs === 'string' || host.process === undefined;
    if (!isGjs) return undefined;
    return host.imports?.gi?.GLib;
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
    _ownsLoop = false; // an uncounted caller now depends on this loop too
    return createLoop();
}

function createLoop(): GLib.MainLoop | undefined {
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
 * Acquire a Node-style counted hold on the running loop — the drain half of
 * Node's event-loop liveness. Acquired again for every handle that must keep
 * the process alive (`worker_threads` spawn, later child/IO migrations); the
 * process is no longer held once the next {@link releaseMainLoop} drops the
 * count to 0.
 *
 * Separate from the uncounted primitives for the same reason they exist:
 * {@link ensureMainLoop} / {@link holdMainLoop} callers park FOREVER and exit
 * via `process.exit()` — a consumer with a drain lifecycle must not be one of
 * them, because releasing has to be reversible here without defeating those
 * callers' expectations. GLib's `loop.run()` blocks until `quit()` — there is
 * no "run until no sources remain" — so a drain cannot be observed by the loop
 * itself; it has to be counted.
 *
 * Known limit, counted holds are only the `worker_threads` and `child_process` consumers today:
 * `net`/`http`/`dgram`/`ws` park via {@link ensureMainLoop}
 * forever (their close paths don't release yet), so an app holding BOTH a
 * live server and a worker stays parked when the worker drains — same as on
 * those packages' pre-existent behavior, and the slot for their migration is
 * exactly this pair. Also inherits the {@link ensureMainLoop} depth note: a
 * hold acquired inside a top-level-await continuation at `main_depth() !== 0`
 * is counted but not armed, and the entry's spin ends at settle like it
 * always did.
 */
export function acquireMainLoop(): GLib.MainLoop | undefined {
    const wasCreated = _created;
    const loop = createLoop();
    if (!loop) return undefined; // not GJS — Node keeps handles natively
    if (_holds === 0 && !_owed) _ownsLoop = !wasCreated;
    _holds += 1;
    return loop;
}

/**
 * Release one hold acquired with {@link acquireMainLoop}. Idempotent beyond
 * the count (calls at 0 are a no-op), no-op on Node.js. At 0, with no referenced timer
 * ({@link trackTimer}) pending and the entry module settled, the loop created
 * by this module is quit and the process exits — the Node "refs drained" moment.
 */
export function releaseMainLoop(): void {
    if (_holds === 0 || !_loop) return;
    _holds -= 1;
    drainIfIdle();
}

/** Count one referenced timer. See {@link _timers}. */
export function trackTimer(): void {
    _timers += 1;
}

/** Drop one referenced timer; the last one may complete a postponed exit. */
export function untrackTimer(): void {
    if (_timers === 0) return;
    _timers -= 1;
    if (_timers === 0) drainIfIdle();
}

/**
 * End the process once nothing is left to wait for: no counted hold, no
 * referenced timer, and the entry module has settled. Node's "event loop is
 * empty" moment, for a loop that {@link acquireMainLoop} owns.
 */
function drainIfIdle(): void {
    if (_holds !== 0 || !_loop || !_ownsLoop) return;
    const loop = _loop;
    if (!_armed) {
        // Unarmed: its owner already drives it and no exit follows, so there is
        // nothing a pending timer could be lost to — just discard the loop.
        quitMainLoop();
        return;
    }
    if (_timers !== 0) {
        _owed = true; // the last timer's untrackTimer() finishes the drain
        return;
    }
    // Armed but not running: gjs's eval_module is still evaluating the entry
    // (a pending top-level await spins the default context, not this loop), so
    // exiting now would kill work the program has not finished — measured:
    // `await close; await sleep(300); log('after')` lost 'after'. Wait until
    // the hook enters `run()`, which is the entry having settled.
    if (!loop.is_running()) {
        _owed = true;
        awaitEntrySettle(loop);
        return;
    }
    exitParked();
}

function awaitEntrySettle(loop: GLib.MainLoop): void {
    const GLibModule = glib();
    if (!GLibModule || _polling) return;
    _polling = true;
    GLibModule.timeout_add(GLibModule.PRIORITY_DEFAULT, 20, () => {
        // Acquired again, a timer appeared, or the loop was replaced: whoever
        // changed that re-runs the idle check when it drains.
        if (_loop !== loop || _holds !== 0 || _timers !== 0) {
            _polling = false;
            return GLibModule.SOURCE_REMOVE;
        }
        if (!loop.is_running()) return GLibModule.SOURCE_CONTINUE;
        _polling = false;
        exitParked();
        return GLibModule.SOURCE_REMOVE;
    });
}

function exitParked(): void {
    quitMainLoop();
    // gjs's eval_module hook drives loop.run() and quit() does not lift it
    // (measured). Exit through process.exit(), which schedules the syscall on
    // an idle source and drives the default context until it fires — the only
    // reliable teardown from inside a parked hook.
    const proc = (globalThis as { process?: { exit?: (code?: number) => void; exitCode?: number } }).process;
    if (typeof proc?.exit !== 'function') return;
    const code = proc.exitCode ?? 0;
    // Deferred so the releasing call returns to its caller (which may still
    // have code to run, e.g. console.log) before the process exits.
    const GLibModule = glib();
    if (GLibModule) {
        GLibModule.timeout_add(GLibModule.PRIORITY_DEFAULT, 0, () => {
            proc.exit!(code);
            return GLibModule.SOURCE_REMOVE;
        });
    } else {
        proc.exit(code);
    }
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
        _holds = 0;
        _ownsLoop = false;
        _owed = false;
    }
}
