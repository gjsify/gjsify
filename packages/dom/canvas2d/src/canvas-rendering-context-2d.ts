// CanvasRenderingContext2D implementation backed by Cairo
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D
// Reference: refs/node-canvas (Cairo-backed Canvas 2D for Node.js)

import Cairo from 'cairo';
import Gdk from 'gi://Gdk?version=4.0';
import GdkPixbuf from 'gi://GdkPixbuf';
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

    // ---- Transforms (Phase 2 — basic implementations included) ----

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

    fill(fillRule?: CanvasFillRule): void {
        this._ensureSurface();
        this._applyCompositing();
        this._applyFillStyle();
        if (fillRule === 'evenodd') {
            this._ctx.setFillRule(Cairo.FillRule.EVEN_ODD);
        } else {
            this._ctx.setFillRule(Cairo.FillRule.WINDING);
        }
        this._ctx.fillPreserve();
    }

    stroke(): void {
        this._ensureSurface();
        this._applyCompositing();
        this._applyStrokeStyle();
        this._applyLineStyle();
        this._ctx.strokePreserve();
    }

    fillRect(x: number, y: number, w: number, h: number): void {
        this._ensureSurface();
        this._applyCompositing();
        this._applyFillStyle();
        this._ctx.rectangle(x, y, w, h);
        this._ctx.fill();
    }

    strokeRect(x: number, y: number, w: number, h: number): void {
        this._ensureSurface();
        this._applyCompositing();
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

    clip(fillRule?: CanvasFillRule): void {
        this._ensureSurface();
        if (fillRule === 'evenodd') {
            this._ctx.setFillRule(Cairo.FillRule.EVEN_ODD);
        } else {
            this._ctx.setFillRule(Cairo.FillRule.WINDING);
        }
        this._ctx.clip();
    }

    // ---- Hit testing ----

    isPointInPath(x: number, y: number, fillRule?: CanvasFillRule): boolean {
        this._ensureSurface();
        if (fillRule === 'evenodd') {
            this._ctx.setFillRule(Cairo.FillRule.EVEN_ODD);
        } else {
            this._ctx.setFillRule(Cairo.FillRule.WINDING);
        }
        return this._ctx.inFill(x, y);
    }

    isPointInStroke(x: number, y: number): boolean {
        this._ensureSurface();
        this._applyLineStyle();
        return this._ctx.inStroke(x, y);
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

    // ---- Text methods (stub for Phase 4) ----

    fillText(_text: string, _x: number, _y: number, _maxWidth?: number): void {
        // Phase 4: PangoCairo text rendering
    }

    strokeText(_text: string, _x: number, _y: number, _maxWidth?: number): void {
        // Phase 4: PangoCairo text rendering
    }

    measureText(_text: string): TextMetrics {
        // Phase 4: Return proper measurements via Pango
        return {
            width: 0,
            actualBoundingBoxAscent: 0,
            actualBoundingBoxDescent: 0,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: 0,
            fontBoundingBoxAscent: 0,
            fontBoundingBoxDescent: 0,
            alphabeticBaseline: 0,
            emHeightAscent: 0,
            emHeightDescent: 0,
            hangingBaseline: 0,
            ideographicBaseline: 0,
        };
    }

    // ---- Cleanup ----

    /** Release native Cairo resources. Call when the canvas is discarded. */
    _dispose(): void {
        this._ctx.$dispose();
        this._surface.finish();
    }
}
