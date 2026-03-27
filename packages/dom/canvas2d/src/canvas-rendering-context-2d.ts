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
            this._state = createDefaultState();
            this._stateStack = [];
        }
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
     * Render a shadow for the current path by painting to a temp surface,
     * applying a simple box blur approximation, and compositing back.
     * This is called before the actual fill/stroke when shadows are active.
     */
    private _renderShadow(drawOp: () => void): void {
        const blur = this._state.shadowBlur;
        const offX = this._state.shadowOffsetX;
        const offY = this._state.shadowOffsetY;
        const color = parseColor(this._state.shadowColor);
        if (!color) return;

        const pad = Math.ceil(blur * 2);
        const w = this._surfaceWidth + pad * 2;
        const h = this._surfaceHeight + pad * 2;

        // Create temp surface for shadow
        const shadowSurface = new Cairo.ImageSurface(Cairo.Format.ARGB32, w, h);
        const shadowCtx = new Cairo.Context(shadowSurface);

        // Copy the current path/state to the shadow context and draw in shadow color
        shadowCtx.translate(pad, pad);
        shadowCtx.setSourceRGBA(color.r, color.g, color.b, color.a * this._state.globalAlpha);
        drawOp.call(this);
        // We can't easily replay the path on a different context without Path2D,
        // so shadow support is approximate: we just paint the shadow color under the actual draw
        shadowCtx.$dispose();
        shadowSurface.finish();

        // For now, apply shadow as a simple offset + color overlay
        // Full Gaussian blur would require pixel manipulation (Phase 5 enhancement)
        this._ctx.save();
        this._applyCompositing();
        this._ctx.setSourceRGBA(color.r, color.g, color.b, color.a * this._state.globalAlpha);
        this._ctx.translate(offX, offY);
        // Re-fill/stroke the current path with shadow color
        drawOp();
        this._ctx.restore();
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
        // Cairo's matrix constructor: Matrix(xx, yx, xy, yy, x0, y0)
        // Canvas matrix [a,b,c,d,e,f] maps to Cairo Matrix(a, b, c, d, e, f)
        const matrix = new Cairo.Matrix();
        (matrix as any).init(a, b, c, d, e, f);
        (this._ctx as any).transform(matrix);
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
        // Cairo doesn't expose getMatrix in GJS types, but it exists at runtime
        const m = (this._ctx as any).getMatrix?.();
        if (m) {
            // Cairo Matrix fields: xx, yx, xy, yy, x0, y0
            return {
                a: m.xx ?? 1, b: m.yx ?? 0,
                c: m.xy ?? 0, d: m.yy ?? 1,
                e: m.x0 ?? 0, f: m.y0 ?? 0,
                m11: m.xx ?? 1, m12: m.yx ?? 0,
                m13: 0, m14: 0,
                m21: m.xy ?? 0, m22: m.yy ?? 1,
                m23: 0, m24: 0,
                m31: 0, m32: 0, m33: 1, m34: 0,
                m41: m.x0 ?? 0, m42: m.y0 ?? 0,
                m43: 0, m44: 1,
                is2D: true,
                isIdentity: (m.xx === 1 && m.yx === 0 && m.xy === 0 && m.yy === 1 && m.x0 === 0 && m.y0 === 0),
            } as any;
        }
        // Fallback: return identity
        return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, is2D: true, isIdentity: true } as any;
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
        if (this._hasShadow()) {
            this._renderShadow(() => {
                this._ctx.rectangle(x, y, w, h);
                this._ctx.fill();
            });
        }
        this._applyFillStyle();
        this._ctx.rectangle(x, y, w, h);
        this._ctx.fill();
    }

    strokeRect(x: number, y: number, w: number, h: number): void {
        this._ensureSurface();
        this._applyCompositing();
        if (this._hasShadow()) {
            this._renderShadow(() => {
                this._ctx.rectangle(x, y, w, h);
                this._ctx.stroke();
            });
        }
        this._applyStrokeStyle();
        this._applyLineStyle();
        this._ctx.rectangle(x, y, w, h);
        this._ctx.stroke();
    }

    clearRect(x: number, y: number, w: number, h: number): void {
        this._ensureSurface();
        this._ctx.save();
        this._ctx.setOperator(Cairo.Operator.CLEAR);
        this._ctx.rectangle(x, y, w, h);
        this._ctx.fill();
        this._ctx.restore();
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

        // Scale the source to fill the destination
        this._ctx.save();
        this._ctx.translate(dx, dy);
        this._ctx.scale(dw / sw, dh / sh);
        this._ctx.translate(-sx, -sy);

        Gdk.cairo_set_source_pixbuf(this._ctx as any, pixbuf, 0, 0);
        this._ctx.rectangle(sx, sy, sw, sh);
        this._ctx.fill();
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

        // Parse CSS font string into Pango font description
        const fontDesc = this._parseFontToDescription(this._state.font);
        layout.set_font_description(fontDesc);

        return layout;
    }

    /** Parse a CSS font string (e.g. "bold 16px Arial") into a Pango.FontDescription. */
    private _parseFontToDescription(cssFont: string): Pango.FontDescription {
        // CSS font: [style] [variant] [weight] size[/line-height] family[, family...]
        // Pango expects: "Family Weight Style Size" format
        const match = cssFont.match(
            /^\s*(italic|oblique|normal)?\s*(small-caps|normal)?\s*(bold|bolder|lighter|[1-9]00|normal)?\s*(\d+(?:\.\d+)?)(px|pt|em|rem|%)?\s*(?:\/\S+)?\s*(.+)?$/i
        );

        if (!match) {
            // Fallback: pass directly to Pango
            return Pango.font_description_from_string(cssFont);
        }

        const style = match[1] || '';
        const weight = match[3] || '';
        let size = parseFloat(match[4]) || 10;
        const unit = match[5] || 'px';
        const family = (match[6] || 'sans-serif').replace(/['"]/g, '').trim();

        // Convert units to points (Pango uses points)
        if (unit === 'px') size = size * 0.75; // 1px = 0.75pt approximately
        else if (unit === 'em' || unit === 'rem') size = size * 12; // assume 16px base = 12pt
        else if (unit === '%') size = (size / 100) * 12;

        let pangoStr = family;
        if (style === 'italic') pangoStr += ' Italic';
        else if (style === 'oblique') pangoStr += ' Oblique';
        if (weight === 'bold' || weight === 'bolder' || (parseInt(weight) >= 600)) pangoStr += ' Bold';
        else if (weight === 'lighter' || (parseInt(weight) > 0 && parseInt(weight) <= 300)) pangoStr += ' Light';
        pangoStr += ` ${Math.round(size)}`;

        return Pango.font_description_from_string(pangoStr);
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
     */
    private _getTextBaselineOffset(layout: Pango.Layout): number {
        const fontDesc = layout.get_font_description() || this._parseFontToDescription(this._state.font);
        const context = layout.get_context();
        const metrics = context.get_metrics(fontDesc, null);
        const ascent = metrics.get_ascent() / Pango.SCALE;
        const descent = metrics.get_descent() / Pango.SCALE;
        const height = ascent + descent;

        switch (this._state.textBaseline) {
            case 'top': return ascent;
            case 'hanging': return ascent * 0.8;
            case 'middle': return ascent - height / 2;
            case 'alphabetic': return 0;
            case 'ideographic': return -descent * 0.5;
            case 'bottom': return -descent;
            default: return 0;
        }
    }

    fillText(text: string, x: number, y: number, _maxWidth?: number): void {
        this._ensureSurface();
        this._applyCompositing();
        this._applyFillStyle();

        const layout = this._createTextLayout(text);
        const xOff = this._getTextAlignOffset(layout);
        const yOff = this._getTextBaselineOffset(layout);

        this._ctx.save();
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
        this._ctx.moveTo(x + xOff, y + yOff);
        PangoCairo.layout_path(this._ctx as any, layout);
        this._ctx.stroke();
        this._ctx.restore();
    }

    measureText(text: string): TextMetrics {
        this._ensureSurface();
        const layout = this._createTextLayout(text);
        const [inkRect, logicalRect] = layout.get_pixel_extents();
        const fontDesc = layout.get_font_description() || this._parseFontToDescription(this._state.font);
        const context = layout.get_context();
        const metrics = context.get_metrics(fontDesc, null);
        const ascent = metrics.get_ascent() / Pango.SCALE;
        const descent = metrics.get_descent() / Pango.SCALE;

        return {
            width: logicalRect.width,
            actualBoundingBoxAscent: ascent,
            actualBoundingBoxDescent: descent,
            actualBoundingBoxLeft: -inkRect.x,
            actualBoundingBoxRight: inkRect.x + inkRect.width,
            fontBoundingBoxAscent: ascent,
            fontBoundingBoxDescent: descent,
            alphabeticBaseline: 0,
            emHeightAscent: ascent,
            emHeightDescent: descent,
            hangingBaseline: ascent * 0.8,
            ideographicBaseline: -descent,
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
