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
    isSidebarAtVisualStart,
    layoutOverlaySplitView,
    resolveOverlaySidebarWidth,
    resolveSidebarBounds,
    resolveSwipeArea,
    resolveSwipeSnapPoints,
    resolveSwipeStart,
    swipeCancelProgress,
    type AdwPackType,
    type AdwTextDirection,
    type SplitViewAnimator,
} from '@gjsify/adwaita-core';

import { bindBreakpointSetter } from '../breakpoints.js';

/**
 * The reveal spring, as a CSS-timed animator.
 *
 * libadwaita animates with a spring `(1, 0.5, 500)`
 * (adw-overlay-split-view.c:1163-1165). A browser cannot be handed spring
 * parameters, so this drives the progress from `requestAnimationFrame` on a
 * critically-damped approximation and lets the element write the resulting
 * geometry — which is the same seam the NativeScript port fills with
 * `View.animate()`, and the same one a test fills with an instant fake.
 */
const CSS_SPLIT_VIEW_ANIMATOR: SplitViewAnimator = {
    animate(request) {
        let handle = 0;
        let cancelled = false;
        // 250ms is the visible settle time of libadwaita's spring at these
        // parameters; the CURVE is an approximation and says so, the ENDPOINTS
        // are exact because `onDone` writes `to`.
        const duration = 250;
        const start = performance.now();
        const step = (now: number) => {
            if (cancelled) return;
            const t = Math.min((now - start) / duration, 1);
            // ease-out: fast first, settling — the visible signature of a spring
            // with no overshoot, which is what `clamp` asks for anyway.
            const eased = 1 - (1 - t) * (1 - t);
            request.onValue(request.from + (request.to - request.from) * eased);
            if (t < 1) {
                handle = requestAnimationFrame(step);
                return;
            }
            request.onValue(request.to);
            request.onDone();
        };
        handle = requestAnimationFrame(step);
        return {
            cancel() {
                cancelled = true;
                if (handle) cancelAnimationFrame(handle);
            },
        };
    },
};

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
    /** The view's own width in CSS px — the size the sidebar fraction is OF. */
    private _measuredWidth = 0;
    private _resizeObserver: ResizeObserver | undefined;
    /** The pointer currently panning the sidebar, if any. */
    private _swipePointer: number | null = null;
    /** Where the pan started, and the progress it started from. */
    private _swipeOrigin = { x: 0, progress: 0 };

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
            'enable-show-gesture',
            'enable-hide-gesture',
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
        this._buildOnce();
        // EVERY connect, not only the first — see `_bindToDocument`.
        this._bindToDocument();
        this._reflectShowSidebar();
        this._syncClasses();
        this._syncSidebarWidth();
        this._syncBreakpoint();
    }

    /** The DOM surgery and the state, which happen once per element lifetime. */
    private _buildOnce() {
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
            enableShowGesture: readTriStateAttr(this, 'enable-show-gesture', true),
            enableHideGesture: readTriStateAttr(this, 'enable-hide-gesture', true),
            animator: CSS_SPLIT_VIEW_ANIMATOR,
        });
        // Every progress step repaints — the reveal is a CONTINUUM now, not two
        // end states, which is what the five OVERLAY_SWIPE_* tables describe.
        this._state.subscribe(() => {
            this._reflectShowSidebar();
            this._syncClasses();
        });

        // `escape_shortcut_cb` (adw-overlay-split-view.c:705-716) — absent from
        // BOTH ports, which made `OverlaySplitViewState.escape()` dead code.
        // Bound on the element, so it only fires while focus is inside the view
        // and still propagates when the state declines to consume it.
        //
        // Bound ONCE, here, and never removed: a listener on the element itself
        // survives detaching and is collected with the element, so there is
        // nothing to leak — while re-adding it per connect would stack a second
        // handler on every move. Only the two bindings that reach OUTSIDE the
        // element (the observer below and the breakpoint's media query) need a
        // teardown, and they are re-established on every connect.
        this.addEventListener('keydown', this._onKeyDown);
        this._bindSwipe();
    }

    /**
     * Everything that must be re-established every time the element enters a
     * document — NOT once per lifetime.
     *
     * `connectedCallback` returns early on the second connect (the DOM is
     * already built), so anything torn down in `disconnectedCallback` used to be
     * gone for good: moving the view between parents — which is what a slideshow
     * or a client-side route change does — killed the ResizeObserver and left
     * `_measuredWidth` frozen at whatever it last saw, or at 0 if the view had
     * never been visible. That is the other half of the docs-site regression.
     */
    private _bindToDocument() {
        // The view's own box is the size source, the same one the breakpoints
        // use: the sidebar width is a FRACTION of it and has to be recomputed
        // when it changes, which a one-shot read at connect could not do.
        this._resizeObserver?.disconnect();
        this._resizeObserver = new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (!entry) return;
            const box = entry.borderBoxSize?.[0];
            this._measuredWidth = box ? box.inlineSize : entry.contentRect.width;
            this._syncSidebarWidth();
            this._syncClasses();
        });
        this._resizeObserver.observe(this);
        // Seed synchronously so the FIRST paint after a connect is already
        // placed. The observer's initial callback is a frame away, and on a
        // re-connect there may be no size change at all for it to report.
        // Zero is the honest answer while the view is in a `display: none`
        // subtree, and `_syncGeometry` knows what to do with it.
        this._measuredWidth = this.offsetWidth;
    }

    disconnectedCallback() {
        this._disposeBreakpoint?.();
        this._disposeBreakpoint = undefined;
        this._resizeObserver?.disconnect();
        this._resizeObserver = undefined;
    }

    /** `escape_shortcut_cb` — only a COLLAPSED view with a revealed sidebar consumes it. */
    private readonly _onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        // The state decides: an uncollapsed view lets Escape through so an
        // enclosing dialog still closes.
        if (this._state.escape()) event.preventDefault();
    };

    attributeChangedCallback(_name: string, _old: string | null, _val: string | null) {
        if (!this._initialized) return;
        if (_name === 'breakpoint') {
            this._syncBreakpoint();
            return;
        }
        this._readAttribute(_name);
        // `collapsed` is in the list because `get_sidebar_width` IGNORES the
        // fraction while collapsed and clamps the VIEW width instead
        // (adw-overlay-split-view.c:462-463) — a collapsed sidebar is a
        // different number, not the same one drawn differently. Leaving it out
        // is the frame-late bug the NativeScript port paid for.
        if (
            _name === 'min-sidebar-width' ||
            _name === 'max-sidebar-width' ||
            _name === 'sidebar-width-fraction' ||
            _name === 'collapsed'
        ) {
            this._syncSidebarWidth();
        }
        this._syncClasses();
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
        // Both default TRUE (adw-overlay-split-view.c:1178-1210), so they read
        // through the tri-state helper for the same reason `show-sidebar` does.
        if (name === 'enable-show-gesture') {
            state.setEnableShowGesture(readTriStateAttr(this, 'enable-show-gesture', true));
        }
        if (name === 'enable-hide-gesture') {
            state.setEnableHideGesture(readTriStateAttr(this, 'enable-hide-gesture', true));
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

    /**
     * The reading direction `start` / `end` are resolved against.
     *
     * `get_start_or_end` (adw-overlay-split-view.c:227-234) returns
     * `GTK_PACK_END` under RTL, so a `start` sidebar is drawn on the RIGHT.
     * Neither renderer mirrored any of it; the browser has the direction for
     * free and only had to read it.
     */
    private get _direction(): AdwTextDirection {
        return getComputedStyle(this).direction === 'rtl' ? 'rtl' : 'ltr';
    }

    /** The sizing properties as the core takes them. */
    private get _widthSpec() {
        return {
            minSidebarWidth: this.minSidebarWidth,
            maxSidebarWidth: this.maxSidebarWidth,
            sidebarWidthFraction: this.sidebarWidthFraction,
        };
    }

    /** The sidebar's allocated width in px — `get_sidebar_width` (:441-466). */
    private get _sidebarWidth(): number {
        return resolveOverlaySidebarWidth({
            ...this._widthSpec,
            totalWidth: this._measuredWidth,
            collapsed: this._state.collapsed,
        });
    }

    private _syncClasses() {
        const state = this._state;
        this.classList.toggle('collapsed', state.collapsed);
        this.classList.toggle('show-sidebar', state.showSidebar);
        const atStart = isSidebarAtVisualStart(state.sidebarPosition, this._direction);
        this.classList.toggle('sidebar-start', state.sidebarPosition === 'start');
        this.classList.toggle('sidebar-end', state.sidebarPosition === 'end');
        // The VISUAL side, which under RTL is the opposite of the logical one.
        // The stylesheet needs it for the divider edge, which `border-inline-*`
        // alone cannot get right: the divider follows where the pane is DRAWN.
        this.classList.toggle('sidebar-at-visual-start', atStart);

        // Derived, not re-decided here: the shield only exists while collapsed
        // AND revealed, and each pane is reachable by keyboard only when it is
        // the one on screen.
        if (this._backdropEl) this._backdropEl.hidden = !state.shieldVisible;
        this._sidebarEl?.setAttribute('aria-hidden', String(!state.sidebarFocusable));
        this._contentEl?.setAttribute('aria-hidden', String(!state.contentFocusable));

        this._syncGeometry();
    }

    /**
     * Place the sidebar for the current progress — `allocate_uncollapsed`
     * (:572-610) and `allocate_collapsed` (:653-703), through the core.
     *
     * The slide used to be `marginRight: -offsetWidth` REGARDLESS of which edge
     * the sidebar is on, so an `end` sidebar slid the wrong way; and it was only
     * two states, so a swipe had nothing to drive. `layoutOverlaySplitView`
     * returns the pane rect for any progress including the overshoot, which is
     * what makes a continuous gesture expressible at all.
     */
    private _syncGeometry() {
        const sidebar = this._sidebarEl;
        if (!sidebar) return;
        // NOTHING MEASURED YET — HAND THE PLACEMENT BACK TO THE STYLESHEET.
        //
        // This used to `return` and leave the inline styles alone, which is the
        // one thing it must not do. The stylesheet no longer carries a
        // `transform: translateX(±100%)` for the hidden end state (that is the
        // point of driving the offset per frame), so an absolutely-positioned
        // pane with no `left` resolves to `left: 0` at full opacity: a HIDDEN
        // sidebar painted over the content at the wrong edge. Shipped that way
        // in v0.32.0's `feat(adwaita)` commit and visible on the docs site,
        // whose slideshow builds each slide hidden and moves it in — so the
        // first measurement never arrived and the fallback was all there was.
        //
        // Clearing rather than skipping matters just as much: a STALE inline
        // `left` from an earlier measurement outranks the resting rule (an
        // absolutely-positioned box with `left` + `width` ignores `right`), so
        // leaving the old value behind would defeat the stylesheet exactly when
        // it is needed. `_resting.scss` carries the four end states.
        if (this._measuredWidth <= 0) {
            for (const prop of ['left', 'marginLeft', 'marginRight', 'width', 'minWidth', 'maxWidth', 'opacity', 'pointerEvents'] as const) {
                sidebar.style[prop] = '';
            }
            if (this._backdropEl) this._backdropEl.style.opacity = '';
            return;
        }
        const state = this._state;
        const measured = this._sidebarWidth;
        const layout = layoutOverlaySplitView({
            totalWidth: this._measuredWidth,
            sidebarWidth: measured,
            showProgress: state.showProgress,
            collapsed: state.collapsed,
            sidebarPosition: state.sidebarPosition,
            direction: this._direction,
        });
        const atStart = isSidebarAtVisualStart(state.sidebarPosition, this._direction);

        sidebar.style.width = `${layout.sidebar.width}px`;
        if (state.collapsed) {
            // Floating above the content: absolutely placed at the rect the core
            // returned, so an overshoot widens the pane instead of detaching it.
            sidebar.style.marginLeft = '';
            sidebar.style.marginRight = '';
            sidebar.style.insetInlineStart = '';
            sidebar.style.left = `${layout.sidebar.x}px`;
        } else {
            // Docked: the pane keeps its place in the flex row and the hidden
            // part is taken off the edge it is ON — the left one at visual
            // start, the right one at visual end.
            sidebar.style.left = '';
            const hidden = measured - Math.trunc(measured * Math.min(state.showProgress, 1));
            sidebar.style.marginLeft = atStart ? `${-hidden}px` : '';
            sidebar.style.marginRight = atStart ? '' : `${-hidden}px`;
        }
        sidebar.style.opacity = state.showProgress <= 0 ? '0' : '1';
        // `sidebarPainted` is the snapshot gate (:757): below zero progress there
        // is nothing on screen, and a pane that is not painted must not take
        // pointer events either.
        sidebar.style.pointerEvents = state.sidebarPainted ? '' : 'none';
        if (this._backdropEl) this._backdropEl.style.opacity = String(1 - layout.shadowProgress);
    }

    private _syncSidebarWidth() {
        if (!this._sidebarEl) return;
        // Normalise through the core rather than writing the raw attributes:
        // libadwaita never lets `max` fall below `min`, and CSS resolves that
        // conflict the other way round (min-width wins over max-width), so an
        // inverted pair would render differently here than in GTK.
        const bounds = resolveSidebarBounds(this._widthSpec, 0, { ceil: true });
        this._sidebarEl.style.minWidth = `${bounds.min}px`;
        this._sidebarEl.style.maxWidth = `${bounds.max}px`;
        // NOT a CSS percentage. `(int)` truncates toward zero, and a percentage
        // is fractional — core's own header forbids it in as many words, and
        // this element carried one for its whole life.
        this._syncGeometry();
    }

    // --- swipe (Adw.Swipeable) ---

    /**
     * The pan gesture the five `OVERLAY_SWIPE_*` tables describe.
     *
     * There was no gesture code in either renderer — grep for `pan` in both
     * split views returned zero — so `showProgress` was only ever 0 or 1 and the
     * tables shipped unexercised. Pointer events give the browser the whole
     * gesture in three handlers; every DECISION in them is core's.
     */
    private _bindSwipe() {
        this.addEventListener('pointerdown', (event) => {
            if (this._swipePointer !== null || event.button !== 0) return;
            const state = this._state;
            const rect = this.getBoundingClientRect();
            const area = resolveSwipeArea({
                isDrag: true,
                sidebarWidth: this._sidebarWidth,
                showProgress: state.showProgress,
                totalWidth: rect.width,
                totalHeight: rect.height,
                sidebarPosition: state.sidebarPosition,
                direction: this._direction,
            });
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            if (x < area.x || x > area.x + area.width || y < area.y || y > area.y + area.height) return;
            this._swipePointer = event.pointerId;
            this._swipeOrigin = { x: event.clientX, progress: state.showProgress };
        });

        this.addEventListener('pointermove', (event) => {
            if (event.pointerId !== this._swipePointer) return;
            const state = this._state;
            const width = this._sidebarWidth || 1;
            const atStart = isSidebarAtVisualStart(state.sidebarPosition, this._direction);
            // Dragging AWAY from the sidebar's edge opens it, so the sign of the
            // travel depends on which edge that is — the same `atStart` predicate
            // the layout uses.
            const travel = ((event.clientX - this._swipeOrigin.x) / width) * (atStart ? 1 : -1);
            if (!state.swipeActive) {
                if (
                    !resolveSwipeStart({
                        showProgress: state.showProgress,
                        collapsed: state.collapsed,
                        direction: travel >= 0 ? 'forward' : 'back',
                        enableShowGesture: state.enableShowGesture,
                        enableHideGesture: state.enableHideGesture,
                    })
                ) {
                    this._swipePointer = null;
                    return;
                }
                state.beginSwipe();
                // Capture keeps the move/up events coming once the pointer
                // leaves the element — an optimisation, not a precondition. It
                // THROWS for a pointer id the browser has no active pointer for,
                // which Firefox does strictly and Chromium tolerates: a synthetic
                // event, or one whose pointer was already released, aborted the
                // whole gesture before the progress was ever written. The swipe
                // still works without it, so the failure is swallowed on purpose.
                try {
                    this.setPointerCapture(event.pointerId);
                } catch {
                    /* no active pointer for this id — the gesture does not need capture */
                }
            }
            state.setShowProgress(this._swipeOrigin.progress + travel);
        });

        const release = (event: PointerEvent, cancelled: boolean) => {
            if (event.pointerId !== this._swipePointer) return;
            this._swipePointer = null;
            const state = this._state;
            if (!state.swipeActive) return;
            // Same asymmetry on the way out: `hasPointerCapture` is false when the
            // capture above was refused, so the release is already conditional.
            if (this.hasPointerCapture(event.pointerId)) this.releasePointerCapture(event.pointerId);
            // A cancelled gesture snaps back to where it came from
            // (`get_cancel_progress`, :1253-1258); a released one settles on the
            // NEAREST allowed snap point.
            const points = resolveSwipeSnapPoints({
                showProgress: state.showProgress,
                enableShowGesture: state.enableShowGesture,
                enableHideGesture: state.enableHideGesture,
                swipeActive: true,
            });
            const target = cancelled
                ? swipeCancelProgress(state.showProgress)
                : points.reduce((best, point) =>
                      Math.abs(point - state.showProgress) < Math.abs(best - state.showProgress) ? point : best,
                  );
            state.endSwipe(target);
        };
        this.addEventListener('pointerup', (event) => release(event, false));
        this.addEventListener('pointercancel', (event) => release(event, true));
    }
}

customElements.define('adw-overlay-split-view', AdwOverlaySplitView);
