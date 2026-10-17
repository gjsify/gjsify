// `Adw.StyleManager`, renderer-free: the SUBSET a widget needs to follow the system appearance —
// `get_default()`, the read-only `dark` property and `notify::dark`.
//
// Also in the subset: `color_scheme` / `set_color_scheme` / `get_color_scheme` and `Adw.ColorScheme`,
// and the read-only `system_supports_color_schemes`: what the source answers, `false` for a source
// that cannot tell (libadwaita says `false` when no settings portal reports a scheme).
// FORCE_LIGHT and FORCE_DARK pin `dark` through the source's `force`; DEFAULT and the two PREFER_*
// values let the system answer (the subset has no preference of its own to weigh against it).
//
// Out of the subset, and so absent (a caller meets `undefined`, not a quiet no-op): `get_for_display`,
// `high_contrast`, `accent_color`.
//
// A port supplies a {@link StyleSource} as the static `source` of the class it exports; the class
// reads it and notifies when it changes. `notify::dark` fires only when the value changed, as on GTK
// (`adw_style_manager_update_dark`). STATE LIVES IN WEAKMAPS, never a class field (see `application.ts`).
//
// Reference: libadwaita src/adw-style-manager.c (`dark`, `adw_style_manager_get_default`)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

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
}

/** `Adw.ColorScheme`, with the values of the GIR. */
export const ColorScheme = {
    DEFAULT: 0,
    FORCE_LIGHT: 1,
    PREFER_LIGHT: 2,
    PREFER_DARK: 3,
    FORCE_DARK: 4,
} as const;

const LAST = new WeakMap<object, boolean>();
const DEFAULTS = new WeakMap<object, StyleManagerBase>();
const SCHEME = new WeakMap<object, number>();

function refresh(manager: StyleManagerBase): void {
    if (!LAST.has(manager)) return;
    const dark = sourceOf(manager).dark();
    if (LAST.get(manager) === dark) return;
    LAST.set(manager, dark);
    manager.notify('dark');
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
            LAST.set(manager, source.dark());
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
    ParamSpec.int('color-scheme', '', '', ParamFlags.READWRITE, 0, 4, 0),
]);
