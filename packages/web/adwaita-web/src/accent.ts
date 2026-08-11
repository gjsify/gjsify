// Applying an Adwaita accent in the browser — the renderer half.
//
// The palette and the OkLab standalone derivation are `@gjsify/adwaita-core`'s
// (ADR 0004). This sets the two custom properties every accent-coloured rule in
// the stylesheet already reads:
//
//   --accent-bg-color   the fill, with white on top
//   --accent-color      the standalone colour, for text on the window
//
// BOTH ARE SET EXPLICITLY, from core's arithmetic, rather than setting only the
// background and letting CSS derive the other with
// `oklab(from var(--accent-bg-color) min(l, 0.5) a b)` — which is what
// libadwaita's own stylesheet does (`_colors.scss:166-170`). Two reasons: core is
// then the single source of truth for a value three renderers have to agree on,
// and the relative-colour form needs channel keywords inside `min()`, which is
// newer than this package's baseline. The CSS route stays available to a consumer
// who wants it; nothing here depends on it.
//
// NOTE, and it is a pre-existing inconsistency rather than something introduced
// here: `_variables.scss:55` hardcodes `--accent-color: #1c71d8` for the default
// blue, while libadwaita derives `#0461be`. The semantic colours in the same file
// DO use the relative-colour expression. Applying an accent through this module
// therefore also corrects the standalone colour; leaving it unset keeps the
// legacy value.
//
// Reference: refs/libadwaita/src/stylesheet/_colors.scss:146-170
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { adwaitaAccentBgColor, adwaitaAccentColor, type AdwAccentColorName } from '@gjsify/adwaita-core';

/** The custom property carrying the accent fill. */
export const ACCENT_BG_PROPERTY = '--accent-bg-color';
/** The custom property carrying the standalone accent, for text on the window. */
export const ACCENT_PROPERTY = '--accent-color';

/** Where and how to apply the accent. */
export interface ApplyAccentOptions {
    /** The element to set the properties on. Defaults to `document.documentElement`. */
    readonly target?: HTMLElement;
    /**
     * Which standalone variant to use. Defaults to the target's RESOLVED scheme,
     * because the standalone colour is the one thing about an accent that differs
     * between light and dark — reading it beats assuming light.
     */
    readonly dark?: boolean;
}

/**
 * Whether `element` is currently rendering dark.
 *
 * `.theme-dark` / `.theme-light` are the stylesheet's manual overrides and win
 * over the media query, so an explicit class is checked first and
 * `prefers-color-scheme` only decides when neither is present.
 */
export function isAdwaitaDark(element: HTMLElement): boolean {
    if (element.closest('.theme-dark')) return true;
    if (element.closest('.theme-light')) return false;
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** Set the accent custom properties for `name`. */
export function applyAdwaitaAccent(name: AdwAccentColorName, options: ApplyAccentOptions = {}): void {
    const target = options.target ?? document.documentElement;
    const dark = options.dark ?? isAdwaitaDark(target);

    target.style.setProperty(ACCENT_BG_PROPERTY, adwaitaAccentBgColor(name));
    target.style.setProperty(ACCENT_PROPERTY, adwaitaAccentColor(name, dark));
}

/** Drop the properties, so the stylesheet's own values apply again. */
export function clearAdwaitaAccent(target: HTMLElement = document.documentElement): void {
    target.style.removeProperty(ACCENT_BG_PROPERTY);
    target.style.removeProperty(ACCENT_PROPERTY);
}
