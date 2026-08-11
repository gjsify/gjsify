// Barrel for the method-group modules that compose CanvasRenderingContext2D. Each pairs an
// `install*Methods(proto)` function with a `declare module` interface. The base file installs onto
// the prototype AFTER its class declaration has run, which is what keeps the arrangement clear of
// the circular-dependency hazard prototype-merge mixins hit at module-load time.

import { installTransformMethods } from './transforms.js';
import { installPathMethods } from './path-ops.js';
import { installDrawingMethods } from './drawing.js';
import { installPixelMethods } from './pixels.js';
import { installTextMethods } from './text-rendering.js';
import { installFactoryMethods } from './factories.js';

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
