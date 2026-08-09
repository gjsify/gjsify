// Lazy GStreamer initialization — call ensureGstInit() before any Gst API usage.
// Reference: GStreamer 1.0 via gi://Gst

import Gst from 'gi://Gst?version=1.0';
import GstApp from 'gi://GstApp?version=1.0';

let initialized = false;

/**
 * Make sure the GstApp typelib is LOADED, not merely imported.
 *
 * `pipeline.get_by_name('src')` returns a plain `Gst.Element` handle whose real
 * type is `GstAppSrc`; its `push_buffer` / `try_pull_sample` methods only resolve
 * once the GstApp namespace is registered. Under gjs the `gi://GstApp` import
 * does that by itself — the specifier stays EXTERNAL, so the import is always
 * evaluated and loading the namespace IS the side effect.
 *
 * On the `--app node` target it does not. `gjsGiNodePlugin` rewrites `gi://Ns`
 * into a virtual module that resolves the namespace LAZILY, on first property
 * access, and that laziness is deliberate: it is what keeps a `gi://` import
 * that is gated to GJS-only code paths from dragging `@gjsify/node-gi` into a
 * cross-platform package's node bundle at load. Consequence: an import whose
 * only purpose is the side effect has none there, and the module is dropped as
 * unused — the emitted bundle contained ZERO references to GstApp, so every
 * `appsrc.push_buffer(...)` failed with "push_buffer is not a function" while
 * the identical source played audio on gjs.
 *
 * So the load is expressed as an ACCESS, which both runtimes honour, inside a
 * called function so nothing can shake it away.
 */
function ensureGstAppLoaded(): void {
    if (GstApp.AppSrc === undefined) {
        throw new Error('GstApp typelib is unavailable — install gstreamer1-plugins-base (gst-plugins-base)');
    }
}

/** The GStreamer bring-up. A parameter so its FAILURE branch is executable. */
export type GstInitializer = () => void;

const defaultInitializer: GstInitializer = () => {
    Gst.init(null);
    ensureGstAppLoaded();
};

/** `null` once GStreamer is up; otherwise why it is not, memoized. */
let outcome: 'pending' | 'ready' | { failed: string } = 'pending';

/**
 * Bring GStreamer up and REPORT the outcome instead of throwing.
 *
 * Returns `null` on success, or a human-readable reason. Every caller that can
 * carry on without audio should use this one — see `AudioContext`.
 *
 * `initializer` is injectable for the same reason `dirLinkTarget` takes its link
 * kind: the interesting branch here is the one where GStreamer is ABSENT, and on
 * a developer's Linux box it never is. A branch nobody can execute is how the
 * throwing version below shipped as the only entry point.
 *
 * The memo applies to the DEFAULT initializer only. A test passing its own is
 * asking to exercise one specific outcome, and must neither be answered from the
 * process-wide memo nor poison it.
 */
export function tryEnsureGstInit(initializer: GstInitializer = defaultInitializer): string | null {
    const memoize = initializer === defaultInitializer;
    if (memoize && outcome !== 'pending') return outcome === 'ready' ? null : outcome.failed;
    try {
        initializer();
        if (memoize) {
            outcome = 'ready';
            initialized = true;
        }
        return null;
    } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (memoize) outcome = { failed: reason };
        return reason;
    }
}

/**
 * TEST SEAM — answer the next bring-up with `reason` (or `null` for success)
 * without touching the real GStreamer, and `undefined` to forget again.
 *
 * The injectable initializer above covers `tryEnsureGstInit` itself, but not its
 * CALLERS: `new AudioContext()` has no initializer to hand it, and "constructing
 * a context on a host with no GStreamer does not throw" is the exact property
 * whose absence killed the game. Priming the memo is what lets that be asserted
 * on a developer machine, where GStreamer is always installed.
 */
export function primeGstOutcomeForTests(reason: string | null | undefined): void {
    if (reason === undefined) {
        outcome = 'pending';
        initialized = false;
        return;
    }
    outcome = reason === null ? 'ready' : { failed: reason };
    initialized = reason === null;
}

/**
 * Bring GStreamer up, or throw.
 *
 * For the callers that genuinely cannot proceed without it — decoding bytes,
 * building a playback pipeline. Constructing an `AudioContext` is NOT one of
 * them, and treating it as one is what killed whole applications: on the
 * batteries-included GTK runtime bundles (win32-x64, darwin) GStreamer is not
 * shipped at all, so `new AudioContext()` threw "Failed to require Gst 1.0"
 * during Excalibur's boot-time audio unlock and the game never rendered a frame.
 */
export function ensureGstInit(): void {
    if (initialized) return;
    const reason = tryEnsureGstInit();
    if (reason !== null) throw new Error(reason);
}

export { Gst };
