// <adw-navigation-split-view> — A docked sidebar beside content. Both panes are
// visible when expanded; when `collapsed` it shows one pane at a time
// (`show-content` decides which), mirroring Adw.NavigationSplitView's
// push-navigation on narrow widths.
//
// Attributes: collapsed, show-content, sidebar-position, min-sidebar-width,
//   max-sidebar-width, breakpoint (an Adwaita condition, e.g. "max-width: 720px",
//   that collapses the view by itself — the counterpart to an Adw.Breakpoint
//   add_setter()). A slotted pane may carry `tag`, which is
//   `Adw.NavigationPage:tag`.
// Slots: slot="sidebar", slot="content".
//
// The element used to toggle two CSS classes and nothing else, so THREE rules
// from the C had no expression here at all: the navigation-stack ordering table
// (a LONE child stays visible whatever `show-content` says; with
// `sidebar-position: end` the CONTENT is the root page), the duplicate-tag
// guard, and the `navigation.push` / `navigation.pop` routing that lets a nested
// split view forward a push outwards. All three are `NavigationSplitViewState`
// in `@gjsify/adwaita-core`, held to NAVIGATION_STACK_VECTORS,
// NAVIGATION_SPLIT_VIEW_CRITICALS and NAVIGATION_ACTION_VECTORS — the last of
// which had no consumer at all before this.
//
// Reference: refs/adwaita-web/adwaita-web/docs/widgets/navigationsplitview.md
// Reference: refs/libadwaita/src/adw-navigation-split-view.c
// Reference: refs/libadwaita/src/stylesheet/widgets/_sidebars.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    DEFAULT_MAX_SIDEBAR_WIDTH,
    DEFAULT_MIN_SIDEBAR_WIDTH,
    NavigationSplitViewState,
    isSidebarAtVisualStart,
    resolveSidebarBounds,
    type AdwPackType,
    type AdwTextDirection,
    type NavigationActionResult,
} from '@gjsify/adwaita-core';

import { bindBreakpointSetter } from '../breakpoints.js';

/** Detail of the `navigation-push` / `navigation-pop` delegation event. */
export interface NavigationDelegateDetail {
    /** The tag a `push` names; absent for a `pop`. */
    tag?: string;
    /** Set by an ancestor that handled it — the `return TRUE` of the C's routing. */
    handled: boolean;
}

export class AdwNavigationSplitView extends HTMLElement {
    private _sidebarEl!: HTMLDivElement;
    private _contentEl!: HTMLDivElement;
    private _initialized = false;
    private _disposeBreakpoint: (() => void) | undefined;
    /** The ordering table, the tag guard and the action routing (ADR 0004). */
    private _state = new NavigationSplitViewState();
    /** Re-entrancy guard for the `show-content` reflection. */
    private _reflecting = false;

    static get observedAttributes() {
        return [
            'collapsed',
            'show-content',
            'sidebar-position',
            'min-sidebar-width',
            'max-sidebar-width',
            'breakpoint',
        ];
    }

    get collapsed(): boolean {
        return this._initialized ? this._state.collapsed : this.hasAttribute('collapsed');
    }

    set collapsed(v: boolean) {
        this.toggleAttribute('collapsed', v);
    }

    /** When collapsed, whether the content pane (true) or sidebar (false) shows. */
    get showContent(): boolean {
        return this._initialized ? this._state.showContent : this.hasAttribute('show-content');
    }

    set showContent(v: boolean) {
        this.toggleAttribute('show-content', v);
    }

    /** Which side the sidebar is packed on — `start` (default) or `end`. */
    get sidebarPosition(): AdwPackType {
        return this.getAttribute('sidebar-position') === 'end' ? 'end' : 'start';
    }

    set sidebarPosition(value: AdwPackType) {
        this.setAttribute('sidebar-position', value);
    }

    /** The sidebar page's tag of record, or `null`. */
    get sidebarTag(): string | null {
        return this._state.sidebarTag;
    }

    /** The content page's tag of record, or `null`. */
    get contentTag(): string | null {
        return this._state.contentTag;
    }

    /**
     * `navigation.push` with `tag` — `navigation_push_cb` (:644-685).
     *
     * An unmatched tag DELEGATES to the parent before it may become a critical,
     * which is how nested split views forward a push outwards; on this port that
     * is a bubbling `navigation-push` event whose `detail.handled` an ancestor
     * sets. Returns what the routing decided.
     */
    push(tag: string): NavigationActionResult {
        return this._state.push(tag);
    }

    /** `navigation.pop` — `navigation_pop_cb` (:687-702). */
    pop(): NavigationActionResult {
        return this._state.pop();
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        const sidebarChildren = Array.from(this.querySelectorAll(':scope > [slot="sidebar"]'));
        const contentChildren = Array.from(this.querySelectorAll(':scope > [slot="content"]'));

        this._sidebarEl = document.createElement('div');
        this._sidebarEl.className = 'adw-nsv-sidebar';
        for (const child of sidebarChildren) this._sidebarEl.appendChild(child);

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-nsv-content';
        for (const child of contentChildren) this._contentEl.appendChild(child);

        this.replaceChildren(this._sidebarEl, this._contentEl);

        // Parse-time attributes are the CONSTRUCTION properties, for the same
        // reason the overlay view treats them so: applying them as sequential
        // setters would emit a transition for a state the markup simply declared.
        this._state = new NavigationSplitViewState({
            sidebarPosition: this.sidebarPosition,
            collapsed: this.hasAttribute('collapsed'),
            showContent: this.hasAttribute('show-content'),
            // `g_critical` has no browser counterpart that a consumer can see;
            // `console.error` is the one a developer reads, and the TEXT is the
            // C's verbatim so a GTK bug report and a browser one say the same.
            onCritical: (message) => console.error(message),
            onDelegate: (action, tag) => {
                const detail: NavigationDelegateDetail = { tag, handled: false };
                this.dispatchEvent(new CustomEvent(`navigation-${action}`, { bubbles: true, detail }));
                return detail.handled;
            },
        });
        // Which children EXIST decides the stack, so the panes are mounted into
        // the state, not merely into the DOM — a lone child stays visible
        // whatever `show-content` says (:389-401), which two CSS classes cannot
        // express.
        this._state.setSidebar(sidebarChildren.length > 0 ? { tag: this._tagOf(sidebarChildren) } : null);
        this._state.setContent(contentChildren.length > 0 ? { tag: this._tagOf(contentChildren) } : null);
        this._state.subscribe(() => {
            this._reflectShowContent();
            this._syncClasses();
        });

        this._syncWidth();
        this._syncClasses();
        this._syncBreakpoint();
    }

    /** `Adw.NavigationPage:tag` off the slotted pane, or `null` when untagged. */
    private _tagOf(children: readonly Element[]): string | null {
        for (const child of children) {
            const tag = child.getAttribute('tag');
            if (tag !== null) return tag;
        }
        return null;
    }

    /**
     * Mirror the state's `showContent` onto the attribute, so the DOM keeps
     * telling the truth after a `navigation.push` moved it.
     *
     * Guarded the way the overlay view's reflection is: writing the attribute
     * re-enters `attributeChangedCallback`, which without the flag is a loop.
     */
    private _reflectShowContent() {
        if (this._reflecting) return;
        const wanted = this._state.showContent;
        if (this.hasAttribute('show-content') === wanted) return;
        this._reflecting = true;
        try {
            this.toggleAttribute('show-content', wanted);
        } finally {
            this._reflecting = false;
        }
    }

    disconnectedCallback() {
        this._disposeBreakpoint?.();
        this._disposeBreakpoint = undefined;
    }

    attributeChangedCallback(name: string) {
        if (!this._initialized) return;
        if (name === 'breakpoint') {
            this._syncBreakpoint();
            return;
        }
        if (name === 'min-sidebar-width' || name === 'max-sidebar-width') {
            this._syncWidth();
            return;
        }
        if (name === 'collapsed') this._state.setCollapsed(this.hasAttribute('collapsed'));
        if (name === 'show-content') this._state.setShowContent(this.hasAttribute('show-content'));
        if (name === 'sidebar-position') this._state.setSidebarPosition(this.sidebarPosition);
        this._syncClasses();
        // Collapsing flips whether the sidebar is width-capped, so re-apply.
        this._syncWidth();
    }

    private _syncWidth() {
        // When collapsed the visible pane fills the whole view, so the sidebar's
        // min/max width caps must not apply (an inline cap would otherwise win
        // over any stylesheet rule and leave a dead strip beside the pane).
        if (this.collapsed) {
            this._sidebarEl.style.minWidth = '';
            this._sidebarEl.style.maxWidth = '';
            return;
        }
        // An ABSENT attribute used to mean "no bound at all", where
        // Adw.NavigationSplitView always has 180 / 280
        // (adw-navigation-split-view.c min-sidebar-width / max-sidebar-width).
        // The core also normalises the pair — libadwaita never lets max fall
        // below min, and CSS resolves that conflict the other way round.
        const bounds = resolveSidebarBounds(
            {
                minSidebarWidth: this._widthAttr('min-sidebar-width', DEFAULT_MIN_SIDEBAR_WIDTH),
                maxSidebarWidth: this._widthAttr('max-sidebar-width', DEFAULT_MAX_SIDEBAR_WIDTH),
            },
            0,
            { ceil: true },
        );
        this._sidebarEl.style.minWidth = `${bounds.min}px`;
        this._sidebarEl.style.maxWidth = `${bounds.max}px`;
    }

    /** A pixel attribute, falling back to the widget's own default. */
    private _widthAttr(name: string, fallback: number): number {
        const raw = this.getAttribute(name);
        if (raw === null) return fallback;
        const value = parseFloat(raw);
        return Number.isFinite(value) ? value : fallback;
    }

    /** The reading direction `start` / `end` resolve against (`get_start_or_end`, :220-227). */
    private get _direction(): AdwTextDirection {
        return getComputedStyle(this).direction === 'rtl' ? 'rtl' : 'ltr';
    }

    private _syncClasses() {
        const state = this._state;
        this.classList.toggle('collapsed', state.collapsed);
        this.classList.toggle('show-content', state.showContent);
        this.classList.toggle('sidebar-end', state.sidebarPosition === 'end');
        // The VISUAL side, which under RTL is the opposite of the logical one —
        // it decides where the pane is drawn AND which edge its divider is on.
        this.classList.toggle(
            'sidebar-at-visual-start',
            isSidebarAtVisualStart(state.sidebarPosition, this._direction),
        );

        // The STACK, not the two flags: `update_navigation_stack` (:342-405)
        // keeps a LONE child visible whatever `show-content` says, and with
        // `sidebar-position: end` the CONTENT is the root page — so the sidebar
        // is PUSHED ON TOP of it rather than replacing it.
        const { stack } = state.stack;
        const visible = stack[stack.length - 1] ?? null;
        if (this._sidebarEl) this._sidebarEl.dataset.paneVisible = String(!state.collapsed || visible === 'sidebar');
        if (this._contentEl) this._contentEl.dataset.paneVisible = String(!state.collapsed || visible === 'content');
    }

    /** (Re)bind the `breakpoint` condition to `collapsed`. */
    private _syncBreakpoint() {
        this._disposeBreakpoint?.();
        this._disposeBreakpoint = bindBreakpointSetter(this, this.getAttribute('breakpoint'), (active) => {
            this.collapsed = active;
        });
    }
}

customElements.define('adw-navigation-split-view', AdwNavigationSplitView);
