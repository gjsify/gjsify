// Video bridge for GJS — Gtk.Picture container backed by GStreamer gtk4paintablesink.
// Reimplemented for GJS using GStreamer + GTK4.

export { VideoBridge } from './video-bridge.js';
export { GstHTMLVideoElement } from './gst-html-video-element.js';
export { buildMediaStreamPipeline, buildUriPipeline, createPaintableSink } from './pipeline-builder.js';

// Side-effect: register GstHTMLVideoElement as the global HTMLVideoElement constructor
// so that document.createElement('video') and instanceof checks work correctly.
import { GstHTMLVideoElement } from './gst-html-video-element.js';

Object.defineProperty(globalThis, 'HTMLVideoElement', {
    value: GstHTMLVideoElement,
    writable: true,
    configurable: true,
});
