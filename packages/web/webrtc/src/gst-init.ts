// Lazy GStreamer initialization for the WebRTC backend.
//
// `webrtcbin` ships with GStreamer's gst-plugins-bad (`libgstwebrtc.so`).
// On Fedora: gstreamer1-plugins-bad-free + gstreamer1-plugins-bad-free-extras.
// On Ubuntu/Debian: gstreamer1.0-plugins-bad + gstreamer1.0-nice.
//
// This module is GJS-only — the Node alias layer routes it to @gjsify/empty.

import Gst from 'gi://Gst?version=1.0';
import { DOMException } from '@gjsify/dom-exception';

let initialized = false;

/**
 * Plugin feature names `autoaudiosrc`/`autoaudiosink` must never select,
 * because their `open()` does not fail fast the way the ordinary candidates
 * (pipewiresrc/pulsesrc/alsasrc and their sink counterparts) do.
 *
 * `getUserMedia({ audio: true })`'s source probe already has cause to
 * distrust `openalsrc` on this exact CI image: `ghcr.io/gjsify/ci-fedora:44`
 * has no reachable PipeWire/Pulse, so `_chooseSource()` in
 * `get-user-media.ts` falls through to `autoaudiosrc`, which GStreamer's
 * autodetect resolves to `openalsrc` there (see that file's `_sourceChoice`
 * comment for the earlier, separately-measured incident: ten probes leaked
 * 12 threads/878 MB each, and a 125-iteration loop wedged the process at 409
 * threads with the main thread parked in `futex_do_wait`). The SAME `openal`
 * plugin backs the sink side, and it is not simply slow: OpenAL Soft runs
 * its OWN nested device-backend probe (PipeWire, then others) SYNCHRONOUSLY
 * inside `gst_element_set_state()`. `GstAutoDetect` (what `autoaudiosrc` and
 * `autoaudiosink` both are) runs a child's state change on the CALLING
 * thread, so on GJS's single JS thread a stall in that probe freezes the
 * whole process — measured directly in a `Multi-PC fan-out` test that moves
 * a getUserMedia track's source between pipelines (closing and reopening
 * it): `[ALSOFT] Failed to connect PipeWire` logged, then 31s of silence
 * until the heartbeat guard killed the job.
 *
 * Deranking both features keeps them out of the autodetect candidate list
 * entirely. `autoaudiosrc`/`autoaudiosink` already fall back gracefully when
 * no real candidate opens (verified: a host with no reachable audio server
 * still resolves to a `GstAudioTestSrc`/`GstFakeSink` child in well under
 * 100ms) — openal was defeating that fallback, not providing a needed one.
 */
const UNBOUNDED_AUTODETECT_CANDIDATES = ['openalsrc', 'openalsink'];

function excludeUnboundedAutodetectCandidates(): void {
    const registry = Gst.Registry.get();
    for (const name of UNBOUNDED_AUTODETECT_CANDIDATES) {
        registry.lookup_feature(name)?.set_rank(Gst.Rank.NONE);
    }
}

export function ensureGstInit(): void {
    if (initialized) return;
    Gst.init(null);
    excludeUnboundedAutodetectCandidates();
    initialized = true;
}

/** Throws if the `webrtcbin` element is not registered (gst-plugins-bad missing). */
export function ensureWebrtcbinAvailable(): void {
    ensureGstInit();
    const webrtcFactory = Gst.ElementFactory.find('webrtcbin');
    if (!webrtcFactory) {
        // Distinguish "gst-plugins-bad is not installed" from "it is installed
        // but this distro does not build its webrtc plugin" — the advice differs
        // and only one of them is actionable. `dtlsenc`/`sctpenc` are siblings
        // from the SAME source package, so their presence settles it without
        // guessing at file paths. Measured on postmarketOS v26.06 / Alpine v3.24
        // aarch64: gst-plugins-bad 1.28.3 installed, libgstdtls/sctp/srtp all
        // present, `libgstwebrtc.so` absent from the package (it is still there
        // in Alpine v3.23) — and the old message told the user to install a
        // package they already had.
        const badInstalled = Gst.ElementFactory.find('dtlsenc') !== null || Gst.ElementFactory.find('sctpenc') !== null;
        throwNotSupported(
            badInstalled
                ? 'GStreamer element "webrtcbin" not available, but gst-plugins-bad IS installed\n' +
                      '(its dtls/sctp elements are registered). This distro does not ship the\n' +
                      'plugin — verify with: ls /usr/lib/gstreamer-1.0/libgstwebrtc.so\n' +
                      '  Alpine/postmarketOS: absent since Alpine v3.24; no package provides it.\n' +
                      '  Otherwise: install the plugin from source, or use a distro that ships it.'
                : 'GStreamer element "webrtcbin" not available. Install gst-plugins-bad:\n' +
                      '  Fedora:              dnf install gstreamer1-plugins-bad-free gstreamer1-plugins-bad-free-extras\n' +
                      '  Ubuntu/Debian:       apt install gstreamer1.0-plugins-bad\n' +
                      '  Alpine/postmarketOS: apk add gst-plugins-bad',
        );
    }
    // webrtcbin requires libnice's GStreamer plugin for ICE transport —
    // without it, pipeline state-change to PLAYING fails and createDataChannel
    // hits the "webrtc->priv->is_closed" assertion.
    const niceFactory = Gst.ElementFactory.find('nicesrc');
    if (!niceFactory) {
        throwNotSupported(
            'GStreamer "nice" plugin (libnice-gstreamer) not available — required by webrtcbin.\n' +
                '  Fedora:        dnf install libnice-gstreamer1\n' +
                '  Ubuntu/Debian: apt install gstreamer1.0-nice\n' +
                '  Verify with:   gst-inspect-1.0 nicesrc',
        );
    }
}

function throwNotSupported(message: string): never {
    throw new DOMException(message, 'NotSupportedError');
}

export { Gst };
