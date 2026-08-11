// Express and several transitive deps (debug, finalhandler, body-parser,
// content-type, …) carry browser-compat fallbacks gated on `typeof document` /
// `typeof navigator`. Tree-shaking cannot drop them — they survive as free
// identifiers in the bundled output, so `--globals auto` would inject the
// GTK-bound `@gjsify/dom-elements/register/*` modules a server never needs.
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
