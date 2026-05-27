// Path-construction methods for CanvasRenderingContext2D.
// Reference: refs/node-canvas — Canvas 2D path API.
// Original: see canvas-rendering-context-2d.ts pre-split.

import type { CanvasRenderingContext2D } from '../canvas-rendering-context-2d.js';
import { quadraticToCubic, cairoArcTo, cairoEllipse, cairoRoundRect } from '../cairo-utils.js';

export interface PathMethods {
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    closePath(): void;
    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void;
    arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
    ellipse(
        x: number,
        y: number,
        radiusX: number,
        radiusY: number,
        rotation: number,
        startAngle: number,
        endAngle: number,
        counterclockwise?: boolean,
    ): void;
    rect(x: number, y: number, w: number, h: number): void;
    roundRect(x: number, y: number, w: number, h: number, radii?: number | number[]): void;
}

declare module '../canvas-rendering-context-2d.js' {
    interface CanvasRenderingContext2D extends PathMethods {}
}

const pathMethods: PathMethods & ThisType<CanvasRenderingContext2D> = {
    beginPath(this: CanvasRenderingContext2D): void {
        this._ensureSurface();
        this._ctx.newPath();
    },

    moveTo(this: CanvasRenderingContext2D, x: number, y: number): void {
        this._ensureSurface();
        this._ctx.moveTo(x, y);
    },

    lineTo(this: CanvasRenderingContext2D, x: number, y: number): void {
        this._ensureSurface();
        this._ctx.lineTo(x, y);
    },

    closePath(this: CanvasRenderingContext2D): void {
        this._ensureSurface();
        this._ctx.closePath();
    },

    bezierCurveTo(
        this: CanvasRenderingContext2D,
        cp1x: number,
        cp1y: number,
        cp2x: number,
        cp2y: number,
        x: number,
        y: number,
    ): void {
        this._ensureSurface();
        this._ctx.curveTo(cp1x, cp1y, cp2x, cp2y, x, y);
    },

    quadraticCurveTo(this: CanvasRenderingContext2D, cpx: number, cpy: number, x: number, y: number): void {
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
    },

    arc(
        this: CanvasRenderingContext2D,
        x: number,
        y: number,
        radius: number,
        startAngle: number,
        endAngle: number,
        counterclockwise = false,
    ): void {
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
    },

    arcTo(this: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, radius: number): void {
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
    },

    ellipse(
        this: CanvasRenderingContext2D,
        x: number,
        y: number,
        radiusX: number,
        radiusY: number,
        rotation: number,
        startAngle: number,
        endAngle: number,
        counterclockwise = false,
    ): void {
        this._ensureSurface();
        if (radiusX < 0 || radiusY < 0) {
            throw new RangeError('The radii provided are negative');
        }
        cairoEllipse(this._ctx, x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise);
    },

    rect(this: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
        this._ensureSurface();
        this._ctx.rectangle(x, y, w, h);
    },

    roundRect(
        this: CanvasRenderingContext2D,
        x: number,
        y: number,
        w: number,
        h: number,
        radii: number | number[] = 0,
    ): void {
        this._ensureSurface();
        cairoRoundRect(this._ctx, x, y, w, h, radii);
    },
};

/** Install path-construction methods on CanvasRenderingContext2D.prototype. */
export function installPathMethods(proto: object): void {
    Object.assign(proto, pathMethods);
}
