// AdwNavigationSplitView — a Libadwaita-style sidebar+content split for NativeScript.
//
// Extends {@link AdwSplitViewBase}: a sidebar pane (column 0) beside a content pane
// (column 1). When collapsed (narrow / phone), only one pane shows at a time —
// the sidebar when `showSidebar`, otherwise the content (the nav-stack collapse
// behaviour of `Adw.NavigationSplitView`). Mirrors it: `setSidebar`/`setContent`,
// `collapsed`, `showSidebar`, `notify::show-sidebar`.
//
// FIDELITY: approximated — see {@link AdwSplitViewBase}. `collapsed` is a manual
// flag (no automatic width breakpoint). The collapsed single-pane swap is animated
// on-device: pushing to the detail slides the incoming pane in from the trailing
// edge while the outgoing pane slides off the leading edge (and the reverse on
// back), via the native `View.animate()` API — Adwaita's master→detail push/pop.
// Off-screen / off-device it degrades to the instant `visibility` swap.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-navigation-split-view`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_navigation-split-view.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, type View } from '@nativescript/core';
import { AdwSplitViewBase } from './split-view-base.js';

/** Push/pop duration (ms) — matches Adwaita's ~200 ms navigation transition. */
const NAV_ANIM_MS = 200;

/** Fallback pane width (DIPs) when the view hasn't been measured yet. */
const FALLBACK_WIDTH = 1024;

export class AdwNavigationSplitView extends AdwSplitViewBase {
    constructor() {
        super('adw-navigation-split-view', 'navigation');
        this._applyLayout();
    }

    protected _applyLayout(): void {
        if (!this._collapsed) {
            // Side-by-side: sidebar in col 0, content in col 1.
            if (this._sidebar) {
                this._sidebar.visibility = 'visible';
                this._sidebar.translateX = 0;
                GridLayout.setColumn(this._sidebar, 0);
                GridLayout.setColumnSpan(this._sidebar, 1);
                this._sidebar.width = this.sidebarWidth;
            }
            if (this._content) {
                this._content.visibility = 'visible';
                this._content.translateX = 0;
                GridLayout.setColumn(this._content, 1);
                GridLayout.setColumnSpan(this._content, 1);
            }
            return;
        }
        // Collapsed: single pane. Show the sidebar OR the content, both spanning.
        if (this._sidebar) {
            this._sidebar.visibility = this._showSidebar ? 'visible' : 'collapse';
            this._sidebar.translateX = 0;
            GridLayout.setColumn(this._sidebar, 0);
            GridLayout.setColumnSpan(this._sidebar, 2);
            this._sidebar.width = 'auto' as unknown as number;
        }
        if (this._content) {
            this._content.visibility = this._showSidebar ? 'collapse' : 'visible';
            this._content.translateX = 0;
            GridLayout.setColumn(this._content, 0);
            GridLayout.setColumnSpan(this._content, 2);
        }
    }

    /** Animate the collapsed master⇄detail swap; instant off-screen/off-device. */
    protected _transitionSidebar(): void {
        if (!this._collapsed || !this._shouldAnimate() || !this._sidebar || !this._content) {
            this._applyLayout();
            return;
        }
        this._cancelPending();
        // Both panes span the full width during the swap (NS paints in add order).
        for (const pane of [this._sidebar, this._content]) {
            GridLayout.setColumn(pane, 0);
            GridLayout.setColumnSpan(pane, 2);
        }
        this._sidebar.width = 'auto' as unknown as number;

        const w = this._paneWidth();
        // `showSidebar` → back (master enters from the left, detail leaves right);
        // otherwise → forward (detail enters from the right, master leaves left).
        const incoming = this._showSidebar ? this._sidebar : this._content;
        const outgoing = this._showSidebar ? this._content : this._sidebar;
        const enterFrom = this._showSidebar ? -w : w;
        const leaveTo = this._showSidebar ? w : -w;

        incoming.visibility = 'visible';
        incoming.translateX = enterFrom;
        outgoing.visibility = 'visible';
        outgoing.translateX = 0;

        this._track(incoming.animate({ translate: { x: 0, y: 0 }, duration: NAV_ANIM_MS, curve: 'easeOut' }));
        const out = this._track(
            outgoing.animate({ translate: { x: leaveTo, y: 0 }, duration: NAV_ANIM_MS, curve: 'easeIn' }),
        );
        out.then(() => this._settleAfterSwap(incoming, outgoing)).catch(() => {
            /* cancelled by a superseding transition — leave state to it */
        });
    }

    /** Collapse the pane that slid out (unless a reverse swap raced in). */
    private _settleAfterSwap(incoming: View, outgoing: View): void {
        const shouldShowSidebar = this._showSidebar;
        const stillIncoming = shouldShowSidebar ? this._sidebar : this._content;
        if (stillIncoming !== incoming) return; // direction reversed mid-flight
        outgoing.visibility = 'collapse';
        outgoing.translateX = 0;
    }

    /** Full-width of a collapsed pane (post-layout), or a fallback before measure. */
    private _paneWidth(): number {
        const size = this.getActualSize();
        return size && size.width > 0 ? size.width : FALLBACK_WIDTH;
    }
}
