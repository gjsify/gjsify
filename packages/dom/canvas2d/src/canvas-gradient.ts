// CanvasGradient implementation backed by Cairo gradient patterns
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/CanvasGradient

import Cairo from 'cairo';
import { parseColor } from './color.js';

/**
 * CanvasGradient wrapping a Cairo LinearGradient or RadialGradient.
 */
export class CanvasGradient {
    private _pattern: Cairo.LinearGradient | Cairo.RadialGradient;

    constructor(
        type: 'linear' | 'radial',
        x0: number, y0: number,
        x1: number, y1: number,
        r0?: number, r1?: number,
    ) {
        if (type === 'radial') {
            this._pattern = new Cairo.RadialGradient(x0, y0, r0!, x1, y1, r1!);
        } else {
            this._pattern = new Cairo.LinearGradient(x0, y0, x1, y1);
        }
    }

    addColorStop(offset: number, color: string): void {
        const parsed = parseColor(color);
        if (!parsed) return;
        this._pattern.addColorStopRGBA(offset, parsed.r, parsed.g, parsed.b, parsed.a);
    }

    /** @internal Get the underlying Cairo pattern for rendering. */
    _getCairoPattern(): Cairo.LinearGradient | Cairo.RadialGradient {
        return this._pattern;
    }
}
