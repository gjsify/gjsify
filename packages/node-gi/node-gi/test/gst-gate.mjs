// SPDX-License-Identifier: MIT
// "Is GStreamer usable on this host?" — one answer, shared by every Gst test.
//
// Gated on the TYPELIB, never on the platform: the aarch64 CI leg runs the suite
// on a plain `fedora:44` with no GStreamer at all, while every other leg has it,
// and `Gst.init()` is part of the question — a namespace that loads against an
// empty registry still fails at the first `ElementFactory.make`.
//
// The gate initialises Gst on import, so a test file that skips gets its reason
// from the load error rather than repeating the try/catch.
import { requireGi } from '../gi.js';

let gst = null;
let loadError = null;
try {
    gst = requireGi('Gst', '1.0');
    gst.init(null);
} catch (err) {
    // The one throw path that matters: no typelib, no shared library, or an
    // init that refuses. Recorded as the skip reason, never swallowed.
    loadError = err;
}

/** The initialised `Gst` namespace, or `null` where GStreamer is unavailable. */
export const Gst = gst;

/** A node:test `skip` reason string when GStreamer is unavailable, else `false`. */
export const gstSkip = loadError ? `Gst 1.0 unavailable: ${loadError.message}` : false;
