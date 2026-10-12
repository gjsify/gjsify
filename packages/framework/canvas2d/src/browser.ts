// The browser entry (ADR 0014, 0107): the package root's cairo classes have no business in a page, where
// the browser's own `CanvasRenderingContext2D` is the real one. Only the bridge crosses over: a
// `<canvas>` element whose `getContext('2d')` is the browser's context. Importing it registers the
// template class `$GjsifyCanvas2DBridge` in adwaita-web.
export { Canvas2DBridge } from '@gjsify/adwaita-web/canvas2d';
