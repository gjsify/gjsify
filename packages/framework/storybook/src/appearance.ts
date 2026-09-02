// Applying the storybook's appearance settings on GTK, and the menu that drives them.
//
// THE ACCENT IS CSS, NOT A PROPERTY, and that is libadwaita's design rather than
// a shortcut: `Adw.StyleManager:accent-color` is READ-ONLY — the desktop owns the
// accent and apps follow it. A storybook wants to preview the other eight, so it
// overrides the two custom properties libadwaita's own stylesheet reads
// (`_colors.scss:166-170`) through a second `Gtk.CssProvider`, which is also how
// every other renderer here applies an accent. The colours come from
// `@gjsify/adwaita-core`, so all three targets show the same ones.
//
// The colour SCHEME is a property, and does go through `StyleManager`.
//
// Original implementation.

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';
import {
    ADW_ACCENT_COLOR_NAMES,
    adwaitaAccentBgColor,
    adwaitaAccentColor,
    type AdwAccentColorName,
} from '@gjsify/adwaita-core';
import { STORYBOOK_COLOR_SCHEMES, StorybookSettings, type StorybookSettingsState } from '@gjsify/storybook-core';

/** Human labels for the scheme choices, in `STORYBOOK_COLOR_SCHEMES` order. */
const SCHEME_LABELS: Record<string, string> = {
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

/** Owns the GTK side of {@link StorybookSettings} — the style manager and the accent provider. */
export class StorybookAppearance {
    readonly settings: StorybookSettings;
    private readonly _styleManager: Adw.StyleManager;
    private _provider: Gtk.CssProvider | null = null;
    /** Re-entrancy guard: `set_color_scheme` can fire `notify::dark` synchronously. */
    private _applying = false;

    constructor() {
        this._styleManager = Adw.StyleManager.get_default();
        this.settings = new StorybookSettings(() => this._styleManager.get_dark());

        this.settings.subscribe((state) => this._apply(state));
        // Wired unconditionally; `systemChanged` is a no-op unless the preference
        // is `'system'`, so the guard stays in one place.
        this._styleManager.connect('notify::dark', () => this.settings.systemChanged());

        this._apply(this.settings.state);
    }

    private _apply(state: StorybookSettingsState): void {
        if (this._applying) return;
        this._applying = true;
        try {
            this._styleManager.set_color_scheme(
                state.colorScheme === 'light'
                    ? Adw.ColorScheme.FORCE_LIGHT
                    : state.colorScheme === 'dark'
                      ? Adw.ColorScheme.FORCE_DARK
                      : Adw.ColorScheme.DEFAULT,
            );
            this._applyAccent(this.settings.resolvedAccent);
        } finally {
            this._applying = false;
        }
    }

    /**
     * @param accent The accent to force, or `null` to hand the choice back to the
     *   desktop. Clearing has to EMPTY the provider rather than skip the call: a
     *   stale override would otherwise keep winning over `StyleManager` forever,
     *   which is the failure that makes a "follow system" switch do nothing.
     */
    private _applyAccent(accent: AdwAccentColorName | null): void {
        const display = Gdk.Display.get_default();
        if (!display) return;

        if (!this._provider) {
            if (!accent) return;
            this._provider = new Gtk.CssProvider();
            Gtk.StyleContext.add_provider_for_display(display, this._provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        }

        if (!accent) {
            this._provider.load_from_string('');
            return;
        }

        // Both properties, from core — the standalone one depends on the RESOLVED
        // scheme, which is why this reruns when the system flips and not only when
        // the accent changes.
        const bg = adwaitaAccentBgColor(accent);
        const standalone = adwaitaAccentColor(accent, this.settings.resolvedDark);
        this._provider.load_from_string(`:root { --accent-bg-color: ${bg}; --accent-color: ${standalone}; }`);
    }
}

/**
 * One round swatch: a grouped `Gtk.CheckButton` whose fill IS the choice.
 *
 * A CheckButton rather than a ToggleButton because grouping gives radio
 * behaviour — exactly one selected, and clicking the selected one cannot
 * deselect it, which a ToggleButton group allows.
 */
function buildSwatch(cssClasses: readonly string[], label: string, group: Gtk.CheckButton | null): Gtk.CheckButton {
    const swatch = new Gtk.CheckButton({
        tooltip_text: label,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        focus_on_click: false,
    });
    for (const cssClass of cssClasses) swatch.add_css_class(cssClass);
    // The tooltip is not an accessible name, and a coloured circle has no text of
    // its own — without this a screen reader reads nine unnamed radio buttons.
    swatch.update_property([Gtk.AccessibleProperty.LABEL], [label]);
    if (group) swatch.set_group(group);
    return swatch;
}

/**
 * A `.card` holding a centred, wrapping row of swatches.
 *
 * THE CARD IS NOT DECORATION. In the dark scheme the "dark" swatch is a
 * near-black circle on a near-black dialog and is effectively invisible; the card
 * is a lighter surface behind it, which is what makes all three legible.
 * Learn6502 answers the same problem the same way
 * (`views/preferences.dialog.blp:26-28`).
 *
 * Centring happens INSIDE a full-width card through `WrapBox:align`, not by
 * giving the container `halign: CENTER` — that shrinks the container to its
 * content, so the card hugs the swatches and the row reads as left-aligned under
 * the group title.
 *
 * @param attached Square the top corners so this card joins the row above it into
 *   one boxed list rather than two stacked cards with a seam between them.
 */
function buildSwatchCard(attached = false): { card: Adw.Bin; row: Adw.WrapBox } {
    const row = new Adw.WrapBox({
        align: 0.5,
        child_spacing: 8,
        line_spacing: 8,
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
    });

    const card = new Adw.Bin({ child: row, hexpand: true });
    card.add_css_class('card');
    if (attached) card.add_css_class('storybook-card-attached');

    return { card, row };
}

/**
 * The appearance dialog: the colour scheme, and the accent behind a switch.
 *
 * An `Adw.PreferencesDialog` rather than a popover — the palette is nine swatches
 * plus a switch row, which a popover squeezes, and the sections need headings to
 * say which choice is which.
 */
export function buildAppearanceDialog(appearance: StorybookAppearance): Adw.PreferencesDialog {
    const settings = appearance.settings;
    const page = new Adw.PreferencesPage();

    // --- Colour scheme ---
    const schemeGroup = new Adw.PreferencesGroup({ title: 'Style' });
    const { card: schemeCard, row: schemeRow } = buildSwatchCard();
    let schemeGroupLeader: Gtk.CheckButton | null = null;
    const schemeSwatches = new Map<string, Gtk.CheckButton>();

    for (const scheme of STORYBOOK_COLOR_SCHEMES) {
        const swatch = buildSwatch(
            ['storybook-swatch', 'storybook-scheme-swatch', `storybook-scheme-${scheme}`],
            SCHEME_LABELS[scheme],
            schemeGroupLeader,
        );
        schemeGroupLeader ??= swatch;
        swatch.set_active(settings.colorScheme === scheme);
        swatch.connect('toggled', () => {
            if (swatch.get_active()) settings.colorScheme = scheme;
        });
        schemeSwatches.set(scheme, swatch);
        schemeRow.append(swatch);
    }
    schemeGroup.add(schemeCard);
    page.add(schemeGroup);

    // --- Accent ---
    const accentGroup = new Adw.PreferencesGroup({ title: 'Accent colour' });
    // Squares the boxed-list's BOTTOM corners. The attached card squares its top,
    // but without this the row above keeps its round bottom and the two meet with a
    // notch at each end.
    accentGroup.add_css_class('storybook-attached-group');
    const accentSwitch = new Adw.SwitchRow({
        title: 'Use a custom accent colour',
        subtitle: 'Off follows the desktop, which owns the accent',
        active: settings.accentMode === 'custom',
    });
    accentGroup.add(accentSwitch);

    // Attached, so the switch row and the palette read as one boxed list — the
    // palette belongs to the switch above it rather than standing on its own.
    const { card: accentCard, row: accentRow } = buildSwatchCard(true);
    let accentGroupLeader: Gtk.CheckButton | null = null;
    const accentSwatches = new Map<string, Gtk.CheckButton>();

    for (const accent of ADW_ACCENT_COLOR_NAMES) {
        const swatch = buildSwatch(['storybook-swatch'], ACCENT_LABELS[accent], accentGroupLeader);
        accentGroupLeader ??= swatch;
        swatch.set_active(settings.accent === accent);

        // The fill comes from core, per swatch, rather than from a stylesheet class
        // per accent — one source of truth for the nine colours, and adding a tenth
        // upstream would not need a CSS edit here.
        const provider = new Gtk.CssProvider();
        provider.load_from_string(`checkbutton { background-color: ${adwaitaAccentBgColor(accent)}; }`);
        swatch.get_style_context().add_provider(provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        swatch.connect('toggled', () => {
            if (swatch.get_active()) settings.accent = accent;
        });
        accentSwatches.set(accent, swatch);
        accentRow.append(swatch);
    }

    accentRow.set_sensitive(settings.accentMode === 'custom');
    accentSwitch.connect('notify::active', () => {
        settings.accentMode = accentSwitch.get_active() ? 'custom' : 'system';
    });
    accentGroup.add(accentCard);
    page.add(accentGroup);

    // Keep the controls honest when the settings move from anywhere else — a
    // devtools call, a keyboard shortcut, a future persisted value. Written as a
    // one-way sync FROM the model, so the dialog has no second copy of the state.
    settings.subscribe((state) => {
        const scheme = schemeSwatches.get(state.colorScheme);
        if (scheme && !scheme.get_active()) scheme.set_active(true);

        const accent = accentSwatches.get(state.accent);
        if (accent && !accent.get_active()) accent.set_active(true);

        const custom = state.accentMode === 'custom';
        if (accentSwitch.get_active() !== custom) accentSwitch.set_active(custom);
        accentRow.set_sensitive(custom);
    });

    const dialog = new Adw.PreferencesDialog({ title: 'Appearance' });
    dialog.add(page);
    return dialog;
}
