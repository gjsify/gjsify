// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/nodes/html-canvas-element/HTMLCanvasElement.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Simplified for gjsify — stubs only, no window reference, no MediaStream/OffscreenCanvas deps.
//   getContext() overridden in @gjsify/webgl with GTK.GLArea-backed implementation.

import { HTMLElement } from './html-element.js';

/**
 * HTMLCanvasElement base class.
 *
 * This is a DOM-spec-compliant stub. The GTK-backed implementation lives in
 * `@gjsify/webgl` and extends this class, overriding `getContext()`.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement
 */
export class HTMLCanvasElement extends HTMLElement {
    // WebGL context event handlers
    oncontextlost: ((ev: Event) => any) | null = null;
    oncontextrestored: ((ev: Event) => any) | null = null;
    onwebglcontextcreationerror: ((ev: Event) => any) | null = null;
    onwebglcontextlost: ((ev: Event) => any) | null = null;
    onwebglcontextrestored: ((ev: Event) => any) | null = null;

    /** Returns the width of the canvas element. Default: 300. */
    get width(): number {
        const w = this.getAttribute('width');
        return w !== null ? Number(w) : 300;
    }

    set width(value: number) {
        this.setAttribute('width', String(value));
    }

    /** Returns the height of the canvas element. Default: 150. */
    get height(): number {
        const h = this.getAttribute('height');
        return h !== null ? Number(h) : 150;
    }

    set height(value: number) {
        this.setAttribute('height', String(value));
    }

    /**
     * Returns a rendering context. Returns null in this base class.
     * Overridden in @gjsify/webgl to return a WebGLRenderingContext backed by Gtk.GLArea.
     */
    getContext(_contextId: string, _options?: any): any {
        return null;
    }

    /** Returns a data URL representing the canvas image. Stub — returns empty string. */
    toDataURL(_type?: string, _quality?: any): string {
        return '';
    }

    /** Converts the canvas to a Blob and passes it to the callback. Stub — returns empty Blob. */
    toBlob(callback: ((blob: Blob | null) => void), _type?: string, _quality?: any): void {
        callback(new Blob([]));
    }

    /** Returns a MediaStream capturing the canvas. Stub — returns empty object. */
    captureStream(_frameRequestRate?: number): any {
        return {};
    }
}
