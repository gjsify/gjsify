// Which template constructs `adwaita-web`'s tree builder builds (ADR 0093 § 2). Pure data, so a
// build plugin can read it without importing the renderer — and plain `.mjs`, because the
// plugin loads it under Node from a published package, where Node refuses to strip types.

/** @type {import('./capabilities.d.mts').capabilities} */
export const capabilities = {
    layout: {
        refused:
            'an <adw-…> element is placed by DOM order and slot=, so a layout-manager placement has no door in the markup this package reads (ADR 0092)',
    },
    strings: 'implemented',
    responses: 'implemented',
    page: 'implemented',
    extern: 'implemented',
    signal: 'implemented',
    bind: 'implemented',
    breakpoint: 'implemented',
    'sibling-object': {
        refused: 'the web builder mounts one root element and has no consumer for a second root yet (ADR 0093)',
    },
};
