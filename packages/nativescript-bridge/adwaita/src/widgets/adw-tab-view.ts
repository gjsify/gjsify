// AdwTabView — a Libadwaita-style tabbed view for NativeScript.
//
// Extends {@link AdwViewSwitcherBase}: a top tab-bar (one tab button per page) +
// a content area, with one page visible at a time. Mirrors `Adw.TabView`: `tabs`
// (re-using the shared view-page list), `selected`, `notify::selected`.
//
// Each tab carries a small ✕ CLOSE button (an `AdwImageButton`) that shows only on
// the SELECTED tab and removes the page when tapped — matching `Adw.TabBar`, whose
// active tab is a raised pill with a close affordance (and which auto-hides the bar
// chrome when a single tab remains). The active tab is a raised rounded pill (NOT
// an accent underline) per the native look. Closing the last remaining tab is a
// no-op (an empty tab view has nothing to show).
//
// FIDELITY: approximated. NS ships a native `TabView`, but it imposes its own
// platform tab chrome (Material/UIKit), bottom-tab placement quirks, and an
// item-binding model that fights the Adwaita top-tab look. To stay visually on
// the Adwaita identity, this builds the tab bar from real NS widgets over the
// shared switcher base (a flat top tab strip) instead — pages swap by visibility
// (no slide animation). `tabs` is an alias of the base `views`.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-tab-view`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_tab-bar.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { StackLayout } from '@nativescript/core';
import { windowCloseSymbolic } from '@gjsify/adwaita-icons/ui';
import { AdwImageButton } from './adw-image-button.js';
import { AdwViewSwitcherBase, type AdwViewPage } from './view-switcher-base.js';

export class AdwTabView extends AdwViewSwitcherBase {
    /** The per-tab close buttons, parallel to {@link AdwViewSwitcherBase._buttons}. */
    private readonly _closeButtons: AdwImageButton[] = [];

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

    /** Append a small ✕ close button to each tab (shown only when active). */
    protected _buildButtonExtras(button: StackLayout, _page: AdwViewPage, index: number): void {
        const close = new AdwImageButton();
        close.className = `${close.className} adw-tab-close`.trim();
        close.icon = windowCloseSymbolic;
        close.iconSize = 12;
        close.verticalAlignment = 'middle';
        close.addEventListener('tap', () => this._closeTab(index));
        button.addChild(close);
        this._closeButtons[index] = close;
    }

    /** Reveal the close button only on the active tab (touch analogue of hover). */
    protected _applyButtonState(_button: StackLayout, index: number, active: boolean): void {
        const close = this._closeButtons[index];
        if (close) close.visibility = active ? 'visible' : 'collapse';
    }

    /** Remove a tab + its page (no-op when only one tab remains). */
    private _closeTab(index: number): void {
        if (this._pages.length <= 1) return;
        const remaining = this._pages.filter((_, i) => i !== index);
        // Keep the selection stable: closing a tab before the selected one shifts
        // the index down; closing the selected one keeps the same slot (clamped).
        if (index < this._selected || this._selected >= remaining.length) {
            this._selected = Math.max(0, this._selected - 1);
        }
        this.setViews(remaining);
    }

    /** Rebuild from scratch — drop the stale per-tab close-button refs first. */
    setViews(pages: AdwViewPage[]): void {
        this._closeButtons.length = 0;
        super.setViews(pages);
    }

    /** The tab pages — an alias of the shared {@link AdwViewSwitcherBase.views}. */
    get tabs(): AdwViewPage[] {
        return this.views;
    }

    set tabs(pages: AdwViewPage[]) {
        this.views = pages;
    }
}
