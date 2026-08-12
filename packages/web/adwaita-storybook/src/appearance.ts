// Applying the storybook's appearance settings in the browser, and the dialog
// that drives them — the web twin of `@gjsify/storybook`'s `appearance.ts`.
//
// The model is `@gjsify/storybook-core`'s `StorybookSettings`, so this target and
// the GTK one agree on what a colour scheme and an accent ARE. Only the two halves
// below are per-target:
//
//   scheme  → `.theme-dark` / `.theme-light` on the root, which is what
//             `_theme.scss` scopes on. NEITHER class means "follow the desktop",
//             so `'system'` removes both and lets `prefers-color-scheme` decide.
//   accent  → the two custom properties, through `@gjsify/adwaita-web`'s
//             `applyAdwaitaAccent`.
//
// Original implementation.

import { ADW_ACCENT_COLOR_NAMES, adwaitaAccentBgColor, type AdwAccentColorName } from '@gjsify/adwaita-core';
import { applyAdwaitaAccent, clearAdwaitaAccent } from '@gjsify/adwaita-web';
import { STORYBOOK_COLOR_SCHEMES, StorybookSettings, type StorybookColorScheme } from '@gjsify/storybook-core';

const SCHEME_LABELS: Record<StorybookColorScheme, string> = {
    system: 'Follow system',
    light: 'Light',
    dark: 'Dark',
};

const ACCENT_LABELS: Record<AdwAccentColorName, string> = {
    blue: 'Blue',
    teal: 'Teal',
    green: 'Green',
    yellow: 'Yellow',
    orange: 'Orange',
    red: 'Red',
    pink: 'Pink',
    purple: 'Purple',
    slate: 'Slate',
};

/** Owns the browser side of {@link StorybookSettings}: the theme scope and the accent. */
export class StorybookWebAppearance {
    readonly settings: StorybookSettings;
    private readonly _root: HTMLElement;

    constructor(root: HTMLElement = document.documentElement) {
        this._root = root;
        const query = globalThis.matchMedia?.('(prefers-color-scheme: dark)') ?? null;

        this.settings = new StorybookSettings(() => query?.matches ?? false);
        this.settings.subscribe(() => this._apply());
        // Wired unconditionally — `systemChanged` no-ops unless the preference is
        // `'system'`, so the guard lives in one place.
        query?.addEventListener('change', () => this.settings.systemChanged());

        this._apply();
    }

    private _apply(): void {
        const scheme = this.settings.colorScheme;
        // Both classes off is the "follow the desktop" state, not a third theme:
        // `_theme.scss` applies its dark palette from `prefers-color-scheme` when
        // no explicit scope is present.
        this._root.classList.toggle('theme-dark', scheme === 'dark');
        this._root.classList.toggle('theme-light', scheme === 'light');

        const accent = this.settings.resolvedAccent;
        if (accent) applyAdwaitaAccent(accent, { target: this._root, dark: this.settings.resolvedDark });
        else clearAdwaitaAccent(this._root);
    }
}

/** A round swatch: a radio input, so grouping and keyboard nav come for free. */
function buildSwatch(name: string, value: string, label: string, classes: readonly string[]): HTMLInputElement {
    const swatch = document.createElement('input');
    swatch.type = 'radio';
    swatch.name = name;
    swatch.value = value;
    swatch.title = label;
    // A coloured circle has no text; without this a screen reader reads unnamed
    // radios, and `title` is not an accessible name.
    swatch.setAttribute('aria-label', label);
    swatch.classList.add('sb-swatch', ...classes);
    return swatch;
}

/**
 * The appearance dialog: the colour scheme, and the accent behind a switch.
 *
 * Built once and reused — unlike the GTK `Adw.Dialog`, `<adw-preferences-dialog>`
 * reopens after a dismissal, so there is nothing to rebuild.
 */
export function buildAppearanceDialog(appearance: StorybookWebAppearance): HTMLElement {
    const settings = appearance.settings;

    const dialog = document.createElement('adw-preferences-dialog');
    dialog.setAttribute('title', 'Appearance');
    const page = document.createElement('adw-preferences-page');

    // --- Colour scheme ---
    const schemeGroup = document.createElement('adw-preferences-group');
    schemeGroup.setAttribute('title', 'Style');

    const schemeCard = document.createElement('div');
    schemeCard.className = 'card sb-swatch-card';
    const schemeSwatches = new Map<string, HTMLInputElement>();

    for (const scheme of STORYBOOK_COLOR_SCHEMES) {
        const swatch = buildSwatch('sb-scheme', scheme, SCHEME_LABELS[scheme], [
            'sb-swatch--scheme',
            `sb-swatch--scheme-${scheme}`,
        ]);
        swatch.checked = settings.colorScheme === scheme;
        swatch.addEventListener('change', () => {
            if (swatch.checked) settings.colorScheme = scheme;
        });
        schemeSwatches.set(scheme, swatch);
        schemeCard.append(swatch);
    }
    schemeGroup.append(schemeCard);
    page.append(schemeGroup);

    // --- Accent ---
    const accentGroup = document.createElement('adw-preferences-group');
    accentGroup.setAttribute('title', 'Accent colour');
    // Squares the group list's BOTTOM corners. The attached card squares its top;
    // without both, the row above keeps its round bottom and the two meet with a
    // notch at each end.
    accentGroup.classList.add('sb-attached-group');

    const accentSwitch = document.createElement('adw-switch-row');
    accentSwitch.setAttribute('title', 'Use a custom accent colour');
    accentSwitch.setAttribute('subtitle', 'Off follows the desktop, which owns the accent');
    accentSwitch.toggleAttribute('active', settings.accentMode === 'custom');
    accentGroup.append(accentSwitch);

    // Attached: the switch row and the palette read as one boxed list rather than
    // two stacked cards with a seam between them.
    const accentCard = document.createElement('div');
    accentCard.className = 'card sb-swatch-card sb-swatch-card--attached';
    const accentSwatches = new Map<string, HTMLInputElement>();

    for (const accent of ADW_ACCENT_COLOR_NAMES) {
        const swatch = buildSwatch('sb-accent', accent, ACCENT_LABELS[accent], []);
        // The fill comes from core, per swatch — one source of truth for the nine
        // colours, and a tenth upstream would need no CSS here.
        swatch.style.backgroundColor = adwaitaAccentBgColor(accent);
        swatch.checked = settings.accent === accent;
        swatch.addEventListener('change', () => {
            if (swatch.checked) settings.accent = accent;
        });
        accentSwatches.set(accent, swatch);
        accentCard.append(swatch);
    }

    const syncAccentEnabled = (custom: boolean): void => {
        accentCard.classList.toggle('sb-swatch-card--disabled', !custom);
        for (const swatch of accentSwatches.values()) swatch.disabled = !custom;
    };
    syncAccentEnabled(settings.accentMode === 'custom');

    accentSwitch.addEventListener('notify::active', () => {
        settings.accentMode = accentSwitch.hasAttribute('active') ? 'custom' : 'system';
    });
    accentGroup.append(accentCard);
    page.append(accentGroup);

    dialog.append(page);

    // One-way sync FROM the model, so the dialog keeps no second copy of the state
    // and a change made anywhere else still shows here.
    settings.subscribe((state) => {
        const scheme = schemeSwatches.get(state.colorScheme);
        if (scheme && !scheme.checked) scheme.checked = true;

        const accent = accentSwatches.get(state.accent);
        if (accent && !accent.checked) accent.checked = true;

        const custom = state.accentMode === 'custom';
        accentSwitch.toggleAttribute('active', custom);
        syncAccentEnabled(custom);
    });

    return dialog;
}
