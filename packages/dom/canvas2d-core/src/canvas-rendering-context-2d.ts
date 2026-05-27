// CanvasRenderingContext2D implementation backed by Cairo.
//
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D
// Reference: refs/node-canvas — Cairo-backed Canvas 2D for Node.js.
//
// Composition layout (see each module's header for details):
//   - canvas-rendering-context-2d.ts (this file): class shell + fields +
//                                                 constructor + the
//                                                 _apply* / _ensureSurface
//                                                 / _hasShadow /
//                                                 _deviceToUserDistance
//                                                 helpers + ALL accessors
//                                                 (state-style) + save /
//                                                 restore + _toDataURL +
//                                                 _dispose.
//   - context/transforms.ts        — translate / rotate / scale / transform
//                                     / setTransform / getTransform /
//                                     resetTransform.
//   - context/path-ops.ts          — beginPath / moveTo / lineTo / closePath
//                                     / bezier+quadraticCurveTo / arc / arcTo
//                                     / ellipse / rect / roundRect.
//   - context/drawing.ts           — fill / stroke / fillRect / strokeRect /
//                                     clearRect / clip / isPointInPath /
//                                     isPointInStroke / drawImage.
//   - context/pixels.ts            — createImageData / getImageData /
//                                     putImageData (ImageData pixel ops).
//   - context/text-rendering.ts    — fillText / strokeText / measureText
//                                     (PangoCairo-backed text).
//   - context/factories.ts         — createLinearGradient /
//                                     createRadialGradient / createPattern.

import Cairo from 'cairo';
// HTMLCanvasElement type is provided by the DOM lib.
// Our @gjsify/dom-elements HTMLCanvasElement satisfies this interface.

// Eagerly import the method-group modules for their `declare module`
// augmentations. tsc preserves bare side-effect imports in the emitted
// .d.ts (the named `installAllContextMethods` import at the bottom is
// stripped because it has only value-level usage). Without this line,
// downstream consumers of @gjsify/canvas2d-core's .d.ts wouldn't see the
// transforms / path / drawing / pixels / text / factory methods on the
// `CanvasRenderingContext2D` interface.
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

/**
 * CanvasRenderingContext2D backed by Cairo.ImageSurface.
 * Implements the Canvas 2D API for GJS.
 */
export class CanvasRenderingContext2D {
    readonly canvas: CanvasLike;

    // Fields are intentionally public (no `private` modifier) so that the
    // method-group modules in `./context/*` can reach them via `this._ctx` /
    // `this._state`. The leading-underscore convention marks them as
    // implementation-internal; consumers should not rely on these.
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

    // ---- Internal helpers (called from split modules) ----

    /** Ensure the surface matches the current canvas dimensions. Recreate if resized. */
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
            // Preserve the current drawing state (fillStyle, strokeStyle, font, etc.) across
            // surface recreations triggered by widget resize. Only reset the save/restore stack
            // because the old Cairo context is gone and saved state is invalid.
            // NOTE: If app code wants a true canvas reset (spec: canvas.width = X resets context),
            // it should call _resetState() explicitly. We do not reset here because _ensureSurface()
            // is called internally from drawing operations, not from app-level canvas.width assignments.
            this._stateStack = [];
        }
    }

    /** Reset drawing state to defaults (called when canvas dimensions are explicitly reset). */
    _resetState(): void {
        this._state = createDefaultState();
        this._stateStack = [];
    }

    /** Apply the current fill style (color, gradient, or pattern) to the Cairo context. */
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

    /** Apply the current stroke style to the Cairo context. */
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
     * Apply the current imageSmoothingEnabled + imageSmoothingQuality state
     * to the currently installed Cairo source pattern. Per Canvas 2D spec,
     * the filter is read from the context at *draw* time, not at pattern
     * creation — so we re-apply it on every fill/stroke.
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

    /** Apply line properties to the Cairo context. */
    _applyLineStyle(): void {
        this._ctx.setLineWidth(this._state.lineWidth);
        this._ctx.setLineCap(LINE_CAP_MAP[this._state.lineCap] as Cairo.LineCap);
        this._ctx.setLineJoin(LINE_JOIN_MAP[this._state.lineJoin] as Cairo.LineJoin);
        this._ctx.setMiterLimit(this._state.miterLimit);
        this._ctx.setDash(this._state.lineDash, this._state.lineDashOffset);
    }

    /** Apply compositing operator. */
    _applyCompositing(): void {
        const op = COMPOSITE_OP_MAP[this._state.globalCompositeOperation];
        if (op !== undefined) {
            this._ctx.setOperator(op as Cairo.Operator);
        }
    }

    /** Get the Cairo ImageSurface (used by other contexts like drawImage). */
    _getSurface(): Cairo.ImageSurface {
        return this._surface;
    }

    /** Check if shadow rendering is needed. */
    _hasShadow(): boolean {
        if (this._state.shadowBlur === 0 && this._state.shadowOffsetX === 0 && this._state.shadowOffsetY === 0) {
            return false;
        }
        const c = parseColor(this._state.shadowColor);
        return c !== null && c.a > 0;
    }

    /**
     * Convert a distance from device pixels to Cairo user space by inverting
     * the linear part of the current CTM (translation doesn't affect distances).
     *
     * Canvas 2D spec: shadowOffsetX/Y are in CSS pixels and are NOT scaled by
     * the current transform. This helper converts them to user-space offsets so
     * that `ctx.moveTo(x + sdx, y + sdy)` produces the correct pixel offset
     * regardless of any ctx.scale() or ctx.rotate() in effect.
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
     * Shadow rendering is intentionally a no-op.
     *
     * Proper Canvas 2D shadows require a Gaussian blur pass on an isolated
     * temporary surface, which cannot be emulated reliably without a full
     * Path2D replay or pixel-level manipulation. The previous implementation
     * attempted to use a temp surface but never replayed the path onto it
     * (because `drawOp` closes over the main context), leaving the shadow
     * surface empty while still leaking memory.
     *
     * Excalibur and most 2D game engines bake glow/outline effects into
     * sprites rather than relying on canvas shadows, so this no-op does not
     * affect the showcase. A correct implementation is tracked as a
     * separate Canvas 2D Phase-5 enhancement.
     */
    _renderShadow(_drawOp: () => void): void {
        // Intentionally empty. See the doc-comment above.
    }

    // ---- State (save / restore) ----

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

    // ---- Style properties (state accessors) ----

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

    // Line dash
    setLineDash(segments: number[]): void {
        // Per spec, ignore if any value is negative or non-finite
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

    // ---- Shadow properties (stored in state, rendering in text-rendering.ts) ----
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

    // ---- Text properties (state-only — rendering lives in text-rendering.ts) ----
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

    // ---- toDataURL/toBlob support ----

    /**
     * Write the canvas surface to a PNG file and return as data URL.
     * Used by HTMLCanvasElement.toDataURL() when a '2d' context is active.
     */
    _toDataURL(type?: string, _quality?: number): string {
        if (type && type !== 'image/png') {
            // Cairo only supports PNG natively
            // For other formats, return PNG anyway (per spec, PNG is the required format)
        }
        this._surface.flush();

        // Write to a temp file, read back as base64
        const Gio = imports.gi.Gio;
        const GLib = imports.gi.GLib;
        const [, tempPath] = GLib.file_open_tmp('canvas-XXXXXX.png');
        try {
            this._surface.writeToPNG(tempPath);
            const file = Gio.File.new_for_path(tempPath);
            const [, contents] = file.load_contents(null);
            const base64 = GLib.base64_encode(contents);
            return `data:image/png;base64,${base64}`;
        } finally {
            try {
                GLib.unlink(tempPath);
            } catch (_e) {
                /* ignore */
            }
        }
    }

    // ---- Cleanup ----

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
