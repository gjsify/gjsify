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
