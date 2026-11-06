// Adwaita named colours on NativeScript — the pure half.
//
// An app that sets `--window-bg-color` & co. through a `Gtk.CssProvider` gets them from
// libadwaita on GTK. On NativeScript the CSS subset has no custom properties, so the
// `:root { --name: <literal>; }` block does nothing and `theme/adwaita.css` keeps its own
// inlined literals. This module reads that block and generates override rules for the exact
// selectors that carry the matching literal, the same way `accent-theme.ts` does for the
// accent.
//
// LITERALS ONLY. A value that is not a literal colour (`var(...)`, `color-mix(...)`) is
// ignored — NativeScript resolves neither here, and guessing would paint a wrong colour.
//
// ONE VALUE, BOTH SCHEMES. A variable overrides the light selector AND its `.ns-dark` twin
// with the same value. That is right because the app re-emits the block when the colour
// scheme changes, so the value it hands over is already the one for the active scheme.
//
// APPEND-ONLY. `Application.addCss` cannot remove a rule, so a variable the app stops
// setting is undone by appending the theme's own literal again ({@link NamedColorRule.fallback}).
// {@link createNamedColorsPublisher} owns that bookkeeping and is free of
// `@nativescript/core`, so the spec suite exercises the shipping logic.
//
// The table is held against the theme by `scripts/check-nativescript-named-colors.mjs`.
//
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { adwaitaAccent, formatAdwRgb, parseAdwRgb } from '@gjsify/adwaita-core';
import { adwaitaNsAccentCss } from './accent-theme.js';

/** The surface variables that have a carrying selector in the NS theme. */
export type NamedColorVariable =
    | 'window-bg-color'
    | 'window-fg-color'
    | 'view-bg-color'
    | 'view-fg-color'
    | 'card-bg-color'
    | 'sidebar-bg-color'
    | 'sidebar-fg-color'
    | 'dialog-bg-color'
    | 'headerbar-bg-color';

/** One declaration in `theme/adwaita.css` that carries a named colour. */
export interface NamedColorRule {
    /** The selector, exactly as the theme spells it. */
    readonly selector: string;
    readonly property: 'color' | 'background-color';
    readonly variable: NamedColorVariable;
    /** The literal the theme carries — what to append again when the variable goes away. */
    readonly fallback: string;
}

/** Every surface declaration in the shipped theme that a named colour repaints. */
export const ADWAITA_NS_NAMED_COLOR_RULES: ReadonlyArray<NamedColorRule> = [
    {
        selector: '.adw-window, Page.adw-window',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#fafafb',
    },
    {
        selector: '.adw-window, Page.adw-window',
        property: 'color',
        variable: 'window-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    {
        selector: '.boxed-list, .adw-preferences-group-listbox',
        property: 'background-color',
        variable: 'card-bg-color',
        fallback: '#ffffff',
    },
    { selector: '.card, .adw-card', property: 'background-color', variable: 'card-bg-color', fallback: '#ffffff' },
    { selector: '.adw-action-row', property: 'color', variable: 'window-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    { selector: '.adw-row-title', property: 'color', variable: 'window-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    {
        selector: '.adw-preferences-page',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#fafafb',
    },
    {
        selector: '.adw-entry-field, .adw-entry-input',
        property: 'color',
        variable: 'window-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    { selector: '.adw-password-field', property: 'color', variable: 'window-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    {
        selector: '.adw-drop-down-label',
        property: 'color',
        variable: 'window-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    { selector: '.adw-spin-value', property: 'color', variable: 'window-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    { selector: '.adw-slider-title', property: 'color', variable: 'window-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    {
        selector: '.adw-expander-disclosure',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#fafafb',
    },
    { selector: '.adw-button', property: 'color', variable: 'window-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    { selector: '.adw-button.flat', property: 'color', variable: 'window-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    { selector: '.adw-button-label', property: 'color', variable: 'window-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    { selector: '.adw-banner-title', property: 'color', variable: 'window-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    { selector: '.adw-banner-button', property: 'color', variable: 'window-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    {
        selector: '.adw-window-title-title',
        property: 'color',
        variable: 'window-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    { selector: '.adw-header-bar', property: 'background-color', variable: 'headerbar-bg-color', fallback: '#ffffff' },
    { selector: '.adw-action-bar', property: 'background-color', variable: 'headerbar-bg-color', fallback: '#ffffff' },
    { selector: '.adw-toolbar-view', property: 'background-color', variable: 'window-bg-color', fallback: '#fafafb' },
    {
        selector: '.adw-toolbar-view-top',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#fafafb',
    },
    {
        selector: '.adw-toolbar-view-bottom',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#fafafb',
    },
    {
        selector: '.adw-toolbar-view-top.raised',
        property: 'background-color',
        variable: 'headerbar-bg-color',
        fallback: '#ffffff',
    },
    {
        selector: '.adw-toolbar-view-bottom.raised',
        property: 'background-color',
        variable: 'headerbar-bg-color',
        fallback: '#ffffff',
    },
    {
        selector: '.adw-viewswitcherbar-button-label',
        property: 'color',
        variable: 'window-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    { selector: '.adw-data-grid-cell', property: 'color', variable: 'window-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    { selector: '.adw-spinner', property: 'color', variable: 'window-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    { selector: '.adw-status-page', property: 'background-color', variable: 'window-bg-color', fallback: '#fafafb' },
    {
        selector: '.adw-status-page-title',
        property: 'color',
        variable: 'window-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    {
        selector: '.adw-button-content-icon',
        property: 'color',
        variable: 'window-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    {
        selector: '.adw-button-content-label',
        property: 'color',
        variable: 'window-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    {
        selector: '.adw-split-button-label',
        property: 'color',
        variable: 'window-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    { selector: '.adw-toggle-label', property: 'color', variable: 'window-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    {
        selector: '.adw-view-switcher-button-label',
        property: 'color',
        variable: 'window-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    {
        selector: '.adw-tab-view-bar',
        property: 'background-color',
        variable: 'headerbar-bg-color',
        fallback: '#ffffff',
    },
    {
        selector: '.adw-navigation-view',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#fafafb',
    },
    {
        selector: '.adw-navigation-page',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#fafafb',
    },
    {
        selector: '.adw-navigation-split-view, .adw-overlay-split-view',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#fafafb',
    },
    {
        selector: '.adw-split-view-sidebar',
        property: 'background-color',
        variable: 'sidebar-bg-color',
        fallback: '#ebebed',
    },
    {
        selector: '.adw-split-view-content',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#fafafb',
    },
    {
        selector: '.adw-overlay-active',
        property: 'background-color',
        variable: 'sidebar-bg-color',
        fallback: '#ebebed',
    },
    { selector: '.adw-sidebar', property: 'background-color', variable: 'sidebar-bg-color', fallback: '#ebebed' },
    {
        selector: '.adw-sidebar-row-title',
        property: 'color',
        variable: 'sidebar-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    {
        selector: '.adw-bottom-sheet-panel',
        property: 'background-color',
        variable: 'dialog-bg-color',
        fallback: '#ffffff',
    },
    { selector: '.adw-check-label', property: 'color', variable: 'window-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    { selector: '.adw-frame-label', property: 'color', variable: 'window-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    { selector: '.adw-text-view', property: 'background-color', variable: 'view-bg-color', fallback: '#ffffff' },
    { selector: '.adw-text-view-input', property: 'color', variable: 'view-fg-color', fallback: 'rgba(0, 0, 0, 0.8)' },
    {
        selector: '.adw-about-dialog-card, .adw-preferences-dialog-card',
        property: 'background-color',
        variable: 'dialog-bg-color',
        fallback: '#fafafb',
    },
    {
        selector: '.adw-about-dialog-back',
        property: 'color',
        variable: 'window-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    {
        selector: '.adw-about-dialog-copy, .adw-about-dialog-close',
        property: 'color',
        variable: 'window-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    { selector: '.adw-dialog-card', property: 'background-color', variable: 'dialog-bg-color', fallback: '#fafafb' },
    {
        selector: '.adw-shortcut-label-cap-text',
        property: 'color',
        variable: 'window-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    {
        selector: '.adw-shortcut-label-side',
        property: 'color',
        variable: 'window-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    {
        selector: '.adw-shortcut-label .dimmed',
        property: 'color',
        variable: 'window-fg-color',
        fallback: 'rgba(0, 0, 0, 0.8)',
    },
    {
        selector: '.ns-dark .adw-window, .ns-dark.adw-window, Page.ns-dark.adw-window',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#222226',
    },
    {
        selector: '.ns-dark .adw-window, .ns-dark.adw-window, Page.ns-dark.adw-window',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
    {
        selector: '.ns-dark .boxed-list, .ns-dark .adw-preferences-group-listbox',
        property: 'background-color',
        variable: 'card-bg-color',
        fallback: '#34343a',
    },
    {
        selector: '.ns-dark .boxed-list, .ns-dark .adw-preferences-group-listbox',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
    {
        selector: '.ns-dark .card, .ns-dark .adw-card',
        property: 'background-color',
        variable: 'card-bg-color',
        fallback: '#34343a',
    },
    {
        selector: '.ns-dark .card, .ns-dark .adw-card',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
    {
        selector: '.ns-dark .adw-row, .ns-dark .adw-action-row',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
    { selector: '.ns-dark .adw-row-title', property: 'color', variable: 'window-fg-color', fallback: '#ffffff' },
    {
        selector: '.ns-dark .adw-preferences-page',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#222226',
    },
    {
        selector: '.ns-dark .adw-entry-field, .ns-dark .adw-entry-input, .ns-dark .adw-password-field',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
    { selector: '.ns-dark .adw-drop-down-label', property: 'color', variable: 'window-fg-color', fallback: '#ffffff' },
    { selector: '.ns-dark .adw-spin-button', property: 'color', variable: 'window-fg-color', fallback: '#ffffff' },
    { selector: '.ns-dark .adw-spin-value', property: 'color', variable: 'window-fg-color', fallback: '#ffffff' },
    { selector: '.ns-dark .adw-slider-title', property: 'color', variable: 'window-fg-color', fallback: '#ffffff' },
    {
        selector: '.ns-dark .adw-expander-disclosure',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#222226',
    },
    { selector: '.ns-dark .adw-button', property: 'color', variable: 'window-fg-color', fallback: '#ffffff' },
    { selector: '.ns-dark .adw-button.flat', property: 'color', variable: 'window-fg-color', fallback: '#ffffff' },
    { selector: '.ns-dark .adw-button-label', property: 'color', variable: 'window-fg-color', fallback: '#ffffff' },
    { selector: '.ns-dark .adw-banner-title', property: 'color', variable: 'window-fg-color', fallback: '#ffffff' },
    { selector: '.ns-dark .adw-banner-button', property: 'color', variable: 'window-fg-color', fallback: '#ffffff' },
    {
        selector: '.ns-dark .adw-window-title-title',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
    {
        selector: '.ns-dark .adw-header-bar',
        property: 'background-color',
        variable: 'headerbar-bg-color',
        fallback: '#2e2e32',
    },
    {
        selector: '.ns-dark .adw-action-bar',
        property: 'background-color',
        variable: 'headerbar-bg-color',
        fallback: '#2e2e32',
    },
    {
        selector: '.ns-dark .adw-toolbar-view',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#222226',
    },
    {
        selector: '.ns-dark .adw-toolbar-view-top',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#222226',
    },
    {
        selector: '.ns-dark .adw-toolbar-view-bottom',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#222226',
    },
    {
        selector: '.ns-dark .adw-toolbar-view-top.raised',
        property: 'background-color',
        variable: 'headerbar-bg-color',
        fallback: '#2e2e32',
    },
    {
        selector: '.ns-dark .adw-toolbar-view-bottom.raised',
        property: 'background-color',
        variable: 'headerbar-bg-color',
        fallback: '#2e2e32',
    },
    {
        selector: '.ns-dark .adw-viewswitcherbar-button-label',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
    { selector: '.ns-dark .adw-data-grid-cell', property: 'color', variable: 'window-fg-color', fallback: '#ffffff' },
    { selector: '.ns-dark .adw-spinner', property: 'color', variable: 'window-fg-color', fallback: '#ffffff' },
    {
        selector: '.ns-dark .adw-status-page',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#222226',
    },
    {
        selector: '.ns-dark .adw-status-page-title',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
    {
        selector: '.ns-dark .adw-button-content-icon, .ns-dark .adw-button-content-label',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
    {
        selector: '.ns-dark .adw-split-button-action, .ns-dark .adw-split-button-dropdown',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
    {
        selector: '.ns-dark .adw-view-switcher-button-label',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
    {
        selector: '.ns-dark .adw-tab-view-bar',
        property: 'background-color',
        variable: 'headerbar-bg-color',
        fallback: '#2e2e32',
    },
    {
        selector: '.ns-dark .adw-navigation-view, .ns-dark .adw-navigation-page',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#222226',
    },
    {
        selector: '.ns-dark .adw-navigation-split-view, .ns-dark .adw-overlay-split-view',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#222226',
    },
    {
        selector: '.ns-dark .adw-split-view-sidebar, .ns-dark .adw-overlay-active',
        property: 'background-color',
        variable: 'sidebar-bg-color',
        fallback: '#2a2a2e',
    },
    {
        selector: '.ns-dark .adw-split-view-content',
        property: 'background-color',
        variable: 'window-bg-color',
        fallback: '#222226',
    },
    {
        selector: '.ns-dark .adw-sidebar',
        property: 'background-color',
        variable: 'sidebar-bg-color',
        fallback: '#2a2a2e',
    },
    {
        selector: '.ns-dark .adw-sidebar-row-title',
        property: 'color',
        variable: 'sidebar-fg-color',
        fallback: '#ffffff',
    },
    {
        selector: '.ns-dark .adw-bottom-sheet-panel',
        property: 'background-color',
        variable: 'dialog-bg-color',
        fallback: '#2e2e32',
    },
    {
        selector: '.ns-dark .adw-check-label, .ns-dark .adw-frame-label',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
    {
        selector: '.ns-dark .adw-text-view',
        property: 'background-color',
        variable: 'view-bg-color',
        fallback: '#2a2a2e',
    },
    { selector: '.ns-dark .adw-text-view-input', property: 'color', variable: 'view-fg-color', fallback: '#ffffff' },
    {
        selector: '.ns-dark .adw-dialog-card',
        property: 'background-color',
        variable: 'dialog-bg-color',
        fallback: '#2e2e32',
    },
    {
        selector: '.ns-dark .adw-about-dialog-card, .ns-dark .adw-preferences-dialog-card',
        property: 'background-color',
        variable: 'dialog-bg-color',
        fallback: '#2e2e32',
    },
    {
        selector: '.ns-dark .adw-about-dialog-name, .ns-dark .adw-preferences-dialog-title',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
    {
        selector: '.ns-dark .adw-about-dialog-back, .ns-dark .adw-about-dialog-page-title',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
    {
        selector: '.ns-dark .adw-about-dialog-copy, .ns-dark .adw-about-dialog-close',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
    {
        selector:
            '.ns-dark .adw-shortcut-label-cap-text, .ns-dark .adw-shortcut-label-side, .ns-dark .adw-shortcut-label .dimmed',
        property: 'color',
        variable: 'window-fg-color',
        fallback: '#ffffff',
    },
];

/** The accent variables, handled through `accent-theme.ts`. */
export const ADWAITA_NS_ACCENT_VARIABLES = ['accent-bg-color', 'accent-color'] as const;

const SURFACE_VARIABLES: ReadonlySet<string> = new Set(ADWAITA_NS_NAMED_COLOR_RULES.map((rule) => rule.variable));
const KNOWN_VARIABLES: ReadonlySet<string> = new Set([...SURFACE_VARIABLES, ...ADWAITA_NS_ACCENT_VARIABLES]);

const LITERAL_COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\))$/i;

/**
 * The literal colour variables of every `:root { … }` block in `css`, later declarations
 * winning. Names are without the leading `--`. Non-literal values are dropped, and so are
 * accent values that are not an opaque-parseable colour.
 */
export function parseAdwaitaRootColors(css: string): Map<string, string> {
    const values = new Map<string, string>();
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const block of stripped.matchAll(/:root\s*\{([^{}]*)\}/g)) {
        for (const [, name, raw] of block[1].matchAll(/--([\w-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g)) {
            const value = raw.trim();
            if (!LITERAL_COLOR.test(value)) continue;
            if (name === 'accent-bg-color' || name === 'accent-color') {
                const rgb = parseAdwRgb(value);
                if (!rgb) continue;
                values.set(name, formatAdwRgb(rgb));
            } else {
                values.set(name, value);
            }
        }
    }
    return values;
}

/** Keep only the variables this module repaints. */
function knownOnly(values: ReadonlyMap<string, string>): Map<string, string> {
    const known = new Map<string, string>();
    for (const [name, value] of values) if (KNOWN_VARIABLES.has(name)) known.set(name, value);
    return known;
}

/** The surface rules for `values`, each variable's value or the theme's own literal. */
export function adwaitaNsSurfaceCss(values: ReadonlyMap<string, string>): string {
    return ADWAITA_NS_NAMED_COLOR_RULES.map(
        (rule) => `${rule.selector} { ${rule.property}: ${values.get(rule.variable) ?? rule.fallback}; }`,
    ).join('\n');
}

/**
 * The override stylesheet for `values`: the surface rules, plus the accent rules when
 * `includeAccent` — derived from `accent-bg-color` when set, else the accent the core holds.
 *
 * Verbatim selectors, so it wins over the theme at equal specificity by source order.
 */
export function adwaitaNsNamedColorsCss(values: ReadonlyMap<string, string>, includeAccent = true): string {
    const surface = adwaitaNsSurfaceCss(values);
    if (!includeAccent) return surface;
    const accent = adwaitaNsAccentCss(values.get('accent-bg-color') ?? adwaitaAccent(), {
        standaloneDark: values.get('accent-color'),
    });
    return `${surface}\n${accent}`;
}

/** What {@link createNamedColorsPublisher} remembers between publishes. */
export interface NamedColorsPublisher {
    /**
     * The stylesheet to append for `values`, or `null` when nothing needs appending.
     *
     * `force` re-appends an unchanged override — for when other CSS was appended after it
     * and could otherwise sit on top.
     */
    update(values: ReadonlyMap<string, string>, force?: boolean): string | null;
}

/**
 * The append-only state machine: nothing is appended until a variable is first set, a
 * change appends the new override, losing every variable appends the defaults once, and
 * an identical result is not appended again.
 */
export function createNamedColorsPublisher(): NamedColorsPublisher {
    let last: string | null = null;
    let overridden = false;
    let accentOverridden = false;
    return {
        update(values, force = false) {
            const known = knownOnly(values);
            if (known.size === 0 && !overridden) return null;
            // Accent rules only while the app sets an accent variable, plus once more to undo
            // it; otherwise they would clobber `applyAdwaitaNsAccent`.
            const accentSet = known.has('accent-bg-color') || known.has('accent-color');
            const css = adwaitaNsNamedColorsCss(known, accentSet || accentOverridden);
            accentOverridden = accentSet;
            overridden = known.size > 0;
            if (css === last && !force) return null;
            last = css;
            return css;
        },
    };
}
