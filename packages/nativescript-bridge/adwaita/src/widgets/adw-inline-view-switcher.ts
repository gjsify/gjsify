// AdwInlineViewSwitcher — a Libadwaita-style inline (pill) view switcher for NS.
//
// Extends {@link AdwViewSwitcherBase}: the compact inline variant — a tighter,
// linked pill bar. Mirrors `Adw.InlineViewSwitcher`: `views`, `selected`,
// `notify::selected`. Shares all switching logic with {@link AdwViewSwitcher},
// differing only in the bar/button styling (the `inline` class set).
//
// FIDELITY: approximated — see {@link AdwViewSwitcherBase}.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-inline-view-switcher`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_view-switcher.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { AdwViewSwitcherBase } from './view-switcher-base.js';

export class AdwInlineViewSwitcher extends AdwViewSwitcherBase {
    constructor() {
        super('adw-inline-view-switcher');
        this._initClasses();
    }

    protected get barClass(): string {
        return 'adw-inline-view-switcher-bar';
    }

    protected get buttonClass(): string {
        return 'adw-inline-view-switcher-button';
    }
}
