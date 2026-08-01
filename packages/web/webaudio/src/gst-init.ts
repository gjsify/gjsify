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

export { Gst };
