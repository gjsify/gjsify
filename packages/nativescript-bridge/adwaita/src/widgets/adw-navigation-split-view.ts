// AdwNavigationSplitView — a Libadwaita-style sidebar+content split for NativeScript.
//
// Extends {@link AdwSplitViewBase}: a sidebar pane beside a content pane. When
// collapsed (narrow / phone), only one pane shows at a time — which one is the top
// of the navigation stack `Adw.NavigationSplitView` maintains, not a boolean. That
// distinction is the whole widget: the stack keeps a LONE child visible whatever
// `show-content` says (adw-navigation-split-view.c:389-401), and with
// `sidebar-position: end` the CONTENT is the root page, so showing it is a POP and
// hiding it a PUSH (:1414-1428). Mirrors it: `setSidebar`/`setContent`,
// `collapsed`, `showSidebar`, `sidebarPosition`, `notify::show-sidebar`.
//
// The ordering table is NOT here — it is `NsNavigationSplitViewState`, over the
// headless `NavigationSplitViewState` (ADR 0004). This file is only the view-tree
// half: columns, `visibility`, and the push/pop slide.
//
// FIDELITY: approximated — see {@link AdwSplitViewBase}. `collapsed` is a manual
// flag (no automatic width breakpoint). The collapsed single-pane swap is animated
// on-device: the incoming pane slides in from the trailing edge on a PUSH while the
// outgoing pane slides off the leading edge (and the reverse on a POP), via the
// native `View.animate()` API — Adwaita's master→detail push/pop. Off-screen /
// off-device it degrades to the instant `visibility` swap.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-navigation-split-view`.
// Reference: refs/libadwaita/src/adw-navigation-split-view.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, type View } from '@nativescript/core';
import { AdwSplitViewBase } from './split-view-base.js';
import { NsNavigationSplitViewState, splitViewColumns } from './split-view-state.js';
import type { NavigationActionResult } from '@gjsify/adwaita-core';
import { xmlBoolean } from './xml-values.js';

/** Push/pop duration (ms) — matches Adwaita's ~200 ms navigation transition. */
const NAV_ANIM_MS = 200;

/** Fallback pane width (DIPs) when the view hasn't been measured yet. */
const FALLBACK_WIDTH = 1024;

export class AdwNavigationSplitView extends AdwSplitViewBase<NsNavigationSplitViewState> {
    constructor() {
        super(
            'adw-navigation-split-view',
            'navigation',
            new NsNavigationSplitViewState({
                onCritical: (message) => console.error(message),
                // `navigation_push_cb` offers an unmatched tag to the PARENT
                // before it may become a critical (:679-683) — the mechanism a
                // nested split view forwards a push with. NativeScript has no
                // bubbling events, so the walk up `parent` is the equivalent.
                onDelegate: (action, tag) => {
                    for (let node = this.parent; node; node = node.parent) {
                        if (!(node instanceof AdwNavigationSplitView)) continue;
                        const result = action === 'push' ? node.push(tag as string) : node.pop();
                        return result.kind !== 'not-found';
                    }
                    return false;
                },
            }),
        );
        this._applyLayout();
    }

    protected _applyLayout(): void {
        if (!this._state.collapsed) {
            // Side-by-side. Which column each pane takes follows `sidebar-position`
            // — the sidebar's column is the fixed one, the content's the expanding
            // one (`allocate_uncollapsed`, :306-316). Writing the sidebar into
            // column 0 unconditionally put an `end` sidebar in the EXPANDING column
            // and squeezed the content into the fixed one: a fully inverted layout.
            const columns = splitViewColumns(this._state.sidebarPosition, this.textDirection);
            if (this._sidebar) {
                this._sidebar.visibility = 'visible';
                this._sidebar.translateX = 0;
                GridLayout.setColumn(this._sidebar, columns.sidebar);
                GridLayout.setColumnSpan(this._sidebar, 1);
                this._sidebar.width = this.sidebarWidth;
            }
            if (this._content) {
                this._content.visibility = 'visible';
                this._content.translateX = 0;
                GridLayout.setColumn(this._content, columns.content);
                GridLayout.setColumnSpan(this._content, 1);
            }
            return;
        }
        // Collapsed: a single pane, spanning both columns. WHICH pane is the top of
        // the navigation stack — keying it on `showSidebar` alone rendered a split
        // view holding only a sidebar blank, because the flag says "content" while
        // there is no content to show.
        const visible = this._state.visiblePane;
        if (this._sidebar) {
            this._sidebar.visibility = visible === 'sidebar' ? 'visible' : 'collapse';
            this._sidebar.translateX = 0;
            GridLayout.setColumn(this._sidebar, 0);
            GridLayout.setColumnSpan(this._sidebar, 2);
            this._sidebar.width = 'auto' as unknown as number;
        }
        if (this._content) {
            this._content.visibility = visible === 'content' ? 'visible' : 'collapse';
            this._content.translateX = 0;
            GridLayout.setColumn(this._content, 0);
            GridLayout.setColumnSpan(this._content, 2);
        }
    }

    /** Animate the collapsed master⇄detail swap; instant off-screen/off-device. */
    protected _transitionSidebar(): void {
        if (!this._shouldAnimate() || !this._sidebar || !this._content) {
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
        // The direction is the STACK's, not the flag's: a PUSH brings the incoming
        // pane in from the trailing edge and takes the outgoing one off the leading
        // edge, a POP is the reverse. With `sidebar-position: end` showing the
        // content is a POP — taking the direction from `showSidebar` ran that swap
        // backwards for the whole life of the widget.
        const push = this._state.transition === 'push';
        const incoming = this._state.visiblePane === 'sidebar' ? this._sidebar : this._content;
        const outgoing = incoming === this._sidebar ? this._content : this._sidebar;
        const enterFrom = push ? w : -w;
        const leaveTo = push ? -w : w;

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
        const stillIncoming = this._state.visiblePane === 'sidebar' ? this._sidebar : this._content;
        if (stillIncoming !== incoming) return; // direction reversed mid-flight
        outgoing.visibility = 'collapse';
        outgoing.translateX = 0;
    }

    /** Full-width of a collapsed pane (post-layout), or a fallback before measure. */
    private _paneWidth(): number {
        const size = this.getActualSize();
        return size && size.width > 0 ? size.width : FALLBACK_WIDTH;
    }

    // --- tags + the navigation.* actions ---
    //
    // Explicit setters rather than a `tag` property read off the pane `View`:
    // a `View` is not an `Adw.NavigationPage`, and reading one would adopt
    // whatever NativeScript happens to put there. The tag of record lives in the
    // core, because a collision CLEARS it and silently mutating a caller's view
    // to do that would be a surprise.

    /** `Adw.NavigationPage:tag` for the sidebar pane, or `null` when untagged. */
    get sidebarTag(): string | null {
        return this._state.sidebarTag;
    }

    set sidebarTag(value: string | null) {
        this._state.setTag('sidebar', value);
    }

    /** `Adw.NavigationPage:tag` for the content pane, or `null` when untagged. */
    get contentTag(): string | null {
        return this._state.contentTag;
    }

    set contentTag(value: string | null) {
        this._state.setTag('content', value);
    }

    /**
     * `navigation.push` with `tag` — `navigation_push_cb` (:644-685).
     *
     * An unmatched tag delegates to the parent before it may become a critical,
     * which is how a nested split view forwards a push outwards. Returns what
     * the routing decided; the ten-row NAVIGATION_ACTION_VECTORS table had no
     * consumer in either renderer before this.
     */
    push(tag: string): NavigationActionResult {
        return this._state.push(tag);
    }

    /** `navigation.pop` — `navigation_pop_cb` (:687-702). */
    pop(): NavigationActionResult {
        return this._state.pop();
    }

    /** `Adw.NavigationSplitView:show-content`, the C's own spelling of the flag. */
    get showContent(): boolean {
        return this._state.showContent;
    }

    set showContent(raw: boolean | string) {
        const value = xmlBoolean(raw, this.showContent);
        this._state.showContent = value;
    }
}
