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

export function ensureGstInit(): void {
    if (initialized) return;
    Gst.init(null);
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
