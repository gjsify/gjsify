// Gradient / Pattern factory methods for CanvasRenderingContext2D.
// Reference: refs/node-canvas — CanvasGradient + CanvasPattern factory API.
// Original: see canvas-rendering-context-2d.ts pre-split.

import type { CanvasRenderingContext2D } from '../canvas-rendering-context-2d.js';
import { CanvasGradient as OurCanvasGradient } from '../canvas-gradient.js';
import { CanvasPattern as OurCanvasPattern } from '../canvas-pattern.js';

export interface FactoryMethods {
    createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
    createRadialGradient(
        x0: number, y0: number, r0: number,
        x1: number, y1: number, r1: number,
    ): CanvasGradient;
    createPattern(image: unknown, repetition: string | null): CanvasPattern | null;
}

declare module '../canvas-rendering-context-2d.js' {
    interface CanvasRenderingContext2D extends FactoryMethods { }
}

const factoryMethods: FactoryMethods & ThisType<CanvasRenderingContext2D> = {
    createLinearGradient(
        this: CanvasRenderingContext2D,
        x0: number, y0: number, x1: number, y1: number,
    ): CanvasGradient {
        return new OurCanvasGradient('linear', x0, y0, x1, y1) as unknown as CanvasGradient;
    },

    createRadialGradient(
        this: CanvasRenderingContext2D,
        x0: number, y0: number, r0: number,
        x1: number, y1: number, r1: number,
    ): CanvasGradient {
        return new OurCanvasGradient('radial', x0, y0, x1, y1, r0, r1) as unknown as CanvasGradient;
    },

    createPattern(
        this: CanvasRenderingContext2D,
        image: unknown, repetition: string | null,
    ): CanvasPattern | null {
        return OurCanvasPattern.create(image, repetition) as unknown as CanvasPattern | null;
    },
};

/** Install gradient / pattern factory methods on CanvasRenderingContext2D.prototype. */
export function installFactoryMethods(proto: object): void {
    Object.assign(proto, factoryMethods);
}
