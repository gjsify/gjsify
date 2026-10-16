// Which template constructs `adwaita-web`'s tree builder builds (ADR 0093 § 2). Pure data, so a
// build plugin can read it without importing the renderer — and plain `.mjs`, because the
// plugin loads it under Node from a published package, where Node refuses to strip types.

/** @type {import('./capabilities.d.mts').capabilities} */
export const capabilities = {
    layout: 'implemented',
    strings: 'implemented',
    responses: 'implemented',
    page: 'implemented',
    extern: 'implemented',
    signal: 'implemented',
    bind: 'implemented',
    breakpoint: 'implemented',
    'sibling-object': 'implemented',
};
