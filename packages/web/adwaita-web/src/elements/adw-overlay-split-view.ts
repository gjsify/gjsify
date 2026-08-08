// <adw-overlay-split-view> — Responsive sidebar that docks or overlays content.
// Reference: Adw.OverlaySplitView from libadwaita.
// Docs: refs/adwaita-web/adwaita-web/docs/widgets/overlaysplitview.md
//
// `breakpoint` takes an Adwaita condition (e.g. "max-width: 720px") and drives
// `collapsed` from the element's own box — the browser counterpart to an
// Adw.Breakpoint with an add_setter(), so the sidebar overlays on narrow widths
// without the application wiring a media query itself.

import {
    DEFAULT_MAX_SIDEBAR_WIDTH,
    DEFAULT_MIN_SIDEBAR_WIDTH,
    DEFAULT_SIDEBAR_WIDTH_FRACTION,
    OverlaySplitViewState,
    resolveSidebarBounds,
    type AdwPackType,
} from '@gjsify/adwaita-core';

import { bindBreakpointSetter } from '../breakpoints.js';

/**
 * Read a boolean attribute the way a GTK property with a TRUE default has to be
 * read: absence means the default, not false.
 *
 * HTML boolean attributes are presence-only, which can only ever express a FALSE
 * default — so `show-sidebar` used to start hidden while `Adw.OverlaySplitView`
 * starts shown (adw-overlay-split-view.c:974-976). `show-sidebar="false"` is the
 * explicit off switch.
 */
function readTriStateAttr(element: Element, name: string, fallback: boolean): boolean {
    const raw = element.getAttribute(name);
    if (raw === null) return fallback;
    return raw !== 'false' && raw !== '0';
}

export class AdwOverlaySplitView extends HTMLElement {
    private _initialized = false;
    private _sidebarEl!: HTMLDivElement;
    private _contentEl!: HTMLDivElement;
    private _backdropEl!: HTMLDivElement;
    private _disposeBreakpoint: (() => void) | undefined;
    /**
     * The single source of truth for the property interplay, shared with the
     * NativeScript renderer (ADR 0004). The element owns the attributes and the
     * painting; every rule about what `collapsed` + `show-sidebar` + `pin-sidebar`
     * MEAN together lives in core, held to `OVERLAY_COLLAPSE_VECTORS`.
     */
    private _state = new OverlaySplitViewState();
    /** Re-entrancy guard for {@link _reflectShowSidebar}. */
    private _reflecting = false;

    /**
     * Every attribute {@link _readAttribute} handles must be listed here — an
     * unobserved attribute never reaches `attributeChangedCallback`, so its branch
     * is DEAD after construction. `pin-sidebar` was missing, which made the
     * property that suppresses the collapse coupling settable only in the markup
     * a parser saw: `view.setAttribute('pin-sidebar', '')` did nothing at all.
     */
    static get observedAttributes() {
        return [
            'show-sidebar',
            'collapsed',
            'pin-sidebar',
            'sidebar-position',
            'min-sidebar-width',
            'max-sidebar-width',
            'sidebar-width-fraction',
            'breakpoint',
        ];
    }

    get showSidebar(): boolean {
        return this._state.showSidebar;
    }

    set showSidebar(v: boolean) {
        // `false` has to be spelled out — absence means the libadwaita default.
        this.setAttribute('show-sidebar', v ? '' : 'false');
    }

    get collapsed(): boolean {
        return this._state.collapsed;
    }

    set collapsed(v: boolean) {
        if (v) this.setAttribute('collapsed', '');
        else this.removeAttribute('collapsed');
    }

    // The three defaults come from the widget, not from an app's taste: 180 /
    // 280 / 0.25 (adw-overlay-split-view.c:1036-1075). They used to be 280 /
    // 400 / 0.30 here, which are the values the three.js and canvas2d showcases
    // set EXPLICITLY in their `.blp` — so an app's preference had been copied
    // into the widget. The visible cost was in the storybook, whose whole
    // purpose is a 1:1 comparison: the GTK story takes the real defaults and the
    // browser story took these, so the two sides showed different sidebars.
    get minSidebarWidth(): number {
        return parseFloat(this.getAttribute('min-sidebar-width') || String(DEFAULT_MIN_SIDEBAR_WIDTH));
    }

    get maxSidebarWidth(): number {
        return parseFloat(this.getAttribute('max-sidebar-width') || String(DEFAULT_MAX_SIDEBAR_WIDTH));
    }

    get sidebarWidthFraction(): number {
        return parseFloat(this.getAttribute('sidebar-width-fraction') || String(DEFAULT_SIDEBAR_WIDTH_FRACTION));
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // Capture slotted children before rebuilding DOM
        const sidebarChildren = Array.from(this.querySelectorAll('[slot="sidebar"]'));
        const contentChildren = Array.from(this.querySelectorAll('[slot="content"]'));
        // Any remaining unslotted children go to content
        const unslotted = Array.from(this.childNodes).filter(
            (n) => !sidebarChildren.includes(n as Element) && !contentChildren.includes(n as Element),
        );

        // Clear children safely
        this.replaceChildren();

        // Sidebar container
        this._sidebarEl = document.createElement('div');
        this._sidebarEl.className = 'adw-osv-sidebar';
        sidebarChildren.forEach((c) => this._sidebarEl.appendChild(c));

        // Content container
        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-osv-content';
        contentChildren.forEach((c) => this._contentEl.appendChild(c));
        unslotted.forEach((c) => this._contentEl.appendChild(c));

        // Backdrop for overlay dismiss
        this._backdropEl = document.createElement('div');
        this._backdropEl.className = 'adw-osv-backdrop';
        this._backdropEl.addEventListener('click', () => this.hideSidebar());

        this.append(this._sidebarEl, this._contentEl, this._backdropEl);

        // Apply initial state
        // The attributes present at parse time ARE the construction options —
        // `Adw.OverlaySplitView` is built with its properties, it is not built
        // and then mutated. Applying them as sequential setters instead would
        // fire the collapse transition and auto-hide a sidebar that the markup
        // explicitly asked to keep shown.
        this._state = new OverlaySplitViewState({
            collapsed: this.hasAttribute('collapsed'),
            showSidebar: readTriStateAttr(this, 'show-sidebar', true),
            pinSidebar: this.hasAttribute('pin-sidebar'),
            sidebarPosition: this.getAttribute('sidebar-position') === 'end' ? 'end' : ('start' as AdwPackType),
        });
        this._reflectShowSidebar();
        this._syncClasses();
        this._syncSidebarWidth();
        this._syncBreakpoint();
    }

    disconnectedCallback() {
        this._disposeBreakpoint?.();
        this._disposeBreakpoint = undefined;
    }

    attributeChangedCallback(_name: string, _old: string | null, _val: string | null) {
        if (!this._initialized) return;
        if (_name === 'breakpoint') {
            this._syncBreakpoint();
            return;
        }
        this._readAttribute(_name);
        this._syncClasses();
        if (_name === 'min-sidebar-width' || _name === 'max-sidebar-width' || _name === 'sidebar-width-fraction') {
            this._syncSidebarWidth();
        }
    }

    /**
     * Push ONE attribute into the state, then reflect back what the state made
     * of it.
     *
     * Per-attribute rather than a re-read of all of them, because `show-sidebar`
     * is a value the state ALSO owns: collapsing auto-hides an unpinned sidebar,
     * and a blanket re-read would immediately clobber that decision with the
     * stale attribute.
     */
    private _readAttribute(name: string) {
        const state = this._state;
        // `pin-sidebar` defaults FALSE (adw-overlay-split-view.c:990-992), so it
        // is an ordinary presence attribute; `show-sidebar` below is the one that
        // cannot be, and `sidebar-position` is an enum defaulting to 'start'.
        if (name === 'pin-sidebar') state.setPinSidebar(this.hasAttribute('pin-sidebar'));
        if (name === 'sidebar-position') {
            const position = this.getAttribute('sidebar-position');
            state.setSidebarPosition(position === 'end' ? 'end' : ('start' as AdwPackType));
        }
        if (name === 'show-sidebar') {
            state.setShowSidebar(readTriStateAttr(this, 'show-sidebar', true));
        }
        // Last: it can change `show-sidebar`, so it must not be overwritten after.
        if (name === 'collapsed') state.setCollapsed(this.hasAttribute('collapsed'));
        this._reflectShowSidebar();
    }

    /**
     * Mirror the state's `showSidebar` back onto the attribute, so the DOM keeps
     * telling the truth after an auto-hide.
     *
     * Guarded: writing the attribute re-enters `attributeChangedCallback`, and
     * without the flag that is an infinite reflection loop rather than a render.
     */
    private _reflectShowSidebar() {
        if (this._reflecting) return;
        const wanted = this._state.showSidebar ? '' : 'false';
        if (this.getAttribute('show-sidebar') === wanted) return;
        this._reflecting = true;
        try {
            this.setAttribute('show-sidebar', wanted);
        } finally {
            this._reflecting = false;
        }
    }

    /** (Re)bind the `breakpoint` condition to `collapsed`. */
    private _syncBreakpoint() {
        this._disposeBreakpoint?.();
        this._disposeBreakpoint = bindBreakpointSetter(this, this.getAttribute('breakpoint'), (active) => {
            this.collapsed = active;
        });
    }

    openSidebar() {
        this.showSidebar = true;
        this.dispatchEvent(new CustomEvent('sidebar-toggled', { detail: { isVisible: true } }));
    }

    hideSidebar() {
        this.showSidebar = false;
        this.dispatchEvent(new CustomEvent('sidebar-toggled', { detail: { isVisible: false } }));
    }

    toggleSidebar() {
        this.showSidebar = !this.showSidebar;
        this.dispatchEvent(
            new CustomEvent('sidebar-toggled', {
                detail: { isVisible: this.showSidebar },
            }),
        );
    }

    private _syncClasses() {
        const state = this._state;
        this.classList.toggle('collapsed', state.collapsed);
        this.classList.toggle('show-sidebar', state.showSidebar);
        this.classList.toggle('sidebar-start', state.sidebarPosition === 'start');
        this.classList.toggle('sidebar-end', state.sidebarPosition === 'end');

        // Derived, not re-decided here: the shield only exists while collapsed
        // AND revealed, and each pane is reachable by keyboard only when it is
        // the one on screen.
        if (this._backdropEl) this._backdropEl.hidden = !state.shieldVisible;
        this._sidebarEl?.setAttribute('aria-hidden', String(!state.sidebarFocusable));
        this._contentEl?.setAttribute('aria-hidden', String(!state.contentFocusable));

        // In docked mode, use negative margin to collapse sidebar space
        // while keeping the sidebar's intrinsic width (slide animation).
        if (this._sidebarEl && !this.collapsed) {
            if (!this.showSidebar) {
                const w = this._sidebarEl.offsetWidth;
                this._sidebarEl.style.marginRight = `-${w}px`;
            } else {
                this._sidebarEl.style.marginRight = '';
            }
        }
    }

    private _syncSidebarWidth() {
        if (!this._sidebarEl) return;
        // Normalise through the core rather than writing the raw attributes:
        // libadwaita never lets `max` fall below `min`, and CSS resolves that
        // conflict the other way round (min-width wins over max-width), so an
        // inverted pair would render differently here than in GTK.
        const bounds = resolveSidebarBounds(
            { minSidebarWidth: this.minSidebarWidth, maxSidebarWidth: this.maxSidebarWidth },
            0,
            { ceil: true },
        );
        this._sidebarEl.style.minWidth = `${bounds.min}px`;
        this._sidebarEl.style.maxWidth = `${bounds.max}px`;
        this._sidebarEl.style.width = `${this.sidebarWidthFraction * 100}%`;
    }
}

customElements.define('adw-overlay-split-view', AdwOverlaySplitView);
