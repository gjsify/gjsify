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
// THREE rules from the C are not expressible as CSS classes and live in
// `NavigationSplitViewState` (`@gjsify/adwaita-core`), held to NAVIGATION_STACK_VECTORS,
// NAVIGATION_SPLIT_VIEW_CRITICALS and NAVIGATION_ACTION_VECTORS: the navigation-stack
// ordering table (a LONE child stays visible whatever `show-content` says; with
// `sidebar-position: end` the CONTENT is the root page), the duplicate-tag guard, and
// the `navigation.push` / `navigation.pop` routing that lets a nested split view
// forward a push outwards.
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
import { bindSlottedChildren } from '../slotted-children.js';

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
    /**
     * What the breakpoint last SET, carried across every rebind. Not read off the
     * attribute: a `collapsed` the markup declared was never this breakpoint's doing,
     * and unapplying it at connect would undo the author.
     */
    private _breakpointApplied = false;
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

    get sidebarTag(): string | null {
        return this._state.sidebarTag;
    }

    get contentTag(): string | null {
        return this._state.contentTag;
    }

    /**
     * `navigation.push` with `tag` — `navigation_push_cb`.
     *
     * An unmatched tag DELEGATES to the parent before it may become a critical,
     * which is how nested split views forward a push outwards; on this port that
     * is a bubbling `navigation-push` event whose `detail.handled` an ancestor
     * sets. Returns what the routing decided.
     */
    push(tag: string): NavigationActionResult {
        return this._state.push(tag);
    }

    /** `navigation.pop` — `navigation_pop_cb`. */
    pop(): NavigationActionResult {
        return this._state.pop();
    }

    connectedCallback() {
        this._buildOnce();
        // `_syncBreakpoint` is the one that HAS to run on EVERY connect: it re-establishes
        // the ResizeObserver `disconnectedCallback` disposed, and without it a view MOVED
        // between parents (a slideshow slide, a client-side route change) stops tracking
        // its condition for good — `<adw-navigation-split-view breakpoint="max-width: 720px">`
        // never collapses again however narrow the page gets. The three above it are the
        // post-build derivations, idempotent on a later connect and left in the order
        // `<adw-overlay-split-view>` runs them so the two views read alike.
        this._reflectShowContent();
        this._syncWidth();
        this._syncClasses();
        this._syncBreakpoint();
    }

    private _buildOnce() {
        if (this._initialized) return;
        this._initialized = true;

        this._sidebarEl = document.createElement('div');
        this._sidebarEl.className = 'adw-nsv-sidebar';

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-nsv-content';

        // Both panes stay LIVE. `adw_navigation_split_view_set_sidebar` is a property
        // setter, callable whenever, so a pane appended after connect has to reach the
        // pane box AND the state that decides the stack — which is what `_mountPane` does
        // on the way. `src/slotted-children.ts` has the incident.
        bindSlottedChildren(
            this,
            [
                { name: 'sidebar', into: this._sidebarEl },
                { name: 'content', into: this._contentEl },
            ],
            (_node, slot) => this._mountPane(slot.name === 'sidebar' ? 'sidebar' : 'content'),
        ).install(this._sidebarEl, this._contentEl);

        // Parse-time attributes are the CONSTRUCTION properties, as in the overlay view:
        // applying them as sequential setters emits a transition for a state the markup
        // simply declared.
        this._state = new NavigationSplitViewState({
            sidebarPosition: this.sidebarPosition,
            collapsed: this.hasAttribute('collapsed'),
            showContent: this.hasAttribute('show-content'),
            // `g_critical` has no browser counterpart a consumer can see; `console.error`
            // is the one a developer reads, and the TEXT is C's verbatim so a GTK bug
            // report and a browser one say the same.
            onCritical: (message) => console.error(message),
            onDelegate: (action, tag) => {
                const detail: NavigationDelegateDetail = { tag, handled: false };
                this.dispatchEvent(new CustomEvent(`navigation-${action}`, { bubbles: true, detail }));
                return detail.handled;
            },
        });
        // Which children EXIST decides the stack, so the panes are mounted into the state
        // and not merely into the DOM — a lone child stays visible whatever
        // `show-content` says, which two CSS classes cannot express.
        this._mountPane('sidebar');
        this._mountPane('content');
        this._state.subscribe(() => {
            this._reflectShowContent();
            this._syncClasses();
        });
    }

    /**
     * Mount whatever a pane box currently HOLDS into the state — `null` while it is empty.
     *
     * Re-mounting an unchanged pane re-emits the plan, because the state compares the page
     * ref by identity. Both subscribers are idempotent reflections (an attribute and a
     * class list), so a second child in the same pane costs a repaint decision and never a
     * navigation event.
     */
    private _mountPane(pane: 'sidebar' | 'content'): void {
        const box = pane === 'sidebar' ? this._sidebarEl : this._contentEl;
        const children = Array.from(box.children);
        const page = children.length > 0 ? { tag: this._tagOf(children) } : null;
        if (pane === 'sidebar') this._state.setSidebar(page);
        else this._state.setContent(page);
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
     * Mirror the state's `showContent` onto the attribute, so the DOM keeps telling the
     * truth after a `navigation.push` moved it. Guarded like the overlay view's
     * reflection: writing the attribute re-enters `attributeChangedCallback`, which
     * without the flag is a loop.
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
        // An ABSENT attribute is NOT "no bound at all": Adw.NavigationSplitView always
        // has 180 / 280. The core also normalises the pair — libadwaita never lets max
        // fall below min, and CSS resolves that conflict the other way round.
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

    private _widthAttr(name: string, fallback: number): number {
        const raw = this.getAttribute(name);
        if (raw === null) return fallback;
        const value = parseFloat(raw);
        return Number.isFinite(value) ? value : fallback;
    }

    /** The reading direction `start` / `end` resolve against (`get_start_or_end`). */
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

        // THE PANE STYLE CLASSES, and only while docked: libadwaita builds the two
        // `.sidebar-pane` / `.content-pane` bins in the UNCOLLAPSED branch alone, and
        // collapsed both pages move into one AdwNavigationView where neither bin exists.
        // A collapsed sidebar is therefore a full window page on the WINDOW background,
        // so painting it `--sidebar-bg-color` at every width is wrong.
        this._sidebarEl?.classList.toggle('sidebar-pane', !state.collapsed);
        this._contentEl?.classList.toggle('content-pane', !state.collapsed);

        // The STACK, not the two flags: `update_navigation_stack` keeps a LONE child
        // visible whatever `show-content` says, and with `sidebar-position: end` the
        // CONTENT is the root page — so the sidebar is PUSHED ON TOP of it rather than
        // replacing it.
        const { stack } = state.stack;
        const visible = stack[stack.length - 1] ?? null;
        if (this._sidebarEl) this._sidebarEl.dataset.paneVisible = String(!state.collapsed || visible === 'sidebar');
        if (this._contentEl) this._contentEl.dataset.paneVisible = String(!state.collapsed || visible === 'content');
    }

    private _syncBreakpoint() {
        this._disposeBreakpoint?.();
        this._disposeBreakpoint = bindBreakpointSetter(
            this,
            this.getAttribute('breakpoint'),
            (active) => {
                this._breakpointApplied = active;
                this.collapsed = active;
            },
            this._breakpointApplied,
        );
    }
}

customElements.define('adw-navigation-split-view', AdwNavigationSplitView);
