// Crash diagnostic helper for GJS-only HTTP/Soup-driven workloads.
//
// Default GJS behaviour for `g_critical()` / `g_warning()` is "log to stderr
// and continue", but several known GJS-binding races (Boxed-Source GC race
// in libsoup chunked responses, GLib.Source double-unref via SpiderMonkey
// finalizer, etc.) follow the WARNING with a SIGSEGV in the same dispatch
// tick. Stdio buffers don't always flush in time, so the user sees only
// "gjs exited with code null" with no diagnostic.
//
// What we cannot do:
//   * `GLib.log_set_writer_func(jsFn)` — GJS's GLib override wraps the
//     writer in a closure that calls `stringFields.recursiveUnpack()` (a JS
//     allocation). When the GLib message is emitted from inside a
//     SpiderMonkey GC sweep — exactly the case that produces the silent
//     crashes — GJS refuses to invoke the writer with `Gjs-CRITICAL:
//     Attempting to run a JS callback during garbage collection. The
//     offending callback was GLogWriterFunc().` See
//     refs/gjs/modules/core/overrides/GLib.js:377-389.
//   * `GLib.log_writer_default_set_use_stderr(true)` — refuses with
//     `assertion 'g_thread_n_created () == 0' failed` once GJS has spun up
//     its worker threads (always the case by the time we run).
//
// What we can do (and this module does):
//   * Print a one-time advisory at HTTP-server startup telling the user to
//     re-run with `G_DEBUG=fatal-criticals` to get a SIGABRT with backtrace
//     (and a coredump on systemd-coredump) instead of a silent SIGSEGV.
//   * Suppress the advisory if `G_DEBUG` is already set.
//
// Reference: STATUS.md "Upstream GJS Patch Candidates" → the two libsoup-
// related entries describing the underlying refcount races.

import type GLibNS from '@girs/glib-2.0';

let _installed = false;

type GjsGlobalThis = typeof globalThis & {
    imports?: { gi?: { GLib?: typeof GLibNS } };
};

function getGLib(): typeof GLibNS | undefined {
    return (globalThis as GjsGlobalThis).imports?.gi?.GLib;
}

/**
 * On first call (per process), print a one-line advisory pointing the user
 * at `G_DEBUG=fatal-criticals` if neither `G_DEBUG` nor
 * `GJSIFY_QUIET_CRASH_HINT` is set. Idempotent. No-op on Node.js / non-GJS.
 *
 * Rationale: a JS log writer cannot run from inside a GC sweep (GJS blocks
 * re-entry), so we cannot capture the assertion message that immediately
 * precedes a libsoup/GJS Boxed-Source-race SIGSEGV. The next-best thing is
 * making sure the user knows how to flip `g_critical()` from "warn and keep
 * going" to "abort with backtrace" — that turns the silent SIGSEGV into a
 * coredump-able SIGABRT with the assertion message intact.
 */
export function installCriticalLogWriter(): void {
    if (_installed) return;
    const GLib = getGLib();
    if (!GLib) return; // Node.js / no GLib available
    _installed = true;

    // Don't lecture users who already opted into stricter warning handling
    // or who have explicitly silenced the hint.
    const gDebug = (GLib.getenv('G_DEBUG') ?? '').trim();
    const quiet = (GLib.getenv('GJSIFY_QUIET_CRASH_HINT') ?? '').trim();
    if (gDebug.length > 0 || quiet.length > 0) return;

    const printerr = (globalThis as { printerr?: (s: string) => void }).printerr;
    const lines = [
        '[gjsify] @gjsify/http server starting on GJS.',
        '[gjsify] If the process exits silently with "gjs exited with code null",',
        '[gjsify] re-run with G_DEBUG=fatal-criticals so the underlying GLib',
        '[gjsify] assertion (typically a Soup/Boxed-Source GC race, see STATUS.md)',
        '[gjsify] aborts with a backtrace + coredump instead of a silent SIGSEGV.',
        '[gjsify] Set GJSIFY_QUIET_CRASH_HINT=1 to suppress this notice.',
    ];
    try {
        if (printerr) lines.forEach(l => printerr(l));
        else lines.forEach(l => console.error(l));
    } catch { /* best-effort */ }
}
