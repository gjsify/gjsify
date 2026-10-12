// @gjsify/adwaita-nativescript/canvas2d — opt-in entry for `Canvas2DBridge` (ADR 0107). Importing
// this module registers the view as the template class `$GjsifyCanvas2DBridge`, so a `.blp` names
// it the way it names the GJS widget. A subpath of its own, not a line in `index.ts`: the view
// needs `@nativescript/core` at module scope, which the package root must not drag in.

export { Canvas2DBridge } from './canvas2d-bridge.js';
export { NsCanvas, NsCanvasRenderingContext2D } from './canvas-subset.js';
