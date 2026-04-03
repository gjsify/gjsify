// Cairo-backed Canvas 2D core — no @gjsify/dom-elements dependency.
// Extracted from @gjsify/canvas2d so @gjsify/dom-elements can depend on it
// without creating a circular dependency.
//
// @gjsify/dom-elements imports this package to auto-register the '2d' context
// factory on HTMLCanvasElement, mirroring browser behavior where
// canvas.getContext('2d') works without any explicit import.

export { CanvasRenderingContext2D } from './canvas-rendering-context-2d.js';
export { CanvasGradient } from './canvas-gradient.js';
export { CanvasPattern } from './canvas-pattern.js';
export { Path2D } from './canvas-path.js';
export { OurImageData as ImageData } from './image-data.js';
export { parseColor } from './color.js';
