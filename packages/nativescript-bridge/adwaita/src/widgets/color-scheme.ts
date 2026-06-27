// Adwaita light/dark color-scheme state for NativeScript.
//
// The Adwaita theme CSS (`theme/adwaita.css`) carries a full `.ns-dark` variant,
// toggled by adding the `ns-dark` class to the root view — NS re-applies CSS on a
// class change, so backgrounds / text / borders flip for free. Symbolic ICONS,
// however, are rasterised to a PRE-COLOURED `Bitmap` (`renderSymbolicIcon`), and
// the NS CSS subset cannot recolour a bitmap — so a dark icon stays dark (and
// invisible) on a dark surface unless it is RE-RENDERED in a light fill.
//
// This module is the single source of truth for the current scheme + a change
// notifier. The host app flips it (`setAdwaitaColorScheme`) alongside the
// `ns-dark` class; `AdwIcon` / `AdwImageButton` subscribe and re-render their
// bitmap in `themeIconColor()` when it changes — UNLESS the caller set an
// explicit colour (e.g. white on a suggested button, destructive red), which
// must survive both schemes.
//
// Pure TS (imports only the colour constants from the pure `icon-path` module),
// so it loads + is unit-testable off-device.
//
// Reference: refs/libadwaita/src/stylesheet/_colors.scss (light/dark palettes).
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { DEFAULT_ICON_COLOR, DEFAULT_ICON_COLOR_DARK } from './icon-path.js';

/** The two Adwaita color schemes. */
export type AdwColorScheme = 'light' | 'dark';

let currentScheme: AdwColorScheme = 'light';
const listeners = new Set<() => void>();

/** The active color scheme (default `'light'`). */
export function adwaitaColorScheme(): AdwColorScheme {
    return currentScheme;
}

/**
 * Set the active color scheme. A no-op when unchanged; otherwise notifies every
 * subscriber (so theme-aware icons re-render). The host app should also toggle
 * the `ns-dark` class on its root view for the CSS half.
 */
export function setAdwaitaColorScheme(scheme: AdwColorScheme): void {
    const next: AdwColorScheme = scheme === 'dark' ? 'dark' : 'light';
    if (next === currentScheme) return;
    currentScheme = next;
    // Snapshot so a listener that unsubscribes mid-iteration can't skip another.
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch {
            // A misbehaving subscriber must not break the rest of the fan-out.
        }
    }
}

/** Flip light↔dark and return the new scheme. */
export function toggleAdwaitaColorScheme(): AdwColorScheme {
    setAdwaitaColorScheme(currentScheme === 'dark' ? 'light' : 'dark');
    return currentScheme;
}

/** The default symbolic-icon fill for the active scheme (dark fg on light, near-white on dark). */
export function themeIconColor(): string {
    return currentScheme === 'dark' ? DEFAULT_ICON_COLOR_DARK : DEFAULT_ICON_COLOR;
}

/** Whether `color` is the current scheme-default fill (i.e. not a caller-set explicit colour). */
export function isThemeIconColor(color: string): boolean {
    return color === DEFAULT_ICON_COLOR || color === DEFAULT_ICON_COLOR_DARK;
}

/**
 * Subscribe to scheme changes. Returns an unsubscribe function. Icon widgets
 * subscribe while `loaded` and unsubscribe on `unloaded`, so the registry only
 * ever holds on-screen icons.
 */
export function onAdwaitaColorSchemeChanged(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
