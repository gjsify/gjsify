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
import { descendants } from './conformance/index.js';

/**
 * Declared locally, exactly as `conformance/diagnostics.ts` declares `printerr`
 * and for the same reason: `console.log` routes through the GLib log system, i.e.
 * straight into the writer func the gate installs, which would make the probe's
 * own result line a diagnostic it then counts.
 */
declare const print: (message: string) => void;
/**
 * Same reason as `print` above, and one more: this is the only way to report from
 * inside the failure path of the GUI entry, where the diagnostics gate has already
 * replaced GLib's writer and `console.error` would route straight back into it.
 */
declare const printerr: (message: string) => void;

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
     *
     * MAY BE ASYNC, and one adapter forces it: Vue flushes render jobs on a
     * microtask, so an assertion after a click has to `await nextTick()` or it reads
     * the pre-patch tree. Without this the Vue showcase hand-rolled the whole
     * harness, and the copy carried the pre-`describeLogRecord` collector bug with
     * it — a log record with no `MESSAGE` counted as a diagnostic and then described
     * as the empty string.
     */
    assert(ui: T, check: ProbeCheck): Record<string, unknown> | Promise<Record<string, unknown>>;
    /**
     * Release what the assertions built, before the diagnostics are counted.
     *
     * ORDER IS THE POINT. Teardown is exactly where GTK reports a mis-parented tree
     * — `Finalizing GtkLabel …, but it still has children left` arrives at finalize,
     * at exit 0 (ADR 0027 § Context). A probe that counts diagnostics and THEN tears
     * down cannot see the one class of defect that only surfaces there, which is
     * what both hand-written probes did.
     *
     * Optional because a probe that owns nothing has nothing to release; the
     * harness's own `build` result is reachable only from here.
     */
    teardown?(ui: T): void;
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
 * **The probe always builds HEADLESS, in both paths.** It is handed `null` rather
 * than the `GApplication`, for two reasons that point the same way. It makes the two
 * paths return the same verdict about the same tree — a probe whose GUI run differs
 * from its headless run is two probes. And it keeps the GUI path from constructing
 * and (now that `teardown` exists) destroying an `Adw.ApplicationWindow` INSIDE
 * `activate`, which is the exact neighbourhood of the segfault recorded on
 * `runHostProbeApp` below. Nothing a probe asserts needs an application; `present`
 * gets the real one.
 *
 * The diagnostics gate is reset first and asserted last, and both halves are the
 * harness's rather than the showcase's. Reset, because in the GUI path this runs
 * from `activate` — AFTER Adw startup, where a session-bus, portal, theme or a11y
 * warning is routine in a container, and counting those would fail the showcase
 * with the host's name on a diagnostic it did not cause. Asserted, because GTK's
 * failure mode is exit 0: a mis-parented widget floods `Gtk-WARNING` and the
 * process still succeeds.
 */
export async function runHostProbe<T>(probe: HostProbe<T>): Promise<number> {
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
        const ui = probe.build(null);
        report = await probe.assert(ui, check);
        // Inside the same `try`: a throw here is a finding like any other, and a
        // teardown that throws is itself a defect worth reporting by name.
        probe.teardown?.(ui);
    } catch (error) {
        // A throw is a finding, not a crash. The hand-written probes let one
        // escape into GJS's `activate` handler, which LOGS the exception and
        // swallows it — leaving exit 0 and a window that never appeared.
        failures.push(`threw: ${(error as Error).message}`);
    }

    // Last, so it covers the build, the assertions AND the teardown.
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
        return system.exit(await runHostProbe(probe));
    }
    const app = new Adw.Application({ application_id: probe.applicationId });
    app.connect('activate', () => {
        // `activate` IS A GLIB CALLBACK AND CANNOT BE AWAITED, while the probe may
        // be async. So the work is STARTED here, and `app.hold()` is what makes
        // that legal.
        //
        // MEASURED, without the hold — in the Vue showcase, before this harness
        // owned the path: `activate` returned having presented nothing,
        // GApplication's hold count reached zero, and `gtk_application_shutdown`
        // ran its own nested main loop. The probe's continuation was then dispatched
        // from INSIDE that shutdown, constructed a window with `application: app`,
        // and `gtk_application_window_added` segfaulted — `PROBE: PASS` on stdout,
        // exit 139, and a stack ending in `gtk_application_shutdown ->
        // g_main_loop_run -> PromiseJobDispatcher`. Nothing about the crash names
        // the missing hold, which is why it is recorded here rather than rediscovered.
        app.hold();
        void (async () => {
            try {
                const failed = await runHostProbe(probe);
                if (failed !== 0) return system.exit(failed);
                probe.present(probe.build(app));
            } catch (error) {
                // A REAL throw path: the probe reaches into GTK and into a
                // framework's scheduler. Caught because a rejected promise would
                // leave the `hold()` above un-released forever, and an application
                // that never exits is what `showcase-smoke` reads as "still up after
                // the dwell" — a failure that reports itself as a pass.
                printerr(`JS ERROR: ${probe.applicationId} probe threw: ${String(error)}`);
                return system.exit(1);
            } finally {
                app.release();
            }
        })();
    });
    await app.runAsync([]);
}

// --- the SHOT half: evidence that a tree rendered, not only that it exists ------
//
// THE INCIDENT, and it is the reason this section is not optional.
//
// The website documented an `Adw.ToolbarView` written with `@gjsify/react-native`
// primitives inside it, and the tree behind it had been asserted: `slot="top"`
// reached `add_top_bar`, `slot="title"` reached `set_title_widget`, an RN `<View>`
// in the default slot WAS `get_content()`. Every one of those assertions was true.
// Built from the page's printed text and PRESENTED, the window was EMPTY — 720×420
// of background, no header bar, no content, no bottom bar — because the snippet
// named `gap-s`, and the layer's default spacing scale holds `0` and `px`. React
// refused the tree, the root reported the refusal and unmounted, and the process
// exited 0 with ZERO GTK diagnostics.
//
// So neither existing instrument could see it. `installDiagnosticsGate` counts what
// GTK complains about, and GTK had nothing to complain about: there was no tree.
// `runHostProbe`'s assertions read a tree the probe itself built — a probe that
// builds the same widgets by hand agrees with itself while the DOCUMENTED source
// renders nothing. The only witness is the window.
//
// WHY `capture` IS A PARAMETER. Rasterising a widget is `@gjsify/devtools`'
// `captureWidgetPng` (`get_native().get_renderer()` → `Gtk.WidgetPaintable` →
// `render_texture` → `save_to_png_bytes`), and `@gjsify/gtk-host` depends on no
// `@gjsify/*` package — it is the element model everything else binds to, and an
// edge from here up to a devtool would invert that. The seam is a parameter for the
// same reason `resolvePrimitive` takes its tokens as one: injected, it is also the
// only way to test THIS logic without a display, which is what `probe.spec.ts` does.

/**
 * Rasterise one widget. `@gjsify/devtools`' `captureWidgetPng` has this shape;
 * `null` means the widget has no renderer or no size yet, never "the image is empty".
 */
export type CaptureWidget = (widget: Gtk.Widget) => Uint8Array | null;

/** What a picture of a subtree is worth, in numbers a `check` can read. */
export interface ShotEvidence {
    /**
     * STRICT descendants of the container in the REAL GTK tree.
     *
     * The decisive number, and the cheapest. `0` is not "a small tree": it is a
     * container nothing was rendered into, which is what a refused render, an
     * unmounted root and a component that returned `null` all look like from here.
     */
    widgets: number;
    width: number;
    height: number;
    /** PNG byte count, `0` when `capture` produced none. */
    bytes: number;
}

/**
 * Count what a shot of `container` would be a picture OF.
 *
 * Reads the real GTK tree (`get_first_child`/`get_next_sibling`) rather than any
 * host bookkeeping — the shadow tree would agree with itself here, which is the
 * whole reason `conformance/` exists.
 */
export function shotEvidence(container: Gtk.Widget, capture: CaptureWidget): ShotEvidence {
    const png = capture(container);
    return {
        // `descendants` includes the root; the question is what is INSIDE.
        widgets: descendants(container).length - 1,
        width: container.get_width(),
        height: container.get_height(),
        bytes: png ? png.length : 0,
    };
}

/**
 * Why a shot of this evidence would be blank — or `null` when it would not.
 *
 * Ordered by what a reader can act on. "Nothing was rendered" and "the renderer had
 * no surface yet" are different bugs with the same photograph, and a message that
 * cannot tell them apart sends the reader back to guessing — the state
 * `describeLogRecord` exists to end one layer down.
 *
 * A NON-EMPTY PNG IS NOT PROOF, which is why byte count is the LAST question rather
 * than the only one: a window with a refused tree still rasterises to several KB of
 * perfectly valid background.
 */
export function blankReason(evidence: ShotEvidence): string | null {
    if (evidence.widgets === 0) {
        return 'nothing was rendered into the container: it has no children at all, which is what a refused render, an unmounted root and a component returning null all look like from GTK';
    }
    if (evidence.width <= 0 || evidence.height <= 0) {
        return `the container is allocated ${evidence.width}×${evidence.height}: its ${evidence.widgets} widget(s) exist and occupy nothing`;
    }
    if (evidence.bytes === 0) {
        return 'the capture produced no PNG: the widget has no renderer yet, so it was measured before it was ever on screen';
    }
    return null;
}

/**
 * Record "this actually rendered" as a probe check, named.
 *
 * Takes the evidence rather than the widget so a caller that already shot it does
 * not rasterise twice, and so the reason lands in the failure list verbatim.
 */
export function checkRendered(check: ProbeCheck, what: string, evidence: ShotEvidence): void {
    const reason = blankReason(evidence);
    check(reason === null ? what : `${what} — ${reason}`, reason === null);
}
