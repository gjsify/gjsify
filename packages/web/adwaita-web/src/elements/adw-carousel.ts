// <adw-carousel> — a swipeable pager (the web counterpart of Adw.Carousel).
// Pages are declared as direct children.
//
// The BEHAVIOUR is headless, in `@gjsify/adwaita-core`'s {@link CarouselState}
// (ADR 0004), shared with the NativeScript twin and pinned by
// `@gjsify/adwaita-core/conformance`: snap points and range clamp, which page a
// position settles on (C's half-DOWN tie-break), the wheel axis rules and their
// 150 ms lockout (`scroll_cb`), the keynav step, and insert/reorder/remove with its
// position compensation. This element is the DOM half only — scroll-snap strip,
// offset↔position, DOM events.
//
// The three attribute defaults HTML cannot spell: `allow-scroll-wheel` and
// `interactive` default TRUE, so `="false"` is the off switch; `allow-long-swipes`
// is an ordinary presence attribute. `position` is the INITIAL page only —
// write-only, with the live value on the `position` property and `notify::position`.
//
// `page-changed` (`detail = { index }`) fires on every settle, including back
// onto the same page, and reports -1 when empty.
//
// The indicators bind through their `carousel` property or a `for` attribute
// naming the carousel's id.
//
// Reference: refs/libadwaita/src/adw-carousel.c (AdwCarousel behaviour)
// Reference: refs/libadwaita/src/adw-carousel-indicator-dots.c
// Reference: refs/libadwaita/src/adw-carousel-indicator-lines.c
// Reference: refs/adwaita-web/adwaita-web/scss/_carousel_indicators.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as Web Components for @gjsify/adwaita-web.

import { CarouselState } from '@gjsify/adwaita-core';
import type { CarouselScrollRequest, CarouselScrollSource, CarouselStateChange } from '@gjsify/adwaita-core';

/** Common surface an indicator binds to. The concrete element is AdwCarousel. */
interface CarouselHost extends HTMLElement {
    readonly nPages: number;
    readonly position: number;
    /** The page the current position settles on, `-1` when empty. */
    readonly currentPage: number;
    scrollToPage(index: number): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

/** A mouse wheel notch is at least this many CSS pixels — below it, assume a touchpad. */
const WHEEL_NOTCH_PIXELS = 40;

/**
 * Which `GdkInputSource` a `WheelEvent` most likely came from. The web platform
 * exposes no device class, so this is a HEURISTIC where GDK has a fact
 * (`gdk_device_get_source`), and the distinction is load-bearing: libadwaita ignores
 * touchpad scrolling because the touchpad's own kinetic scroll already drives the
 * swipe — here, the track's native scroll-snap. Line- and page-mode deltas only ever
 * come from a wheel; a touchpad reports small or fractional pixel deltas and is the
 * only source of a horizontal component alongside a vertical one.
 */
function wheelSource(event: WheelEvent): CarouselScrollSource {
    if (event.deltaMode !== 0) return 'mouse';
    const dy = Math.abs(event.deltaY);
    const dx = Math.abs(event.deltaX);
    if (dx > 0 && dy > 0) return 'touchpad';
    const dominant = Math.max(dx, dy);
    if (!Number.isInteger(dominant) || dominant < WHEEL_NOTCH_PIXELS) return 'touchpad';
    return 'mouse';
}

export class AdwCarousel extends HTMLElement implements CarouselHost {
    private readonly _state = new CarouselState({
        // The DOM owns the scroll animation: `scrollTo` only asks, and the
        // scroll handler feeds the ramp back through `setPosition`.
        animateScroll: true,
        onScrollTo: (request) => this._performScroll(request),
    });
    private _trackEl!: HTMLDivElement;
    /** Page id → its `.adw-carousel-page` slot. Ids are internal; the DOM node is the public handle. */
    private readonly _slots = new Map<string, HTMLDivElement>();
    private _nextPageId = 0;
    private _scrollRaf = 0;
    private _initialized = false;
    /** A declared `position` waiting for the track to have a width. */
    private _pendingPosition: number | null = null;
    private _pendingLayout: ResizeObserver | undefined;
    /**
     * `interactive` for the scroll now in flight: the flag of the request that
     * started it, or `null` for a scroll we did not start — which is a user drag,
     * and therefore interactive.
     */
    private _pendingInteractive: boolean | null = null;

    static get observedAttributes() {
        return ['allow-scroll-wheel', 'allow-long-swipes', 'interactive', 'spacing', 'position'];
    }

    constructor() {
        super();
        // Legal in a custom-element constructor: subscribing touches no attributes
        // and no children, unlike anything DOM-shaped.
        this._state.subscribe((change) => this._onStateChange(change));
        this._state.onPageChanged((index) => {
            this.dispatchEvent(new CustomEvent('page-changed', { bubbles: true, detail: { index } }));
        });
    }

    get nPages(): number {
        return this._state.nPages;
    }

    /** Fractional scroll position (0 = first page, 1 = second, …). */
    get position(): number {
        return this._state.position;
    }

    /**
     * Scroll to the page this position settles on. MODIFICATION: `AdwCarousel:position`
     * is READ-ONLY in C; this setter is a port convenience that resolves through the
     * same `get_page_at_position` rule, so 0.5 lands on page 0 exactly as scrolling
     * there would.
     */
    set position(value: number) {
        this._scrollToPosition(value);
    }

    get currentPage(): number {
        return this._state.pageAt(this._state.position);
    }

    /** Whether the scroll wheel navigates between pages. Defaults to TRUE, as in libadwaita. */
    get allowScrollWheel(): boolean {
        return this._state.allowScrollWheel;
    }

    set allowScrollWheel(value: boolean) {
        this.setAttribute('allow-scroll-wheel', value ? 'true' : 'false');
    }

    get allowLongSwipes(): boolean {
        return this._state.allowLongSwipes;
    }

    set allowLongSwipes(value: boolean) {
        this.toggleAttribute('allow-long-swipes', value);
    }

    /** Whether the carousel can be navigated at all. Defaults to TRUE. */
    get interactive(): boolean {
        return this._state.interactive;
    }

    set interactive(value: boolean) {
        this.setAttribute('interactive', value ? 'true' : 'false');
    }

    /** Spacing between pages in px (`AdwCarousel:spacing`). */
    get spacing(): number {
        return this._state.spacing;
    }

    set spacing(value: number) {
        this.setAttribute('spacing', String(value));
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this._trackEl = document.createElement('div');
        this._trackEl.className = 'adw-carousel-track';
        // CSS rather than a hard-coded `behavior: 'smooth'`, so it stays
        // overridable: `scroll-behavior: auto` on the track makes every scroll
        // instant, for prefers-reduced-motion or for a test that needs it to land now.
        this._trackEl.style.setProperty('scroll-behavior', 'smooth');

        // Declared properties BEFORE children: `spacing` is part of the page pitch,
        // so a page added first would be measured against the wrong distance.
        this._applyAttribute('allow-scroll-wheel', this.getAttribute('allow-scroll-wheel'));
        this._applyAttribute('allow-long-swipes', this.getAttribute('allow-long-swipes'));
        this._applyAttribute('interactive', this.getAttribute('interactive'));
        this._applyAttribute('spacing', this.getAttribute('spacing'));

        const declared = Array.from(this.children).filter(
            (child): child is HTMLElement => child instanceof HTMLElement,
        );
        this.replaceChildren(this._trackEl);
        for (const page of declared) this._insert(page, -1);

        this._trackEl.addEventListener('scroll', this._onScroll, { passive: true });
        this._trackEl.addEventListener('wheel', this._onWheel, { passive: false });

        // Applied last, once the pages it names exist. Custom-element upgrade
        // delivers attributes BEFORE `connectedCallback`, so reading it here is the
        // only way `<adw-carousel position="2">` works at all.
        this._applyAttribute('position', this.getAttribute('position'));
    }

    attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null) {
        if (!this._initialized) return;
        this._applyAttribute(name, newValue);
    }

    disconnectedCallback() {
        // A pending declared position watches the track for its first layout; a
        // carousel removed before that must not keep the observer alive.
        this._cancelPendingPosition();
    }

    private _applyAttribute(name: string, value: string | null): void {
        switch (name) {
            case 'allow-scroll-wheel':
                // Absent means TRUE here: the property defaults TRUE in C, so the
                // usual "presence = on" spelling would invert it.
                this._state.setAllowScrollWheel(value !== 'false');
                return;
            case 'allow-long-swipes':
                this._state.setAllowLongSwipes(value !== null && value !== 'false');
                this._applySnapStop();
                return;
            case 'interactive':
                this._state.setInteractive(value !== 'false');
                return;
            case 'spacing': {
                const spacing = value === null ? 0 : Number.parseFloat(value);
                if (Number.isFinite(spacing)) this._state.setSpacing(Math.max(0, spacing));
                this._trackEl.style.columnGap = `${this._state.spacing}px`;
                return;
            }
            case 'position':
                // One parse for both paths, so `1.7` resolves the same declaratively
                // and imperatively.
                if (value !== null) this._positionWhenMeasurable(Number.parseFloat(value));
        }
    }

    /**
     * Scroll to `value`, waiting for the first layout when the track has no width yet:
     * `connectedCallback` runs DURING insertion, so the track is still 0px wide and a
     * scroll offset has nowhere to land. The first non-zero measurement is the earliest
     * point at which the offset means anything; a later assignment replaces the pending
     * one.
     */
    private _positionWhenMeasurable(value: number): void {
        if (!Number.isFinite(value)) return;
        if (this._trackEl.clientWidth > 0) {
            this._cancelPendingPosition();
            this._scrollInstantly(value);
            return;
        }
        this._pendingPosition = value;
        if (this._pendingLayout) return;
        this._pendingLayout = new ResizeObserver(() => {
            if (this._trackEl.clientWidth <= 0) return;
            const pending = this._pendingPosition;
            this._cancelPendingPosition();
            if (pending !== null) this._scrollInstantly(pending);
        });
        this._pendingLayout.observe(this._trackEl);
    }

    /**
     * Jump to `value` without the reveal animation: a DECLARED position is where the
     * carousel STARTS, not somewhere it travels to. Left smooth, the track is still at
     * offset 0 while the animation runs and the `scroll` event fired from there
     * recomputes the position back to page 0 — so this one assignment is made instant
     * and the caller's `scroll-behavior` restored.
     */
    private _scrollInstantly(value: number): void {
        const previous = this._trackEl.style.getPropertyValue('scroll-behavior');
        this._trackEl.style.setProperty('scroll-behavior', 'auto');
        try {
            this._scrollToPosition(value);
        } finally {
            if (previous) this._trackEl.style.setProperty('scroll-behavior', previous);
            else this._trackEl.style.removeProperty('scroll-behavior');
        }
    }

    private _cancelPendingPosition(): void {
        this._pendingLayout?.disconnect();
        this._pendingLayout = undefined;
        this._pendingPosition = null;
    }

    private _scrollToPosition(value: number): void {
        if (!Number.isFinite(value)) return;
        const page = this._state.pageAt(value);
        if (page >= 0) this.scrollToPage(page);
    }

    /**
     * Insert `page` at `position` — `adw_carousel_insert`.
     * `-1` or a position past the end appends. Returns whether it was added.
     */
    insertPage(page: HTMLElement, position = -1): boolean {
        if (!this._initialized) {
            this.appendChild(page);
            return true;
        }
        return this._insert(page, position);
    }

    /** `adw_carousel_append`. */
    appendPage(page: HTMLElement): boolean {
        return this.insertPage(page, -1);
    }

    /** `adw_carousel_prepend`. */
    prependPage(page: HTMLElement): boolean {
        return this.insertPage(page, 0);
    }

    /** Remove `page` — `adw_carousel_remove`. */
    removePage(page: HTMLElement): boolean {
        const id = this._idOf(page);
        if (id === null) return false;
        if (!this._state.removePage(id)) return false;
        // reveal-duration is 0 by default and this port has no reveal ramp, so
        // the shrink completes at once — `adw_animation_skip`.
        this._state.skipReveal(id);
        this._syncTrack();
        return true;
    }

    /** Move `page` — `adw_carousel_reorder`. */
    reorderPage(page: HTMLElement, position: number): boolean {
        const id = this._idOf(page);
        if (id === null) return false;
        if (!this._state.reorderPage(id, position)) return false;
        this._syncTrack();
        return true;
    }

    /**
     * Scroll to the page at `index`. Out-of-range, fractional and NaN indices are
     * refused rather than clamped, matching `adw_carousel_get_nth_page`'s
     * precondition.
     */
    scrollToPage(index: number): void {
        this._state.scrollTo(index);
    }

    /** One keynav step — `navigate_to_direction`. */
    navigate(direction: 'back' | 'forward'): boolean {
        return this._state.navigate(direction);
    }

    private _insert(page: HTMLElement, position: number): boolean {
        const id = `page-${this._nextPageId++}`;
        if (!this._state.insertPage(id, position)) return false;

        const slot = document.createElement('div');
        slot.className = 'adw-carousel-page';
        slot.appendChild(page);
        this._slots.set(id, slot);

        // No reveal ramp in this port: with reveal-duration 0 the page is at full
        // size immediately, which is what a zero-duration AdwTimedAnimation does.
        this._state.skipReveal(id);
        this._syncTrack();
        return true;
    }

    private _idOf(page: HTMLElement): string | null {
        for (const [id, slot] of this._slots) if (slot.contains(page)) return id;
        return null;
    }

    private _syncTrack(): void {
        const ids = this._state.ids;
        const live = new Set(ids);
        for (const [id, slot] of this._slots) {
            if (live.has(id)) continue;
            slot.remove();
            this._slots.delete(id);
        }
        ids.forEach((id, index) => {
            const slot = this._slots.get(id);
            if (!slot) return;
            if (this._trackEl.children[index] !== slot) {
                this._trackEl.insertBefore(slot, this._trackEl.children[index] ?? null);
            }
        });
        this._applySnapStop();
        this._applyScrollFromModel();
    }

    /**
     * Put the scroll offset back where the model says it is, instantly. A page revealed
     * at or before the current one moves the position with it (`shift_position`)
     * precisely so the page on screen does not slide sideways — but a scroll container
     * keeps its old offset and would show the newly-inserted page instead. GTK gets this
     * from the allocation that adds the child; here it takes one write.
     */
    private _applyScrollFromModel(): void {
        const distance = this._distance();
        if (!(distance > 0)) return;
        this._trackEl.scrollTo({ left: this._state.position * distance, behavior: 'instant' });
    }

    /**
     * `allow-long-swipes` in CSS: `scroll-snap-stop: always` forces the scroll to
     * stop at every page, which is exactly what the property being FALSE means —
     * "each swipe can only move to the adjacent pages".
     */
    private _applySnapStop(): void {
        const stop = this._state.allowLongSwipes ? 'normal' : 'always';
        for (const slot of this._slots.values()) slot.style.setProperty('scroll-snap-stop', stop);
    }

    /** The px pitch between two page origins — `self->distance`. */
    private _distance(): number {
        const first = this._trackEl?.firstElementChild as HTMLElement | null;
        if (!first) return 0;
        return this._state.pageDistance(first.getBoundingClientRect().width);
    }

    private _performScroll(request: CarouselScrollRequest): void {
        if (!this._trackEl) return;
        const distance = this._distance();
        if (!(distance > 0)) return;
        this._pendingInteractive = request.interactive;
        // `offset = distance * position`, NOT `slot.offsetLeft` — that is measured from
        // the nearest POSITIONED ancestor and coincides with the scroll offset only by
        // accident.
        this._trackEl.scrollTo({ left: request.index * distance });
    }

    private _onScroll = (): void => {
        if (this._scrollRaf) return;
        this._scrollRaf = requestAnimationFrame(() => {
            this._scrollRaf = 0;
            this._updatePositionFromScroll();
        });
    };

    private _onWheel = (event: WheelEvent): void => {
        const step = this._state.handleWheel({
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            source: wheelSource(event),
        });
        // GDK_EVENT_STOP only when it actually paged — a sub-threshold scroll must
        // propagate, not be swallowed.
        if (step !== 0) event.preventDefault();
    };

    private _updatePositionFromScroll(): void {
        const distance = this._distance();
        if (!(distance > 0)) return;

        const next = this._trackEl.scrollLeft / distance;
        // A scroll event that does not MOVE the position is the echo of the offset
        // `_applyScrollFromModel` just wrote; reading it back as an arrival would
        // announce a `page-changed` for an insert that deliberately kept the same page
        // on screen. `notify::position` still goes out — C's is unconditional too.
        if (!this._state.setPosition(next, this._pendingInteractive ?? true)) return;
        // `scroll_animation_done_cb` has an animation to tell it the scroll
        // finished; scroll-snap has only the offset, so the core stands ARRIVAL
        // at a snap point in for it.
        if (this._state.settleIfArrived()) this._pendingInteractive = null;
    }

    private _onStateChange(change: CarouselStateChange): void {
        if (change.reason === 'n-pages') {
            this.dispatchEvent(
                new CustomEvent('notify::n-pages', { bubbles: true, detail: { nPages: change.nPages } }),
            );
            return;
        }
        if (change.reason === 'position') {
            this.dispatchEvent(
                new CustomEvent('notify::position', {
                    bubbles: true,
                    detail: { position: change.position, page: change.page, interactive: change.interactive },
                }),
            );
        }
    }
}

abstract class AdwCarouselIndicator extends HTMLElement {
    protected _carousel: CarouselHost | null = null;
    protected _initialized = false;

    static get observedAttributes() {
        return ['for'];
    }

    /** The bound carousel. Mirrors AdwCarouselIndicator*'s `carousel` property. */
    get carousel(): CarouselHost | null {
        return this._carousel;
    }

    set carousel(value: CarouselHost | null) {
        if (value === this._carousel) return;
        this._detach();
        this._carousel = value;
        this._attach();
    }

    connectedCallback() {
        this._initialized = true;
        if (!this._carousel) this._resolveForAttr();
        this._attach();
        this._render();
    }

    disconnectedCallback() {
        this._detach();
    }

    attributeChangedCallback(name: string) {
        if (name === 'for' && this._initialized) {
            this._detach();
            this._carousel = null;
            this._resolveForAttr();
            this._attach();
            this._render();
        }
    }

    private _resolveForAttr(): void {
        const id = this.getAttribute('for');
        if (!id) return;
        const root = this.getRootNode() as Document | ShadowRoot;
        const el = root.getElementById?.(id) ?? document.getElementById(id);
        if (el instanceof AdwCarousel) this._carousel = el;
    }

    private _attach(): void {
        if (!this._carousel || !this._initialized) return;
        this._carousel.addEventListener('notify::position', this._onChange);
        this._carousel.addEventListener('notify::n-pages', this._onChange);
        this._render();
    }

    private _detach(): void {
        if (!this._carousel) return;
        this._carousel.removeEventListener('notify::position', this._onChange);
        this._carousel.removeEventListener('notify::n-pages', this._onChange);
    }

    private _onChange = (): void => {
        this._render();
    };

    protected nPages(): number {
        return this._carousel?.nPages ?? 0;
    }

    protected position(): number {
        return this._carousel?.position ?? 0;
    }

    protected currentPage(): number {
        return this._carousel?.currentPage ?? -1;
    }

    protected goTo(index: number): void {
        this._carousel?.scrollToPage(index);
    }

    protected abstract _render(): void;
}

export class AdwCarouselIndicatorDots extends AdwCarouselIndicator {
    protected _render(): void {
        renderIndicator(this, 'adw-carousel-dot', this.nPages(), this.position(), this.currentPage(), (i) =>
            this.goTo(i),
        );
    }
}

export class AdwCarouselIndicatorLines extends AdwCarouselIndicator {
    protected _render(): void {
        renderIndicator(this, 'adw-carousel-line', this.nPages(), this.position(), this.currentPage(), (i) =>
            this.goTo(i),
        );
    }
}

/**
 * Shared rebuild for both indicator kinds: one child per page, the CURRENT page carries
 * `.active`, and clicking scrolls the carousel. The dot/line look is in SCSS, driven by
 * a per-marker `--adw-carousel-progress`.
 *
 * `current` comes from the carousel's `get_page_at_position`, not from the progress
 * ramp: a `progress > 0.5` test marks NO dot at an exact half-way position, where both
 * neighbours score exactly 0.5.
 *
 * MODIFICATION: the ramp is the `1 − |position − i|` approximation, exact only while
 * every page is fully revealed. libadwaita's real per-dot progress (`snapshot_dots`)
 * also scales radius and opacity by that page's size, which needs a reveal ramp this
 * port does not have.
 */
function renderIndicator(
    host: HTMLElement,
    markerClass: string,
    nPages: number,
    position: number,
    current: number,
    onClick: (index: number) => void,
): void {
    if (host.childElementCount !== nPages) {
        const markers: HTMLButtonElement[] = [];
        for (let i = 0; i < nPages; i++) {
            const marker = document.createElement('button');
            marker.type = 'button';
            marker.className = markerClass;
            marker.setAttribute('aria-label', `Page ${i + 1}`);
            marker.addEventListener('click', () => onClick(i));
            markers.push(marker);
        }
        host.replaceChildren(...markers);
    }
    Array.from(host.children).forEach((child, i) => {
        const progress = Math.max(0, 1 - Math.abs(position - i));
        const marker = child as HTMLElement;
        marker.style.setProperty('--adw-carousel-progress', progress.toFixed(3));
        marker.classList.toggle('active', i === current);
        marker.setAttribute('aria-current', i === current ? 'true' : 'false');
    });
}

customElements.define('adw-carousel', AdwCarousel);
customElements.define('adw-carousel-indicator-dots', AdwCarouselIndicatorDots);
customElements.define('adw-carousel-indicator-lines', AdwCarouselIndicatorLines);
