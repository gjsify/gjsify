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

export function ensureGstInit(): void {
    if (!initialized) {
        Gst.init(null);
        ensureGstAppLoaded();
        initialized = true;
    }
}

/**
 * Whether a GStreamer pipeline that spins its own streaming threads
 * (`decodebin`, `playbin`, …) is UNSAFE to run on the current runtime.
 *
 * TRUE on **bun** and **deno**, which drive the GLib main context with a pure
 * `iterateMainContext` pump and no libuv coupling: GStreamer's streaming threads
 * then race the JS engine's garbage collector during pipeline teardown (a
 * GObject finalize firing on a streaming thread while the engine drains its
 * toggle-ref queue) and NONDETERMINISTICALLY segfault the process — reproduced
 * on bun with the synchronous `decodebin` decode path; deno shares the pump so
 * is guarded defensively.
 *
 * FALSE on gjs (native GStreamer) and on **node**, whose main loop IS uv-coupled.
 * Node was briefly guarded here as well, on the theory that the
 * `GTK_IS_EVENT_CONTROLLER` assertion failures seen once audio finally ran there
 * were the same race. They are not: re-running with the guard ON still produces
 * them (1/6/1 criticals over three runs), and so does a build with the GValue
 * marshalling fix reverted entirely. They are a separate, pre-existing and
 * NONDETERMINISTIC node-gi instability, which is exactly why a single clean run
 * is not evidence of anything — the first attribution was a sampling error, and
 * gating audio on it would have removed a working capability for a defect it
 * does not cause. Tracked in STATUS.md as its own entry.
 *
 * Callers use this to fail cleanly (a rejected `EncodingError`, which every
 * WebAudio consumer already handles) instead of crashing.
 */
export function isGstStreamingUnsafe(): boolean {
    const g = globalThis as { Bun?: unknown; Deno?: unknown };
    return typeof g.Bun !== 'undefined' || typeof g.Deno !== 'undefined';
}

export { Gst };
