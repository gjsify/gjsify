// The self-verification harness a gtk-host showcase runs instead of writing one.
//
// WHY THIS IS A PACKAGE MODULE AND NOT SHOWCASE CODE. Two showcases hand-rolled
// the same probe and a third (Vue) is doing it again on another branch. Measured on
// the two that exist: 70 of 183 code lines in `adw-host-counter/src/app.ts` and 68
// of 164 in `solid-host-counter/src/app.tsx` were this scaffolding, 58 of them
// BYTE-IDENTICAL between the files — the GLib writer func with its LEVEL_MASK
// comment, `findDescendant`, the `check()`/`failures` pair, the
// `PROBE: PASS|FAIL <json>` protocol and the `GJSIFY_HOST_PROBE=1`-vs-`activate`
// dual entry.
//
// Duplication was not the expensive part. Every one of those copies re-implemented
// the diagnostics collector that `conformance/diagnostics.ts` already exports —
// including the pre-`describeLogRecord` bug that module exists to end, where a log
// record without a `MESSAGE` field is COUNTED as a failure and then described as
// the empty string. A probe that can count a failure but not name it sends the
// reader back to guessing.
//
// The shape is `installStorybookProbe`'s (`@gjsify/storybook`): the harness owns
// the env gate, the run and the exit, the showcase owns only its own assertions.
// That is what makes "the SAME assertions also run on `activate`" structural — in
// the hand-written copies it was a paragraph of comment repeated per file, and the
// whole point of it is that `showcase-smoke` (which only launches the app and
// waits) otherwise proves nothing beyond "it started".

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import system from 'system';

import { installDiagnosticsGate, type DiagnosticsGate } from './conformance/diagnostics.js';

/**
 * Declared locally, exactly as `conformance/diagnostics.ts` declares `printerr`
 * and for the same reason: `console.log` routes through the GLib log system, i.e.
 * straight into the writer func the gate installs, which would make the probe's
 * own result line a diagnostic it then counts.
 */
declare const print: (message: string) => void;

/** Record one assertion. A `false` is a finding; nothing else is. */
export type ProbeCheck = (what: string, ok: boolean) => void;

/** What a showcase gives the harness. */
export interface HostProbe<T> {
    /**
     * Build the UI. `app` is `null` on the headless path, where there is no
     * `GApplication` and the window is never presented.
     */
    build(app: Adw.Application | null): T;
    /**
     * Assert against the REAL widget tree — `get_first_child()`/`get_next_sibling()`
     * and the exact getters, never the host's own bookkeeping, which would agree
     * with itself while the window is wrong. Return whatever belongs in the result
     * line; the harness adds the failure list and the diagnostic count.
     */
    assert(ui: T, check: ProbeCheck): Record<string, unknown>;
    /** Prefix of the machine-readable result line. Default `PROBE`. */
    label?: string;
}

/** A showcase that also has a GUI path — i.e. every one of them. */
export interface HostProbeApp<T> extends HostProbe<T> {
    /** GApplication id for the GUI path. */
    applicationId: string;
    /** Present the toplevel. Reached only after the assertions have passed. */
    present(ui: T): void;
}

/**
 * Truthy-env check, matching `@gjsify/devtools`' `GJSIFY_DEVTOOLS` gate semantics
 * and `@gjsify/storybook`'s `probeEnabled` — one spelling of "opt in" across the
 * repo, so `=0` and `=false` mean off rather than "any value is on".
 */
export function probeEnabled(): boolean {
    const value = GLib.getenv('GJSIFY_HOST_PROBE');
    if (value === null) return false;
    const lowered = value.toLowerCase();
    return lowered !== '' && lowered !== '0' && lowered !== 'false';
}

/** The sentinel the recorder is measured with. Prefixed, so it cannot collide. */
const RECORDER_PROBE = '<gtk-host probe: recorder self-check>';

/**
 * Does `check` still RECORD a failure?
 *
 * Every assertion in every showcase reaches the report through this one closure,
 * so a `check` that silently drops its findings turns the whole probe into the
 * green-that-checked-nothing class — and no showcase assertion can detect it,
 * because they all speak through the thing that is broken. So the harness asks
 * first, with a case that must fail and a case that must not, and reports the
 * ANSWER rather than trusting it.
 */
function recorderIsHonest(check: ProbeCheck, failures: string[]): string | null {
    const mark = failures.length;
    check(RECORDER_PROBE, false);
    const recorded = failures.length === mark + 1 && failures[mark] === RECORDER_PROBE;
    // Not a finding — it was a question. Truncated rather than spliced, so a
    // recorder that pushes something unexpected leaves nothing behind either.
    failures.length = mark;
    check(RECORDER_PROBE, true);
    const quiet = failures.length === mark;
    failures.length = mark;
    if (recorded && quiet) return null;
    return recorded
        ? 'the probe recorder records a PASSING check as a failure, so every assertion below is a false alarm'
        : 'the probe recorder did not record a failed check, so every assertion below is unverifiable';
}

/**
 * Run the showcase's assertions once and return the process exit code.
 *
 * The diagnostics gate is reset first and asserted last, and both halves are the
 * harness's rather than the showcase's. Reset, because in the GUI path this runs
 * from `activate` — AFTER Adw startup, where a session-bus, portal, theme or a11y
 * warning is routine in a container, and counting those would fail the showcase
 * with the host's name on a diagnostic it did not cause. Asserted, because GTK's
 * failure mode is exit 0: a mis-parented widget floods `Gtk-WARNING` and the
 * process still succeeds.
 */
export function runHostProbe<T>(probe: HostProbe<T>, app: Adw.Application | null = null): number {
    const label = probe.label ?? 'PROBE';
    const gate: DiagnosticsGate = installDiagnosticsGate();
    gate.reset();

    const failures: string[] = [];
    const check: ProbeCheck = (what, ok) => {
        if (!ok) failures.push(what);
    };

    const dishonest = recorderIsHonest(check, failures);
    if (dishonest !== null) {
        // Reported through the array rather than through `check`, which is the
        // thing under suspicion.
        failures.push(dishonest);
    }

    let report: Record<string, unknown> = {};
    try {
        report = probe.assert(probe.build(app), check);
    } catch (error) {
        // A throw is a finding, not a crash. The hand-written probes let one
        // escape into GJS's `activate` handler, which LOGS the exception and
        // swallows it — leaving exit 0 and a window that never appeared.
        failures.push(`threw: ${(error as Error).message}`);
    }

    // Last, so it covers the build AND the assertions.
    const diagnostics = gate.seen.length;
    check(`no GTK diagnostics (saw ${diagnostics})`, diagnostics === 0);

    const line = JSON.stringify({ ...(failures.length > 0 ? { failures } : {}), diagnostics, ...report });
    print(`${label}: ${failures.length > 0 ? 'FAIL' : 'PASS'} ${line}`);
    return failures.length > 0 ? 1 : 0;
}

/**
 * The whole `main` of a gtk-host showcase.
 *
 * `GJSIFY_HOST_PROBE` truthy: assert headlessly and exit, no window and no main
 * loop. Otherwise: run the SAME assertions from `activate` before the window is
 * shown, exit non-zero if any of them failed, then present. The GUI path carrying
 * the assertions is the load-bearing half — `scripts/showcase-smoke.mjs` launches
 * the app and waits, so without it the CI leg proves only that the process started.
 *
 * `runAsync`, never the sync `run()`: a sync `run()` leaves promise jobs undrained
 * and hangs a view load on its spinner (the class `@gjsify/adwaita-app` documents).
 */
export async function runHostProbeApp<T>(probe: HostProbeApp<T>): Promise<void> {
    if (probeEnabled()) {
        Gtk.init();
        return system.exit(runHostProbe(probe, null));
    }
    const app = new Adw.Application({ application_id: probe.applicationId });
    app.connect('activate', () => {
        const failed = runHostProbe(probe, app);
        if (failed !== 0) system.exit(failed);
        probe.present(probe.build(app));
    });
    await app.runAsync([]);
}
