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

import Adw from '@girs/adw-1';
import Gdk from '@girs/gdk-4.0';
import Gtk from '@girs/gtk-4.0';
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
            this._applyAccent(state.accent);
        } finally {
            this._applying = false;
        }
    }

    private _applyAccent(accent: AdwAccentColorName): void {
        const display = Gdk.Display.get_default();
        if (!display) return;

        if (!this._provider) {
            this._provider = new Gtk.CssProvider();
            Gtk.StyleContext.add_provider_for_display(display, this._provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
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
 * The appearance popover: the scheme choice and the nine accents.
 *
 * A plain `Gtk.Popover` built in a function rather than a registered GObject
 * subclass — it holds no properties or signals of its own, and a subclass would
 * only add a GType to collide with.
 */
export function buildAppearanceMenu(appearance: StorybookAppearance): Gtk.Popover {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        margin_top: 12,
        margin_bottom: 12,
        margin_start: 12,
        margin_end: 12,
    });

    const schemeLabel = new Gtk.Label({ label: 'Appearance', xalign: 0 });
    schemeLabel.add_css_class('heading');
    box.append(schemeLabel);

    // Linked toggles, grouped so exactly one is active — the shape GNOME's own
    // appearance switcher uses.
    const schemeRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, homogeneous: true });
    schemeRow.add_css_class('linked');
    let schemeGroup: Gtk.ToggleButton | null = null;
    const schemeButtons = new Map<string, Gtk.ToggleButton>();

    for (const scheme of STORYBOOK_COLOR_SCHEMES) {
        const button = new Gtk.ToggleButton({ label: SCHEME_LABELS[scheme] });
        if (schemeGroup) button.set_group(schemeGroup);
        else schemeGroup = button;
        button.set_active(appearance.settings.colorScheme === scheme);
        button.connect('toggled', () => {
            if (button.get_active()) appearance.settings.colorScheme = scheme;
        });
        schemeButtons.set(scheme, button);
        schemeRow.append(button);
    }
    box.append(schemeRow);

    const accentLabel = new Gtk.Label({ label: 'Accent colour', xalign: 0 });
    accentLabel.add_css_class('heading');
    box.append(accentLabel);

    // A grid of swatches. Each carries its own colour as inline CSS, so the row
    // shows the palette instead of nine identical buttons with names on them.
    const grid = new Gtk.Grid({ row_spacing: 6, column_spacing: 6 });
    let accentGroup: Gtk.ToggleButton | null = null;

    for (const [index, accent] of ADW_ACCENT_COLOR_NAMES.entries()) {
        const swatch = new Gtk.ToggleButton({
            tooltip_text: ACCENT_LABELS[accent],
            width_request: 28,
            height_request: 28,
        });
        swatch.update_property([Gtk.AccessibleProperty.LABEL], [ACCENT_LABELS[accent]]);
        if (accentGroup) swatch.set_group(accentGroup);
        else accentGroup = swatch;
        swatch.set_active(appearance.settings.accent === accent);

        const provider = new Gtk.CssProvider();
        provider.load_from_string(
            `button { background-image: none; background-color: ${adwaitaAccentBgColor(accent)}; }`,
        );
        swatch.get_style_context().add_provider(provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        swatch.connect('toggled', () => {
            if (swatch.get_active()) appearance.settings.accent = accent;
        });

        grid.attach(swatch, index % 5, Math.floor(index / 5), 1, 1);
    }
    box.append(grid);

    const popover = new Gtk.Popover({ child: box });

    // Keep the toggles honest if the settings are changed from elsewhere (a
    // devtools call, a future keyboard shortcut) rather than only from this menu.
    appearance.settings.subscribe((state) => {
        const active = schemeButtons.get(state.colorScheme);
        if (active && !active.get_active()) active.set_active(true);
    });

    return popover;
}
