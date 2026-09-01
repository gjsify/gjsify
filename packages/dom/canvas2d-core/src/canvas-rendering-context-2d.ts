// CanvasRenderingContext2D implementation backed by Cairo.
//
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D
// Reference: refs/node-canvas — Cairo-backed Canvas 2D for Node.js.
//
// This file holds the class shell, fields, accessors and internal helpers; the drawing operations
// are installed onto the prototype from ./context/, one module per method group.

import Cairo from 'cairo';
// `gi://`, not the legacy `imports.gi` global: the portable spelling also resolves on the
// `--app node` reverse bridge (AGENTS.md § The legacy imports.* object is NOT an API).
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

// Bare side-effect import so the method groups' `declare module` augmentations survive into the
// emitted .d.ts — tsc keeps bare imports but strips the value-only one at the bottom, and without
// this line consumers see none of the drawing methods on the interface.
import './context/index.js';

import { asCairoPattern } from './cairo-types.js';
import type { CanvasLike } from './dom-types.js';
import { parseColor } from './color.js';
import { COMPOSITE_OP_MAP, LINE_CAP_MAP, LINE_JOIN_MAP } from './cairo-utils.js';
import { type CanvasState, createDefaultState, cloneState } from './canvas-state.js';
import { CanvasGradient as OurCanvasGradient } from './canvas-gradient.js';
import { CanvasPattern as OurCanvasPattern } from './canvas-pattern.js';

/**
 * Options bag passed through the `getContext('2d', options)` factory. Mirrors
 * the WHATWG `CanvasRenderingContext2DSettings` dictionary; fields are
 * accepted but not yet honored by this implementation.
 */
export interface CanvasRenderingContext2DInit {
    alpha?: boolean;
    desynchronized?: boolean;
    colorSpace?: PredefinedColorSpace;
    willReadFrequently?: boolean;
}

/** The Canvas 2D API backed by a `Cairo.ImageSurface`. */
export class CanvasRenderingContext2D {
    readonly canvas: CanvasLike;

    // Public without a `private` modifier so the method-group modules in ./context/ can reach them;
    // the leading underscore marks them implementation-internal.
    _surface: Cairo.ImageSurface;
    _ctx: Cairo.Context;
    _state: CanvasState;
    _stateStack: CanvasState[] = [];
    _surfaceWidth: number;
    _surfaceHeight: number;

    constructor(canvas: CanvasLike, _options?: CanvasRenderingContext2DInit) {
        this.canvas = canvas;
        this._surfaceWidth = canvas.width || 300;
        this._surfaceHeight = canvas.height || 150;
        this._surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, this._surfaceWidth, this._surfaceHeight);
        this._ctx = new Cairo.Context(this._surface);
        this._state = createDefaultState();
    }

    /** Recreate the surface when the canvas dimensions changed. */
    _ensureSurface(): void {
        const w = this.canvas.width || 300;
        const h = this.canvas.height || 150;
        if (w !== this._surfaceWidth || h !== this._surfaceHeight) {
            this._ctx.$dispose();
            this._surface.finish();
            this._surfaceWidth = w;
            this._surfaceHeight = h;
            this._surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, w, h);
            this._ctx = new Cairo.Context(this._surface);
            // The drawing state survives a widget resize; only the save/restore stack is dropped,
            // since its entries belong to the destroyed Cairo context. The spec's "canvas.width = X
            // resets the context" is deliberately NOT done here — this runs from drawing operations,
            // not from an app-level width assignment, so a true reset is `_resetState()`.
            this._stateStack = [];
        }
    }

    /** Called when canvas dimensions are explicitly reset. */
    _resetState(): void {
        this._state = createDefaultState();
        this._stateStack = [];
    }

    _applyFillStyle(): void {
        const style = this._state.fillStyle;
        if (typeof style === 'string') {
            const c = this._state.fillColor;
            const a = c.a * this._state.globalAlpha;
            this._ctx.setSourceRGBA(c.r, c.g, c.b, a);
        } else if (style instanceof OurCanvasGradient) {
            this._ctx.setSource(style._getCairoPattern());
        } else if (style instanceof OurCanvasPattern) {
            this._ctx.setSource(style._getCairoPattern());
            this._applyPatternFilter();
        }
    }

    _applyStrokeStyle(): void {
        const style = this._state.strokeStyle;
        if (typeof style === 'string') {
            const c = this._state.strokeColor;
            const a = c.a * this._state.globalAlpha;
            this._ctx.setSourceRGBA(c.r, c.g, c.b, a);
        } else if (style instanceof OurCanvasGradient) {
            this._ctx.setSource(style._getCairoPattern());
        } else if (style instanceof OurCanvasPattern) {
            this._ctx.setSource(style._getCairoPattern());
            this._applyPatternFilter();
        }
    }

    /**
     * Push imageSmoothing{Enabled,Quality} onto the installed Cairo source pattern. Re-applied on
     * every fill/stroke because the spec reads the filter from the context at draw time, not at
     * pattern creation.
     */
    _applyPatternFilter(): void {
        const pat = asCairoPattern(this._ctx.getSource?.());
        if (!pat) return;
        let filter: Cairo.Filter;
        if (!this._state.imageSmoothingEnabled) {
            filter = Cairo.Filter.NEAREST;
        } else if (this._state.imageSmoothingQuality === 'high') {
            filter = Cairo.Filter.BEST;
        } else {
            filter = Cairo.Filter.BILINEAR;
        }
        pat.setFilter(filter);
    }

    _applyLineStyle(): void {
        this._ctx.setLineWidth(this._state.lineWidth);
        this._ctx.setLineCap(LINE_CAP_MAP[this._state.lineCap] as Cairo.LineCap);
        this._ctx.setLineJoin(LINE_JOIN_MAP[this._state.lineJoin] as Cairo.LineJoin);
        this._ctx.setMiterLimit(this._state.miterLimit);
        this._ctx.setDash(this._state.lineDash, this._state.lineDashOffset);
    }

    _applyCompositing(): void {
        const op = COMPOSITE_OP_MAP[this._state.globalCompositeOperation];
        if (op !== undefined) {
            this._ctx.setOperator(op as Cairo.Operator);
        }
    }

    _getSurface(): Cairo.ImageSurface {
        return this._surface;
    }

    _hasShadow(): boolean {
        if (this._state.shadowBlur === 0 && this._state.shadowOffsetX === 0 && this._state.shadowOffsetY === 0) {
            return false;
        }
        const c = parseColor(this._state.shadowColor);
        return c !== null && c.a > 0;
    }

    /**
     * Convert a device-pixel distance to Cairo user space by inverting the linear part of the CTM
     * (translation does not affect distances). Needed because the spec says shadowOffsetX/Y are CSS
     * pixels and are NOT scaled by the current transform, so they must be converted before use in
     * user space under an active scale() or rotate().
     */
    _deviceToUserDistance(dx: number, dy: number): [number, number] {
        const origin = this._ctx.userToDevice(0, 0);
        const xAxis = this._ctx.userToDevice(1, 0);
        const yAxis = this._ctx.userToDevice(0, 1);
        const a = (xAxis[0] ?? 0) - (origin[0] ?? 0);
        const b = (xAxis[1] ?? 0) - (origin[1] ?? 0);
        const c = (yAxis[0] ?? 0) - (origin[0] ?? 0);
        const d = (yAxis[1] ?? 0) - (origin[1] ?? 0);
        const det = a * d - b * c;
        if (Math.abs(det) < 1e-10) return [dx, dy]; // degenerate transform — no conversion
        return [(d * dx - c * dy) / det, (-b * dx + a * dy) / det];
    }

    /**
     * A no-op on purpose. Canvas 2D shadows need a Gaussian blur pass on an isolated surface, and
     * `drawOp` closes over the main context — so a temp surface cannot receive the path at all
     * without a full Path2D replay, and drawing to one only leaks memory while staying empty. 2D
     * game engines generally bake glow and outline effects into sprites instead. Text is the
     * exception: ./context/text-rendering.ts approximates its shadow with a 5-tap kernel.
     */
    _renderShadow(_drawOp: () => void): void {}

    save(): void {
        this._ensureSurface();
        this._stateStack.push(cloneState(this._state));
        this._ctx.save();
    }

    restore(): void {
        this._ensureSurface();
        const prev = this._stateStack.pop();
        if (prev) {
            this._state = prev;
            this._ctx.restore();
        }
    }

    get fillStyle(): string | CanvasGradient | CanvasPattern {
        return this._state.fillStyle;
    }

    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
        if (typeof value === 'string') {
            const parsed = parseColor(value);
            if (parsed) {
                this._state.fillStyle = value;
                this._state.fillColor = parsed;
            }
        } else {
            this._state.fillStyle = value;
        }
    }

    get strokeStyle(): string | CanvasGradient | CanvasPattern {
        return this._state.strokeStyle;
    }

    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
        if (typeof value === 'string') {
            const parsed = parseColor(value);
            if (parsed) {
                this._state.strokeStyle = value;
                this._state.strokeColor = parsed;
            }
        } else {
            this._state.strokeStyle = value;
        }
    }

    get lineWidth(): number {
        return this._state.lineWidth;
    }
    set lineWidth(value: number) {
        if (value > 0 && isFinite(value)) this._state.lineWidth = value;
    }

    get lineCap(): CanvasLineCap {
        return this._state.lineCap;
    }
    set lineCap(value: CanvasLineCap) {
        if (value === 'butt' || value === 'round' || value === 'square') {
            this._state.lineCap = value;
        }
    }

    get lineJoin(): CanvasLineJoin {
        return this._state.lineJoin;
    }
    set lineJoin(value: CanvasLineJoin) {
        if (value === 'miter' || value === 'round' || value === 'bevel') {
            this._state.lineJoin = value;
        }
    }

    get miterLimit(): number {
        return this._state.miterLimit;
    }
    set miterLimit(value: number) {
        if (value > 0 && isFinite(value)) this._state.miterLimit = value;
    }

    get globalAlpha(): number {
        return this._state.globalAlpha;
    }
    set globalAlpha(value: number) {
        if (value >= 0 && value <= 1 && isFinite(value)) this._state.globalAlpha = value;
    }

    get globalCompositeOperation(): GlobalCompositeOperation {
        return this._state.globalCompositeOperation;
    }

    set globalCompositeOperation(value: GlobalCompositeOperation) {
        if (COMPOSITE_OP_MAP[value] !== undefined) {
            this._state.globalCompositeOperation = value;
        }
    }

    get imageSmoothingEnabled(): boolean {
        return this._state.imageSmoothingEnabled;
    }
    set imageSmoothingEnabled(value: boolean) {
        this._state.imageSmoothingEnabled = !!value;
    }

    get imageSmoothingQuality(): ImageSmoothingQuality {
        return this._state.imageSmoothingQuality;
    }
    set imageSmoothingQuality(value: ImageSmoothingQuality) {
        if (value === 'low' || value === 'medium' || value === 'high') {
            this._state.imageSmoothingQuality = value;
        }
    }

    setLineDash(segments: number[]): void {
        // Per spec, ignore the call outright if any value is negative or non-finite.
        if (segments.some((v) => v < 0 || !isFinite(v))) return;
        this._state.lineDash = [...segments];
    }

    getLineDash(): number[] {
        return [...this._state.lineDash];
    }

    get lineDashOffset(): number {
        return this._state.lineDashOffset;
    }
    set lineDashOffset(value: number) {
        if (isFinite(value)) this._state.lineDashOffset = value;
    }

    // Shadow and text properties are state-only here; the rendering is in ./context/.
    get shadowColor(): string {
        return this._state.shadowColor;
    }
    set shadowColor(value: string) {
        this._state.shadowColor = value;
    }
    get shadowBlur(): number {
        return this._state.shadowBlur;
    }
    set shadowBlur(value: number) {
        if (value >= 0 && isFinite(value)) this._state.shadowBlur = value;
    }
    get shadowOffsetX(): number {
        return this._state.shadowOffsetX;
    }
    set shadowOffsetX(value: number) {
        if (isFinite(value)) this._state.shadowOffsetX = value;
    }
    get shadowOffsetY(): number {
        return this._state.shadowOffsetY;
    }
    set shadowOffsetY(value: number) {
        if (isFinite(value)) this._state.shadowOffsetY = value;
    }

    get font(): string {
        return this._state.font;
    }
    set font(value: string) {
        this._state.font = value;
    }
    get textAlign(): CanvasTextAlign {
        return this._state.textAlign;
    }
    set textAlign(value: CanvasTextAlign) {
        this._state.textAlign = value;
    }
    get textBaseline(): CanvasTextBaseline {
        return this._state.textBaseline;
    }
    set textBaseline(value: CanvasTextBaseline) {
        this._state.textBaseline = value;
    }
    get direction(): CanvasDirection {
        return this._state.direction;
    }
    set direction(value: CanvasDirection) {
        this._state.direction = value;
    }

    /** Backs `HTMLCanvasElement.toDataURL()` while a '2d' context is active. */
    _toDataURL(type?: string, _quality?: number): string {
        if (type && type !== 'image/png') {
            // Every requested type yields PNG: Cairo encodes nothing else, and PNG is the one
            // format the spec requires.
        }
        this._surface.flush();

        // Cairo can only encode to a file, so the bytes come back via a temp file.
        const [, tempPath] = GLib.file_open_tmp('canvas-XXXXXX.png');
        try {
            this._surface.writeToPNG(tempPath);
            const file = Gio.File.new_for_path(tempPath);
            const [, contents] = file.load_contents(null);
            const base64 = GLib.base64_encode(contents);
            return `data:image/png;base64,${base64}`;
        } finally {
            // No try/catch: `GLib.unlink` returns 0/-1 and is not `throws` in the GIR, so
            // best-effort cleanup means ignoring the RETURN value.
            GLib.unlink(tempPath);
        }
    }

    /** Release native Cairo resources. Call when the canvas is discarded. */
    _dispose(): void {
        this._ctx.$dispose();
        this._surface.finish();
    }
}

// Wire focused method groups into CanvasRenderingContext2D.prototype.
// Imported eagerly so the augmentation interfaces in each module merge into
// `CanvasRenderingContext2D` at type-check time. The actual prototype
// assignment runs after the class is fully declared, sidestepping the
// circular-import trap that prototype-merge mixins would otherwise hit at
// module-load time.
import { installAllContextMethods } from './context/index.js';
installAllContextMethods(CanvasRenderingContext2D.prototype);
