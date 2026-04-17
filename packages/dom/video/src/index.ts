// Video bridge for GJS — Gtk.Picture container backed by GStreamer gtk4paintablesink.
// Reimplemented for GJS using GStreamer + GTK4.

export { VideoBridge } from './video-bridge.js';
export { buildMediaStreamPipeline, buildUriPipeline, createPaintableSink } from './pipeline-builder.js';

// Side-effect: register so that document.createElement('video') works
// (already built into @gjsify/dom-elements, but register the global constructor)
import { HTMLVideoElement } from '@gjsify/dom-elements';

Object.defineProperty(globalThis, 'HTMLVideoElement', {
    value: HTMLVideoElement,
    writable: true,
    configurable: true,
});
