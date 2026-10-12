// Canvas2DBridge for NativeScript (ADR 0107) — a leaf view over an Android `ImageView` that a
// subset `CanvasRenderingContext2D` draws into (see `canvas-subset.ts` and `native-canvas.android.ts`).
//
// The size and resize semantics are the GJS widget's, name for name (`@gjsify/canvas2d`):
//   · the canvas exists from the first allocation, sized to it in LOGICAL pixels,
//   · `onReady(cb)` runs once canvas and context exist, synchronously if they already do,
//   · the size is NOT synced again until the allocation changes,
//   · an allocation change sets `canvas.width/height`, dispatches `resize` on the canvas, then
//     runs the `resize` signal handlers and the `onResize` callbacks.
//
// It imports `@nativescript/core` at module-eval, so specs must not import this file except
// through the `test.trees.mts` entry.

import { View as NsView } from '@nativescript/core';

import { registerTemplateClass } from '../builder/template-classes.js';
import { withGtkWidgetLayout } from '../widgets/widget-layout.js';
import { xmlNumber } from '../widgets/xml-values.js';
import { NsCanvas, type NsCanvasRenderingContext2D } from './canvas-subset.js';
import { createNativeCanvasDriver, type NativeCanvasDriver } from './native-canvas.js';

type ReadyCallback = (canvas: NsCanvas, ctx: NsCanvasRenderingContext2D) => void;
type ResizeCallback = (width: number, height: number) => void;
type SignalHandler = (self: Canvas2DBridge, width: number, height: number) => unknown;

export class Canvas2DBridge extends withGtkWidgetLayout(NsView) {
    static readonly GTypeName: string = 'GjsifyCanvas2DBridge';

    private readonly driver: NativeCanvasDriver = createNativeCanvasDriver();
    private _canvas: NsCanvas | null = null;
    private _ctx: NsCanvasRenderingContext2D | null = null;
    private _readyCallbacks: ReadyCallback[] = [];
    private _resizeCallbacks: ResizeCallback[] = [];
    private readonly _handlers = new Map<number, SignalHandler>();
    private _nextHandler = 0;
    private _width = -1;
    private _height = -1;
    private _contentWidth = 0;
    private _contentHeight = 0;

    createNativeView(): object {
        return this.driver.createNativeView(this._context);
    }

    initNativeView(): void {
        super.initNativeView();
        this.driver.attach(this.nativeViewProtected, (width, height) => this.allocated(width, height));
    }

    disposeNativeView(): void {
        this.driver.detach();
        this._canvas = null;
        this._ctx = null;
        this._width = -1;
        this._height = -1;
        super.disposeNativeView();
    }

    /** `Gtk.DrawingArea:content-width` — the requested width, `0` for none. */
    get contentWidth(): number {
        return this._contentWidth;
    }

    set contentWidth(raw: number | string) {
        this._contentWidth = Math.max(0, Math.trunc(xmlNumber(raw, this._contentWidth)));
        this.minWidth = this._contentWidth;
    }

    get contentHeight(): number {
        return this._contentHeight;
    }

    set contentHeight(raw: number | string) {
        this._contentHeight = Math.max(0, Math.trunc(xmlNumber(raw, this._contentHeight)));
        this.minHeight = this._contentHeight;
    }

    get content_width(): number {
        return this.contentWidth;
    }

    set content_width(raw: number | string) {
        this.contentWidth = raw;
    }

    get content_height(): number {
        return this.contentHeight;
    }

    set content_height(raw: number | string) {
        this.contentHeight = raw;
    }

    /** The canvas backing this view. Available after the first allocation. */
    get canvas(): NsCanvas | null {
        return this._canvas;
    }

    /** The subset 2D context; available after the first allocation. */
    getContext(_id: '2d'): NsCanvasRenderingContext2D | null {
        return this._ctx;
    }

    /** Runs `cb` once the 2D context is ready, synchronously if it already is. */
    onReady(cb: ReadyCallback): void {
        if (this._canvas && this._ctx) {
            cb(this._canvas, this._ctx);
            return;
        }
        this._readyCallbacks.push(cb);
    }

    /** Runs `cb` on every allocation change, with the canvas dimensions already updated. */
    onResize(cb: ResizeCallback): void {
        this._resizeCallbacks.push(cb);
    }

    /** NativeScript's own `requestAnimationFrame`, here so the call reads the same on every target. */
    requestAnimationFrame(cb: FrameRequestCallback): number {
        return (globalThis as unknown as { requestAnimationFrame(cb: FrameRequestCallback): number }).requestAnimationFrame(cb);
    }

    /** A no-op: NativeScript already has `requestAnimationFrame` and `performance`. */
    installGlobals(): void {}

    /** `gtk_widget_queue_draw`: show what was drawn since the last call. */
    queue_draw(): void {
        this.driver.invalidate();
    }

    connect(signal: string, handler: SignalHandler): number {
        if (signal !== 'resize') {
            throw new Error(`Canvas2DBridge declares no signal '${signal}'. It emits: resize.`);
        }
        const id = ++this._nextHandler;
        this._handlers.set(id, handler);
        return id;
    }

    disconnect(id: number): void {
        if (!this._handlers.delete(id)) throw new TypeError(`Canvas2DBridge has no handler with id ${id}.`);
    }

    private allocated(width: number, height: number): void {
        if (!this._canvas) {
            this._width = width;
            this._height = height;
            this._canvas = new NsCanvas(width, height, this.driver);
            this._ctx = this._canvas.getContext('2d');
            const ready = this._readyCallbacks;
            this._readyCallbacks = [];
            if (this._ctx) for (const cb of ready) cb(this._canvas, this._ctx);
            return;
        }
        // Compared with the last ALLOCATION, not with the canvas: a ready callback may have sized
        // the canvas for a static render, and resyncing would clear what it drew.
        if (this._width === width && this._height === height) return;
        this._width = width;
        this._height = height;
        this._canvas.width = width;
        this._canvas.height = height;
        this._canvas.dispatchEvent({ type: 'resize' });
        for (const handler of [...this._handlers.values()]) handler(this, width, height);
        for (const cb of this._resizeCallbacks) cb(width, height);
    }
}

registerTemplateClass(Canvas2DBridge.GTypeName, Canvas2DBridge);
