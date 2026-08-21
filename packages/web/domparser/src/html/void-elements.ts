// Elements that never have children and never take an end tag. Getting this set
// wrong is not a cosmetic error: without it, `<div id=a><img src=x></div>` puts
// everything after the `<img>` INSIDE it, and the `</div>` closes the image
// instead of the div — the whole rest of the document shifts one level down.
//
// Implements the "void elements" of the HTML syntax plus the four deprecated
// names the tree builder still inserts-and-pops, per
// https://html.spec.whatwg.org/multipage/syntax.html#void-elements
export const VOID_ELEMENTS: ReadonlySet<string> = new Set([
    'area',
    'base',
    'basefont',
    'bgsound',
    'br',
    'col',
    'embed',
    'frame',
    'hr',
    'img',
    'input',
    'keygen',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
]);
