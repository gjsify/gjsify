// Lazy GStreamer initialization for the Video bridge.
//
// gtk4paintablesink ships with GStreamer's gst-plugins-rs (Rust plugins).
// On Fedora: gstreamer1-plugin-gtk4
// On Ubuntu/Debian: gstreamer1.0-gtk4
//
// This module is GJS-only — the Node alias layer routes it to @gjsify/empty.

import Gst from 'gi://Gst?version=1.0';
import { DOMException } from '@gjsify/dom-exception';

let initialized = false;

export function ensureGstInit(): void {
    if (initialized) return;
    Gst.init(null as any);
    initialized = true;
}

/** Throws if the gtk4paintablesink element is not registered. */
export function ensurePaintableSinkAvailable(): void {
    ensureGstInit();
    const factory = Gst.ElementFactory.find('gtk4paintablesink');
    if (!factory) {
        throwNotSupported(
            'GStreamer element "gtk4paintablesink" not available. Install gst-plugins-rs:\n' +
            '  Fedora:        dnf install gstreamer1-plugin-gtk4\n' +
            '  Ubuntu/Debian: apt install gstreamer1.0-gtk4\n' +
            '  Verify with:   gst-inspect-1.0 gtk4paintablesink',
        );
    }
}

function throwNotSupported(message: string): never {
    throw new DOMException(message, 'NotSupportedError');
}

export { Gst };
