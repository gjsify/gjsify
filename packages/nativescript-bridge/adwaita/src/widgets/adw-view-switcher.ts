// AdwViewSwitcher — a Libadwaita-style top view-switcher for NativeScript.
//
// Extends {@link AdwViewSwitcherBase}: a centered bar of pill buttons (one per
// view) sitting above the content stack, the wide/desktop view-switcher form.
// Mirrors `Adw.ViewSwitcher`: `views`, `selected`, `notify::selected`.
//
// FIDELITY: approximated — see {@link AdwViewSwitcherBase} (pages swap by
// visibility toggle, no animated cross-fade; switcher buttons are real NS Buttons).
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-view-switcher`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_view-switcher.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { AdwViewSwitcherBase } from './view-switcher-base.js';

export class AdwViewSwitcher extends AdwViewSwitcherBase {
    constructor() {
        super('adw-view-switcher');
        this._initClasses();
    }

    protected get barClass(): string {
        return 'adw-view-switcher-bar';
    }

    protected get buttonClass(): string {
        return 'adw-view-switcher-button';
    }
}
