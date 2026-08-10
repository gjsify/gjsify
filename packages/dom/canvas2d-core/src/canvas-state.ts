// Drawing state for Canvas 2D context save()/restore() stack.
// Each save() pushes a clone of the current state; restore() pops it.

import type { RGBA } from './color.js';
import { BLACK } from './color.js';

export interface CanvasState {
    // Fill & stroke
    fillStyle: string | CanvasGradient | CanvasPattern;
    fillColor: RGBA;
    strokeStyle: string | CanvasGradient | CanvasPattern;
    strokeColor: RGBA;

    // Line properties
    lineWidth: number;
    lineCap: CanvasLineCap;
    lineJoin: CanvasLineJoin;
    miterLimit: number;
    lineDash: number[];
    lineDashOffset: number;

    // Compositing
    globalAlpha: number;
    globalCompositeOperation: GlobalCompositeOperation;

    // Shadows (Phase 5 — tracked in state for save/restore correctness)
    shadowColor: string;
    shadowBlur: number;
    shadowOffsetX: number;
    shadowOffsetY: number;

    // Text (Phase 4)
    font: string;
    textAlign: CanvasTextAlign;
    textBaseline: CanvasTextBaseline;
    direction: CanvasDirection;

    // Image smoothing
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: ImageSmoothingQuality;

    /**
     * The current transform collapses everything to zero area (a determinant of
     * 0, e.g. after `scale(0, 1)`).
     *
     * Canvas 2D allows that and simply draws nothing; Cairo cannot represent it
     * — `cairo_scale(0, 0)` puts the context into a permanent
     * `invalid matrix (not invertible)` error state, after which EVERY call on
     * it throws. So we keep the singular transform here and leave Cairo on the
     * last invertible one, with drawing suppressed while this is set — which is
     * what the singular transform would have produced anyway.
     */
    transformIsSingular: boolean;
}

export function createDefaultState(): CanvasState {
    return {
        fillStyle: '#000000',
        fillColor: { ...BLACK },
        strokeStyle: '#000000',
        strokeColor: { ...BLACK },
        lineWidth: 1,
        lineCap: 'butt',
        lineJoin: 'miter',
        miterLimit: 10,
        lineDash: [],
        lineDashOffset: 0,
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        shadowColor: 'rgba(0, 0, 0, 0)',
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        font: '10px sans-serif',
        textAlign: 'start',
        textBaseline: 'alphabetic',
        direction: 'ltr',
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'low',
        transformIsSingular: false,
    };
}

export function cloneState(state: CanvasState): CanvasState {
    return {
        ...state,
        fillColor: { ...state.fillColor },
        strokeColor: { ...state.strokeColor },
        lineDash: [...state.lineDash],
    };
}
