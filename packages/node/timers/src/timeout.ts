// Reference: Node.js lib/internal/timers.js — Timeout/Immediate classes
// Reimplemented for GJS

type TimerCallback = (...args: unknown[]) => void;

/**
 * Whether the host's own `.unref()` / `.ref()` may be delegated to.
 *
 * The test is POSITIVE — the host must carry the Node `Timeout` members that a
 * `GLib.Source` does not have — because the negative test does not work here.
 * The previous guard was `!('$gtype' in host)`, on the theory that a GJS timer
 * handle is a GObject `BoxedInstance` and therefore carries `$gtype`. Measured
 * on gjs 1.88.1, it does NOT:
 *
 *     const t = setTimeout(() => {}, 5000);
 *     '$gtype' in t        → false
 *     t.constructor.name   → 'GLib_Source'
 *     typeof t.hasRef      → 'undefined'
 *
 * So the guard passed, `.unref()` reached `g_source_unref`, and the process
 * died on `g_source_unref_internal: assertion 'old_ref > 0' failed` — the very
 * crash this module documents. Require the members a libuv-backed `Timeout`
 * has and a `GLib.Source` lacks (`hasRef`, `refresh`), and delegation is only
 * reachable where it is safe.
 *
 * On Node the host IS a libuv `Timeout`, so `unref()` really does release the
 * event loop and a consumer that wants "don't hold the process open" gets the
 * behaviour it gets from Node. `GjsifyTimeout` (what the globals register
 * installs) also satisfies the probe, and its `unref()` is a recorded flag —
 * delegating is a no-op there, which is the intended behaviour anyway.
 *
 * GJS cannot honour `unref()`'s liveness contract in general: `Gtk.Application`
 * and `GLib.MainLoop` own the loop, and there is no ref/unref pair on a GSource
 * that releases liveness without destroying the source. `hasRef()` therefore
 * reports what the caller ASKED for, and an unreferenced timer still fires —
 * documented rather than silently faked.
 */
function canDelegateRef(host: unknown): host is { unref(): unknown; ref(): unknown } {
    if (typeof host !== 'object' || host === null) return false;
    const probe = host as { unref?: unknown; ref?: unknown; hasRef?: unknown; refresh?: unknown };
    return (
        typeof probe.unref === 'function' &&
        typeof probe.ref === 'function' &&
        typeof probe.hasRef === 'function' &&
        typeof probe.refresh === 'function'
    );
}

export class Timeout {
    private _id: ReturnType<typeof setTimeout> | null;
    private _ref = true;
    private _callback: TimerCallback;
    private _delay: number;
    private _args: unknown[];
    private _isInterval: boolean;
    /**
     * Retained so `+timeout` still yields a number after `close()`, where the
     * host handle is gone. Node keeps its id readable for the object's life.
     */
    private _numericId: number;

    constructor(callback: TimerCallback, delay: number, args: unknown[], isInterval: boolean) {
        this._callback = callback;
        this._delay = delay;
        this._args = args;
        this._isInterval = isInterval;

        if (isInterval) {
            this._id = setInterval(callback, delay, ...args);
        } else {
            this._id = setTimeout(callback, delay, ...args);
        }
        this._numericId = Number(this._id);
    }

    /**
     * Mark this timeout as referenced (default).
     *
     * Delegated to the host where the host is a Node-shaped handle (see
     * {@link canDelegateRef}); recorded only otherwise.
     */
    ref(): this {
        this._ref = true;
        if (this._id != null && canDelegateRef(this._id)) {
            this._id.ref();
        }
        return this;
    }

    /**
     * Mark this timeout as unreferenced — the caller asks that it not require
     * the host loop to stay alive.
     *
     * Honoured on Node (delegated to libuv). On GJS it is RECORDED ONLY and the
     * timer keeps firing: the app owns the main loop, and releasing liveness
     * there would mean destroying the GLib source. `hasRef()` reports the
     * recorded flag on both runtimes.
     */
    unref(): this {
        this._ref = false;
        if (this._id != null && canDelegateRef(this._id)) {
            this._id.unref();
        }
        return this;
    }

    /** Whether this timeout is referenced. */
    hasRef(): boolean {
        return this._ref;
    }

    /**
     * Reset the timer's start time to now and reschedule.
     *
     * The ref state is carried over: rescheduling creates a NEW host handle,
     * which arrives refed, so an `unref()`ed timer that is refreshed would
     * silently start holding the event loop open again — on Node that is the
     * difference between a process that exits and one that hangs.
     */
    refresh(): this {
        if (this._id != null) {
            if (this._isInterval) {
                clearInterval(this._id);
                this._id = setInterval(this._callback, this._delay, ...this._args);
            } else {
                clearTimeout(this._id);
                this._id = setTimeout(this._callback, this._delay, ...this._args);
            }
            this._numericId = Number(this._id);
            if (!this._ref && canDelegateRef(this._id)) {
                this._id.unref();
            }
        }
        return this;
    }

    /** Close/clear this timer. Returns `this`, matching `@types/node`. */
    close(): this {
        if (this._id != null) {
            if (this._isInterval) {
                clearInterval(this._id);
            } else {
                clearTimeout(this._id);
            }
            this._id = null;
        }
        return this;
    }

    /**
     * Node libraries call this directly rather than going through the scheduled
     * dispatch (`@types/node` declares it on `NodeJS.Timeout`).
     */
    _onTimeout(...args: unknown[]): void {
        this._callback(...args);
    }

    [Symbol.dispose](): void {
        this.close();
    }

    /** Get the underlying timer ID (for clearTimeout/clearInterval). */
    [Symbol.toPrimitive](): number {
        return this._numericId;
    }
}

export class Immediate {
    private _cancelled = false;
    private _ref = true;
    readonly _callback: TimerCallback;
    readonly _args: unknown[];

    constructor(callback: TimerCallback, args: unknown[]) {
        this._callback = callback;
        this._args = args;
        // Use a microtask so setImmediate fires before setTimeout(0). The
        // dispatch goes through `_onImmediate` so there is ONE path to the
        // callback — the same one a library invoking it directly takes — and it
        // carries `_args`, because that is the only record of them: an Immediate
        // has no host handle to hand the arguments to.
        Promise.resolve().then(() => {
            if (!this._cancelled) {
                this._onImmediate(...this._args);
            }
        });
    }

    /**
     * Recorded only, never delegated — an `Immediate` here is a microtask, not a
     * host handle, so there is nothing to release. See {@link Timeout.unref} for
     * why that is the honest answer on GJS.
     */
    ref(): this {
        this._ref = true;
        return this;
    }

    /** Recorded only — see {@link Timeout.unref}. */
    unref(): this {
        this._ref = false;
        return this;
    }

    hasRef(): boolean {
        return this._ref;
    }

    /** Cancels the immediate. Returns `this` for the same reason `Timeout.close` does. */
    close(): this {
        this._cancelled = true;
        return this;
    }

    /** Node libraries call this directly (`@types/node` declares it). */
    _onImmediate(...args: unknown[]): void {
        this._callback(...args);
    }

    [Symbol.dispose](): void {
        this.close();
    }
}
