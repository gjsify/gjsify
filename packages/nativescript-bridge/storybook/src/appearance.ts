// Applying the storybook's appearance settings on NativeScript, and the dialog that
// drives them — the NS twin of `@gjsify/storybook`'s and
// `@gjsify/adwaita-storybook`'s `appearance.ts`.
//
// THE ACCENT IS OFFERED; THE COLOUR SCHEME IS NOT, and that is a platform limit
// rather than an omission:
//
//   accent  → `Application.addCss`, which appends rules AND re-applies style to the
//             live tree. That is the mechanism the accent override is built on, and
//             it works at runtime.
//   scheme  → the theme's dark half is `.ns-dark`-scoped CSS, and NS 9.1-alpha does
//             not reliably RE-APPLY those overrides once the tree is styled — the
//             reason `StorybookNsApp._wireColorScheme` deliberately SEEDS the scheme
//             at mount instead of switching it. Offering a switch here would flip the
//             pre-coloured symbolic icons (they are JS, not CSS) while the stylesheet
//             stayed put, which is worse than not offering it: a control that half
//             works reads as a rendering bug in whatever story is on screen.
//
// The way to lift that is to stop relying on `.ns-dark` re-application and generate
// the dark overrides through `addCss` too, exactly as the accent does. That is a
// much larger table than the accent's 16 rules, so it is a separate piece of work
// rather than something to half-do here.
//
// The MODEL is still `@gjsify/storybook-core`'s `StorybookSettings`, unchanged and
// shared with the other two targets — this file simply does not wire its
// `colorScheme` half to a control.
//
// Original implementation.

import {
    ADW_ACCENT_COLOR_NAMES,
    adwaitaAccentBgColor,
    adwaitaColorScheme,
    type AdwAccentColorName,
} from '@gjsify/adwaita-core';
import {
    Adw,
    applyAdwaitaNsAccent,
    clearAdwaitaNsAccent,
    NOTIFY_ACTIVE,
    type NotifyActiveEventData,
} from '@gjsify/adwaita-nativescript';
import { StorybookSettings } from '@gjsify/storybook-core';
import { GridLayout, WrapLayout } from '@nativescript/core';

/** Kept for the dialog's own use; NS swatches carry no text of their own. */
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

/** The class the theme styles a swatch with; see `theme/storybook.css`. */
const SWATCH_CLASS = 'sb-swatch';

/** Owns the NativeScript side of {@link StorybookSettings}. */
export class StorybookNsAppearance {
    readonly settings: StorybookSettings;

    constructor() {
        // The resolved scheme comes from core, which the app seeds from the OS at
        // mount. It is READ here (the accent's shade does not depend on it, but
        // `resolvedDark` is part of the shared model) and never written.
        this.settings = new StorybookSettings(() => adwaitaColorScheme() === 'dark');
        this.settings.subscribe(() => this._apply());
        this._apply();
    }

    private _apply(): void {
        const accent = this.settings.resolvedAccent;
        if (accent) applyAdwaitaNsAccent(accent);
        else clearAdwaitaNsAccent();
    }
}

/**
 * A round swatch. NS has no radio input, so selection is a class the applier
 * maintains — `border-radius` and `border-width` are in the CSS subset, which is all
 * a circle with a ring needs.
 */
function buildSwatch(accent: AdwAccentColorName): GridLayout {
    const swatch = new GridLayout();
    swatch.className = SWATCH_CLASS;
    swatch.backgroundColor = adwaitaAccentBgColor(accent);
    return swatch;
}

/**
 * The appearance dialog: the accent palette behind a switch.
 *
 * Returned unpresented; the caller adds it to a host cell and calls `present()`, the
 * way every NS dialog in this tree is used.
 */
export function buildAppearanceDialog(appearance: StorybookNsAppearance): Adw.PreferencesDialog {
    const settings = appearance.settings;

    const dialog = new Adw.PreferencesDialog();
    dialog.title = 'Appearance';
    const page = new Adw.PreferencesPage();

    const group = new Adw.PreferencesGroup();
    group.title = 'ACCENT COLOUR';

    const accentSwitch = new Adw.SwitchRow();
    accentSwitch.title = 'Use a custom accent colour';
    accentSwitch.subtitle = 'Off keeps the default Adwaita blue';
    accentSwitch.active = settings.accentMode === 'custom';
    group.addRow(accentSwitch);

    // A WrapLayout, not a StackLayout: nine swatches do not fit one dialog-width line
    // and a StackLayout does not wrap — it clipped the last two and a half off the edge.
    const row = new WrapLayout();
    row.orientation = 'horizontal';
    row.className = 'sb-swatch-row';

    const swatches = new Map<AdwAccentColorName, GridLayout>();
    for (const accent of ADW_ACCENT_COLOR_NAMES) {
        const swatch = buildSwatch(accent);
        swatch.addEventListener('tap', () => {
            // A guard rather than `isUserInteractionEnabled`: the dimmed row already
            // says the palette is unavailable, and refusing the tap here keeps that
            // a rule instead of a styling side effect.
            if (settings.accentMode !== 'custom') return;
            settings.accent = accent;
        });
        swatches.set(accent, swatch);
        row.addChild(swatch);
    }
    group.addRow(row);
    page.addGroup(group);
    dialog.add(page);

    const sync = (): void => {
        const custom = settings.accentMode === 'custom';
        if (accentSwitch.active !== custom) accentSwitch.active = custom;
        // NS has no `:checked`, so "selected" is a class, and "unavailable" is the
        // row's opacity rather than a `:disabled` pseudo-class.
        row.opacity = custom ? 1 : 0.4;
        for (const [accent, swatch] of swatches) {
            const selected = accent === settings.accent;
            swatch.className = selected ? `${SWATCH_CLASS} selected` : SWATCH_CLASS;
        }
    };

    accentSwitch.addEventListener(NOTIFY_ACTIVE, (event) => {
        settings.accentMode = (event as NotifyActiveEventData).active ? 'custom' : 'system';
    });
    settings.subscribe(sync);
    sync();

    return dialog;
}

/**
 * Put `dialog` into `root` so its scrim covers every pane.
 *
 * Added as a CHILD of the split view rather than by wrapping it: the split view is
 * itself a `GridLayout`, and wrapping re-parents it — which crashes with
 * "View already has a parent" the second time `mount()` runs, and `mount()` runs on
 * every `onNavigatingTo`. Spanning the columns is what makes the scrim cover the
 * content pane too; a child with no column lands in column 0, i.e. over the sidebar
 * alone. The span is deliberately larger than the declared column count, which NS
 * clamps — the count differs between the collapsed and expanded layouts.
 */
export function installAppearanceDialog(root: GridLayout, dialog: Adw.PreferencesDialog): void {
    GridLayout.setColumn(dialog, 0);
    GridLayout.setColumnSpan(dialog, 3);
    GridLayout.setRow(dialog, 0);
    GridLayout.setRowSpan(dialog, 3);
    root.addChild(dialog);
}
