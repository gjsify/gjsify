// `Adw.StyleManager`, renderer-free: the SUBSET a widget needs to follow the system appearance —
// `get_default()`, the read-only `dark` property and `notify::dark`.
//
// Also in the subset: `color_scheme` / `set_color_scheme` / `get_color_scheme` and `Adw.ColorScheme`,
// and the read-only `system_supports_color_schemes`: what the source answers, `false` for a source
// that cannot tell (libadwaita says `false` when no settings portal reports a scheme).
// FORCE_LIGHT and FORCE_DARK pin `dark` through the source's `force`; DEFAULT and the two PREFER_*
// values let the system answer (the subset has no preference of its own to weigh against it).
//
// Also in the subset: the read-only `high_contrast`, `accent_color` (`Adw.AccentColor`),
// `accent_color_rgba` and `system_supports_accent_colors`, each answered by the source when it can
// (`false`, BLUE and "unsupported" when it cannot — libadwaita's own answer without a settings portal).
//
// Out of the subset, and so absent (a caller meets `undefined`, not a quiet no-op): `get_for_display`.
//
// A port supplies a {@link StyleSource} as the static `source` of the class it exports; the class
// reads it and notifies when it changes. `notify::dark` fires only when the value changed, as on GTK
// (`adw_style_manager_update_dark`). STATE LIVES IN WEAKMAPS, never a class field (see `application.ts`).
//
// Reference: libadwaita src/adw-style-manager.c (`dark`, `adw_style_manager_get_default`)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import {
    ADW_ACCENT_COLOR_NAMES,
    ADW_DEFAULT_ACCENT_COLOR,
    adwaitaAccentBgColor,
    adwaitaAccentColor,
    parseAdwRgb,
    type AdwAccentColorName,
} from './accent.js';
import { RGBA } from './rgba.js';
import { GIR_TYPE, GObjectObject, ParamFlags, ParamSpec, registerBaseClass } from './gobject.js';

/** Where a platform reads "is the interface dark" and hears it change. */
export interface StyleSource {
    dark(): boolean;
    /** Calls `changed` whenever `dark()` may have changed; returns the unsubscribe. */
    subscribe(changed: () => void): () => void;
    /** Pins the interface dark or light; `null` hands it back to the system. */
    force?(dark: boolean | null): void;
    /** Whether the platform reports a light/dark preference at all. Absent means it cannot. */
    supportsColorSchemes?(): boolean;
    /** Whether the platform asks for more contrast. Absent means it cannot. */
    highContrast?(): boolean;
    /** The system accent, snapped to one of the nine; `null` (or absent) when the platform has none. */
    accentColor?(): AdwAccentColorName | null;
}

/** `Adw.ColorScheme`, with the values of the GIR. */
export const ColorScheme = {
    DEFAULT: 0,
    FORCE_LIGHT: 1,
    PREFER_LIGHT: 2,
    PREFER_DARK: 3,
    FORCE_DARK: 4,
} as const;

/** `Adw.AccentColor`, with the values of the GIR, and its two functions. */
export const AccentColor = {
    BLUE: 0,
    TEAL: 1,
    GREEN: 2,
    YELLOW: 3,
    ORANGE: 4,
    RED: 5,
    PINK: 6,
    PURPLE: 7,
    SLATE: 8,
    to_rgba: (accent: number): RGBA => rgbaOf(adwaitaAccentBgColor(nameOf(accent))),
    to_standalone_rgba: (accent: number, dark: boolean): RGBA => rgbaOf(adwaitaAccentColor(nameOf(accent), dark)),
};

function nameOf(accent: number): AdwAccentColorName {
    return ADW_ACCENT_COLOR_NAMES[accent] ?? ADW_DEFAULT_ACCENT_COLOR;
}

function rgbaOf(css: string): RGBA {
    const rgb = parseAdwRgb(css)!;
    return new RGBA({ red: rgb.red, green: rgb.green, blue: rgb.blue, alpha: 1 });
}

interface Reading {
    dark: boolean;
    contrast: boolean;
    accent: number;
}

const LAST = new WeakMap<object, Reading>();

function read(source: StyleSource): Reading {
    const name = source.accentColor?.() ?? null;
    return {
        dark: source.dark(),
        contrast: source.highContrast?.() ?? false,
        accent: name === null ? AccentColor.BLUE : ADW_ACCENT_COLOR_NAMES.indexOf(name),
    };
}
const DEFAULTS = new WeakMap<object, StyleManagerBase>();
const SCHEME = new WeakMap<object, number>();

function refresh(manager: StyleManagerBase): void {
    if (!LAST.has(manager)) return;
    const last = LAST.get(manager)!;
    const next = read(sourceOf(manager));
    LAST.set(manager, next);
    if (next.dark !== last.dark) manager.notify('dark');
    if (next.contrast !== last.contrast) manager.notify('high-contrast');
    if (next.accent !== last.accent) {
        manager.notify('accent-color');
    }
}

function sourceOf(manager: object): StyleSource {
    const source = (manager.constructor as { source?: StyleSource }).source;
    if (source === undefined) {
        throw new Error('Adw.StyleManager: this class has no StyleSource; use the Adw.StyleManager of a port.');
    }
    return source;
}

export class StyleManagerBase extends GObjectObject {
    static [GIR_TYPE] = 'Adw.StyleManager';
    static source: StyleSource | undefined;

    static get_default(): StyleManagerBase {
        let manager = DEFAULTS.get(this);
        if (manager === undefined) {
            manager = new this();
            DEFAULTS.set(this, manager);
            const source = sourceOf(manager);
            LAST.set(manager, read(source));
            source.subscribe(() => refresh(manager!));
        }
        return manager;
    }

    get dark(): boolean {
        return sourceOf(this).dark();
    }

    get_dark(): boolean {
        return this.dark;
    }

    get system_supports_color_schemes(): boolean {
        return sourceOf(this).supportsColorSchemes?.() ?? false;
    }

    get_system_supports_color_schemes(): boolean {
        return this.system_supports_color_schemes;
    }

    get high_contrast(): boolean {
        return sourceOf(this).highContrast?.() ?? false;
    }

    get_high_contrast(): boolean {
        return this.high_contrast;
    }

    get system_supports_accent_colors(): boolean {
        return (sourceOf(this).accentColor?.() ?? null) !== null;
    }

    get_system_supports_accent_colors(): boolean {
        return this.system_supports_accent_colors;
    }

    get accent_color(): number {
        return read(sourceOf(this)).accent;
    }

    get_accent_color(): number {
        return this.accent_color;
    }

    get accent_color_rgba(): RGBA {
        return AccentColor.to_rgba(this.accent_color);
    }

    get_accent_color_rgba(): RGBA {
        return this.accent_color_rgba;
    }

    get color_scheme(): number {
        return SCHEME.get(this) ?? ColorScheme.DEFAULT;
    }

    set color_scheme(scheme: number) {
        if (!Object.values(ColorScheme).includes(scheme as never)) {
            throw new Error(`Adw.StyleManager: ${scheme} is not an Adw.ColorScheme`);
        }
        if (scheme === this.color_scheme) return;
        SCHEME.set(this, scheme);
        const forced = scheme === ColorScheme.FORCE_DARK ? true : scheme === ColorScheme.FORCE_LIGHT ? false : null;
        sourceOf(this).force?.(forced);
        this.notify('color-scheme');
        refresh(this);
    }

    get_color_scheme(): number {
        return this.color_scheme;
    }

    set_color_scheme(scheme: number): void {
        this.color_scheme = scheme;
    }
}

registerBaseClass(StyleManagerBase as never, 'AdwStyleManager', {}, [
    ParamSpec.boolean('dark', '', '', ParamFlags.READABLE, false),
    ParamSpec.boolean('system-supports-color-schemes', '', '', ParamFlags.READABLE, false),
    ParamSpec.boolean('high-contrast', '', '', ParamFlags.READABLE, false),
    ParamSpec.boolean('system-supports-accent-colors', '', '', ParamFlags.READABLE, false),
    ParamSpec.int('accent-color', '', '', ParamFlags.READABLE, 0, 8, 0),
    ParamSpec.int('color-scheme', '', '', ParamFlags.READWRITE, 0, 4, 0),
]);
