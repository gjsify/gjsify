// GLib's main-loop sources, renderer-free: `idle_add`, `timeout_add`, `source_remove` and the
// `PRIORITY_*` / `SOURCE_*` constants. A browser page and a NativeScript runtime both own an event
// loop that exposes `setTimeout`, so one implementation serves both ports and they differ only in
// the host they hand in.
//
// A TRUE SUBSET of `GLib`: the names and the semantics are GLib's, and a later stage only adds
// members. What GLib has and this does not (`MainLoop`, `Source`, `timeout_add_seconds`,
// `idle_add_full`, `main_context_*`) is not defined here; the `gi://GLib` arm refuses it by name.
//
// WHERE A HOST LOOP CANNOT HONOUR GLIB:
//   - PRIORITY is honoured among IDLE sources only. Each pump dispatches the sources of the
//     lowest priority value present, as a main context does, so a LOW idle waits for a
//     HIGH_IDLE one. A timeout's priority is accepted and ignored: `setTimeout` has no priority,
//     and a timeout never competes with an idle source here (GLib would run a ready DEFAULT
//     timeout before a DEFAULT_IDLE source).
//   - An idle source runs on the next macrotask, not "when the loop has nothing else to do".
//   - A throwing callback is logged and its source removed, as GJS does (measured on gjs 1.88:
//     one run, then gone); nothing propagates into the host loop.
//
// Reference: GLib glib/gmain.c (g_idle_add_full, g_timeout_add_full, g_source_remove), glib/gmain.h
// Copyright (c) GNOME contributors (GLib). LGPLv2.1+.

/** The slice of a host event loop the timers need. */
export interface TimerHost {
    setTimeout(run: () => void, milliseconds: number): unknown;
    clearTimeout(handle: unknown): void;
}

export type SourceFunc = () => boolean | void;

/** `GLib` as far as this subset goes. */
export interface GLibTimers {
    readonly PRIORITY_HIGH: number;
    readonly PRIORITY_DEFAULT: number;
    readonly PRIORITY_HIGH_IDLE: number;
    readonly PRIORITY_DEFAULT_IDLE: number;
    readonly PRIORITY_LOW: number;
    readonly SOURCE_REMOVE: boolean;
    readonly SOURCE_CONTINUE: boolean;
    idle_add(priority: number, run: SourceFunc): number;
    timeout_add(priority: number, milliseconds: number, run: SourceFunc): number;
    source_remove(sourceId: number): boolean;
}

interface IdleSource {
    readonly priority: number;
    readonly run: SourceFunc;
}

function checkPriority(call: string, priority: unknown): asserts priority is number {
    if (typeof priority !== 'number' || !Number.isInteger(priority)) {
        throw new TypeError(`${call}: priority has to be an integer, got ${String(priority)}`);
    }
}

function checkCallback(call: string, run: unknown): asserts run is SourceFunc {
    if (typeof run !== 'function') {
        throw new TypeError(`${call}: expected function for callback argument function, got ${String(run)}`);
    }
}

/** GJS logs a throwing callback and removes its source; it never reaches the loop. */
function runSource(run: SourceFunc): boolean {
    try {
        return Boolean(run());
    } catch (error) {
        console.error('JS ERROR:', error);
        return false;
    }
}

const globalHost: TimerHost = {
    setTimeout: (run, milliseconds) => globalThis.setTimeout(run, milliseconds),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as never),
};

/** One main context's worth of sources; the namespace object of a port is one of these. */
export function createGLibTimers(host: TimerHost = globalHost): GLibTimers {
    let nextId = 1;
    const timeouts = new Map<number, unknown>();
    const idles = new Map<number, IdleSource>();
    let pump: unknown = undefined;

    const schedulePump = (): void => {
        if (pump !== undefined || idles.size === 0) return;
        pump = host.setTimeout(dispatchIdles, 0);
    };

    function dispatchIdles(): void {
        pump = undefined;
        let best = Infinity;
        for (const source of idles.values()) best = Math.min(best, source.priority);
        const due = [...idles].filter(([, source]) => source.priority === best);
        try {
            for (const [id, source] of due) {
                if (!idles.has(id)) continue;
                const keep = runSource(source.run);
                if (!keep) idles.delete(id);
            }
        } finally {
            schedulePump();
        }
    }

    return {
        PRIORITY_HIGH: -100,
        PRIORITY_DEFAULT: 0,
        PRIORITY_HIGH_IDLE: 100,
        PRIORITY_DEFAULT_IDLE: 200,
        PRIORITY_LOW: 300,
        SOURCE_REMOVE: false,
        SOURCE_CONTINUE: true,

        idle_add(priority, run) {
            checkPriority('GLib.idle_add', priority);
            checkCallback('GLib.idle_add', run);
            const id = nextId++;
            idles.set(id, { priority, run });
            schedulePump();
            return id;
        },

        timeout_add(priority, milliseconds, run) {
            checkPriority('GLib.timeout_add', priority);
            if (typeof milliseconds !== 'number' || !Number.isInteger(milliseconds) || milliseconds < 0) {
                throw new TypeError(
                    `GLib.timeout_add: interval has to be a non-negative integer, got ${String(milliseconds)}`,
                );
            }
            checkCallback('GLib.timeout_add', run);
            const id = nextId++;
            const arm = (): void => {
                timeouts.set(id, host.setTimeout(tick, milliseconds));
            };
            function tick(): void {
                // The source stays registered while it runs, so removing itself answers true.
                const keep = runSource(run);
                if (keep && timeouts.has(id)) arm();
                else timeouts.delete(id);
            }
            arm();
            return id;
        },

        source_remove(sourceId) {
            if (timeouts.has(sourceId)) {
                host.clearTimeout(timeouts.get(sourceId));
                timeouts.delete(sourceId);
                return true;
            }
            if (idles.delete(sourceId)) return true;
            console.warn(`GLib-CRITICAL: Source ID ${String(sourceId)} was not found when attempting to remove it`);
            return false;
        },
    };
}
