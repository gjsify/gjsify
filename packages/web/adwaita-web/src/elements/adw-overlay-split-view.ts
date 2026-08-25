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
import { bindSlottedChildren } from '../slotted-children.js';

/**
 * The reveal spring, as a CSS-timed animator: libadwaita animates with a spring
 * `(1, 0.5, 500)`, which a browser cannot be handed, so this approximates it from
 * `requestAnimationFrame`. Pluggable so the NativeScript port can substitute
 * `View.animate()` and a test an instant fake.
 */
const CSS_SPLIT_VIEW_ANIMATOR: SplitViewAnimator = {
    animate(request) {
        let handle = 0;
        let cancelled = false;
        // 250ms is the visible settle time of libadwaita's spring at these
        // parameters. The CURVE is an approximation; the ENDPOINTS are exact,
        // because `onDone` writes `to`.
        const duration = 250;
        const start = performance.now();
        const step = (now: number) => {
            if (cancelled) return;
            const t = Math.min((now - start) / duration, 1);
            // ease-out — the visible signature of a spring with no overshoot.
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
 * Read a boolean attribute the way a GTK property with a TRUE default has to be read:
 * absence means the default, not false. HTML boolean attributes are presence-only,
 * which can only ever express a FALSE default, while
 * `Adw.OverlaySplitView:show-sidebar` starts shown — `show-sidebar="false"` is the
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
     * What the breakpoint last SET, carried across every rebind. Not read off the
     * attribute: a `collapsed` the markup declared was never this breakpoint's doing,
     * and unapplying it at connect would undo the author.
     */
    private _breakpointApplied = false;
    /**
     * The property interplay, shared with the NativeScript renderer (ADR 0004): the
     * element owns the attributes and the painting, core owns what `collapsed` +
     * `show-sidebar` + `pin-sidebar` mean together, held to `OVERLAY_COLLAPSE_VECTORS`.
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
     * is dead after construction and the property is settable only in parsed markup.
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

    // The three defaults are the widget's, not an app's taste: 180 / 280 / 0.25. A
    // showcase that wants other numbers sets them explicitly, so the storybook's GTK
    // and browser sides stay 1:1.
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

    private _buildOnce() {
        if (this._initialized) return;
        this._initialized = true;

        this._sidebarEl = document.createElement('div');
        this._sidebarEl.className = 'adw-osv-sidebar';

        this._contentEl = document.createElement('div');
        this._contentEl.className = 'adw-osv-content';

        this._backdropEl = document.createElement('div');
        this._backdropEl.className = 'adw-osv-backdrop';
        this._backdropEl.addEventListener('click', () => this.hideSidebar());

        // Both panes stay LIVE, and the unnamed slot is the content — the
        // Adw.OverlaySplitView buildable default. `src/slotted-children.ts` has the
        // incident. The routing also stops at the DIRECT children, which the two
        // selectors here did not: `[slot="sidebar"]` matched at any depth, so a nested
        // split view's sidebar was stolen into the outer one's pane.
        bindSlottedChildren(this, [
            { name: 'sidebar', into: this._sidebarEl },
            { name: 'content', into: this._contentEl },
            { into: this._contentEl },
        ]).install(this._sidebarEl, this._contentEl, this._backdropEl);

        // The attributes present at parse time ARE the construction options —
        // `Adw.OverlaySplitView` is built with its properties, not built and then
        // mutated. Sequential setters would fire the collapse transition and
        // auto-hide a sidebar the markup explicitly asked to keep shown.
        this._state = new OverlaySplitViewState({
            collapsed: this.hasAttribute('collapsed'),
            showSidebar: readTriStateAttr(this, 'show-sidebar', true),
            pinSidebar: this.hasAttribute('pin-sidebar'),
            sidebarPosition: this.getAttribute('sidebar-position') === 'end' ? 'end' : ('start' as AdwPackType),
            enableShowGesture: readTriStateAttr(this, 'enable-show-gesture', true),
            enableHideGesture: readTriStateAttr(this, 'enable-hide-gesture', true),
            animator: CSS_SPLIT_VIEW_ANIMATOR,
        });
        // Every progress step repaints: the reveal is a continuum, not two end
        // states — the five OVERLAY_SWIPE_* tables describe it.
        this._state.subscribe(() => {
            this._reflectShowSidebar();
            this._syncClasses();
        });

        // `escape_shortcut_cb`, bound on the element so it only fires while focus is
        // inside the view and still propagates when the state declines to consume it.
        // Bound ONCE and never removed: a listener on the element itself is collected
        // with the element, while re-adding it per connect would stack a handler on
        // every move. Only the bindings that reach OUTSIDE the element (the observer,
        // the breakpoint's media query) need a teardown.
        this.addEventListener('keydown', this._onKeyDown);
        this._bindSwipe();
    }

    /**
     * Everything that must be re-established every time the element enters a document,
     * NOT once per lifetime: `_buildOnce` returns early on the second connect, so
     * anything torn down in `disconnectedCallback` and rebound only there would be gone
     * for good — moving the view between parents (a slideshow, a client-side route
     * change) would kill the ResizeObserver and freeze `_measuredWidth`.
     */
    private _bindToDocument() {
        // The view's own box is the size source, the same one the breakpoints use:
        // the sidebar width is a FRACTION of it, so a one-shot read at connect
        // cannot keep up.
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
        // Seed synchronously so the FIRST paint after a connect is already placed:
        // the observer's initial callback is a frame away, and on a re-connect
        // there may be no size change for it to report at all. Zero is the honest
        // answer inside a `display: none` subtree — `_syncGeometry` handles it.
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
        // `collapsed` is in the list because `get_sidebar_width` IGNORES the fraction
        // while collapsed and clamps the VIEW width instead — a collapsed sidebar is a
        // different number, not the same one drawn differently. Omitting it lands the
        // width a frame late.
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
     * Push ONE attribute into the state, then reflect back what the state made of it.
     * Per-attribute rather than a re-read of all of them: `show-sidebar` is a value the
     * state ALSO owns (collapsing auto-hides an unpinned sidebar), so a blanket re-read
     * would clobber that decision with the stale attribute.
     */
    private _readAttribute(name: string) {
        const state = this._state;
        // `pin-sidebar` defaults FALSE, so it is an ordinary presence attribute;
        // `show-sidebar` below is the one that cannot be.
        if (name === 'pin-sidebar') state.setPinSidebar(this.hasAttribute('pin-sidebar'));
        if (name === 'sidebar-position') {
            const position = this.getAttribute('sidebar-position');
            state.setSidebarPosition(position === 'end' ? 'end' : ('start' as AdwPackType));
        }
        if (name === 'show-sidebar') {
            state.setShowSidebar(readTriStateAttr(this, 'show-sidebar', true));
        }
        // Both default TRUE, hence tri-state.
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
     * Mirror the state's `showSidebar` back onto the attribute, so the DOM keeps telling
     * the truth after an auto-hide. Guarded: writing the attribute re-enters
     * `attributeChangedCallback`, and without the flag that is an infinite reflection
     * loop rather than a render.
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
     * The reading direction `start` / `end` are resolved against: `get_start_or_end`
     * returns `GTK_PACK_END` under RTL, so a `start` sidebar is drawn on the RIGHT.
     */
    private get _direction(): AdwTextDirection {
        return getComputedStyle(this).direction === 'rtl' ? 'rtl' : 'ltr';
    }

    private get _widthSpec() {
        return {
            minSidebarWidth: this.minSidebarWidth,
            maxSidebarWidth: this.maxSidebarWidth,
            sidebarWidthFraction: this.sidebarWidthFraction,
        };
    }

    /** The sidebar's allocated width in px — `get_sidebar_width`. */
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
        // The VISUAL side, which under RTL is the opposite of the logical one. The
        // stylesheet needs it for the divider edge, which `border-inline-*` alone
        // cannot get right: the divider follows where the pane is DRAWN.
        this.classList.toggle('sidebar-at-visual-start', atStart);

        // The pane style classes are part of this widget's documented CSS node tree,
        // switched in `update_collapsed`: docked, the panes are `.sidebar-pane` and
        // `.content-pane`; collapsed, the sidebar becomes an `.overlay-pane` above a
        // content pane carrying no class at all. Not decoration — `.overlay-pane` is
        // what swaps the sidebar background for the window one, and both are the
        // documented hook an app themes its panes through, so omitting them makes
        // correct app CSS a no-op.
        this._sidebarEl?.classList.toggle('sidebar-pane', !state.collapsed);
        this._sidebarEl?.classList.toggle('overlay-pane', state.collapsed);
        this._contentEl?.classList.toggle('content-pane', !state.collapsed);

        // Derived, not re-decided here: the shield exists only while collapsed AND
        // revealed, and a pane is keyboard-reachable only while it is on screen.
        if (this._backdropEl) this._backdropEl.hidden = !state.shieldVisible;
        this._sidebarEl?.setAttribute('aria-hidden', String(!state.sidebarFocusable));
        this._contentEl?.setAttribute('aria-hidden', String(!state.contentFocusable));

        this._syncGeometry();
    }

    /**
     * Place the sidebar for the current progress — `allocate_uncollapsed` /
     * `allocate_collapsed`, through the core. `layoutOverlaySplitView` returns the pane
     * rect for ANY progress, overshoot included, which is what makes a continuous
     * gesture expressible; the offset also has to follow the edge the sidebar is on, or
     * an `end` sidebar slides the wrong way.
     */
    private _syncGeometry() {
        const sidebar = this._sidebarEl;
        if (!sidebar) return;
        // Nothing measured yet — hand the placement back to the stylesheet, and CLEAR
        // rather than skip. The stylesheet carries no `transform: translateX(±100%)`
        // for the hidden end state (the point of driving the offset per frame), so an
        // absolutely-positioned pane with no `left` resolves to `left: 0` at full
        // opacity — a hidden sidebar painted over the content at the wrong edge. A
        // stale inline `left` is just as bad: with `left` + `width` set, the box
        // ignores `right` and outranks the resting rule. The resting states live in
        // `scss/_overlay_split_view.scss`.
        if (this._measuredWidth <= 0) {
            for (const prop of [
                'left',
                'marginLeft',
                'marginRight',
                'width',
                'minWidth',
                'maxWidth',
                'opacity',
                'pointerEvents',
            ] as const) {
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
            // Absolutely placed at the rect the core returned, so an overshoot
            // widens the pane instead of detaching it.
            sidebar.style.marginLeft = '';
            sidebar.style.marginRight = '';
            sidebar.style.insetInlineStart = '';
            sidebar.style.left = `${layout.sidebar.x}px`;
        } else {
            // Docked: the pane keeps its place in the flex row and the hidden part
            // is taken off the edge it is ON.
            sidebar.style.left = '';
            const hidden = measured - Math.trunc(measured * Math.min(state.showProgress, 1));
            sidebar.style.marginLeft = atStart ? `${-hidden}px` : '';
            sidebar.style.marginRight = atStart ? '' : `${-hidden}px`;
        }
        sidebar.style.opacity = state.showProgress <= 0 ? '0' : '1';
        // `sidebarPainted` is the snapshot gate: below zero progress there
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
        // px, never a CSS percentage: the C `(int)` truncates toward zero and a
        // percentage is fractional. Core's header forbids it.
        this._syncGeometry();
    }

    /**
     * The `Adw.Swipeable` pan gesture the five `OVERLAY_SWIPE_*` tables describe.
     * Pointer events give the browser the whole gesture in three handlers; every
     * DECISION in them is core's.
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
                // Capture keeps the move/up events coming once the pointer leaves the
                // element — an optimisation, not a precondition. It THROWS for a pointer
                // id with no active pointer (Firefox strictly, Chromium tolerates), which
                // a synthetic or already-released event hits, so the failure is swallowed
                // rather than aborting the gesture.
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
            // (`get_cancel_progress`); a released one settles on the NEAREST snap point.
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
