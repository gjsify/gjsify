// Video bridge for GJS — Gtk.Picture container backed by GStreamer gtk4paintablesink.
// Reimplemented for GJS using GStreamer + GTK4.

export { VideoBridge } from './video-bridge.js';
export { buildMediaStreamPipeline, buildUriPipeline, createPaintableSink } from './pipeline-builder.js';

// Re-export HTMLVideoElement from dom-elements for consumers who need the type.
export { HTMLVideoElement } from '@gjsify/dom-elements';
