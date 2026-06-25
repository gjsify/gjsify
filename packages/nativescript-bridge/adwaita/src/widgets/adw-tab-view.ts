// AdwTabView — a Libadwaita-style tabbed view for NativeScript.
//
// Extends {@link AdwViewSwitcherBase}: a top tab-bar (one tab button per page) +
// a content area, with one page visible at a time. Mirrors `Adw.TabView`: `tabs`
// (re-using the shared view-page list), `selected`, `notify::selected`.
//
// FIDELITY: approximated. NS ships a native `TabView`, but it imposes its own
// platform tab chrome (Material/UIKit), bottom-tab placement quirks, and an
// item-binding model that fights the Adwaita top-tab look. To stay visually on
// the Adwaita identity, this builds the tab bar from real NS `Button`s over the
// shared switcher base (a flat top tab strip) instead — pages swap by visibility
// (no slide animation). `tabs` is an alias of the base `views`.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-tab-view`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_tab-bar.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { AdwViewSwitcherBase, type AdwViewPage } from './view-switcher-base.js';

export class AdwTabView extends AdwViewSwitcherBase {
    constructor() {
        super('adw-tab-view');
        this._initClasses();
        // The tab bar spans the full width (not centered like a view switcher).
        this._bar.horizontalAlignment = 'stretch';
    }

    protected get barClass(): string {
        return 'adw-tab-view-bar';
    }

    protected get buttonClass(): string {
        return 'adw-tab-view-tab';
    }

    /** The tab pages — an alias of the shared {@link AdwViewSwitcherBase.views}. */
    get tabs(): AdwViewPage[] {
        return this.views;
    }

    set tabs(pages: AdwViewPage[]) {
        this.views = pages;
    }
}
