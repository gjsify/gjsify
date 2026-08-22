// POSIX signal delivery for `process.on('SIGINT', …)` under GJS.
//
// Registering the listener always worked — `Process` is an `EventEmitter`, so
// `process.on('SIGINT', …)` and `listenerCount('SIGINT')` behaved — but nothing
// ever EMITTED, so every such handler was dead code and the kernel's default
// disposition ran instead. It reads as working: on a terminal, Ctrl+C reaches
// the whole foreground process group, so the app dies and the handler that never
// ran is not missed. It stops reading as working the moment a handler has real
// cleanup to do (a supervised child to take down, a socket to unlink) or the
// signal is sent to the process ALONE, `kill -INT <pid>`, where the default
// disposition kills the parent and orphans everything it was supervising.
//
// `g_unix_signal_add()` is the GLib-native answer: it makes the signal a source
// on the default main context, so the handler runs on the JS thread between
// dispatches instead of inside an async-signal-unsafe context — and installing
// it also suppresses the default disposition, which is exactly Node's rule that
// a registered handler replaces the default.

import { getGjsGlobal } from './gjs.js';

/**
 * The signals delivered here, and their numbers.
 *
 * Deliberately the three whose numbers are the same on EVERY POSIX
 * architecture. GLib also supports `SIGUSR1`/`SIGUSR2`/`SIGWINCH`, but those
 * three are renumbered on some architectures (mips, alpha), so a hardcoded
 * table would be quietly wrong there — and wrong in the worst direction, since
 * `g_unix_signal_add()` would happily arm the WRONG signal rather than fail. The
 * three below cover what a process must react to rather than die from: Ctrl+C,
 * `kill`, and the terminal going away.
 */
const DELIVERABLE: Readonly<Record<string, number>> = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };

/** Live `g_unix_signal_add()` source ids, by signal name. */
const sources = new Map<string, number>();

/**
 * `signal_add` and the namespace it lives on. GJS ≥ 1.88 moved the unix-only
 * GLib entry points into `GLibUnix` and WARNS (with a stack trace, onto stderr,
 * once per call) when they are reached through `GLib` — the same split
 * `getGioNamespace()` already handles for the byte streams. Probing is wrapped
 * because reaching for an absent namespace THROWS under GJS rather than
 * returning undefined.
 */
function resolveSignalAdd(): ((priority: number, signum: number, handler: () => boolean) => number) | null {
    const gi = getGjsGlobal().imports?.gi;
    if (!gi) return null;
    for (const [namespace, member] of [
        ['GLibUnix', 'signal_add'],
        ['GLib', 'unix_signal_add'],
    ] as const) {
        try {
            const fn = (gi[namespace] as Record<string, unknown> | undefined)?.[member];
            if (typeof fn === 'function') {
                return fn as (priority: number, signum: number, handler: () => boolean) => number;
            }
        } catch {
            // Namespace not introspectable on this host — try the next spelling.
        }
    }
    return null;
}

/** Whether `name` is a signal this module can deliver. */
export function isDeliverableSignal(name: string | symbol): name is string {
    return typeof name === 'string' && name in DELIVERABLE;
}

/**
 * Start delivering `signal` to `emit`. Idempotent, and a no-op off GJS — where
 * the host runtime already delivers signals to `globalThis.process`.
 *
 * The GLib source is attached to the DEFAULT main context, so nothing arrives
 * until something drives it. That is the same condition every other async
 * source in a GJS process lives under; a program that wants a handler to run
 * while it is otherwise idle has to hold a main loop
 * (`@gjsify/utils`'s `holdMainLoop()`).
 */
export function armSignal(signal: string, emit: (signal: string) => void): void {
    if (sources.has(signal)) return;
    const signum = DELIVERABLE[signal];
    const signalAdd = resolveSignalAdd();
    const GLib = getGjsGlobal().imports?.gi?.GLib;
    if (signum === undefined || signalAdd === null || !GLib) return;
    const priority = GLib['PRIORITY_DEFAULT'] as unknown as number;
    const id = signalAdd(priority, signum, () => {
        emit(signal);
        // `G_SOURCE_CONTINUE` — keep the source, or a second Ctrl+C would fall
        // through to the default disposition.
        return true;
    });
    sources.set(signal, id);
}

/** Stop delivering `signal`, restoring the default disposition. Idempotent. */
export function disarmSignal(signal: string): void {
    const id = sources.get(signal);
    if (id === undefined) return;
    sources.delete(signal);
    const GLib = getGjsGlobal().imports?.gi?.GLib;
    if (GLib && typeof GLib['source_remove'] === 'function') GLib['source_remove'](id);
}
