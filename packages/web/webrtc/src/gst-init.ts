// Lazy GStreamer initialization for the WebRTC backend.
//
// `webrtcbin` ships with GStreamer's gst-plugins-bad (`libgstwebrtc.so`).
// On Fedora: gstreamer1-plugins-bad-free + gstreamer1-plugins-bad-free-extras.
// On Ubuntu/Debian: gstreamer1.0-plugins-bad + gstreamer1.0-nice.
//
// This module is GJS-only — the Node alias layer routes it to @gjsify/empty.

import Gst from 'gi://Gst?version=1.0';

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
        throwNotSupported(
            'GStreamer element "webrtcbin" not available. Install gst-plugins-bad:\n' +
            '  Fedora:        dnf install gstreamer1-plugins-bad-free gstreamer1-plugins-bad-free-extras\n' +
            '  Ubuntu/Debian: apt install gstreamer1.0-plugins-bad',
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
    const DOMExceptionCtor: typeof DOMException | undefined = (globalThis as any).DOMException;
    if (DOMExceptionCtor) {
        throw new DOMExceptionCtor(message, 'NotSupportedError');
    }
    throw new Error(message);
}

export { Gst };
