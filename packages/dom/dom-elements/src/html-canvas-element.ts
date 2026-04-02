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
    // Context factory registry — packages register their context types here.
    // e.g. @gjsify/canvas2d registers '2d', @gjsify/webgl registers 'webgl'.
    private static _contextFactories = new Map<string, (canvas: HTMLCanvasElement, options?: any) => any>();

    /**
     * Register a rendering context factory for a given context type.
     * Called by packages like @gjsify/canvas2d and @gjsify/webgl to plug in their implementations.
     */
    static registerContextFactory(contextId: string, factory: (canvas: HTMLCanvasElement, options?: any) => any): void {
        HTMLCanvasElement._contextFactories.set(contextId, factory);
    }

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
     * Returns a rendering context.
     * Checks the static context factory registry for a matching factory.
     * Subclasses (e.g. @gjsify/webgl) may override and fall through via super.getContext().
     */
    getContext(contextId: string, options?: any): any {
        const factory = HTMLCanvasElement._contextFactories.get(contextId);
        if (factory) return factory(this, options);
        return null;
    }

    /** Returns a data URL representing the canvas image. Delegates to the active 2D context if available. */
    toDataURL(type?: string, quality?: any): string {
        const ctx = this.getContext('2d') as any;
        if (ctx && typeof ctx._toDataURL === 'function') return ctx._toDataURL(type, quality);
        return '';
    }

    /** Converts the canvas to a Blob and passes it to the callback. Delegates to the active 2D context if available. */
    toBlob(callback: ((blob: Blob | null) => void), type?: string, quality?: any): void {
        const dataUrl = this.toDataURL(type, quality);
        if (!dataUrl) { callback(null); return; }
        const [header, b64] = dataUrl.split(',');
        const mime = header.split(':')[1].split(';')[0];
        const bytes = atob(b64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        callback(new Blob([arr], { type: mime }));
    }

    /** Returns a MediaStream capturing the canvas. Stub — returns empty object. */
    captureStream(_frameRequestRate?: number): any {
        return {};
    }
}
