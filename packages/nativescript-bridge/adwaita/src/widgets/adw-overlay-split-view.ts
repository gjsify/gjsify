// AdwOverlaySplitView — a Libadwaita-style overlay split view for NativeScript.
//
// Extends {@link AdwSplitViewBase}: uncollapsed it lays sidebar+content side by side,
// collapsed the sidebar OVERLAYS the content rather than replacing it, drawn on top of
// it (NS paints children in add order) over a dimmed tap-to-dismiss SCRIM.
//
// The property interplay is NOT here — it is `NsOverlaySplitViewState`, over the
// headless `OverlaySplitViewState` (ADR 0004). This file is the view-tree half only:
// columns, paint order, `visibility`, the slide/fade animation, and the
// `isUserInteractionEnabled` pair that keeps the off-screen pane out of the focus and
// screen-reader order (GTK's `gtk_widget_set_can_focus`).
//
// FIDELITY: the slide + scrim fade run through the native `View.animate()` API, not the
// CSS subset (which has no transform transition), and degrade to an instant
// `visibility` swap off-screen or off-device. The scrim + sidebar are RE-RAISED above
// the content on every layout (content < scrim < sidebar) so the overlay
// paints/hit-tests on top whatever order setContent / setSidebar / collapsed came in.
// Still out of reach: box-shadow and backdrop-blur — the scrim is a flat fill.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-overlay-split-view`.
// Reference: refs/libadwaita/src/adw-overlay-split-view.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_misc.scss (overlay-split-view transition shadows)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout } from '@nativescript/core';
import { AdwSplitViewBase } from './split-view-base.js';
import { NsOverlaySplitViewState, splitViewColumns } from './split-view-state.js';
import { xmlBoolean } from './xml-values.js';

/** Slide/fade duration (ms) — matches Adwaita's ~200 ms sidebar reveal. */
const OVERLAY_ANIM_MS = 200;

export class AdwOverlaySplitView extends AdwSplitViewBase<NsOverlaySplitViewState> {
    /** Dimmed backdrop drawn between content and the overlaid sidebar; tapping it
     *  closes the sidebar (Adwaita's click-outside-to-dismiss). Created lazily. */
    private _scrim: GridLayout | null = null;

    constructor() {
        super('adw-overlay-split-view', 'overlay', new NsOverlaySplitViewState());
        this._applyLayout();
    }

    /**
     * `Adw.OverlaySplitView:pin-sidebar` (adw-overlay-split-view.c:990-992,
     * default FALSE) — whether collapsing leaves the sidebar's visibility alone.
     */
    get pinSidebar(): boolean {
        return this._state.pinSidebar;
    }

    set pinSidebar(raw: boolean | string) {
        const value = xmlBoolean(raw, this.pinSidebar);
        this._state.setPinSidebar(!!value);
    }

    protected _applyLayout(): void {
        const columns = splitViewColumns(this._state.sidebarPosition);
        const sidebarEnd = this._state.sidebarPosition === 'end';
        if (!this._state.collapsed) {
            // Side-by-side. `sidebar-position` decides which column each pane takes
            // (the storybook controls overlay uses `'end'` → controls on the right).
            // `show-sidebar` still applies when expanded (Adw.OverlaySplitView):
            // hiding it drops the sidebar column so the content reflows full-width
            // (e.g. the storybook controls toggle on a wide tablet/desktop screen).
            this._detachScrim();
            const showSide = this._state.showSidebar;
            if (this._sidebar) {
                this._sidebar.visibility = showSide ? 'visible' : 'collapse';
                this._sidebar.translateX = 0;
                this._sidebar.opacity = 1;
                GridLayout.setColumn(this._sidebar, columns.sidebar);
                GridLayout.setColumnSpan(this._sidebar, 1);
                this._sidebar.width = this.sidebarWidth;
                // `update_collapsed` REMOVES `overlay-pane` and re-adds `sidebar-pane`
                // when the view uncollapses (:730-738). Stripping it only in the
                // collapsed branches left the class — and the edge alignment the
                // overlay was anchored with — on the docked pane forever. Invisible
                // today only because `.adw-overlay-active` and
                // `.adw-split-view-sidebar` happen to paint the same fill; the
                // alignment is not, and neither would survive a theme change.
                this._sidebar.className = this._paneClassName(this._sidebar.className, false);
                this._sidebar.horizontalAlignment = 'stretch';
            }
            if (this._content) {
                this._content.visibility = 'visible';
                // Span both columns when the sidebar is hidden so the content takes
                // the full width; otherwise take just its own column (the one the
                // sidebar isn't in).
                GridLayout.setColumn(this._content, showSide ? columns.content : 0);
                GridLayout.setColumnSpan(this._content, showSide ? 1 : 2);
            }
            this._applyPaneFocus();
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
            // Resting state mirrors the shield the state derives (collapsed AND
            // revealed); an animated toggle overrides it.
            this._scrim.visibility = this._state.shieldVisible ? 'visible' : 'collapse';
            this._scrim.opacity = this._state.shieldVisible ? 1 : 0;
        }
        if (this._sidebar) {
            GridLayout.setColumn(this._sidebar, 0);
            GridLayout.setColumnSpan(this._sidebar, 2);
            this._sidebar.width = this.sidebarWidth;
            this._sidebar.horizontalAlignment = sidebarEnd ? 'right' : 'left';
            this._sidebar.className = this._paneClassName(this._sidebar.className, true);
            this._sidebar.visibility = this._state.showSidebar ? 'visible' : 'collapse';
            this._sidebar.translateX = this._state.showSidebar ? 0 : this._hiddenOffset();
            this._sidebar.opacity = 1;
        }
        this._applyPaneFocus();
    }

    /** Animate a collapsed show/hide toggle; fall back to instant off-screen/off-device. */
    protected _transitionSidebar(): void {
        if (!this._state.collapsed || !this._shouldAnimate()) {
            this._applyLayout();
            return;
        }
        this._cancelPending();
        // Establish structure (columns, paint order, scrim, classes) without
        // touching the animatable props — the animation owns those.
        this._prepareCollapsedStructure();
        this._applyPaneFocus();
        if (this._state.showSidebar) this._animateOpen();
        else this._animateClose();
    }

    // --- internals ---

    /**
     * `gtk_widget_set_can_focus (sidebar_bin, !collapsed || show_sidebar)` and its
     * mirror (:330-331, :1460-1461), as NativeScript spells it.
     *
     * Without this the pane hidden UNDER the overlay keeps answering taps and stays
     * in the screen-reader order — the scrim only shields the area it covers, and a
     * `translateX`-ed sidebar is not covered at all.
     *
     * DEVIATION the C cannot settle: GTK sets `can-focus` on its own `AdwBin`
     * WRAPPER, leaving the application's child untouched. NativeScript has no such
     * wrapper — the pane IS the view the consumer handed us — so this writes on
     * their view, and a pane the app deliberately made non-interactive is made
     * interactive again the next time it comes on screen.
     */
    private _applyPaneFocus(): void {
        if (this._sidebar) this._sidebar.isUserInteractionEnabled = this._state.sidebarFocusable;
        if (this._content) this._content.isUserInteractionEnabled = this._state.contentFocusable;
    }

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
        const sidebarEnd = this._state.sidebarPosition === 'end';
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
            this._sidebar.width = this.sidebarWidth;
            this._sidebar.horizontalAlignment = sidebarEnd ? 'right' : 'left';
            this._sidebar.className = this._paneClassName(this._sidebar.className, true);
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
                if (this._state.showSidebar) return;
                if (sidebar) sidebar.visibility = 'collapse';
                if (scrim) scrim.visibility = 'collapse';
            })
            .catch(() => {
                /* cancelled by a superseding transition — leave state to it */
            });
    }

    /** Off-screen sidebar offset: slides past the edge it's anchored to. */
    private _hiddenOffset(): number {
        const width = this.sidebarWidth;
        return this._state.sidebarPosition === 'end' ? width : -width;
    }

    /**
     * The sidebar pane's class list for the current mode — the NativeScript
     * spelling of `update_collapsed`'s css-class swap (:727-738): `overlay-pane`
     * while collapsed, `sidebar-pane` while docked, never both.
     */
    private _paneClassName(className: string | undefined, overlay: boolean): string {
        const base = (className ?? '')
            .split(/\s+/)
            .filter((c) => c && c !== 'adw-overlay-active' && c !== 'adw-split-view-sidebar')
            .join(' ');
        return `${base} adw-split-view-sidebar${overlay ? ' adw-overlay-active' : ''}`.trim();
    }
}
