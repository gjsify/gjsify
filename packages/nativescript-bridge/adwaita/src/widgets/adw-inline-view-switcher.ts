// AdwInlineViewSwitcher — a Libadwaita-style inline (pill) view switcher for NS.
//
// Extends {@link AdwViewSwitcherBase}: the compact inline variant — a tighter,
// linked pill bar. Mirrors `Adw.InlineViewSwitcher`: `views`, `selected`,
// `displayMode`, `notify::selected`. Shares all switching logic with
// {@link AdwViewSwitcher}, differing in the bar/button styling (the `inline`
// class set) and in having a DISPLAY MODE at all.
//
// The display mode was missing entirely: the inherited base always built icon +
// label, i.e. a hard-wired `both`, where libadwaita defaults to `labels`
// (adw-inline-view-switcher.c:657, :715) and rejects an unrecognised value
// rather than falling back to one (`g_return_if_fail (mode <= …_BOTH)`, :819).
//
// FIDELITY: approximated — see {@link AdwViewSwitcherBase}. The two INDEX SPACES
// libadwaita maintains (a hidden page produces no toggle, so the toggle index and
// the page index diverge) are not observable here: NS collapses a hidden page's
// button in place rather than removing it, so the widget's `selected` is always
// the PAGE index. `toggleIndexForPage`/`pageIndexForToggle` in
// `@gjsify/adwaita-core` are what a future NS switcher that really removes them
// would use.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-inline-view-switcher`.
// Reference: refs/libadwaita/src/adw-inline-view-switcher.c (AdwInlineViewSwitcher)
// Reference: refs/libadwaita/src/stylesheet/widgets/_toggle-group.scss
// Copyright (c) 2023 Maximiliano Sandoval / 2024 GNOME Foundation Inc. (libadwaita). LGPLv2.1+.

import { isInlineViewSwitcherDisplayMode } from '@gjsify/adwaita-core';
import type { AdwInlineViewSwitcherDisplayMode } from '@gjsify/adwaita-core';
import { AdwViewSwitcherBase } from './view-switcher-base.js';
import type { ViewSwitcherKind } from './view-switcher-model.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

export class AdwInlineViewSwitcher extends AdwViewSwitcherBase {
    // libadwaita's default, and the class the toggle group starts with
    // (adw-inline-view-switcher.c:657, :715).
    private _displayMode: AdwInlineViewSwitcherDisplayMode = 'labels';

    constructor(props?: ConstructProps<AdwInlineViewSwitcher>) {
        super('adw-inline-view-switcher');
        this._initClasses();

        applyConstructProps(this, props);
    }

    protected get barClass(): string {
        return 'adw-inline-view-switcher-bar';
    }

    protected get buttonClass(): string {
        return 'adw-inline-view-switcher-button';
    }

    protected override get buttonDisplayMode(): AdwInlineViewSwitcherDisplayMode {
        return this._displayMode;
    }

    /**
     * `populate_group` gates on the page's `visible` ALONE
     * (adw-inline-view-switcher.c:370-378) — the title-or-icon rule the base
     * follows belongs to `AdwViewSwitcher.update_button`
     * (adw-view-switcher.c:178) and has no counterpart here, so a page with
     * neither title nor icon still gets an (empty) toggle.
     *
     * Inheriting the stricter rule made this switcher drop toggles libadwaita
     * draws. The rule itself lives in {@link switcherButtonVisible}, where a
     * spec can reach it.
     */
    protected override get switcherKind(): ViewSwitcherKind {
        return 'inline';
    }

    /** What the toggles display: `'labels'` (default), `'icons'` or `'both'`. */
    get displayMode(): AdwInlineViewSwitcherDisplayMode {
        return this._displayMode;
    }

    /**
     * Set the display mode. An unrecognised value is REJECTED and leaves the
     * current mode alone — `g_return_if_fail (mode <= ADW_INLINE_VIEW_SWITCHER_BOTH)`
     * returns before `self->display_mode` is touched
     * (adw-inline-view-switcher.c:819). The browser port used to replace the
     * current mode with `'both'` there.
     */
    set displayMode(value: AdwInlineViewSwitcherDisplayMode) {
        if (!isInlineViewSwitcherDisplayMode(value)) return;
        if (value === this._displayMode) return;
        this._displayMode = value;
        // C rebuilds every toggle's child on a mode change (:852-854); here the
        // nodes persist and only what they carry is repainted.
        this._applySelection();
    }
}
