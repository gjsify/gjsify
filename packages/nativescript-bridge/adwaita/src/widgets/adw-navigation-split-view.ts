// AdwNavigationSplitView — a Libadwaita-style sidebar+content split for NativeScript.
//
// Extends {@link AdwSplitViewBase}: a sidebar pane (column 0) beside a content pane
// (column 1). When collapsed (narrow / phone), only one pane shows at a time —
// the sidebar when `showSidebar`, otherwise the content (the nav-stack collapse
// behaviour of `Adw.NavigationSplitView`). Mirrors it: `setSidebar`/`setContent`,
// `collapsed`, `showSidebar`, `notify::show-sidebar`.
//
// FIDELITY: approximated — see {@link AdwSplitViewBase}. `collapsed` is a manual
// flag (no automatic width breakpoint); the collapsed single-pane swap is faithful
// to the nav-split behaviour, just without the slide animation.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-navigation-split-view`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_navigation-split-view.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout } from '@nativescript/core';
import { AdwSplitViewBase } from './split-view-base.js';

export class AdwNavigationSplitView extends AdwSplitViewBase {
    constructor() {
        super('adw-navigation-split-view');
        this._applyLayout();
    }

    protected _applyLayout(): void {
        if (!this._collapsed) {
            // Side-by-side: sidebar in col 0, content in col 1.
            if (this._sidebar) {
                this._sidebar.visibility = 'visible';
                GridLayout.setColumn(this._sidebar, 0);
                this._sidebar.width = this._sidebarWidth;
            }
            if (this._content) {
                this._content.visibility = 'visible';
                GridLayout.setColumn(this._content, 1);
            }
            return;
        }
        // Collapsed: single pane. Show the sidebar OR the content, both spanning.
        if (this._sidebar) {
            this._sidebar.visibility = this._showSidebar ? 'visible' : 'collapse';
            GridLayout.setColumn(this._sidebar, 0);
            GridLayout.setColumnSpan(this._sidebar, 2);
            this._sidebar.width = 'auto' as unknown as number;
        }
        if (this._content) {
            this._content.visibility = this._showSidebar ? 'collapse' : 'visible';
            GridLayout.setColumn(this._content, 0);
            GridLayout.setColumnSpan(this._content, 2);
        }
    }
}
