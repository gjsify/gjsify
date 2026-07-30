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
 * TRUE on the whole `@gjsify/node-gi` reverse bridge — node, bun and deno —
 * and FALSE on gjs, where native GStreamer drives the identical pipeline
 * safely.
 *
 * GStreamer's streaming threads race the JS engine's garbage collector (a
 * GObject finalize firing on a streaming thread while the engine drains its
 * toggle-ref queue). It was first reproduced on bun/deno, which drive the GLib
 * main context with a pure `iterateMainContext` pump, as a nondeterministic
 * SEGFAULT — and node was believed unaffected because its main loop is
 * uv-coupled. It is not: node was merely never reaching a live pipeline. Two
 * bugs stood in front of it (`set_property` had no GValue marshalling, and the
 * GstApp typelib was tree-shaken out of the bundle so `push_buffer` did not
 * resolve), and with both fixed, decode and playback DO run there — and the
 * process then dies mid-frame with
 *
 *   Gtk-CRITICAL **: gtk_event_controller_handle_crossing:
 *   assertion 'GTK_IS_EVENT_CONTROLLER (controller)' failed
 *
 * repeated, i.e. live GTK objects invalidated under it. Same root cause, a
 * different symptom because node's loop coupling changes where the corruption
 * lands. Isolated by bisecting the two fixes: no criticals while playback was
 * still broken, criticals as soon as it worked.
 *
 * Callers use this to fail cleanly (a rejected `EncodingError`, which every
 * WebAudio consumer already handles) instead of crashing. Audio is therefore
 * silent on the reverse bridge and unchanged on gjs. That closes no capability
 * that was ever available — audio has never actually worked on node — and the
 * two fixes above are still what a future node-gi threading fix will build on.
 * Tracked in STATUS.md as the node-gi GStreamer-threading follow-up.
 */
export function isGstStreamingUnsafe(): boolean {
    const g = globalThis as {
        Bun?: unknown;
        Deno?: unknown;
        process?: { versions?: Record<string, string>; argv?: unknown };
    };
    if (typeof g.Bun !== 'undefined' || typeof g.Deno !== 'undefined') return true;

    // Node vs gjs, and neither obvious marker works alone — `process` on the gjs
    // target comes in TWO shapes and one of them mimics Node:
    //
    //   • the byte-1 stub the gjs build prepends (`process-stub.ts`) sets
    //     `versions:{}` — no `node`, no `gjs`;
    //   • `@gjsify/process`, once registered, deliberately reports
    //     `versions.node = '20.0.0'` for npm packages that gate on it (the trap
    //     documented in its own internal/detect.ts) AND sets `versions.gjs`.
    //
    // So: no `process` at all is gjs (a bundle with neither), `versions.gjs` is
    // gjs, an EMPTY `versions` is the gjs stub, and `argv[0] === 'gjs'` is set by
    // both gjs shapes. Only a `process` that reports a node version while
    // claiming none of those is a reverse-bridge runtime.
    const proc = g.process;
    if (proc === undefined) return false;
    const versions = proc.versions ?? {};
    if (typeof versions.gjs === 'string') return false;
    if (typeof versions.node !== 'string') return false;
    if (Array.isArray(proc.argv) && proc.argv[0] === 'gjs') return false;
    return true;
}

export { Gst };
