// Barrel for the focused method-group modules that compose
// CanvasRenderingContext2D.
//
// Each module exports an `install*Methods(proto)` function plus a TypeScript
// `*Methods` interface that augments the `CanvasRenderingContext2D`
// declaration via `declare module`. The base file calls
// `installAllContextMethods(CanvasRenderingContext2D.prototype)` after the
// class declaration runs — this avoids the circular-dependency hazard that
// prototype-merge mixins would otherwise hit at module-load time.

import { installTransformMethods } from './transforms.js';
import { installPathMethods } from './path-ops.js';
import { installDrawingMethods } from './drawing.js';
import { installPixelMethods } from './pixels.js';
import { installTextMethods } from './text-rendering.js';
import { installFactoryMethods } from './factories.js';

// Re-export interfaces so the declaration-merging in each module is reachable
// through this single entry point.
export type { TransformMethods } from './transforms.js';
export type { PathMethods } from './path-ops.js';
export type { DrawingMethods } from './drawing.js';
export type { PixelMethods } from './pixels.js';
export type { TextMethods } from './text-rendering.js';
export type { FactoryMethods } from './factories.js';

export function installAllContextMethods(proto: object): void {
    installTransformMethods(proto);
    installPathMethods(proto);
    installDrawingMethods(proto);
    installPixelMethods(proto);
    installTextMethods(proto);
    installFactoryMethods(proto);
}
