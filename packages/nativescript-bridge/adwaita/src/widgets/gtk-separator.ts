// GtkSeparator — a thin dividing line, for NativeScript.
//
// A `GridLayout` with no children whose one dimension the theme fixes at a hairline:
// `.adw-separator.horizontal` is 1 DIP tall and stretches across, `.vertical` is 1 DIP wide
// and stretches down (`separator` in `_misc.scss`, `min-width/min-height: 1px`). The
// orientation is the widget's own, defaulting to `horizontal` as `GtkOrientable` does, and
// it is a CLASS, so a `.blp`'s `orientation: vertical` and a later write both land through
// the same restyle.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_misc.scss (separator)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { normalizeBoxOrientation } from '@gjsify/adwaita-core';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import type { BoxOrientation } from './box-layout.js';
import { AdwStyledLayoutBase } from './styled-layout-base.js';

export class GtkSeparator extends AdwStyledLayoutBase {
    private _orientation: BoxOrientation = 'horizontal';

    constructor(props?: ConstructProps<GtkSeparator>) {
        super();
        this._restyle();
        applyConstructProps(this, props);
    }

    /** `Gtk.Orientable:orientation` — `horizontal` (the default) or `vertical`. */
    get orientation(): BoxOrientation {
        return this._orientation;
    }

    set orientation(value: BoxOrientation) {
        // `Gtk.Orientation.VERTICAL` is 1, as `Gtk.Box` reads it.
        const next = normalizeBoxOrientation((value as unknown) === 1 ? 'vertical' : value);
        if (next === this._orientation) return;
        this._orientation = next;
        this._restyle();
        this.notify({ eventName: 'notify::orientation', object: this });
    }

    protected get _ownClass(): string {
        return `adw-separator ${this._orientation}`;
    }
}
