// GTK → DOM Event Bridge
// Bridges GTK4 event controllers to standard DOM events (MouseEvent, KeyboardEvent, etc.)
// Used by Canvas2DWidget, CanvasWebGLWidget, IFrameWidget, and any future GTK-backed DOM widgets.

export { attachEventControllers } from './event-bridge.js';
export { gdkKeyvalToKey, gdkKeyvalToCode, gdkKeyvalToLocation } from './key-map.js';
