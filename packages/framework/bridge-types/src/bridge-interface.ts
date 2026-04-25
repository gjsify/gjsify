// DOMBridgeContainer — shared interface for all GTK-DOM bridge containers.
// Each bridge (Canvas2DBridge, WebGLBridge, IFrameBridge, VideoBridge) implements
// this interface to provide a consistent API.

import type { BridgeEnvironment } from './bridge-environment.js';

/**
 * Common interface for GTK widgets that host a DOM element.
 *
 * Each bridge IS a GTK widget (extends a GObject class) and wraps a single
 * DOM element, providing an isolated browser-like environment.
 */
export interface DOMBridgeContainer {
    /** The hosted DOM element (null until ready). */
    readonly element: HTMLElement | null;

    /** Isolated browser environment (own document, body, window). */
    readonly environment: BridgeEnvironment;

    /** Register a callback that fires when the DOM element and rendering context are ready. */
    onReady(cb: (element: HTMLElement) => void): void;

    /** Register a callback that fires when the widget is resized. */
    onResize?(cb: (width: number, height: number) => void): void;

    /** Request an animation frame backed by the GTK frame clock (vsync). */
    requestAnimationFrame?(cb: FrameRequestCallback): number;

    /** Install this bridge's environment as globalThis globals. */
    installGlobals(): void;
}
