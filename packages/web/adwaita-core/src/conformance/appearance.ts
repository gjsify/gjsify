// Desktop-appearance handoff vectors (ADR 0078): what a server hands over, the
// `<meta>` tags that carry it, and the accent a page must end up painting.
//
// The web renderer drives this table in `adwaita-web/src/adw-appearance.spec.ts`:
// each `appearance` goes through `renderAppearanceMeta` into a real `<head>`, and
// the root's COMPUTED `--accent-bg-color` is compared with `paints`. The core
// suite holds the writer and reader against each other in `appearance.spec.ts`.

import type { AdwAccentColorName } from '../accent.js';
import type { DesktopAppearance } from '../appearance.js';

export interface AppearanceHandoffVector {
    /** What the server read. May carry values outside the closed sets, as untrusted input does. */
    appearance: DesktopAppearance;
    /** The exact tags `renderAppearanceMeta` must write. */
    meta: string;
    /** The accent the page paints from those tags; `null` = the stylesheet's own blue. */
    paints: AdwAccentColorName | null;
    /** The theme class the page puts on `<html>`, or `null`. */
    themeClass: 'theme-dark' | 'theme-light' | null;
}

export const APPEARANCE_HANDOFF_VECTORS: ReadonlyArray<AppearanceHandoffVector> = [
    {
        appearance: { accent: 'purple', accentRgb: '#9141ac', colorScheme: 'dark' },
        meta: '<meta name="adw-accent" content="purple">\n<meta name="adw-color-scheme" content="dark">',
        paints: 'purple',
        themeClass: 'theme-dark',
    },
    {
        appearance: { accent: 'teal', colorScheme: 'light' },
        meta: '<meta name="adw-accent" content="teal">\n<meta name="adw-color-scheme" content="light">',
        paints: 'teal',
        themeClass: 'theme-light',
    },
    // `no-preference` is an answer, and it writes a tag, but the page leaves the scheme to
    // `prefers-color-scheme` rather than pinning one.
    {
        appearance: { accent: 'slate', colorScheme: 'no-preference' },
        meta: '<meta name="adw-accent" content="slate">\n<meta name="adw-color-scheme" content="no-preference">',
        paints: 'slate',
        themeClass: null,
    },
    // Unknown renders nothing, so the page falls through to its next source.
    { appearance: {}, meta: '', paints: null, themeClass: null },
    // An unchecked value outside the nine is dropped, never written into markup.
    {
        appearance: { accent: '"><script>' as AdwAccentColorName, colorScheme: 'dark' },
        meta: '<meta name="adw-color-scheme" content="dark">',
        paints: null,
        themeClass: 'theme-dark',
    },
];
