// Path2D implementation for Canvas 2D context
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/Path2D
// Records path operations and replays them on a Cairo context.

import { quadraticToCubic, cairoRoundRect } from './cairo-utils.js';

/** A recorded path operation. */
type PathOp =
    | { type: 'moveTo'; x: number; y: number }
    | { type: 'lineTo'; x: number; y: number }
    | { type: 'closePath' }
    | { type: 'bezierCurveTo'; cp1x: number; cp1y: number; cp2x: number; cp2y: number; x: number; y: number }
    | { type: 'quadraticCurveTo'; cpx: number; cpy: number; x: number; y: number }
    | { type: 'arc'; x: number; y: number; radius: number; startAngle: number; endAngle: number; ccw: boolean }
    | { type: 'ellipse'; x: number; y: number; rx: number; ry: number; rotation: number; startAngle: number; endAngle: number; ccw: boolean }
    | { type: 'rect'; x: number; y: number; w: number; h: number }
    | { type: 'roundRect'; x: number; y: number; w: number; h: number; radii: number | number[] };

/**
 * Path2D records path operations for later replay on a CanvasRenderingContext2D.
 */
export class Path2D {
    /** @internal Recorded operations */
    _ops: PathOp[] = [];

    constructor(pathOrSvg?: Path2D | string) {
        if (pathOrSvg instanceof Path2D) {
            this._ops = [...pathOrSvg._ops];
        }
        // SVG path string parsing is not implemented (complex, rarely needed)
    }

    addPath(path: Path2D): void {
        this._ops.push(...path._ops);
    }

    moveTo(x: number, y: number): void {
        this._ops.push({ type: 'moveTo', x, y });
    }

    lineTo(x: number, y: number): void {
        this._ops.push({ type: 'lineTo', x, y });
    }

    closePath(): void {
        this._ops.push({ type: 'closePath' });
    }

    bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
        this._ops.push({ type: 'bezierCurveTo', cp1x, cp1y, cp2x, cp2y, x, y });
    }

    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
        this._ops.push({ type: 'quadraticCurveTo', cpx, cpy, x, y });
    }

    arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise = false): void {
        this._ops.push({ type: 'arc', x, y, radius, startAngle, endAngle, ccw: counterclockwise });
    }

    ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, startAngle: number, endAngle: number, counterclockwise = false): void {
        if (radiusX < 0 || radiusY < 0) throw new RangeError('The radii provided are negative');
        this._ops.push({ type: 'ellipse', x, y, rx: radiusX, ry: radiusY, rotation, startAngle, endAngle, ccw: counterclockwise });
    }

    rect(x: number, y: number, w: number, h: number): void {
        this._ops.push({ type: 'rect', x, y, w, h });
    }

    roundRect(x: number, y: number, w: number, h: number, radii: number | number[] = 0): void {
        this._ops.push({ type: 'roundRect', x, y, w, h, radii });
    }

    /**
     * @internal Replay all recorded path operations onto a Cairo context.
     */
    _replayOnCairo(ctx: import('cairo').default.Context): void {
        let lastX = 0, lastY = 0;

        for (const op of this._ops) {
            switch (op.type) {
                case 'moveTo':
                    ctx.moveTo(op.x, op.y);
                    lastX = op.x; lastY = op.y;
                    break;
                case 'lineTo':
                    ctx.lineTo(op.x, op.y);
                    lastX = op.x; lastY = op.y;
                    break;
                case 'closePath':
                    ctx.closePath();
                    break;
                case 'bezierCurveTo':
                    ctx.curveTo(op.cp1x, op.cp1y, op.cp2x, op.cp2y, op.x, op.y);
                    lastX = op.x; lastY = op.y;
                    break;
                case 'quadraticCurveTo': {
                    const { cp1x, cp1y, cp2x, cp2y } = quadraticToCubic(lastX, lastY, op.cpx, op.cpy, op.x, op.y);
                    ctx.curveTo(cp1x, cp1y, cp2x, cp2y, op.x, op.y);
                    lastX = op.x; lastY = op.y;
                    break;
                }
                case 'arc':
                    if (op.ccw) {
                        ctx.arcNegative(op.x, op.y, op.radius, op.startAngle, op.endAngle);
                    } else {
                        ctx.arc(op.x, op.y, op.radius, op.startAngle, op.endAngle);
                    }
                    break;
                case 'ellipse':
                    ctx.save();
                    ctx.translate(op.x, op.y);
                    ctx.rotate(op.rotation);
                    ctx.scale(op.rx, op.ry);
                    if (op.ccw) {
                        ctx.arcNegative(0, 0, 1, op.startAngle, op.endAngle);
                    } else {
                        ctx.arc(0, 0, 1, op.startAngle, op.endAngle);
                    }
                    ctx.restore();
                    break;
                case 'rect':
                    ctx.rectangle(op.x, op.y, op.w, op.h);
                    break;
                case 'roundRect':
                    cairoRoundRect(ctx, op.x, op.y, op.w, op.h, op.radii);
                    break;
            }
        }
    }
}
