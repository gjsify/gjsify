// <gjsify-canvas2d-bridge> — the browser half of `Canvas2DBridge` from `@gjsify/canvas2d` (ADR 0107).
//
// On GJS the bridge is a `Gtk.DrawingArea` that hands the app a Cairo-backed canvas. Here the
// canvas is a real `<canvas>` and `getContext('2d')` returns the browser's own context, so the
// size and resize semantics are the GJS widget's, name for name:
//
//   · the canvas exists from the first allocation, sized to it in LOGICAL pixels (no DPR backing),
//   · `onReady(cb)` runs once canvas and context exist, synchronously if they already do,
//   · the size is NOT synced again until the allocation changes, so a ready callback that sized
//     the canvas for a static render keeps its pixels,
//   · an allocation change sets `canvas.width/height`, dispatches a DOM `resize` event on the
//     canvas, then calls the `onResize` callbacks and the `resize` signal handlers.
//
// The canvas sits at the top-left at its natural size; the host clips the rest. That is the GJS
// widget's blit: the surface painted unscaled at (0, 0).

import { registerTemplateClass } from '../template-classes.js';

/**
 * The DOM types this element names, resolved through `globalThis` so the published `.d.ts`
 * never names a `lib.dom` type directly: a consumer that loads `lib.dom` gets the real ones,
 * one that does not still type-checks the declarations with `skipLibCheck: false`.
 */
export type BridgeCanvas = typeof globalThis extends { HTMLCanvasElement: { prototype: infer T } } ? T : object;
export type BridgeContext2D = typeof globalThis extends { CanvasRenderingContext2D: { prototype: infer T } }
    ? T
    : object;
/** `FrameRequestCallback` without `lib.dom`. */
export type FrameCallback = (time: number) => void;
type ElementConstructor = typeof globalThis extends { HTMLElement: infer C } ? C : abstract new () => object;

// biome-ignore lint: the annotation, not the value, is what the declaration file keeps
const HostElement: ElementConstructor = (globalThis as { HTMLElement?: unknown }).HTMLElement as ElementConstructor;

type ReadyCallback = (canvas: BridgeCanvas, ctx: BridgeContext2D) => void;
type ResizeCallback = (width: number, height: number) => void;
type SignalHandler = (emitter: Canvas2DBridgeElement, ...args: unknown[]) => unknown;

const TAG = 'gjsify-canvas2d-bridge';

/** `G_MAXINT`, the top of `g_param_spec_int`'s range. */
const MAX_INT = 2147483647;

function intAttribute(element: Element, name: string): number {
    const raw = Number.parseInt(element.getAttribute(name) ?? '', 10);
    return Number.isFinite(raw) ? raw : 0;
}

export class Canvas2DBridgeElement extends HostElement {
    static readonly GTypeName = 'GjsifyCanvas2DBridge';
    /** The signals `connect()` accepts, as `Gtk.Widget` names them. */
    static readonly signals: Record<string, string> = { resize: 'resize' };

    private _canvas: BridgeCanvas | null = null;
    private _ctx: BridgeContext2D | null = null;
    private _readyCallbacks: ReadyCallback[] = [];
    private _resizeCallbacks: ResizeCallback[] = [];
    private _handlers = new Map<number, { signal: string; handler: SignalHandler }>();
    private _nextHandler = 0;
    private _observer: ResizeObserver | null = null;
    private _width = -1;
    private _height = -1;
    private _drawFrame: number | null = null;

    static get observedAttributes() {
        return ['content-width', 'content-height'];
    }

    /** `Gtk.DrawingArea:content-width`, the minimum and natural width. Defaults to 0. */
    get contentWidth(): number {
        return intAttribute(this, 'content-width');
    }

    set contentWidth(v: number) {
        this._write('content-width', Math.min(Math.max(Math.trunc(v) || 0, 0), MAX_INT));
    }

    /** `Gtk.DrawingArea:content-height`, the minimum and natural height. Defaults to 0. */
    get contentHeight(): number {
        return intAttribute(this, 'content-height');
    }

    set contentHeight(v: number) {
        this._write('content-height', Math.min(Math.max(Math.trunc(v) || 0, 0), MAX_INT));
    }

    get content_width(): number {
        return this.contentWidth;
    }

    set content_width(v: number) {
        this.contentWidth = v;
    }

    get content_height(): number {
        return this.contentHeight;
    }

    set content_height(v: number) {
        this.contentHeight = v;
    }

    private _write(name: string, value: number): void {
        if (this.getAttribute(name) !== String(value)) this.setAttribute(name, String(value));
    }

    /** The `<canvas>` backing this widget. Available after the first allocation. */
    get canvas(): BridgeCanvas | null {
        return this._canvas;
    }

    /** The browser's own 2D context; available after the first allocation. */
    getContext(_id: '2d'): BridgeContext2D | null {
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

    /** The browser's own, here only so the call reads the same on every target. */
    requestAnimationFrame(cb: FrameCallback): number {
        return globalThis.requestAnimationFrame(cb);
    }

    /** A no-op: the browser already has `requestAnimationFrame` and `performance`. */
    installGlobals(): void {}

    /** `gtk_widget_queue_draw`: nothing to blit here, the canvas IS the screen. */
    queue_draw(): void {}

    queueDraw(): void {}

    connect(signal: string, handler: SignalHandler): number {
        if (!(signal in Canvas2DBridgeElement.signals)) {
            throw new Error(
                `<${TAG}> declares no signal '${signal}'. It emits: ${Object.keys(Canvas2DBridgeElement.signals).join(', ')}.`,
            );
        }
        const id = ++this._nextHandler;
        this._handlers.set(id, { signal, handler });
        return id;
    }

    disconnect(id: number): void {
        if (!this._handlers.delete(id)) throw new Error(`No handler with id ${id} is connected to <${TAG}>`);
    }

    connectedCallback() {
        if (!this.style.display) this.style.display = 'block';
        this.style.overflow = 'hidden';
        this.style.position = 'relative';
        this._publishSize();
        this._observe();
    }

    disconnectedCallback() {
        this._observer?.disconnect();
        this._observer = null;
    }

    attributeChangedCallback(name: string) {
        if (name === 'content-width' || name === 'content-height') this._publishSize();
    }

    private _publishSize(): void {
        const size: [string, number][] = [
            ['min-width', this.contentWidth],
            ['min-height', this.contentHeight],
        ];
        for (const [property, value] of size) {
            if (value > 0) this.style.setProperty(property, `${value}px`);
            else this.style.removeProperty(property);
        }
    }

    private _observe(): void {
        if (this._observer) return;
        this._observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const box = entry.contentBoxSize?.[0];
                this._allocated(
                    Math.round(box ? box.inlineSize : entry.contentRect.width),
                    Math.round(box ? box.blockSize : entry.contentRect.height),
                );
            }
        });
        this._observer.observe(this);
    }

    /** The GJS widget's `_onDraw`, minus the blit. */
    private _allocated(width: number, height: number): void {
        if (!this._canvas) {
            const canvas = document.createElement('canvas');
            canvas.style.cssText = 'position:absolute;left:0;top:0;';
            canvas.width = width;
            canvas.height = height;
            this._canvas = canvas;
            this._ctx = canvas.getContext('2d');
            this._width = width;
            this._height = height;
            this.replaceChildren(canvas);
            const ready = this._readyCallbacks;
            this._readyCallbacks = [];
            if (this._ctx) for (const cb of ready) cb(canvas, this._ctx);
            return;
        }
        if (this._width === width && this._height === height) return;
        this._width = width;
        this._height = height;
        this._canvas.width = width;
        this._canvas.height = height;
        this._canvas.dispatchEvent(new Event('resize'));
        for (const { signal, handler } of Array.from(this._handlers.values())) {
            if (signal === 'resize') handler(this, width, height);
        }
        for (const cb of this._resizeCallbacks) cb(width, height);
    }
}

if (customElements.get(TAG) === undefined) customElements.define(TAG, Canvas2DBridgeElement);
registerTemplateClass(Canvas2DBridgeElement.GTypeName, TAG);

export { Canvas2DBridgeElement as Canvas2DBridge };
