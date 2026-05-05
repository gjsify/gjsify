// Express and several of its transitive deps (debug, finalhandler, body-parser,
// content-type, …) carry browser-compat fallbacks gated by
// `typeof document !== "undefined"` / `typeof navigator !== "undefined"`.
// Tree-shaking can't drop these — they appear as free identifiers in the
// bundled output, so `--globals auto` would otherwise inject
// `@gjsify/dom-elements/register/{document,navigator,...}` which is a
// GTK-bound DOM package the server has no need for. Exclude the lot so the
// runtime never reaches the polyfilled code paths and the bundle stays slim.
export default {
    excludeGlobals: [
        'document',
        'navigator',
        'Image',
        'HTMLElement',
        'HTMLCanvasElement',
        'HTMLImageElement',
        'MutationObserver',
        'ResizeObserver',
        'IntersectionObserver',
        'FontFace',
        'matchMedia',
        'location',
        'XMLHttpRequest',
        'XMLHttpRequestUpload',
    ],
};
