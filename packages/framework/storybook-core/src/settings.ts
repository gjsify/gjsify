// Storybook appearance settings — renderer-agnostic.
//
// Every storybook target shows the same components, so "does this widget hold up
// in dark mode / under a different accent" is a question about the STORYBOOK, not
// about any one story. This is that state, in the one place all three renderers
// read it from.
//
// WHY A PREFERENCE AND A RESOLVED VALUE ARE DIFFERENT THINGS. `colorScheme` is
// what the user picked and includes `'system'`; `resolvedDark` is what is
// actually on screen. Collapsing them loses the ability to follow the desktop,
// and a UI that only stores light/dark cannot show "Follow system" as selected.
// The renderer supplies the resolution, because only it can see the system:
// `Adw.StyleManager:dark` on GTK, `prefers-color-scheme` in a browser, the
// Android night mode on NativeScript.
//
// THE ACCENT IS NOT APPLIED HERE. Nothing in this module touches a surface — a
// renderer subscribes and applies its own half. The values come from
// `@gjsify/adwaita-core`'s palette so all three agree on the colours; how they
// reach a widget is per-target (a `Gtk.CssProvider`, two custom properties, a
// generated NativeScript stylesheet).
//
// Original implementation.

import type { AdwAccentColorName } from '@gjsify/adwaita-core';

/** What the user picked. `'system'` follows the desktop rather than pinning. */
export type StorybookColorScheme = 'system' | 'light' | 'dark';

/** Every colour-scheme choice, in the order a selector should offer them. */
export const STORYBOOK_COLOR_SCHEMES: readonly StorybookColorScheme[] = ['system', 'light', 'dark'];

/** A snapshot of the appearance settings. */
export interface StorybookSettingsState {
    /** The colour-scheme PREFERENCE, not the resolved value. */
    readonly colorScheme: StorybookColorScheme;
    /** The accent the storybook overrides the desktop's with. */
    readonly accent: AdwAccentColorName;
}

/** How the renderer answers "is the system currently dark?". */
export type SystemDarkQuery = () => boolean;

/**
 * The storybook's appearance settings, with change notification.
 *
 * Deliberately a plain observable rather than the abstract-base-plus-`applyTheme`
 * shape: a renderer subscribing to changes can apply a scheme AND an accent
 * through one path, where a template method would need one hook per setting and a
 * new setting would mean a new abstract member in every target.
 */
export class StorybookSettings {
    private _colorScheme: StorybookColorScheme = 'system';
    private _accent: AdwAccentColorName = 'blue';
    private readonly _listeners = new Set<(state: StorybookSettingsState) => void>();
    private readonly _systemDark: SystemDarkQuery;

    /**
     * @param systemDark How to resolve `'system'`. Defaults to "not dark", which
     *   is what a renderer that cannot see the desktop should report — guessing
     *   dark would fight a light desktop on every start.
     */
    constructor(systemDark: SystemDarkQuery = () => false) {
        this._systemDark = systemDark;
    }

    get colorScheme(): StorybookColorScheme {
        return this._colorScheme;
    }

    set colorScheme(value: StorybookColorScheme) {
        if (!STORYBOOK_COLOR_SCHEMES.includes(value) || value === this._colorScheme) return;
        this._colorScheme = value;
        this._notify();
    }

    get accent(): AdwAccentColorName {
        return this._accent;
    }

    set accent(value: AdwAccentColorName) {
        if (value === this._accent) return;
        this._accent = value;
        this._notify();
    }

    /** Whether dark is actually on screen — the preference, resolved. */
    get resolvedDark(): boolean {
        if (this._colorScheme === 'dark') return true;
        if (this._colorScheme === 'light') return false;
        return this._systemDark();
    }

    get state(): StorybookSettingsState {
        return { colorScheme: this._colorScheme, accent: this._accent };
    }

    /**
     * Subscribe to changes; returns an unsubscribe function.
     *
     * Also called when the SYSTEM scheme changes underneath `'system'` — see
     * {@link systemChanged} — because a renderer applying an accent needs to
     * recompute the standalone colour when light↔dark flips, not only when the
     * user picks something.
     */
    subscribe(listener: (state: StorybookSettingsState) => void): () => void {
        this._listeners.add(listener);
        return () => {
            this._listeners.delete(listener);
        };
    }

    /**
     * Tell the settings the system scheme moved. A no-op unless the preference is
     * `'system'`, so a renderer can wire it to the platform signal unconditionally
     * instead of guarding at every call site.
     */
    systemChanged(): void {
        if (this._colorScheme !== 'system') return;
        this._notify();
    }

    private _notify(): void {
        const state = this.state;
        // Snapshot: a listener that unsubscribes mid-fan-out must not make the
        // live Set iterator skip the next one.
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot
        for (const listener of [...this._listeners]) {
            try {
                listener(state);
            } catch {
                // One misbehaving subscriber must not stop the others.
            }
        }
    }
}
