// Lazy GStreamer initialization — call ensureGstInit() before any Gst API usage.
// Reference: GStreamer 1.0 via gi://Gst

import Gst from 'gi://Gst?version=1.0';

let initialized = false;

export function ensureGstInit(): void {
    if (!initialized) {
        Gst.init(null);
        initialized = true;
    }
}

/**
 * Whether a GStreamer pipeline that spins its own streaming threads
 * (`decodebin`, `playbin`, …) is UNSAFE to run on the current runtime.
 *
 * Under the `@gjsify/node-gi` reverse bridge, **bun** and **deno** drive the
 * GLib main context with a pure `iterateMainContext` pump and no libuv
 * coupling. GStreamer's own streaming threads then race the JS engine's
 * garbage collector during pipeline teardown (a GObject finalize firing on a
 * streaming thread while the engine drains its toggle-ref queue) and
 * NONDETERMINISTICALLY segfault the process — reproduced on bun with the
 * synchronous `decodebin` decode path; deno shares the same pump so is guarded
 * defensively. GJS (native GStreamer) and Node (uv-coupled main loop) drive the
 * identical pipeline safely, so they are NOT affected.
 *
 * Callers use this to fail cleanly (a rejected `EncodingError`, which every
 * WebAudio consumer already handles) instead of crashing. This closes no
 * working capability: GStreamer decode does not function on the node target at
 * all (decodebin returns no samples via the reverse bridge), so the only
 * behavior change is turning a nondeterministic crash into a clean rejection.
 * Tracked as a node-gi GStreamer-threading follow-up.
 */
export function isGstStreamingUnsafe(): boolean {
    const g = globalThis as { Bun?: unknown; Deno?: unknown };
    return typeof g.Bun !== 'undefined' || typeof g.Deno !== 'undefined';
}

export { Gst };
