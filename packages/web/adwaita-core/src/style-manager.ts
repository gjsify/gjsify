// `Adw.StyleManager`, renderer-free: the SUBSET a widget needs to follow the system appearance —
// `get_default()`, the read-only `dark` property and `notify::dark`.
//
// Out of the subset, and so absent (a caller meets `undefined`, not a quiet no-op): `color_scheme`,
// `set_color_scheme`, `get_for_display`, `system_supports_color_schemes`, `high_contrast`, `accent_color`
// and `Adw.ColorScheme`. Forcing a scheme is the app's own call on a port (`setAdwaitaColorScheme`),
// not a property of this object, so a port's `source` answers `dark` and nothing here writes it.
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
}

const LAST = new WeakMap<object, boolean>();
const DEFAULTS = new WeakMap<object, StyleManagerBase>();

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
            source.subscribe(() => {
                const dark = source.dark();
                if (LAST.get(manager!) === dark) return;
                LAST.set(manager!, dark);
                manager!.notify('dark');
            });
        }
        return manager;
    }

    get dark(): boolean {
        return sourceOf(this).dark();
    }

    get_dark(): boolean {
        return this.dark;
    }
}

registerBaseClass(StyleManagerBase as never, 'AdwStyleManager', {}, [
    ParamSpec.boolean('dark', '', '', ParamFlags.READABLE, false),
]);
