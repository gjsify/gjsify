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

export { Gst };
