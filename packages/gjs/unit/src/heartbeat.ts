// The breadcrumb a SUPERVISOR reads when this process can no longer speak for itself.
//
// INCIDENT (run 34945600666, `Test 2/4 Fedora 44`): `@gjsify/webrtc`'s
// `Multi-PC fan-out › track gets a tee multiplexer after second addTrack` wedged inside a
// synchronous GStreamer tee/pad call. The job burned its full 90-minute cap and arrived as an
// unexplained red on a PR that had not caused it — 86 of those minutes were SILENCE after the
// previous test's ✔ line, and nothing in the log distinguished "hung" from "still running".
// The same test passes in 2.2 ms on `main`, so it was a nondeterministic GStreamer flake, but
// telling that apart cost a full diagnosis cycle.
//
// Why none of `index.ts`'s three timeouts fired — measured on both shapes, a spin loop and a
// nested `GLib.MainLoop.run()`, each reproducing the incident's exact log signature:
// `withTimeout` races `Promise.resolve(fn())` against a `setTimeout`, and BOTH halves need the
// main loop. A body that blocks it never returns from `fn()`, so the race is never even
// constructed, and the armed timer is never dispatched. A promise-based deadline cannot
// observe a loop that stopped turning — only another PROCESS can.
//
// So: when `GJSIFY_UNIT_HEARTBEAT` names a file, write WHAT is in flight and WHEN it is due
// there, before the body runs. `@gjsify/cli`'s `utils/hang-watchdog.ts` polls that file from
// the parent and, past the deadline, names the test and kills this process. Unset — every
// consumer's run, every run outside `gjsify run` — this costs one env read per run.
//
// GJS only: the write needs GLib, and the blocked-main-loop shape is a GJS shape. On Node the
// writer is a documented no-op; a Node-side hang would need its own channel and has not been
// observed.

import type GLib from '@girs/glib-2.0';

/** GJS runtime bootstrap shape read here — same spelling as `@gjsify/utils/main-loop`. */
interface _GjsImports {
    imports?: { gi?: { GLib?: typeof GLib } };
}

/** The GJS `GLib` binding, or `undefined` when not running under GJS. */
const glib = (): typeof GLib | undefined => (globalThis as unknown as _GjsImports).imports?.gi?.GLib;

/**
 * One line: `<deadline-epoch-ms>\t<label>`. Tabs and newlines are stripped from the label
 * because the reader splits on the first tab and reads one line — a test name containing
 * either would otherwise silently truncate the parse.
 *
 * `deadlineMs <= 0` means "no deadline" (`{ timeout: 0 }` disables the per-test timeout, and a
 * guard must not invent one the harness itself declined to set).
 */
export const formatHeartbeat = (deadlineMs: number, label: string): string =>
    `${Math.max(0, Math.round(deadlineMs))}\t${label.replace(/[\t\r\n]+/g, ' ').trim()}`;

export interface Heartbeat {
    /** Announce the test about to run, with the deadline its own timeout gives it. */
    noteInFlight(label: string, timeoutMs: number): void;
    /** The test settled: fall back to the run-level deadline. */
    noteSettled(): void;
    /** Disarm — whatever holds the process from here on is teardown, not a test. */
    stop(): void;
}

const INERT: Heartbeat = {
    noteInFlight: () => {},
    noteSettled: () => {},
    stop: () => {},
};

/**
 * A heartbeat writing into `env.GJSIFY_UNIT_HEARTBEAT`, or an inert one when nobody named a
 * file (or GLib is out of reach, i.e. not GJS).
 *
 * An INSTANCE rather than module state on purpose: this package's own suite tests the writer,
 * and under `gjsify run` that suite is itself being watched — module state would let the test
 * disarm the guard watching it.
 */
export function createHeartbeat(env: Record<string, string | undefined> | undefined, runTimeoutMs: number): Heartbeat {
    const path = env?.GJSIFY_UNIT_HEARTBEAT;
    const GLibNs = glib();
    if (!path || path.length === 0 || !GLibNs) return INERT;

    /**
     * `g_file_set_contents` writes a temp file and renames it, so a reader mid-poll sees either
     * the old line or the new one, never half of either. The catch is load-bearing rather than
     * defensive: it throws a GError on a full or read-only `/tmp`, and a breadcrumb that cannot
     * be written must never fail the run it is only describing.
     */
    const write = (text: string): void => {
        try {
            GLibNs.file_set_contents(path, text);
        } catch (_e) {
            /* an unwritable breadcrumb is not a test failure — see above */
        }
    };

    // The deadline in force between tests — the run's own. Restored whenever a test settles,
    // so a hang in a suite BODY is still covered, by the run timeout rather than the test one.
    const baseLine = formatHeartbeat(runTimeoutMs > 0 ? Date.now() + runTimeoutMs : 0, '<test run>');
    write(baseLine);

    return {
        noteInFlight: (label, timeoutMs) => write(formatHeartbeat(timeoutMs > 0 ? Date.now() + timeoutMs : 0, label)),
        noteSettled: () => write(baseLine),
        stop: () => write(formatHeartbeat(0, '<run finished>')),
    };
}
