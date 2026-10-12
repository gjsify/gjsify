// The Canvas 2D subset NativeScript honours (ADR 0107), as plain TypeScript with no platform import.
//
// `Canvas2DBridge` promises the Web-standard `CanvasRenderingContext2D`. Android has no such
// context, only `android.graphics.Canvas`, so this class is a TRUE SUBSET: the members below do
// what the browser's do, and every other member of the interface is ABSENT. Calling `ctx.arc()`
// is a `TypeError` naming the missing function, never a silent no-op that draws nothing.
//
// THE SUBSET: `canvas.width/height`, `fillStyle`, `strokeStyle`, `lineWidth`, `globalAlpha`,
// `imageSmoothingEnabled`, `fillRect`, `clearRect`, `beginPath`, `moveTo`, `lineTo`, `rect`,
// `closePath`, `fill`, `stroke`, `save`, `restore`.
//
// The pixels are the `Canvas2DBackend`'s. The Android backend lives in `native-canvas.android.ts`;
// the specs hand this class a recording backend, which is what makes the semantics testable off
// a device.

import { parseColor } from '@gjsify/canvas2d-core/color';

/** What the subset needs from a surface. Colours are signed 32-bit ARGB, the way Android takes them. */
export interface Canvas2DBackend {
    /** Reallocates the surface at `width` x `height` LOGICAL pixels; the old pixels are gone. */
    resize(width: number, height: number): void;
    fillRect(x: number, y: number, width: number, height: number, argb: number): void;
    clearRect(x: number, y: number, width: number, height: number): void;
    resetPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    rect(x: number, y: number, width: number, height: number): void;
    closePath(): void;
    fillPath(argb: number): void;
    strokePath(argb: number, lineWidth: number): void;
    setImageSmoothing(enabled: boolean): void;
    /** Something was drawn: make the screen show it. */
    invalidate(): void;
}

type DomListener = (event: { type: string; target: unknown }) => void;

/** The `canvas` of the GJS widget, reduced to what a subset context needs: a size and `resize` events. */
export class NsCanvas {
    private _width: number;
    private _height: number;
    private readonly listeners = new Map<string, Set<DomListener>>();
    private context: NsCanvasRenderingContext2D | null = null;

    constructor(
        width: number,
        height: number,
        private readonly backend: Canvas2DBackend,
    ) {
        this._width = NsCanvas.dimension(width);
        this._height = NsCanvas.dimension(height);
        backend.resize(this._width, this._height);
    }

    private static dimension(value: number): number {
        const n = Math.trunc(Number(value));
        return Number.isFinite(n) && n > 0 ? n : 0;
    }

    /** Setting either size reallocates the surface and clears it, as an HTML canvas does. */
    get width(): number {
        return this._width;
    }

    set width(value: number) {
        this._width = NsCanvas.dimension(value);
        this.backend.resize(this._width, this._height);
        this.backend.invalidate();
    }

    get height(): number {
        return this._height;
    }

    set height(value: number) {
        this._height = NsCanvas.dimension(value);
        this.backend.resize(this._width, this._height);
        this.backend.invalidate();
    }

    getContext(id: string): NsCanvasRenderingContext2D | null {
        if (id !== '2d') return null;
        this.context ??= new NsCanvasRenderingContext2D(this, this.backend);
        return this.context;
    }

    addEventListener(type: string, listener: DomListener): void {
        let set = this.listeners.get(type);
        if (set === undefined) this.listeners.set(type, (set = new Set()));
        set.add(listener);
    }

    removeEventListener(type: string, listener: DomListener): void {
        this.listeners.get(type)?.delete(listener);
    }

    dispatchEvent(event: { type: string }): boolean {
        for (const listener of [...(this.listeners.get(event.type) ?? [])]) listener({ ...event, target: this });
        return true;
    }
}

interface DrawingState {
    fillStyle: string;
    strokeStyle: string;
    lineWidth: number;
    globalAlpha: number;
    imageSmoothingEnabled: boolean;
}

const REFUSAL =
    'is not part of the Canvas2D subset NativeScript supports (ADR 0107): ' +
    'fillRect/clearRect/beginPath/moveTo/lineTo/rect/closePath/fill/stroke/save/restore ' +
    'with fillStyle, strokeStyle, lineWidth, globalAlpha and imageSmoothingEnabled.';

/** `#rrggbb` for an opaque colour and `rgba(r, g, b, a)` otherwise, the browser's serialisation. */
function serialise(color: { r: number; g: number; b: number; a: number }): string {
    const byte = (v: number) => Math.round(v * 255);
    if (color.a >= 1) {
        return `#${[color.r, color.g, color.b].map((v) => byte(v).toString(16).padStart(2, '0')).join('')}`;
    }
    return `rgba(${byte(color.r)}, ${byte(color.g)}, ${byte(color.b)}, ${Number(color.a.toFixed(3))})`;
}

export class NsCanvasRenderingContext2D {
    private state: DrawingState = {
        fillStyle: '#000000',
        strokeStyle: '#000000',
        lineWidth: 1,
        globalAlpha: 1,
        imageSmoothingEnabled: true,
    };
    private readonly stack: DrawingState[] = [];
    private hasSubpath = false;

    constructor(
        readonly canvas: NsCanvas,
        private readonly backend: Canvas2DBackend,
    ) {}

    private static colorOf(property: string, value: unknown): string | null {
        if (typeof value !== 'string') {
            throw new TypeError(
                `CanvasRenderingContext2D.${property} takes a colour string on NativeScript; gradients and patterns ${REFUSAL}`,
            );
        }
        const color = parseColor(value);
        return color === null ? null : serialise(color);
    }

    /** An unparseable colour leaves the style as it was, as the browser's setter does. */
    get fillStyle(): string {
        return this.state.fillStyle;
    }

    set fillStyle(value: string) {
        this.state.fillStyle = NsCanvasRenderingContext2D.colorOf('fillStyle', value) ?? this.state.fillStyle;
    }

    get strokeStyle(): string {
        return this.state.strokeStyle;
    }

    set strokeStyle(value: string) {
        this.state.strokeStyle = NsCanvasRenderingContext2D.colorOf('strokeStyle', value) ?? this.state.strokeStyle;
    }

    get lineWidth(): number {
        return this.state.lineWidth;
    }

    set lineWidth(value: number) {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) this.state.lineWidth = n;
    }

    get globalAlpha(): number {
        return this.state.globalAlpha;
    }

    set globalAlpha(value: number) {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0 && n <= 1) this.state.globalAlpha = n;
    }

    get imageSmoothingEnabled(): boolean {
        return this.state.imageSmoothingEnabled;
    }

    set imageSmoothingEnabled(value: boolean) {
        this.state.imageSmoothingEnabled = Boolean(value);
        this.backend.setImageSmoothing(this.state.imageSmoothingEnabled);
    }

    private argb(style: string): number {
        const color = parseColor(style)!;
        const alpha = Math.round(color.a * this.state.globalAlpha * 255);
        return ((alpha << 24) | (Math.round(color.r * 255) << 16) | (Math.round(color.g * 255) << 8) | Math.round(color.b * 255)) | 0;
    }

    private static finite(...values: number[]): boolean {
        return values.every((v) => Number.isFinite(Number(v)));
    }

    fillRect(x: number, y: number, width: number, height: number): void {
        if (!NsCanvasRenderingContext2D.finite(x, y, width, height) || width === 0 || height === 0) return;
        const [rx, rw] = width < 0 ? [x + width, -width] : [x, width];
        const [ry, rh] = height < 0 ? [y + height, -height] : [y, height];
        this.backend.fillRect(rx, ry, rw, rh, this.argb(this.state.fillStyle));
        this.backend.invalidate();
    }

    clearRect(x: number, y: number, width: number, height: number): void {
        if (!NsCanvasRenderingContext2D.finite(x, y, width, height) || width === 0 || height === 0) return;
        const [rx, rw] = width < 0 ? [x + width, -width] : [x, width];
        const [ry, rh] = height < 0 ? [y + height, -height] : [y, height];
        this.backend.clearRect(rx, ry, rw, rh);
        this.backend.invalidate();
    }

    beginPath(): void {
        this.backend.resetPath();
        this.hasSubpath = false;
    }

    moveTo(x: number, y: number): void {
        if (!NsCanvasRenderingContext2D.finite(x, y)) return;
        this.backend.moveTo(x, y);
        this.hasSubpath = true;
    }

    /** With no current point `lineTo` starts a subpath, where `android.graphics.Path` would draw from (0, 0). */
    lineTo(x: number, y: number): void {
        if (!NsCanvasRenderingContext2D.finite(x, y)) return;
        if (this.hasSubpath) this.backend.lineTo(x, y);
        else this.backend.moveTo(x, y);
        this.hasSubpath = true;
    }

    rect(x: number, y: number, width: number, height: number): void {
        if (!NsCanvasRenderingContext2D.finite(x, y, width, height)) return;
        this.backend.rect(x, y, width, height);
        this.backend.moveTo(x, y);
        this.hasSubpath = true;
    }

    closePath(): void {
        if (this.hasSubpath) this.backend.closePath();
    }

    fill(): void {
        this.backend.fillPath(this.argb(this.state.fillStyle));
        this.backend.invalidate();
    }

    stroke(): void {
        this.backend.strokePath(this.argb(this.state.strokeStyle), this.state.lineWidth);
        this.backend.invalidate();
    }

    save(): void {
        this.stack.push({ ...this.state });
    }

    restore(): void {
        const previous = this.stack.pop();
        if (previous === undefined) return;
        this.state = previous;
        this.backend.setImageSmoothing(previous.imageSmoothingEnabled);
    }
}
