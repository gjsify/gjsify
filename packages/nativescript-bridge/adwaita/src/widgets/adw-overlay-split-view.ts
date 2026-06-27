// AdwOverlaySplitView — a Libadwaita-style overlay split view for NativeScript.
//
// Extends {@link AdwSplitViewBase}: when NOT collapsed it lays sidebar+content
// side by side (like the navigation split view); when collapsed the sidebar
// OVERLAYS the content rather than replacing it (`Adw.OverlaySplitView`'s defining
// behaviour). The overlay is drawn on top of the content (NS paints children in
// add order) with a dimmed, tap-to-dismiss SCRIM beneath it, and the show/hide
// transition SLIDES the sidebar in/out + FADES the scrim. Mirrors it: `collapsed`,
// `showSidebar`, `notify::show-sidebar`, click-outside-to-close.
//
// FIDELITY: the slide + scrim fade run through the native `View.animate()` API
// (a real per-property animation — NOT the CSS subset, which has no transform
// transition), so the collapsed reveal matches Adwaita's ~200 ms motion and the
// dim-to-dismiss backdrop. Off-screen (pre-load) or off-device (the mock view
// tree in specs) it degrades to the instant `visibility` swap. The scrim + sidebar
// are RE-RAISED above the content on every layout (content < scrim < sidebar) so
// the overlay paints/hit-tests on top regardless of the order setContent /
// setSidebar / collapsed were called in. What the CSS subset still can't do:
// box-shadow and backdrop-blur — the scrim is a flat translucent fill, not a blur.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-overlay-split-view`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_overlay-split-view.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout } from '@nativescript/core';
import { AdwSplitViewBase } from './split-view-base.js';

/** Slide/fade duration (ms) — matches Adwaita's ~200 ms sidebar reveal. */
const OVERLAY_ANIM_MS = 200;

export class AdwOverlaySplitView extends AdwSplitViewBase {
    /** Dimmed backdrop drawn between content and the overlaid sidebar; tapping it
     *  closes the sidebar (Adwaita's click-outside-to-dismiss). Created lazily. */
    private _scrim: GridLayout | null = null;

    constructor() {
        super('adw-overlay-split-view');
        this._applyLayout();
    }

    protected _applyLayout(): void {
        const sidebarEnd = this._sidebarPosition === 'end';
        if (!this._collapsed) {
            // Side-by-side. `sidebar-position` decides which column each pane takes
            // (the storybook controls overlay uses `'end'` → controls on the right).
            // `show-sidebar` still applies when expanded (Adw.OverlaySplitView):
            // hiding it drops the sidebar column so the content reflows full-width
            // (e.g. the storybook controls toggle on a wide tablet/desktop screen).
            this._detachScrim();
            const showSide = this._showSidebar;
            if (this._sidebar) {
                this._sidebar.visibility = showSide ? 'visible' : 'collapse';
                this._sidebar.translateX = 0;
                this._sidebar.opacity = 1;
                GridLayout.setColumn(this._sidebar, sidebarEnd ? 1 : 0);
                GridLayout.setColumnSpan(this._sidebar, 1);
                this._sidebar.width = this._sidebarWidth;
            }
            if (this._content) {
                this._content.visibility = 'visible';
                // Span both columns when the sidebar is hidden so the content takes
                // the full width; otherwise take just its own column (the one the
                // sidebar isn't in).
                GridLayout.setColumn(this._content, showSide ? (sidebarEnd ? 0 : 1) : 0);
                GridLayout.setColumnSpan(this._content, showSide ? 1 : 2);
            }
            return;
        }
        // Collapsed: content fills both columns; the scrim + sidebar overlay on top
        // (NS paints children in add order — both are re-raised above content). `'end'`
        // anchors the overlay to the right edge.
        if (this._content) {
            this._content.visibility = 'visible';
            GridLayout.setColumn(this._content, 0);
            GridLayout.setColumnSpan(this._content, 2);
        }
        this._raiseOverlayChildren();
        if (this._scrim) {
            GridLayout.setColumn(this._scrim, 0);
            GridLayout.setColumnSpan(this._scrim, 2);
            // Resting state mirrors `showSidebar` (an animated toggle overrides it).
            this._scrim.visibility = this._showSidebar ? 'visible' : 'collapse';
            this._scrim.opacity = this._showSidebar ? 1 : 0;
        }
        if (this._sidebar) {
            GridLayout.setColumn(this._sidebar, 0);
            GridLayout.setColumnSpan(this._sidebar, 2);
            this._sidebar.width = this._sidebarWidth;
            this._sidebar.horizontalAlignment = sidebarEnd ? 'right' : 'left';
            this._sidebar.className =
                `${this._stripOverlay(this._sidebar.className)} adw-split-view-sidebar adw-overlay-active`.trim();
            this._sidebar.visibility = this._showSidebar ? 'visible' : 'collapse';
            this._sidebar.translateX = this._showSidebar ? 0 : this._hiddenOffset();
            this._sidebar.opacity = 1;
        }
    }

    /** Animate a collapsed show/hide toggle; fall back to instant off-screen/off-device. */
    protected _transitionSidebar(): void {
        if (!this._collapsed || !this._shouldAnimate()) {
            this._applyLayout();
            return;
        }
        this._cancelPending();
        // Establish structure (columns, paint order, scrim, classes) without
        // touching the animatable props — the animation owns those.
        this._prepareCollapsedStructure();
        if (this._showSidebar) this._animateOpen();
        else this._animateClose();
    }

    // --- internals ---

    /** Lazily create the tap-to-dismiss scrim. */
    private _ensureScrim(): GridLayout {
        if (this._scrim) return this._scrim;
        const scrim = new GridLayout();
        scrim.className = 'adw-overlay-scrim';
        scrim.visibility = 'collapse';
        scrim.opacity = 0;
        scrim.addEventListener('tap', () => this.hideSidebarPane());
        this._scrim = scrim;
        return scrim;
    }

    /** Re-establish paint order: content < scrim < sidebar (NS paints in add order).
     *  Removing + re-adding the scrim/sidebar keeps them above the content no matter
     *  what order setContent/setSidebar/collapsed ran in. */
    private _raiseOverlayChildren(): void {
        const scrim = this._ensureScrim();
        if (this._isChild(scrim)) this.removeChild(scrim);
        const sidebar = this._sidebar;
        if (sidebar && this._isChild(sidebar)) this.removeChild(sidebar);
        this.addChild(scrim);
        if (sidebar) this.addChild(sidebar);
    }

    /** Detach the scrim (side-by-side mode has no overlay). */
    private _detachScrim(): void {
        if (this._scrim && this._isChild(this._scrim)) this.removeChild(this._scrim);
    }

    /** Structural setup shared by the animated path (columns, order, scrim, class)
     *  — deliberately leaves translateX/opacity/visibility to the animation. */
    private _prepareCollapsedStructure(): void {
        const sidebarEnd = this._sidebarPosition === 'end';
        if (this._content) {
            this._content.visibility = 'visible';
            GridLayout.setColumn(this._content, 0);
            GridLayout.setColumnSpan(this._content, 2);
        }
        this._raiseOverlayChildren();
        if (this._scrim) {
            GridLayout.setColumn(this._scrim, 0);
            GridLayout.setColumnSpan(this._scrim, 2);
        }
        if (this._sidebar) {
            GridLayout.setColumn(this._sidebar, 0);
            GridLayout.setColumnSpan(this._sidebar, 2);
            this._sidebar.width = this._sidebarWidth;
            this._sidebar.horizontalAlignment = sidebarEnd ? 'right' : 'left';
            this._sidebar.className =
                `${this._stripOverlay(this._sidebar.className)} adw-split-view-sidebar adw-overlay-active`.trim();
        }
    }

    /** Slide the sidebar in from its edge and fade the scrim up. */
    private _animateOpen(): void {
        const scrim = this._scrim;
        if (scrim) {
            scrim.visibility = 'visible';
            scrim.opacity = 0;
            this._track(scrim.animate({ opacity: 1, duration: OVERLAY_ANIM_MS, curve: 'easeOut' }));
        }
        const sidebar = this._sidebar;
        if (sidebar) {
            sidebar.visibility = 'visible';
            sidebar.translateX = this._hiddenOffset();
            sidebar.opacity = 1;
            this._track(sidebar.animate({ translate: { x: 0, y: 0 }, duration: OVERLAY_ANIM_MS, curve: 'easeOut' }));
        }
    }

    /** Slide the sidebar back out and fade the scrim down, then collapse both. */
    private _animateClose(): void {
        const scrim = this._scrim;
        const sidebar = this._sidebar;
        const tasks: Array<Promise<void>> = [];
        if (scrim) tasks.push(this._track(scrim.animate({ opacity: 0, duration: OVERLAY_ANIM_MS, curve: 'easeIn' })));
        if (sidebar) {
            tasks.push(
                this._track(
                    sidebar.animate({
                        translate: { x: this._hiddenOffset(), y: 0 },
                        duration: OVERLAY_ANIM_MS,
                        curve: 'easeIn',
                    }),
                ),
            );
        }
        Promise.all(tasks)
            .then(() => {
                // A re-open may have raced in during the close — don't hide then.
                if (this._showSidebar) return;
                if (sidebar) sidebar.visibility = 'collapse';
                if (scrim) scrim.visibility = 'collapse';
            })
            .catch(() => {
                /* cancelled by a superseding transition — leave state to it */
            });
    }

    /** Off-screen sidebar offset: slides past the edge it's anchored to. */
    private _hiddenOffset(): number {
        return this._sidebarPosition === 'end' ? this._sidebarWidth : -this._sidebarWidth;
    }

    private _stripOverlay(className: string | undefined): string {
        return (className ?? '')
            .split(/\s+/)
            .filter((c) => c && c !== 'adw-overlay-active' && c !== 'adw-split-view-sidebar')
            .join(' ');
    }
}
