// SPDX-License-Identifier: MIT
//
// The project's own token scales — the half of ADR 0032 § 3 that does NOT live in
// gjsify. The class FAMILIES (`mt`, `bg`, `rounded`, `items`, …) are declared in
// `@gjsify/gtk-host/style`; the VALUES are the application's, and this file is what
// a real consumer generates out of its design-token source and hands to
// `configureStyle` once, before the first render.
//
// NEUTRAL NAMES ARE THE POINT, not a stylistic preference. ADR 0032 § 11 asks for a
// regression proof that can live in THIS repository, which the application the layer
// was measured against cannot: it is third-party and under a different licence. A
// vocabulary lifted from it — its colour names, its route names — would carry the
// same problem in a smaller package. So every name here is generic
// (`surface`/`sunken`/`ink`/`accent`), and the showcase is an ordinary design system
// rather than a copy of a particular one.
//
// TWO CONSTRAINTS THE SCALES HAVE TO RESPECT, both enforced by L1 rather than by
// convention, and both of which a hand-written scale gets wrong on the first try:
//
//   · SPACING MUST BE PIXEL LENGTHS. `mt-*`, `gap-*` and `w-*` become `margin-top`,
//     `spacing` and `width-request`, which are `gint`s of device pixels with no unit
//     conversion behind them, so a `rem` scale is a named error the moment a margin
//     asks for it (padding, being CSS, would still work — which is what makes the
//     failure partial and confusing).
//   · A TOKEN NAME MAY NOT SIT IN TWO SCALES THAT ONE FAMILY READS. `text-*` reads
//     `fontSize` AND `colors`, `border-*` reads `borderWidth` AND `colors`, `font-*`
//     reads `fontWeight` AND `fontFamily` — a name in both halves makes the utility
//     ambiguous and L1 refuses it by name rather than picking. Hence type ramps named
//     `caption`/`body`/`title`/`display` and colours named after their ROLE: no name
//     is reachable from two families.

import type { StyleTokens } from '@gjsify/gtk-host/style';

export const TOKENS: StyleTokens = {
    // `0` and `px` are kept from the minimal set because `inset-0` and a hairline
    // need them; the rest is a t-shirt ramp, which is what a token file generated
    // from a design source normally holds.
    spacing: {
        '0': '0px',
        px: '1px',
        '2xs': '2px',
        xs: '4px',
        s: '8px',
        m: '12px',
        l: '16px',
        xl: '24px',
        '2xl': '32px',
    },
    // `rgb(r g b)` rather than `#rrggbb`: it is the spelling GTK's parser
    // round-trips unchanged, so a rule read back out of the sheet is comparable to
    // the value written here.
    colors: {
        transparent: 'transparent',
        surface: 'rgb(255 255 255)',
        sunken: 'rgb(246 245 244)',
        line: 'rgb(222 221 218)',
        ink: 'rgb(36 31 49)',
        muted: 'rgb(119 118 123)',
        inverse: 'rgb(255 255 255)',
        accent: 'rgb(53 132 228)',
        positive: 'rgb(38 162 105)',
        caution: 'rgb(245 194 17)',
    },
    borderRadius: { none: '0', sm: '4px', DEFAULT: '6px', md: '8px', lg: '12px', pill: '999px' },
    borderWidth: { DEFAULT: '1px', '0': '0', '2': '2px' },
    fontSize: { caption: '11px', body: '14px', title: '18px', display: '26px' },
    fontWeight: { regular: '400', medium: '500', bold: '700' },
    opacity: { '0': '0', '60': '0.6', '70': '0.7', '80': '0.8', '100': '1' },
    // Named after what they measure rather than after a step, because a component
    // reads them once and a reader of `w-thumb` should not have to know the ramp.
    width: { thumb: '48px', rail: '4px' },
    height: { thumb: '48px', hairline: '1px' },
    // Pixels, not `em`. GTK parses `0.06em` (measured) and stores it, but a
    // pixel tracking value is what the sheet reads back unrounded.
    letterSpacing: { wide: '1px' },
    lineHeight: { snug: '1.3' },
};
