// Cairo-backed Canvas 2D core. Deliberately does not depend on @gjsify/dom-elements: that package
// imports this one to auto-register the '2d' context factory on HTMLCanvasElement (so
// `canvas.getContext('2d')` works with no explicit import, as in a browser), and a dependency back
// would close the cycle.

export { CanvasRenderingContext2D } from './canvas-rendering-context-2d.js';
export { CanvasGradient } from './canvas-gradient.js';
export { CanvasPattern } from './canvas-pattern.js';
export { Path2D } from './canvas-path.js';
export { OurImageData as ImageData } from './image-data.js';
export { parseColor } from './color.js';
