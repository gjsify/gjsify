// AdwToggle — one toggle of an `Adw.ToggleGroup`, for NativeScript.
//
// NOT A VIEW, and that is the libadwaita shape rather than a shortcut: `AdwToggle` is a
// GObject the group turns into a button of its own (adw-toggle-group.c:861), so a `.blp`
// writes `Adw.Toggle { name: "grid"; … }` inside the group and the group decides what it
// looks like. It is an `Observable` — the GObject half of a NativeScript view, which is
// what carries `connect`/`notify` — and `AdwToggleGroup._addChildFromBuilder` receives it
// and builds the segment. `<adw-toggle>` is the web's counterpart, a data element the
// group consumes the same way.
//
// THE PROPERTIES ARE THE ONES THE GROUP RENDERS, and only those. GTK's toggle also has
// `tooltip`, `description`, `enabled`, `use-underline` and `child`; declaring them here
// while the group ignored them would let the shared-tree builder accept an authored value
// and draw nothing for it. Undeclared, the builder refuses them by name instead, and
// `check-nativescript-widget-coverage.mjs` holds the reason.
//
// Reference: refs/libadwaita/src/adw-toggle-group.c (AdwToggle properties, :405-513)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { Observable } from '@nativescript/core';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';

export class AdwToggle extends withSignals(Observable) {
    private _name: string | null = null;
    private _label = '';
    private _iconName: string | null = null;

    constructor(props?: ConstructProps<AdwToggle>) {
        super();
        applyConstructProps(this, props);
    }

    /** `Adw.Toggle:name` — how `Adw.ToggleGroup:active-name` finds this toggle. */
    get name(): string | null {
        return this._name;
    }

    set name(value: string | null) {
        this._name = value;
    }

    /** `Adw.Toggle:label`. */
    get label(): string {
        return this._label;
    }

    set label(value: string | null) {
        this._label = value ?? '';
    }

    /** `Adw.Toggle:icon-name` — a symbolic icon drawn before the label. */
    get iconName(): string | null {
        return this._iconName;
    }

    set iconName(value: string | null) {
        this._iconName = value;
    }
}
