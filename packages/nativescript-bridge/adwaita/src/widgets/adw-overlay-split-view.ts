// AdwOverlaySplitView — a Libadwaita-style overlay split view for NativeScript.
//
// Extends {@link AdwSplitViewBase}: when NOT collapsed it lays sidebar+content
// side by side (like the navigation split view); when collapsed the sidebar
// OVERLAYS the content rather than replacing it (`Adw.OverlaySplitView`'s defining
// behaviour). The overlay is achieved by giving the content full column-span
// (rows 0, cols 0–1) and drawing the sidebar on top of column 0 with a scrim
// look. Mirrors it: `collapsed`, `showSidebar`, `notify::show-sidebar`.
//
// FIDELITY: compromised on the overlay polish. The NS CSS subset has no z-index,
// box-shadow, backdrop-blur, or slide transform, so the "sidebar over content"
// effect relies on later-added children painting on top within the same grid cell
// (NS paints in add order) plus an opaque sidebar background — there is NO dimming
// scrim blur and NO slide-in animation. The SHOW/HIDE state machine and the
// non-collapsed side-by-side layout are faithful.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-overlay-split-view`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_overlay-split-view.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout } from '@nativescript/core';
import { AdwSplitViewBase } from './split-view-base.js';

export class AdwOverlaySplitView extends AdwSplitViewBase {
    constructor() {
        super('adw-overlay-split-view');
        this._applyLayout();
    }

    protected _applyLayout(): void {
        if (!this._collapsed) {
            // Side-by-side, same as the navigation split view's expanded layout.
            if (this._sidebar) {
                this._sidebar.visibility = 'visible';
                GridLayout.setColumn(this._sidebar, 0);
                GridLayout.setColumnSpan(this._sidebar, 1);
                this._sidebar.width = this._sidebarWidth;
            }
            if (this._content) {
                this._content.visibility = 'visible';
                GridLayout.setColumn(this._content, 1);
                GridLayout.setColumnSpan(this._content, 1);
            }
            return;
        }
        // Collapsed: content fills both columns; sidebar overlays column 0 on top
        // (NS paints children in add order — the sidebar was added after content
        // in setSidebar/setContent order, so re-assert it draws last when shown).
        if (this._content) {
            this._content.visibility = 'visible';
            GridLayout.setColumn(this._content, 0);
            GridLayout.setColumnSpan(this._content, 2);
        }
        if (this._sidebar) {
            this._sidebar.visibility = this._showSidebar ? 'visible' : 'collapse';
            GridLayout.setColumn(this._sidebar, 0);
            GridLayout.setColumnSpan(this._sidebar, 1);
            this._sidebar.width = this._sidebarWidth;
            this._sidebar.className = `${this._stripOverlay(this._sidebar.className)} adw-split-view-sidebar adw-overlay-active`.trim();
        }
    }

    private _stripOverlay(className: string | undefined): string {
        return (className ?? '')
            .split(/\s+/)
            .filter((c) => c && c !== 'adw-overlay-active' && c !== 'adw-split-view-sidebar')
            .join(' ');
    }
}
