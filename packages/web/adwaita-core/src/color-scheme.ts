// Adwaita light/dark color-scheme observable — headless.
//
// The single source of truth for the current Adwaita color scheme plus a change
// notifier, shared by every renderer (ADR 0004 — headless Adwaita core). The
// host app flips it (`setAdwaitaColorScheme`); theme-aware widgets subscribe via
// `onAdwaitaColorSchemeChanged` and re-render in `themeIconColor()` when it
// changes — UNLESS the caller set an explicit colour (e.g. white on a suggested
// button, destructive red), which must survive both schemes.
//
// This module is PLATFORM-NEUTRAL: applying the scheme to a surface is the
// renderer's job — e.g. `@gjsify/adwaita-nativescript` toggles the `ns-dark`
// CSS class on its root view and re-rasterises symbolic-icon bitmaps, a browser
// renderer would flip a CSS custom-property scope.
//
// Reference: refs/libadwaita/src/stylesheet/_colors.scss (light/dark palettes).
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** Default symbolic-icon fill for light theme — Adwaita's ~`rgba(0,0,0,0.8)` fg. */
export const DEFAULT_ICON_COLOR = '#33333A';

/** Default symbolic-icon fill for dark theme — near-white fg. */
export const DEFAULT_ICON_COLOR_DARK = '#FFFFFF';

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
 * subscriber (so theme-aware icons re-render). The renderer should also apply
 * its platform half (e.g. the `ns-dark` class on NativeScript, a CSS scope in
 * the browser).
 */
export function setAdwaitaColorScheme(scheme: AdwColorScheme): void {
    const next: AdwColorScheme = scheme === 'dark' ? 'dark' : 'light';
    if (next === currentScheme) return;
    currentScheme = next;
    // Snapshot so a listener that unsubscribes mid-iteration can't skip another.
    // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
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
 * Subscribe to scheme changes. Returns an unsubscribe function. Widgets should
 * subscribe while on screen and unsubscribe when leaving it (e.g. NS `loaded` /
 * `unloaded`), so the registry only ever holds live subscribers.
 */
export function onAdwaitaColorSchemeChanged(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
