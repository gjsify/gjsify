// Runtime accent override for the NativeScript theme — the pure half.
//
// WHY THIS IS A STYLESHEET AND NOT A PROPERTY. `theme/adwaita.css` inlines the
// accent as a literal in 16 declarations, because the NativeScript CSS subset has
// no custom properties — `var()` does not resolve, so there is nothing to
// reassign. Changing the accent at runtime therefore means generating rules that
// override those exact selectors and handing them to `Application.addCss`.
//
// TWO ROLES, NOT TWO CONSTANTS. The theme uses `#3584e4` for the accent fill and
// `#1c71d8` for a DARKER variant (the pressed suggested-action, the dark-mode
// avatar). `#1c71d8` is not the standalone colour — libadwaita derives `#0461be`
// for blue — it is adwaita-web's legacy shade, so treating it as "standalone"
// would put a text colour on a button. Both roles come from
// `@gjsify/adwaita-core`: the fill from the palette, the darker one from the
// `min(l, 0.5)` derivation, which is exactly "this accent, darkened".
//
// Free of `@nativescript/core` value imports so the spec suite exercises the
// shipping generator; the applier that calls `Application.addCss` cannot be
// imported off-device.
//
// The table below is kept honest by `scripts/check-nativescript-accent-rules.mjs`,
// which fails the build when the theme declares an accent the table does not
// cover. A hand-listed selector set with nothing checking it is how the theme and
// its override drift apart.
//
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { adwaitaAccentBgColor, adwaitaAccentColor, type AdwAccentColorName } from '@gjsify/adwaita-core';

/** Which of the two accent shades a declaration carries. */
export type AccentRole = 'fill' | 'shade';

/** One accent-carrying declaration in `theme/adwaita.css`. */
export interface AccentRule {
    /** The selector, exactly as the theme spells it. */
    readonly selector: string;
    /** The property the accent is assigned to. */
    readonly property: 'color' | 'background-color';
    /** Which shade it uses. */
    readonly role: AccentRole;
}

/**
 * Every accent declaration in the shipped theme.
 *
 * Extracted from the stylesheet rather than written from memory, and gated against
 * it — see the header.
 */
export const ADWAITA_NS_ACCENT_RULES: ReadonlyArray<AccentRule> = [
    { selector: '.adw-switch', property: 'color', role: 'fill' },
    { selector: '.adw-slider', property: 'color', role: 'fill' },
    { selector: '.adw-button.suggested-action', property: 'background-color', role: 'fill' },
    { selector: '.adw-button.suggested-action:highlighted', property: 'background-color', role: 'shade' },
    { selector: '.adw-banner-button.suggested-action', property: 'background-color', role: 'fill' },
    { selector: '.adw-avatar', property: 'background-color', role: 'fill' },
    {
        selector: '.adw-viewswitcherbar-button.active .adw-viewswitcherbar-button-label',
        property: 'color',
        role: 'fill',
    },
    { selector: '.adw-viewswitcherbar-button-badge', property: 'background-color', role: 'fill' },
    { selector: '.adw-button-row', property: 'color', role: 'fill' },
    { selector: '.adw-button-row-title', property: 'color', role: 'fill' },
    { selector: '.adw-button-row-start-icon', property: 'color', role: 'fill' },
    { selector: '.adw-view-switcher-button-badge', property: 'background-color', role: 'fill' },
    { selector: '.adw-inline-view-switcher-button-badge', property: 'background-color', role: 'fill' },
    { selector: '.adw-carousel-dot.active', property: 'color', role: 'fill' },
    { selector: '.ns-dark .adw-button.suggested-action', property: 'background-color', role: 'fill' },
    { selector: '.ns-dark .adw-avatar', property: 'background-color', role: 'shade' },
];

/** The colour for one role of `accent`. */
export function adwaitaNsAccentColor(accent: AdwAccentColorName, role: AccentRole): string {
    // 'shade' is the `min(l, 0.5)` derivation — libadwaita's own "darker version of
    // this colour", which is what the two shade sites want. It is NOT scheme
    // dependent here: both sites are already scheme specific through their selector.
    return role === 'fill' ? adwaitaAccentBgColor(accent) : adwaitaAccentColor(accent, false);
}

/**
 * The stylesheet that repaints the theme in `accent`.
 *
 * Appended to the app's CSS, so it must WIN over the rules it replaces: NS
 * resolves equal-specificity rules by order, and added CSS comes last. Every
 * selector is reproduced verbatim for that reason — a shortened or merged selector
 * would lose to the original.
 */
export function adwaitaNsAccentCss(accent: AdwAccentColorName): string {
    return ADWAITA_NS_ACCENT_RULES.map(
        (rule) => `${rule.selector} { ${rule.property}: ${adwaitaNsAccentColor(accent, rule.role)}; }`,
    ).join('\n');
}
