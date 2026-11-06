// The status-page icon colour — the pure half.
//
// `Adw.StatusPage` draws its icon in the foreground colour at reduced opacity
// (`-gtk-icon-style: symbolic; opacity: .5`, adw-status-page.c / _misc.scss). The NS port
// pre-renders the icon to a bitmap, which CSS cannot recolour, so the window foreground
// reaches the widget through this small observable instead: the style host publishes the
// `--window-fg-color` it read from the app's `:root`, the page re-renders on a change.
//
// Free of `@nativescript/core` imports so the spec suite exercises the shipping code.

import { formatAdwRgb, parseAdwRgb } from '@gjsify/adwaita-core';

/** libadwaita's status-page icon opacity. */
export const STATUS_ICON_OPACITY = 0.5;

let windowFg: string | null = null;
const listeners = new Set<() => void>();

/** Record the `--window-fg-color` the app declares (`null` = none), and tell the subscribers. */
export function publishWindowFg(value: string | null): void {
    if (value === windowFg) return;
    windowFg = value;
    for (const listener of listeners) listener();
}

/** The published window foreground, or `null` while the app declares none. */
export function publishedWindowFg(): string | null {
    return windowFg;
}

/** Subscribe to {@link publishWindowFg} changes; returns the unsubscribe function. */
export function onWindowFgChanged(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * `fg` at `opacity` as `#aarrggbb`, the spelling both icon renderers read. A `fg` that is not
 * a colour falls back to `fallback`, which is a scheme-default hex and is dimmed the same way.
 */
export function dimmedIconColor(fg: string | null, fallback: string, opacity: number = STATUS_ICON_OPACITY): string {
    const rgb = (fg === null ? null : parseAdwRgb(fg)) ?? parseAdwRgb(fallback) ?? { red: 0, green: 0, blue: 0 };
    const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255)
        .toString(16)
        .padStart(2, '0');
    return `#${alpha}${formatAdwRgb(rgb).slice(1)}`;
}
