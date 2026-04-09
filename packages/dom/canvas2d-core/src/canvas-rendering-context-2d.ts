// CanvasRenderingContext2D implementation backed by Cairo
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D
// Reference: refs/node-canvas (Cairo-backed Canvas 2D for Node.js)

import Cairo from 'cairo';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';
// HTMLCanvasElement type is provided by the DOM lib.
// Our @gjsify/dom-elements HTMLCanvasElement satisfies this interface.

import { parseColor } from './color.js';
import {
    quadraticToCubic,
    cairoArcTo,
    cairoEllipse,
    cairoRoundRect,
    COMPOSITE_OP_MAP,
    LINE_CAP_MAP,
    LINE_JOIN_MAP,
} from './cairo-utils.js';
import { type CanvasState, createDefaultState, cloneState } from './canvas-state.js';
import { OurImageData } from './image-data.js';
import { CanvasGradient as OurCanvasGradient } from './canvas-gradient.js';
import { CanvasPattern as OurCanvasPattern } from './canvas-pattern.js';
import { Path2D } from './canvas-path.js';

/**
 * CanvasRenderingContext2D backed by Cairo.ImageSurface.
 * Implements the Canvas 2D API for GJS.
 */
export class CanvasRenderingContext2D {
    readonly canvas: any;

    private _surface: Cairo.ImageSurface;
    private _ctx: Cairo.Context;
    private _state: CanvasState;
    private _stateStack: CanvasState[] = [];
    private _surfaceWidth: number;
    private _surfaceHeight: number;

    constructor(canvas: any, _options?: any) {
        this.canvas = canvas;
        this._surfaceWidth = canvas.width || 300;
        this._surfaceHeight = canvas.height || 150;
        this._surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, this._surfaceWidth, this._surfaceHeight);
        this._ctx = new Cairo.Context(this._surface);
        this._state = createDefaultState();
    }

    // ---- Internal helpers ----

    /** Ensure the surface matches the current canvas dimensions. Recreate if resized. */
    private _ensureSurface(): void {
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
    private _applyFillStyle(): void {
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
    private _applyStrokeStyle(): void {
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
    private _applyPatternFilter(): void {
        const pat = (this._ctx as any).getSource?.();
        if (pat && typeof pat.setFilter === 'function') {
            let filter: number;
            if (!this._state.imageSmoothingEnabled) {
                filter = Cairo.Filter.NEAREST as unknown as number;
            } else if (this._state.imageSmoothingQuality === 'high') {
                filter = Cairo.Filter.BEST as unknown as number;
            } else {
                filter = Cairo.Filter.BILINEAR as unknown as number;
            }
            pat.setFilter(filter);
        }
    }

    /** Apply line properties to the Cairo context. */
    private _applyLineStyle(): void {
        this._ctx.setLineWidth(this._state.lineWidth);
        this._ctx.setLineCap(LINE_CAP_MAP[this._state.lineCap] as Cairo.LineCap);
        this._ctx.setLineJoin(LINE_JOIN_MAP[this._state.lineJoin] as Cairo.LineJoin);
        this._ctx.setMiterLimit(this._state.miterLimit);
        this._ctx.setDash(this._state.lineDash, this._state.lineDashOffset);
    }

    /** Apply compositing operator. */
    private _applyCompositing(): void {
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
    private _hasShadow(): boolean {
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
    private _deviceToUserDistance(dx: number, dy: number): [number, number] {
        const origin = (this._ctx as any).userToDevice(0, 0);
        const xAxis  = (this._ctx as any).userToDevice(1, 0);
        const yAxis  = (this._ctx as any).userToDevice(0, 1);
        const a = (xAxis[0] ?? 0) - (origin[0] ?? 0);
        const b = (xAxis[1] ?? 0) - (origin[1] ?? 0);
        const c = (yAxis[0] ?? 0) - (origin[0] ?? 0);
        const d = (yAxis[1] ?? 0) - (origin[1] ?? 0);
        const det = a * d - b * c;
        if (Math.abs(det) < 1e-10) return [dx, dy]; // degenerate transform — no conversion
        return [
            ( d * dx - c * dy) / det,
            (-b * dx + a * dy) / det,
        ];
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
    private _renderShadow(_drawOp: () => void): void {
        // Intentionally empty. See the doc-comment above.
    }

    // ---- State ----

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

    // ---- Transforms ----

    translate(x: number, y: number): void {
        this._ensureSurface();
        this._ctx.translate(x, y);
    }

    rotate(angle: number): void {
        this._ensureSurface();
        this._ctx.rotate(angle);
    }

    scale(x: number, y: number): void {
        this._ensureSurface();
        this._ctx.scale(x, y);
    }

    /**
     * Multiply the current transformation matrix by the given values.
     * Matrix: [a c e]
     *         [b d f]
     *         [0 0 1]
     */
    transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
        this._ensureSurface();
        // Guard against NaN / undefined / Infinity — Cairo will hard-crash
        // on invalid matrix values.
        if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) ||
            !Number.isFinite(d) || !Number.isFinite(e) || !Number.isFinite(f)) {
            return;
        }
        // Cairo.Context in GJS does NOT expose a generic `transform(matrix)` /
        // `setMatrix()` call — only `translate()`, `rotate()`, `scale()` and
        // `identityMatrix()`. So we decompose the affine 2D matrix
        //   [a c e]
        //   [b d f]
        //   [0 0 1]
        // into translate + rotate + scale (ignoring shear, which Excalibur /
        // three.js 2D users don't rely on). Shear would require a combined
        // matrix multiply, which isn't available in this binding.
        const tx = e;
        const ty = f;
        const sx = Math.hypot(a, b);
        const sy = Math.hypot(c, d);
        const rotation = Math.atan2(b, a);
        this._ctx.translate(tx, ty);
        if (rotation !== 0) this._ctx.rotate(rotation);
        if (sx !== 1 || sy !== 1) this._ctx.scale(sx, sy);
    }

    /**
     * Reset the transform to identity, then apply the given matrix.
     */
    setTransform(matrix?: DOMMatrix2DInit): void;
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    setTransform(a?: number | DOMMatrix2DInit, b?: number, c?: number, d?: number, e?: number, f?: number): void {
        this._ensureSurface();
        if (typeof a === 'object' && a !== null) {
            const m = a;
            this._ctx.identityMatrix();
            this.transform(
                m.a ?? m.m11 ?? 1, m.b ?? m.m12 ?? 0,
                m.c ?? m.m21 ?? 0, m.d ?? m.m22 ?? 1,
                m.e ?? m.m41 ?? 0, m.f ?? m.m42 ?? 0,
            );
        } else if (typeof a === 'number') {
            this._ctx.identityMatrix();
            this.transform(a, b!, c!, d!, e!, f!);
        } else {
            this._ctx.identityMatrix();
        }
    }

    /**
     * Return the current transformation matrix as a DOMMatrix-like object.
     */
    getTransform(): DOMMatrix {
        // Cairo.Context in GJS doesn't expose `getMatrix()`, but it does
        // expose `userToDevice(x, y)`. We reconstruct the current affine
        // matrix [a,b,c,d,e,f] by transforming three reference points:
        //   userToDevice(0, 0) = (e,     f)      — translation
        //   userToDevice(1, 0) = (a + e, b + f)  — first basis vector
        //   userToDevice(0, 1) = (c + e, d + f)  — second basis vector
        const origin = (this._ctx as any).userToDevice(0, 0);
        const xAxis  = (this._ctx as any).userToDevice(1, 0);
        const yAxis  = (this._ctx as any).userToDevice(0, 1);
        const e = origin[0] ?? 0;
        const f = origin[1] ?? 0;
        const a = (xAxis[0] ?? 0) - e;
        const b = (xAxis[1] ?? 0) - f;
        const c = (yAxis[0] ?? 0) - e;
        const d = (yAxis[1] ?? 0) - f;

        const DOMMatrixCtor = (globalThis as any).DOMMatrix;
        if (typeof DOMMatrixCtor === 'function') {
            return new DOMMatrixCtor([a, b, c, d, e, f]);
        }
        return {
            a, b, c, d, e, f,
            m11: a, m12: b, m13: 0, m14: 0,
            m21: c, m22: d, m23: 0, m24: 0,
            m31: 0, m32: 0, m33: 1, m34: 0,
            m41: e, m42: f, m43: 0, m44: 1,
            is2D: true,
            isIdentity: (a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0),
        } as any;
    }

    resetTransform(): void {
        this._ensureSurface();
        this._ctx.identityMatrix();
    }

    // ---- Style properties ----

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

    get lineWidth(): number { return this._state.lineWidth; }
    set lineWidth(value: number) {
        if (value > 0 && isFinite(value)) this._state.lineWidth = value;
    }

    get lineCap(): CanvasLineCap { return this._state.lineCap; }
    set lineCap(value: CanvasLineCap) {
        if (value === 'butt' || value === 'round' || value === 'square') {
            this._state.lineCap = value;
        }
    }

    get lineJoin(): CanvasLineJoin { return this._state.lineJoin; }
    set lineJoin(value: CanvasLineJoin) {
        if (value === 'miter' || value === 'round' || value === 'bevel') {
            this._state.lineJoin = value;
        }
    }

    get miterLimit(): number { return this._state.miterLimit; }
    set miterLimit(value: number) {
        if (value > 0 && isFinite(value)) this._state.miterLimit = value;
    }

    get globalAlpha(): number { return this._state.globalAlpha; }
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

    get imageSmoothingEnabled(): boolean { return this._state.imageSmoothingEnabled; }
    set imageSmoothingEnabled(value: boolean) { this._state.imageSmoothingEnabled = !!value; }

    get imageSmoothingQuality(): ImageSmoothingQuality { return this._state.imageSmoothingQuality; }
    set imageSmoothingQuality(value: ImageSmoothingQuality) {
        if (value === 'low' || value === 'medium' || value === 'high') {
            this._state.imageSmoothingQuality = value;
        }
    }

    // Line dash
    setLineDash(segments: number[]): void {
        // Per spec, ignore if any value is negative or non-finite
        if (segments.some(v => v < 0 || !isFinite(v))) return;
        this._state.lineDash = [...segments];
    }

    getLineDash(): number[] {
        return [...this._state.lineDash];
    }

    get lineDashOffset(): number { return this._state.lineDashOffset; }
    set lineDashOffset(value: number) {
        if (isFinite(value)) this._state.lineDashOffset = value;
    }

    // ---- Shadow properties (stored in state, rendering in Phase 5) ----
    get shadowColor(): string { return this._state.shadowColor; }
    set shadowColor(value: string) { this._state.shadowColor = value; }
    get shadowBlur(): number { return this._state.shadowBlur; }
    set shadowBlur(value: number) { if (value >= 0 && isFinite(value)) this._state.shadowBlur = value; }
    get shadowOffsetX(): number { return this._state.shadowOffsetX; }
    set shadowOffsetX(value: number) { if (isFinite(value)) this._state.shadowOffsetX = value; }
    get shadowOffsetY(): number { return this._state.shadowOffsetY; }
    set shadowOffsetY(value: number) { if (isFinite(value)) this._state.shadowOffsetY = value; }

    // ---- Text properties (stored in state, rendering in Phase 4) ----
    get font(): string { return this._state.font; }
    set font(value: string) { this._state.font = value; }
    get textAlign(): CanvasTextAlign { return this._state.textAlign; }
    set textAlign(value: CanvasTextAlign) { this._state.textAlign = value; }
    get textBaseline(): CanvasTextBaseline { return this._state.textBaseline; }
    set textBaseline(value: CanvasTextBaseline) { this._state.textBaseline = value; }
    get direction(): CanvasDirection { return this._state.direction; }
    set direction(value: CanvasDirection) { this._state.direction = value; }

    // ---- Path methods ----

    beginPath(): void {
        this._ensureSurface();
        this._ctx.newPath();
    }

    moveTo(x: number, y: number): void {
        this._ensureSurface();
        this._ctx.moveTo(x, y);
    }

    lineTo(x: number, y: number): void {
        this._ensureSurface();
        this._ctx.lineTo(x, y);
    }

    closePath(): void {
        this._ensureSurface();
        this._ctx.closePath();
    }

    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
        this._ensureSurface();
        this._ctx.curveTo(cp1x, cp1y, cp2x, cp2y, x, y);
    }

    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
        this._ensureSurface();
        let cx: number, cy: number;
        if (this._ctx.hasCurrentPoint()) {
            [cx, cy] = this._ctx.getCurrentPoint();
        } else {
            cx = cpx;
            cy = cpy;
        }
        const { cp1x, cp1y, cp2x, cp2y } = quadraticToCubic(cx, cy, cpx, cpy, x, y);
        this._ctx.curveTo(cp1x, cp1y, cp2x, cp2y, x, y);
    }

    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise = false): void {
        this._ensureSurface();
        // Browsers draw a full circle when |endAngle - startAngle| >= 2π,
        // regardless of direction. Cairo's arcNegative would produce a
        // zero-length arc for arcNegative(x,y,r,0,2π) because it normalizes
        // endAngle to be < startAngle, collapsing the arc to nothing.
        if (Math.abs(endAngle - startAngle) >= 2 * Math.PI) {
            this._ctx.arc(x, y, radius, 0, 2 * Math.PI);
            return;
        }
        if (counterclockwise) {
            this._ctx.arcNegative(x, y, radius, startAngle, endAngle);
        } else {
            this._ctx.arc(x, y, radius, startAngle, endAngle);
        }
    }

    arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
        this._ensureSurface();
        let x0: number, y0: number;
        if (this._ctx.hasCurrentPoint()) {
            [x0, y0] = this._ctx.getCurrentPoint();
        } else {
            x0 = x1;
            y0 = y1;
            this._ctx.moveTo(x1, y1);
        }
        cairoArcTo(this._ctx, x0, y0, x1, y1, x2, y2, radius);
    }

    ellipse(
        x: number, y: number,
        radiusX: number, radiusY: number,
        rotation: number,
        startAngle: number, endAngle: number,
        counterclockwise = false,
    ): void {
        this._ensureSurface();
        if (radiusX < 0 || radiusY < 0) {
            throw new RangeError('The radii provided are negative');
        }
        cairoEllipse(this._ctx, x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise);
    }

    rect(x: number, y: number, w: number, h: number): void {
        this._ensureSurface();
        this._ctx.rectangle(x, y, w, h);
    }

    roundRect(x: number, y: number, w: number, h: number, radii: number | number[] = 0): void {
        this._ensureSurface();
        cairoRoundRect(this._ctx, x, y, w, h, radii);
    }

    // ---- Drawing methods ----

    fill(fillRule?: CanvasFillRule): void;
    fill(path: Path2D, fillRule?: CanvasFillRule): void;
    fill(pathOrRule?: Path2D | CanvasFillRule, fillRule?: CanvasFillRule): void {
        this._ensureSurface();
        this._applyCompositing();
        this._applyFillStyle();

        let rule: CanvasFillRule | undefined;
        if (pathOrRule instanceof Path2D) {
            this._ctx.newPath();
            pathOrRule._replayOnCairo(this._ctx);
            rule = fillRule;
        } else {
            rule = pathOrRule;
        }

        this._ctx.setFillRule(rule === 'evenodd' ? Cairo.FillRule.EVEN_ODD : Cairo.FillRule.WINDING);
        this._ctx.fillPreserve();
    }

    stroke(): void;
    stroke(path: Path2D): void;
    stroke(path?: Path2D): void {
        this._ensureSurface();
        this._applyCompositing();
        this._applyStrokeStyle();
        this._applyLineStyle();

        if (path instanceof Path2D) {
            this._ctx.newPath();
            path._replayOnCairo(this._ctx);
        }

        this._ctx.strokePreserve();
    }

    fillRect(x: number, y: number, w: number, h: number): void {
        this._ensureSurface();
        this._applyCompositing();
        // Per spec: fillRect must not affect the current path.
        // Save current path, draw the rect in an isolated path, then restore.
        const savedPath = this._ctx.copyPath();
        if (this._hasShadow()) {
            this._renderShadow(() => {
                this._ctx.newPath();
                this._ctx.rectangle(x, y, w, h);
                this._ctx.fill();
            });
        }
        this._applyFillStyle();
        this._ctx.newPath();
        this._ctx.rectangle(x, y, w, h);
        this._ctx.fill();
        this._ctx.newPath();
        this._ctx.appendPath(savedPath);
    }

    strokeRect(x: number, y: number, w: number, h: number): void {
        this._ensureSurface();
        this._applyCompositing();
        // Per spec: strokeRect must not affect the current path.
        const savedPath = this._ctx.copyPath();
        if (this._hasShadow()) {
            this._renderShadow(() => {
                this._ctx.newPath();
                this._ctx.rectangle(x, y, w, h);
                this._ctx.stroke();
            });
        }
        this._applyStrokeStyle();
        this._applyLineStyle();
        this._ctx.newPath();
        this._ctx.rectangle(x, y, w, h);
        this._ctx.stroke();
        this._ctx.newPath();
        this._ctx.appendPath(savedPath);
    }

    clearRect(x: number, y: number, w: number, h: number): void {
        this._ensureSurface();
        // Per spec: clearRect must not affect the current path.
        const savedPath = this._ctx.copyPath();
        this._ctx.save();
        this._ctx.setOperator(Cairo.Operator.CLEAR);
        this._ctx.newPath();
        this._ctx.rectangle(x, y, w, h);
        this._ctx.fill();
        this._ctx.restore();
        this._ctx.newPath();
        this._ctx.appendPath(savedPath);
    }

    // ---- Clipping ----

    clip(fillRule?: CanvasFillRule): void;
    clip(path: Path2D, fillRule?: CanvasFillRule): void;
    clip(pathOrRule?: Path2D | CanvasFillRule, fillRule?: CanvasFillRule): void {
        this._ensureSurface();
        let rule: CanvasFillRule | undefined;
        if (pathOrRule instanceof Path2D) {
            this._ctx.newPath();
            pathOrRule._replayOnCairo(this._ctx);
            rule = fillRule;
        } else {
            rule = pathOrRule;
        }
        this._ctx.setFillRule(rule === 'evenodd' ? Cairo.FillRule.EVEN_ODD : Cairo.FillRule.WINDING);
        this._ctx.clip();
    }

    // ---- Hit testing ----

    isPointInPath(x: number, y: number, fillRule?: CanvasFillRule): boolean;
    isPointInPath(path: Path2D, x: number, y: number, fillRule?: CanvasFillRule): boolean;
    isPointInPath(pathOrX: Path2D | number, xOrY: number, fillRuleOrY?: CanvasFillRule | number, fillRule?: CanvasFillRule): boolean {
        this._ensureSurface();
        let x: number, y: number, rule: CanvasFillRule | undefined;
        if (pathOrX instanceof Path2D) {
            this._ctx.newPath();
            pathOrX._replayOnCairo(this._ctx);
            x = xOrY; y = fillRuleOrY as number; rule = fillRule;
        } else {
            x = pathOrX; y = xOrY; rule = fillRuleOrY as CanvasFillRule | undefined;
        }
        this._ctx.setFillRule(rule === 'evenodd' ? Cairo.FillRule.EVEN_ODD : Cairo.FillRule.WINDING);
        return this._ctx.inFill(x, y);
    }

    isPointInStroke(x: number, y: number): boolean;
    isPointInStroke(path: Path2D, x: number, y: number): boolean;
    isPointInStroke(pathOrX: Path2D | number, xOrY: number, y?: number): boolean {
        this._ensureSurface();
        this._applyLineStyle();
        if (pathOrX instanceof Path2D) {
            this._ctx.newPath();
            pathOrX._replayOnCairo(this._ctx);
            return this._ctx.inStroke(xOrY, y!);
        }
        return this._ctx.inStroke(pathOrX, xOrY);
    }

    // ---- Gradient / Pattern factories ----

    createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient {
        return new OurCanvasGradient('linear', x0, y0, x1, y1) as any;
    }

    createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): CanvasGradient {
        return new OurCanvasGradient('radial', x0, y0, x1, y1, r0, r1) as any;
    }

    createPattern(image: any, repetition: string | null): CanvasPattern | null {
        return OurCanvasPattern.create(image, repetition) as any;
    }

    // ---- Image data methods ----

    createImageData(sw: number, sh: number): ImageData;
    createImageData(imagedata: ImageData): ImageData;
    createImageData(swOrImageData: number | ImageData, sh?: number): ImageData {
        if (typeof swOrImageData === 'number') {
            return new OurImageData(Math.abs(swOrImageData), Math.abs(sh!)) as any;
        }
        return new OurImageData(swOrImageData.width, swOrImageData.height) as any;
    }

    getImageData(sx: number, sy: number, sw: number, sh: number): ImageData {
        this._ensureSurface();
        this._surface.flush();

        // Use Gdk.pixbuf_get_from_surface to read pixels
        const pixbuf = Gdk.pixbuf_get_from_surface(this._surface, sx, sy, sw, sh);
        if (!pixbuf) {
            return new OurImageData(sw, sh) as any;
        }

        const pixels = pixbuf.get_pixels();
        const hasAlpha = pixbuf.get_has_alpha();
        const rowstride = pixbuf.get_rowstride();
        const nChannels = pixbuf.get_n_channels();
        const out = new Uint8ClampedArray(sw * sh * 4);

        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                const srcIdx = y * rowstride + x * nChannels;
                const dstIdx = (y * sw + x) * 4;
                out[dstIdx] = pixels[srcIdx];         // R
                out[dstIdx + 1] = pixels[srcIdx + 1]; // G
                out[dstIdx + 2] = pixels[srcIdx + 2]; // B
                out[dstIdx + 3] = hasAlpha ? pixels[srcIdx + 3] : 255; // A
            }
        }

        return new OurImageData(out, sw, sh) as any;
    }

    putImageData(imageData: ImageData, dx: number, dy: number, dirtyX?: number, dirtyY?: number, dirtyWidth?: number, dirtyHeight?: number): void {
        this._ensureSurface();

        // Determine the dirty region
        const sx = dirtyX ?? 0;
        const sy = dirtyY ?? 0;
        const sw = dirtyWidth ?? imageData.width;
        const sh = dirtyHeight ?? imageData.height;

        // Create a GdkPixbuf from the ImageData RGBA
        const srcData = imageData.data;
        const srcWidth = imageData.width;

        // Create a temporary buffer for the dirty region (RGBA, no padding)
        const regionData = new Uint8Array(sw * sh * 4);
        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) {
                const srcIdx = ((sy + y) * srcWidth + (sx + x)) * 4;
                const dstIdx = (y * sw + x) * 4;
                regionData[dstIdx] = srcData[srcIdx];
                regionData[dstIdx + 1] = srcData[srcIdx + 1];
                regionData[dstIdx + 2] = srcData[srcIdx + 2];
                regionData[dstIdx + 3] = srcData[srcIdx + 3];
            }
        }

        const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(
            regionData as unknown as import('@girs/glib-2.0').default.Bytes,
            GdkPixbuf.Colorspace.RGB,
            true, // has_alpha
            8,    // bits_per_sample
            sw,
            sh,
            sw * 4, // rowstride
        );

        // putImageData per spec ignores compositing — always uses SOURCE operator
        this._ctx.save();
        this._ctx.setOperator(Cairo.Operator.SOURCE);
        Gdk.cairo_set_source_pixbuf(this._ctx as any, pixbuf, dx + sx, dy + sy);
        this._ctx.rectangle(dx + sx, dy + sy, sw, sh);
        this._ctx.fill();
        this._ctx.restore();
    }

    // ---- drawImage ----

    drawImage(image: any, dx: number, dy: number): void;
    drawImage(image: any, dx: number, dy: number, dw: number, dh: number): void;
    drawImage(image: any, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
    drawImage(
        image: any,
        a1: number, a2: number,
        a3?: number, a4?: number,
        a5?: number, a6?: number,
        a7?: number, a8?: number,
    ): void {
        this._ensureSurface();
        this._applyCompositing();

        let sx: number, sy: number, sw: number, sh: number;
        let dx: number, dy: number, dw: number, dh: number;

        // Get source surface/pixbuf
        const sourceInfo = this._getDrawImageSource(image);
        if (!sourceInfo) return;
        const { pixbuf, imgWidth, imgHeight } = sourceInfo;

        if (a3 === undefined) {
            // drawImage(image, dx, dy)
            sx = 0; sy = 0; sw = imgWidth; sh = imgHeight;
            dx = a1; dy = a2; dw = imgWidth; dh = imgHeight;
        } else if (a5 === undefined) {
            // drawImage(image, dx, dy, dw, dh)
            sx = 0; sy = 0; sw = imgWidth; sh = imgHeight;
            dx = a1; dy = a2; dw = a3; dh = a4!;
        } else {
            // drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh)
            sx = a1; sy = a2; sw = a3; sh = a4!;
            dx = a5; dy = a6!; dw = a7!; dh = a8!;
        }

        // Spec: drawImage with any zero-width/height source or destination
        // rectangle is a no-op (and MUST NOT throw). Without this guard,
        // `scale(dw / sw, dh / sh)` produces 0 or Infinity which Cairo
        // rejects with "invalid matrix (not invertible)".
        if (sw === 0 || sh === 0 || dw === 0 || dh === 0) {
            return;
        }

        // Clip to the destination rectangle so the source pattern is only
        // painted inside it; this lets us use paint() (which fills the
        // entire clip) + paintWithAlpha() for globalAlpha support.
        this._ctx.save();
        this._ctx.rectangle(dx, dy, dw, dh);
        this._ctx.clip();

        // Scale the source to fill the destination
        this._ctx.translate(dx, dy);
        this._ctx.scale(dw / sw, dh / sh);
        this._ctx.translate(-sx, -sy);

        Gdk.cairo_set_source_pixbuf(this._ctx as any, pixbuf, 0, 0);

        // Apply Cairo interpolation filter based on imageSmoothingEnabled +
        // imageSmoothingQuality. setSource installs a fresh SurfacePattern and
        // resets any filter to Cairo's default (BILINEAR), so setFilter MUST
        // be called between setSource and paint. Without this, Excalibur's
        // pixel-art mode (imageSmoothingEnabled=false) renders blurry because
        // Cairo uses bilinear interpolation by default.
        //
        // Cairo.Filter values (verified runtime in GJS 1.86):
        //   FAST=0  GOOD=1  BEST=2  NEAREST=3  BILINEAR=4  GAUSSIAN=5
        // GIR typings are incomplete for Cairo.SurfacePattern so we go via any.
        const pat = (this._ctx as any).getSource?.();
        if (pat && typeof pat.setFilter === 'function') {
            let filter: number;
            if (!this._state.imageSmoothingEnabled) {
                filter = Cairo.Filter.NEAREST as unknown as number;
            } else if (this._state.imageSmoothingQuality === 'high') {
                filter = Cairo.Filter.BEST as unknown as number;
            } else {
                filter = Cairo.Filter.BILINEAR as unknown as number;
            }
            pat.setFilter(filter);
        }

        // paint() vs fill(): paint() composites the current source over the
        // current clip region uniformly, honoring paintWithAlpha for global
        // alpha multiplication. fill() would require a rectangle path and
        // doesn't support per-draw alpha, so paint() is the spec-correct
        // choice for drawImage. The clip above confines the paint to dx,dy,dw,dh.
        if (this._state.globalAlpha < 1) {
            (this._ctx as any).paintWithAlpha(this._state.globalAlpha);
        } else {
            this._ctx.paint();
        }
        this._ctx.restore();
    }

    private _getDrawImageSource(image: any): { pixbuf: GdkPixbuf.Pixbuf; imgWidth: number; imgHeight: number } | null {
        // HTMLImageElement (GdkPixbuf-backed)
        if (typeof image?.isPixbuf === 'function' && image.isPixbuf()) {
            const pixbuf = image._pixbuf as GdkPixbuf.Pixbuf;
            return { pixbuf, imgWidth: pixbuf.get_width(), imgHeight: pixbuf.get_height() };
        }

        // HTMLCanvasElement with a 2D context
        if (typeof image?.getContext === 'function') {
            const ctx2d = image.getContext('2d');
            if (ctx2d && typeof ctx2d._getSurface === 'function') {
                const surface = ctx2d._getSurface() as Cairo.ImageSurface;
                surface.flush();
                const pixbuf = Gdk.pixbuf_get_from_surface(surface, 0, 0, image.width, image.height);
                if (pixbuf) {
                    return { pixbuf, imgWidth: image.width, imgHeight: image.height };
                }
            }
        }

        return null;
    }

    // ---- Text methods (PangoCairo) ----

    /** Create a PangoCairo layout configured with current font/text settings. */
    private _createTextLayout(text: string): Pango.Layout {
        const layout = PangoCairo.create_layout(this._ctx as any);
        layout.set_text(text, -1);

        // Force LTR base direction so text is never rendered mirrored
        // regardless of system locale or Pango context defaults.
        const pangoCtx = layout.get_context();
        pangoCtx.set_base_dir(Pango.Direction.LTR);
        layout.context_changed();

        // Parse CSS font string into Pango font description
        const fontDesc = this._parseFontToDescription(this._state.font);
        layout.set_font_description(fontDesc);

        return layout;
    }

    /** Parse a CSS font string (e.g. "bold 16px Arial") into a Pango.FontDescription. */
    private _parseFontToDescription(cssFont: string): Pango.FontDescription {
        // CSS font: [style] [variant] [weight] size[/line-height] family[, family...]
        const match = cssFont.match(
            /^\s*(italic|oblique|normal)?\s*(small-caps|normal)?\s*(bold|bolder|lighter|[1-9]00|normal)?\s*(\d+(?:\.\d+)?)(px|pt|em|rem|%)?\s*(?:\/\S+)?\s*(.+)?$/i
        );

        if (!match) {
            // Fallback: pass directly to Pango (may have DPI-scaling quirks)
            return Pango.font_description_from_string(cssFont);
        }

        const style  = match[1] || '';
        const weight = match[3] || '';
        let   size   = parseFloat(match[4]) || 10;
        const unit   = (match[5] || 'px').toLowerCase();
        const family = (match[6] || 'sans-serif').replace(/['"]/g, '').trim();

        // Normalise everything to CSS pixels.
        // We use set_absolute_size() below which bypasses Pango's DPI scaling,
        // so 1 CSS pixel == 1 device pixel on a 1:1 surface (standard for Canvas2D).
        if      (unit === 'pt')            size = size * 96 / 72;  // 1pt = 96/72 px
        else if (unit === 'em' || unit === 'rem') size = size * 16; // assume 16px base
        else if (unit === '%')             size = (size / 100) * 16;
        // 'px' stays as-is

        // Build description string WITHOUT size — size is set via set_absolute_size.
        let pangoStr = family;
        if (style === 'italic')  pangoStr += ' Italic';
        else if (style === 'oblique') pangoStr += ' Oblique';
        if (weight === 'bold' || weight === 'bolder' || parseInt(weight) >= 600) pangoStr += ' Bold';
        else if (weight === 'lighter' || (parseInt(weight) > 0 && parseInt(weight) <= 300)) pangoStr += ' Light';

        const desc = Pango.font_description_from_string(pangoStr);
        // Absolute size: Pango.SCALE units per device pixel, no DPI conversion.
        // This ensures "9px Round9x13" renders at exactly 9 pixels — pixel-perfect.
        desc.set_absolute_size(size * Pango.SCALE);
        return desc;
    }

    /**
     * Compute the x-offset for text alignment relative to the given x coordinate.
     */
    private _getTextAlignOffset(layout: Pango.Layout): number {
        const [, logicalRect] = layout.get_pixel_extents();
        const width = logicalRect.width;

        switch (this._state.textAlign) {
            case 'center': return -width / 2;
            case 'right':
            case 'end': return -width;
            case 'left':
            case 'start':
            default: return 0;
        }
    }

    /**
     * Compute the y-offset for text baseline positioning.
     *
     * PangoCairo.show_layout() places the layout TOP-LEFT at the current Cairo point
     * (not the baseline). Within the layout, the first line's baseline is at
     * approximately `ascent` pixels below the layout top.
     *
     * For CSS textBaseline semantics, we shift the current point UP (negative offset)
     * so the layout top lands at the right position relative to the user's y coordinate.
     */
    private _getTextBaselineOffset(layout: Pango.Layout): number {
        const fontDesc = layout.get_font_description() || this._parseFontToDescription(this._state.font);
        const context = layout.get_context();
        const metrics = context.get_metrics(fontDesc, null);
        const ascent = metrics.get_ascent() / Pango.SCALE;
        const descent = metrics.get_descent() / Pango.SCALE;
        const height = ascent + descent;

        // layout top = current point; baseline within layout ≈ ascent below top.
        // yOff is added to user's y to get the layout top-left y.
        switch (this._state.textBaseline) {
            case 'top':          return 0;                      // top of em square = y
            case 'hanging':      return -(ascent * 0.2);        // hanging ≈ 0.2*ascent below top
            case 'middle':       return -(height / 2);          // center of em square = y
            case 'alphabetic':   return -ascent;                 // baseline = y
            case 'ideographic':  return -(ascent + descent * 0.5); // below alphabetic baseline
            case 'bottom':       return -height;                 // bottom of em square = y
            default:             return -ascent;                 // default = alphabetic
        }
    }

    fillText(text: string, x: number, y: number, _maxWidth?: number): void {
        this._ensureSurface();
        this._applyCompositing();

        const layout = this._createTextLayout(text);
        const xOff = this._getTextAlignOffset(layout);
        const yOff = this._getTextBaselineOffset(layout);

        // Shadow pass: draw text at offset position with shadowColor.
        // shadowOffsetX/Y are in CSS pixels (not scaled by CTM per Canvas2D spec),
        // so we convert them to user-space before applying to moveTo.
        // No Gaussian blur — offset-only shadow is sufficient for game text labels.
        if (this._hasShadow()) {
            const sc = parseColor(this._state.shadowColor);
            if (sc) {
                const [sdx, sdy] = this._deviceToUserDistance(
                    this._state.shadowOffsetX,
                    this._state.shadowOffsetY,
                );
                this._ctx.save();
                (this._ctx as any).setAntialias(this._state.imageSmoothingEnabled ? Cairo.Antialias.DEFAULT : Cairo.Antialias.NONE);
                this._ctx.setSourceRGBA(sc.r, sc.g, sc.b, sc.a);
                this._ctx.moveTo(x + xOff + sdx, y + yOff + sdy);
                PangoCairo.show_layout(this._ctx as any, layout);
                this._ctx.restore();
            }
        }

        this._applyFillStyle();
        this._ctx.save();
        // Disable anti-aliasing so pixel/bitmap fonts render crisp (matching browser
        // behaviour for fonts with no outline hints). cairo_save/restore covers antialias.
        (this._ctx as any).setAntialias(this._state.imageSmoothingEnabled ? Cairo.Antialias.DEFAULT : Cairo.Antialias.NONE);
        this._ctx.moveTo(x + xOff, y + yOff);
        PangoCairo.show_layout(this._ctx as any, layout);
        this._ctx.restore();
    }

    strokeText(text: string, x: number, y: number, _maxWidth?: number): void {
        this._ensureSurface();
        this._applyCompositing();
        this._applyStrokeStyle();
        this._applyLineStyle();

        const layout = this._createTextLayout(text);
        const xOff = this._getTextAlignOffset(layout);
        const yOff = this._getTextBaselineOffset(layout);

        this._ctx.save();
        (this._ctx as any).setAntialias(this._state.imageSmoothingEnabled ? Cairo.Antialias.DEFAULT : Cairo.Antialias.NONE);
        this._ctx.moveTo(x + xOff, y + yOff);
        PangoCairo.layout_path(this._ctx as any, layout);
        this._ctx.stroke();
        this._ctx.restore();
    }

    measureText(text: string): TextMetrics {
        this._ensureSurface();
        const layout = this._createTextLayout(text);
        const [inkRect, logicalRect] = layout.get_pixel_extents();

        // Baseline of first line in pixels from layout top (Pango.SCALE units → px).
        const baselinePx = layout.get_baseline() / Pango.SCALE;

        // actualBoundingBox: ink-based, relative to baseline (positive = above/right of baseline).
        // inkRect.y is pixels below layout top — compare against baseline to get baseline-relative values.
        const actualAscent  = Math.max(0, baselinePx - inkRect.y);
        const actualDescent = Math.max(0, (inkRect.y + inkRect.height) - baselinePx);

        // fontBoundingBox: font-level metrics (same for all glyphs at this font/size).
        const fontDesc = layout.get_font_description() || this._parseFontToDescription(this._state.font);
        const metrics = layout.get_context().get_metrics(fontDesc, null);
        const fontAscent  = metrics.get_ascent()  / Pango.SCALE;
        const fontDescent = metrics.get_descent() / Pango.SCALE;

        return {
            width: logicalRect.width,
            actualBoundingBoxAscent:  actualAscent,
            actualBoundingBoxDescent: actualDescent,
            actualBoundingBoxLeft:    Math.max(0, -inkRect.x),
            actualBoundingBoxRight:   inkRect.x + inkRect.width,
            fontBoundingBoxAscent:    fontAscent,
            fontBoundingBoxDescent:   fontDescent,
            alphabeticBaseline:       0,
            emHeightAscent:           fontAscent,
            emHeightDescent:          fontDescent,
            hangingBaseline:          fontAscent * 0.8,
            ideographicBaseline:      -fontDescent,
        };
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
            try { GLib.unlink(tempPath); } catch (_e) { /* ignore */ }
        }
    }

    // ---- Cleanup ----

    /** Release native Cairo resources. Call when the canvas is discarded. */
    _dispose(): void {
        this._ctx.$dispose();
        this._surface.finish();
    }
}
