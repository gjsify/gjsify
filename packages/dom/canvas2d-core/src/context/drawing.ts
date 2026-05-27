// Drawing-primitive methods for CanvasRenderingContext2D: fill / stroke /
// fillRect / strokeRect / clearRect / clip / isPointInPath / isPointInStroke
// / drawImage.
//
// Reference: refs/node-canvas — Canvas 2D drawing primitives.
// Original: see canvas-rendering-context-2d.ts pre-split.

import Cairo from 'cairo';
import Gdk from 'gi://Gdk?version=4.0';
import type GdkPixbuf from 'gi://GdkPixbuf';

import type { CanvasRenderingContext2D } from '../canvas-rendering-context-2d.js';
import { asCairoPattern } from '../cairo-types.js';
import { isPixbufImageSource, isCanvasImageSource } from '../dom-types.js';
import { Path2D } from '../canvas-path.js';

export interface DrawingMethods {
    fill(fillRule?: CanvasFillRule): void;
    fill(path: Path2D, fillRule?: CanvasFillRule): void;
    stroke(): void;
    stroke(path: Path2D): void;
    fillRect(x: number, y: number, w: number, h: number): void;
    strokeRect(x: number, y: number, w: number, h: number): void;
    clearRect(x: number, y: number, w: number, h: number): void;
    clip(fillRule?: CanvasFillRule): void;
    clip(path: Path2D, fillRule?: CanvasFillRule): void;
    isPointInPath(x: number, y: number, fillRule?: CanvasFillRule): boolean;
    isPointInPath(path: Path2D, x: number, y: number, fillRule?: CanvasFillRule): boolean;
    isPointInStroke(x: number, y: number): boolean;
    isPointInStroke(path: Path2D, x: number, y: number): boolean;
    drawImage(image: unknown, dx: number, dy: number): void;
    drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
    drawImage(
        image: unknown,
        sx: number, sy: number, sw: number, sh: number,
        dx: number, dy: number, dw: number, dh: number,
    ): void;
}

declare module '../canvas-rendering-context-2d.js' {
    interface CanvasRenderingContext2D extends DrawingMethods { }
}

function getDrawImageSource(image: unknown): { pixbuf: GdkPixbuf.Pixbuf; imgWidth: number; imgHeight: number } | null {
    // HTMLImageElement (GdkPixbuf-backed)
    if (isPixbufImageSource(image)) {
        const pixbuf = image._pixbuf;
        return { pixbuf, imgWidth: pixbuf.get_width(), imgHeight: pixbuf.get_height() };
    }

    // HTMLCanvasElement with a 2D context
    if (isCanvasImageSource(image)) {
        const w = image.width ?? 0;
        const h = image.height ?? 0;
        // Reject non-positive / non-finite dimensions before they reach
        // GdkPixbuf — `pixbuf_get_from_surface` logs a GLib-CRITICAL on
        // `width > 0 && height > 0` assertion failure for NaN/0 inputs.
        if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
            return null;
        }
        const ctx2d = image.getContext('2d');
        if (ctx2d && typeof ctx2d._getSurface === 'function') {
            const surface = ctx2d._getSurface();
            surface.flush();
            const pixbuf = Gdk.pixbuf_get_from_surface(surface, 0, 0, w, h);
            if (pixbuf) {
                return { pixbuf, imgWidth: w, imgHeight: h };
            }
        }
    }

    return null;
}

const drawingMethods: DrawingMethods & ThisType<CanvasRenderingContext2D> = {
    fill(this: CanvasRenderingContext2D, pathOrRule?: Path2D | CanvasFillRule, fillRule?: CanvasFillRule): void {
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
    },

    stroke(this: CanvasRenderingContext2D, path?: Path2D): void {
        this._ensureSurface();
        this._applyCompositing();
        this._applyStrokeStyle();
        this._applyLineStyle();

        if (path instanceof Path2D) {
            this._ctx.newPath();
            path._replayOnCairo(this._ctx);
        }

        this._ctx.strokePreserve();
    },

    fillRect(this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
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
    },

    strokeRect(this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
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
    },

    clearRect(this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
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
    },

    clip(this: CanvasRenderingContext2D, pathOrRule?: Path2D | CanvasFillRule, fillRule?: CanvasFillRule): void {
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
    },

    isPointInPath(
        this: CanvasRenderingContext2D,
        pathOrX: Path2D | number, xOrY: number,
        fillRuleOrY?: CanvasFillRule | number, fillRule?: CanvasFillRule,
    ): boolean {
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
    },

    isPointInStroke(
        this: CanvasRenderingContext2D,
        pathOrX: Path2D | number, xOrY: number, y?: number,
    ): boolean {
        this._ensureSurface();
        this._applyLineStyle();
        if (pathOrX instanceof Path2D) {
            this._ctx.newPath();
            pathOrX._replayOnCairo(this._ctx);
            return this._ctx.inStroke(xOrY, y!);
        }
        return this._ctx.inStroke(pathOrX, xOrY);
    },

    drawImage(
        this: CanvasRenderingContext2D,
        image: unknown,
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
        const sourceInfo = getDrawImageSource(image);
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
        //
        // Non-finite (NaN / Infinity / -Infinity) inputs reach us when the
        // caller derives a dimension from a not-yet-resized canvas (e.g.
        // Excalibur's logo overlay computes `Math.min(logoWidth, n * 0.75)`
        // before the engine's pixelRatio / canvas size are known). Treat
        // them the same as 0: spec-correct, and avoids cascading Cairo
        // matrix failures that abort frames mid-paint.
        if (
            !Number.isFinite(sx) || !Number.isFinite(sy) ||
            !Number.isFinite(sw) || !Number.isFinite(sh) ||
            !Number.isFinite(dx) || !Number.isFinite(dy) ||
            !Number.isFinite(dw) || !Number.isFinite(dh) ||
            sw === 0 || sh === 0 || dw === 0 || dh === 0
        ) {
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

        Gdk.cairo_set_source_pixbuf(this._ctx, pixbuf, 0, 0);

        // Apply Cairo interpolation filter based on imageSmoothingEnabled +
        // imageSmoothingQuality. setSource installs a fresh SurfacePattern and
        // resets any filter to Cairo's default (BILINEAR), so setFilter MUST
        // be called between setSource and paint. Without this, Excalibur's
        // pixel-art mode (imageSmoothingEnabled=false) renders blurry because
        // Cairo uses bilinear interpolation by default.
        //
        // Cairo.Filter values (verified runtime in GJS 1.86):
        //   FAST=0  GOOD=1  BEST=2  NEAREST=3  BILINEAR=4  GAUSSIAN=5
        // GIR typings are missing setFilter on Pattern — `asCairoPattern`
        // narrows to the augmented shape (see cairo-types.ts).
        const pat = asCairoPattern(this._ctx.getSource?.());
        if (pat) {
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

        // paint() vs fill(): paint() composites the current source over the
        // current clip region uniformly, honoring paintWithAlpha for global
        // alpha multiplication. fill() would require a rectangle path and
        // doesn't support per-draw alpha, so paint() is the spec-correct
        // choice for drawImage. The clip above confines the paint to dx,dy,dw,dh.
        if (this._state.globalAlpha < 1) {
            this._ctx.paintWithAlpha(this._state.globalAlpha);
        } else {
            this._ctx.paint();
        }
        this._ctx.restore();
    },
};

/** Install drawing methods on CanvasRenderingContext2D.prototype. */
export function installDrawingMethods(proto: object): void {
    Object.assign(proto, drawingMethods);
}
