// GTK → DOM Event Bridge
// Bridges GTK4 event controllers to standard DOM events (MouseEvent, KeyboardEvent, etc.)
// Used by Canvas2DBridge, WebGLBridge, IFrameBridge, VideoBridge, and any future GTK-DOM bridges.

export { attachEventControllers } from './event-bridge.js';
export { gdkKeyvalToKey, gdkKeyvalToCode, gdkKeyvalToLocation } from './key-map.js';
