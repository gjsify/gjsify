// Runtime accent override for the NativeScript theme — the pure half.
//
// WHY THIS IS A STYLESHEET AND NOT A PROPERTY. `theme/adwaita.css` inlines the
// accent as a literal in 16 declarations, because the NativeScript CSS subset has
// no custom properties — `var()` does not resolve, so there is nothing to
// reassign. Changing the accent at runtime therefore means generating rules that
// override those exact selectors and handing them to `Application.addCss`.
//
// ROLES, NOT CONSTANTS. The theme uses `#3584e4` for the accent fill and `#1c71d8`
// for a DARKER variant (the pressed suggested-action, the dark-mode avatar).
// `#1c71d8` is not the standalone colour — libadwaita derives `#0461be` for blue —
// it is adwaita-web's legacy shade, so treating it as "standalone" would put a text
// colour on a button. Both come from `@gjsify/adwaita-core`: the fill from the
// palette, the darker one from the `min(l, 0.5)` derivation, which is exactly
// "this accent, darkened".
//
// THE THIRD ROLE, and why it was missing (#1154). Four dark rules paint accent TEXT
// (`.ns-dark` switch, view-switcher label, button-row title, active carousel dot)
// with `#78aeed` — adwaita-web's dark `--accent-color`. The gate recognised two
// literals, so this one was not a mismatch, it was INVISIBLE: under
// `applyAdwaitaNsAccent('orange')` every one of those stayed blue. It is a real
// role rather than drift, because a standalone accent on a dark background has to
// be LIGHTENED to stay legible (libadwaita: oklab `max(l, 0.85)`), which is the
// opposite of what `shade` does.
//
// The dark press shade that #1154 opened on, `#2c75d6`, was NOT a role: libadwaita
// presses an opaque button with `background-image: image(RGB(0 0 6 / 20%))` — a
// DARKENING overlay, the same in both schemes (_buttons.scss:165-167, via
// `%opaque_button`). There is no lighter dark press for an accent button; the
// lighter one belongs to the plain button. So it carries `shade`, like the light
// press and like `.adw-entry-apply` already did.
//
// Free of `@nativescript/core` value imports so the spec suite exercises the
// shipping generator; the applier that calls `Application.addCss` cannot be
// imported off-device.
//
// The table below is kept honest by `scripts/check-nativescript-accent-rules.mjs`,
// which fails the build when the theme declares an accent the table does not cover
// — and, since #1154, when the theme carries a colour the gate cannot CLASSIFY at
// all, which is how `#78aeed` and `#2c75d6` stayed hidden. A hand-listed selector
// set with nothing checking it is how the theme and its override drift apart.
//
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { adwaitaAccentBgColor, adwaitaAccentColor, type AdwAccentColorName } from '@gjsify/adwaita-core';

/** Which accent shade a declaration carries. */
export type AccentRole = 'fill' | 'shade' | 'standalone-dark';

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
    { selector: '.adw-view-switcher-button-badge', property: 'background-color', role: 'fill' },
    { selector: '.adw-inline-view-switcher-button-badge', property: 'background-color', role: 'fill' },
    { selector: '.adw-carousel-dot.active', property: 'color', role: 'fill' },
    { selector: '.adw-image-button.adw-entry-apply', property: 'background-color', role: 'fill' },
    { selector: '.adw-image-button.adw-entry-apply:highlighted', property: 'background-color', role: 'shade' },
    { selector: '.ns-dark .adw-button.suggested-action', property: 'background-color', role: 'fill' },
    { selector: '.ns-dark .adw-button.suggested-action:highlighted', property: 'background-color', role: 'shade' },
    { selector: '.ns-dark .adw-avatar', property: 'background-color', role: 'shade' },
    { selector: '.ns-dark .adw-image-button.adw-entry-apply:highlighted', property: 'background-color', role: 'shade' },
    // Accent TEXT on a dark page — the standalone role, lightened rather than
    // darkened. These four were the invisible half of #1154.
    { selector: '.ns-dark .adw-switch', property: 'color', role: 'standalone-dark' },
    {
        selector: '.ns-dark .adw-viewswitcherbar-button.active .adw-viewswitcherbar-button-label',
        property: 'color',
        role: 'standalone-dark',
    },
    // One entry, because the theme groups these two into one rule and the generated
    // override has to reproduce the selector VERBATIM to win on source order.
    {
        selector: '.ns-dark .adw-button-row-title, .ns-dark .adw-button-row-start-icon',
        property: 'color',
        role: 'standalone-dark',
    },
    { selector: '.ns-dark .adw-carousel-dot.active', property: 'color', role: 'standalone-dark' },
];

/** The colour for one role of `accent`. */
export function adwaitaNsAccentColor(accent: AdwAccentColorName, role: AccentRole): string {
    // 'shade' is the `min(l, 0.5)` derivation — libadwaita's own "darker version of
    // this colour", which is what the shade sites want. It is not scheme dependent
    // here: every one of them is already scheme specific through its selector.
    //
    // 'standalone-dark' is the SAME derivation with the dark branch, `max(l, 0.85)`.
    // The two are not interchangeable and the difference is the point: a press fill
    // must go darker than the accent, accent text on a dark page must go lighter.
    // Sharing one role between them is what left four rules unreachable.
    if (role === 'fill') return adwaitaAccentBgColor(accent);
    return adwaitaAccentColor(accent, role === 'standalone-dark');
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
