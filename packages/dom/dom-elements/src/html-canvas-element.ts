// Adapted from happy-dom (refs/happy-dom/packages/happy-dom/src/nodes/html-canvas-element/HTMLCanvasElement.ts)
// Copyright (c) David Ortner (capricorn86). MIT license.
// Modifications: Simplified for gjsify — stubs only, no window reference, no MediaStream/OffscreenCanvas deps.

import { HTMLElement } from './html-element.js';

/**
 * A DOM-spec-compliant canvas with no rendering of its own. `@gjsify/webgl` extends it with a
 * `Gtk.GLArea`-backed `getContext()` override.
 *
 * Reference: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement
 */
export class HTMLCanvasElement extends HTMLElement {
    // Context factory registry: `./register/canvas.ts` puts '2d' here. WebGL does NOT use it — that
    // package overrides `getContext()` and falls through to the registry for everything else.
    private static _contextFactories = new Map<string, (canvas: HTMLCanvasElement, options?: unknown) => unknown>();

    static registerContextFactory(
        contextId: string,
        factory: (canvas: HTMLCanvasElement, options?: unknown) => unknown,
    ): void {
        HTMLCanvasElement._contextFactories.set(contextId, factory);
    }

    oncontextlost: ((ev: Event) => unknown) | null = null;
    oncontextrestored: ((ev: Event) => unknown) | null = null;
    onwebglcontextcreationerror: ((ev: Event) => unknown) | null = null;
    onwebglcontextlost: ((ev: Event) => unknown) | null = null;
    onwebglcontextrestored: ((ev: Event) => unknown) | null = null;

    /** Defaults to 300 when the attribute is absent, per spec. */
    get width(): number {
        const w = this.getAttribute('width');
        return w !== null ? Number(w) : 300;
    }

    set width(value: number) {
        this.setAttribute('width', String(value));
    }

    /** Defaults to 150 when the attribute is absent, per spec. */
    get height(): number {
        const h = this.getAttribute('height');
        return h !== null ? Number(h) : 150;
    }

    set height(value: number) {
        this.setAttribute('height', String(value));
    }

    /** `null` for any context type with no registered factory. */
    getContext(contextId: string, options?: unknown): unknown {
        const factory = HTMLCanvasElement._contextFactories.get(contextId);
        if (factory) return factory(this, options);
        return null;
    }

    /** Empty string unless a 2D context is active — the pixels live in that context's surface. */
    toDataURL(type?: string, quality?: unknown): string {
        const ctx = this.getContext('2d') as { _toDataURL?: (type?: string, quality?: unknown) => string } | null;
        if (ctx && typeof ctx._toDataURL === 'function') return ctx._toDataURL(type, quality);
        return '';
    }

    /** Calls back with `null` when there is no 2D context to read pixels from. */
    toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: unknown): void {
        const dataUrl = this.toDataURL(type, quality);
        if (!dataUrl) {
            callback(null);
            return;
        }
        const [header, b64] = dataUrl.split(',');
        const mime = header.split(':')[1].split(';')[0];
        const bytes = atob(b64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        callback(new Blob([arr], { type: mime }));
    }

    /** Stub: the returned object is not a usable MediaStream. */
    captureStream(_frameRequestRate?: number): Record<string, never> {
        return {};
    }
}
