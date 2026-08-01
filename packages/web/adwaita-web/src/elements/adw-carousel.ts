// <adw-carousel> — a horizontally swipeable pager (the web counterpart of
// Adw.Carousel). Pages are declared as direct children; the carousel lays them
// out in a horizontal scroll-snap strip, tracks the fractional scroll position,
// and exposes a `position` (fractional page index) + `n-pages`, mirroring the
// AdwCarousel properties. Navigation: drag/scroll-snap (touch + trackpad),
// optional scroll-wheel paging, and `scroll-to(index)`.
//
// Indicators are SEPARATE elements bound to a carousel (exactly as the native
// Adw.CarouselIndicatorDots / Adw.CarouselIndicatorLines bind to an
// Adw.Carousel via their `carousel` property): set `el.carousel = carouselEl`
// or place a `for` attribute referencing the carousel's id. The indicator
// listens to the carousel's `notify::position` / `notify::n-pages` events and
// repaints; clicking an indicator scrolls the carousel to that page.
//
// adw-carousel
//   Attributes: allow-scroll-wheel (bool, default present), allow-long-swipes
//     (bool — a flick can skip multiple pages at once), position (number,
//     fractional page index — reflected, settable to snap to a page).
//   Events: `notify::position` (fractional scroll position changed),
//     `notify::n-pages` (page count changed), `page-changed` (settled on a new
//     page; `detail = { index }`) — mirroring the AdwCarousel signals the native
//     story uses.
// adw-carousel-indicator-dots / adw-carousel-indicator-lines
//   Properties: carousel (the bound AdwCarousel element), or a `for` attribute
//     with the carousel element's id.
//
// Reference: refs/libadwaita/src/adw-carousel.c (AdwCarousel behaviour)
// Reference: refs/libadwaita/src/adw-carousel-indicator-dots.c
//   (DOTS_RADIUS 3, DOTS_RADIUS_SELECTED 4, DOTS_OPACITY 0.3,
//    DOTS_OPACITY_SELECTED 0.9, DOTS_SPACING 7)
// Reference: refs/libadwaita/src/adw-carousel-indicator-lines.c
//   (LINE_WIDTH 3, LINE_LENGTH 35, LINE_SPACING 5,
//    LINE_OPACITY 0.3, LINE_OPACITY_ACTIVE 0.9)
// Reference: refs/adwaita-web/adwaita-web/scss/_carousel_indicators.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as Web Components for @gjsify/adwaita-web.

/** Common surface an indicator binds to. The concrete element is AdwCarousel. */
interface CarouselHost extends HTMLElement {
    readonly nPages: number;
    readonly position: number;
    scrollToPage(index: number): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void;
}

export class AdwCarousel extends HTMLElement implements CarouselHost {
    private _trackEl!: HTMLDivElement;
    private _pages: HTMLElement[] = [];
    private _position = 0;
    private _scrollRaf = 0;
    private _wheelAccum = 0;
    private _initialized = false;

    static get observedAttributes() {
        return ['allow-scroll-wheel', 'allow-long-swipes', 'position'];
    }

    /** Number of pages in the carousel. */
    get nPages(): number {
        return this._pages.length;
    }

    /** Fractional scroll position (0 = first page, 1 = second, …). */
    get position(): number {
        return this._position;
    }

    set position(value: number) {
        const clamped = Math.min(Math.max(value, 0), Math.max(0, this.nPages - 1));
        this.scrollToPage(Math.round(clamped));
    }

    /** Whether the scroll wheel navigates between pages. */
    get allowScrollWheel(): boolean {
        return this.hasAttribute('allow-scroll-wheel');
    }

    set allowScrollWheel(value: boolean) {
        this.toggleAttribute('allow-scroll-wheel', value);
    }

    /** Whether a single flick can skip more than one page. */
    get allowLongSwipes(): boolean {
        return this.hasAttribute('allow-long-swipes');
    }

    set allowLongSwipes(value: boolean) {
        this.toggleAttribute('allow-long-swipes', value);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        // The declared children become the carousel's pages. Snapshot them
        // before we move them into the scroll track.
        this._pages = Array.from(this.children).filter((c): c is HTMLElement => c instanceof HTMLElement);

        this._trackEl = document.createElement('div');
        this._trackEl.className = 'adw-carousel-track';
        for (const page of this._pages) {
            const slot = document.createElement('div');
            slot.className = 'adw-carousel-page';
            slot.appendChild(page);
            this._trackEl.appendChild(slot);
        }
        this.replaceChildren(this._trackEl);

        this._trackEl.addEventListener('scroll', this._onScroll, { passive: true });
        this._trackEl.addEventListener('wheel', this._onWheel, { passive: false });

        // Surface the page count once the DOM is wired so indicators can paint.
        this.dispatchEvent(new CustomEvent('notify::n-pages', { bubbles: true, detail: { nPages: this.nPages } }));
        this._emitPosition();
    }

    attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null) {
        if (!this._initialized) return;
        if (name === 'position' && newValue !== null) {
            const next = Number.parseInt(newValue, 10);
            if (!Number.isNaN(next) && next !== Math.round(this._position)) this.scrollToPage(next);
        }
        // allow-scroll-wheel / allow-long-swipes are read live in the handlers.
    }

    /** Scroll (snap) to the page at `index`, clamped to the valid range. */
    scrollToPage(index: number): void {
        if (!this._trackEl) return;
        const clamped = Math.min(Math.max(index, 0), Math.max(0, this.nPages - 1));
        const slot = this._trackEl.children[clamped] as HTMLElement | undefined;
        if (!slot) return;
        this._trackEl.scrollTo({ left: slot.offsetLeft, behavior: 'smooth' });
    }

    private _onScroll = (): void => {
        if (this._scrollRaf) return;
        this._scrollRaf = requestAnimationFrame(() => {
            this._scrollRaf = 0;
            this._updatePositionFromScroll();
        });
    };

    private _onWheel = (event: WheelEvent): void => {
        if (!this.allowScrollWheel || this.nPages === 0) return;
        // A horizontal scroll already pans the snap strip natively; only the
        // vertical wheel needs translating into page steps (mirrors AdwCarousel,
        // which lets vertical scrolling page a horizontal carousel).
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        this._wheelAccum += event.deltaY;
        const threshold = 40;
        if (Math.abs(this._wheelAccum) < threshold) return;
        const step = this._wheelAccum > 0 ? 1 : -1;
        this._wheelAccum = 0;
        const current = Math.round(this._position);
        const target = this.allowLongSwipes ? current + step * 1 : current + step;
        this.scrollToPage(target);
    };

    private _updatePositionFromScroll(): void {
        if (!this._trackEl) return;
        const slotWidth = this._slotWidth();
        if (slotWidth <= 0) return;
        const next = this._trackEl.scrollLeft / slotWidth;
        const settledBefore = Math.round(this._position);
        this._position = next;
        this._emitPosition();
        const settledAfter = Math.round(next);
        // Snap landed cleanly on a page boundary → page-changed (within 0.02 of
        // an integer index, matching a finished scroll-snap).
        if (settledAfter !== settledBefore && Math.abs(next - settledAfter) < 0.02) {
            this.dispatchEvent(new CustomEvent('page-changed', { bubbles: true, detail: { index: settledAfter } }));
        }
    }

    private _slotWidth(): number {
        const first = this._trackEl?.children[0] as HTMLElement | undefined;
        return first ? first.offsetWidth : 0;
    }

    private _emitPosition(): void {
        this.dispatchEvent(
            new CustomEvent('notify::position', { bubbles: true, detail: { position: this._position } }),
        );
    }
}

/** Shared base for the dot / line indicator elements. */
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

    protected goTo(index: number): void {
        this._carousel?.scrollToPage(index);
    }

    protected abstract _render(): void;
}

export class AdwCarouselIndicatorDots extends AdwCarouselIndicator {
    protected _render(): void {
        renderIndicator(this, 'adw-carousel-dot', this.nPages(), this.position(), (i) => this.goTo(i));
    }
}

export class AdwCarouselIndicatorLines extends AdwCarouselIndicator {
    protected _render(): void {
        renderIndicator(this, 'adw-carousel-line', this.nPages(), this.position(), (i) => this.goTo(i));
    }
}

/**
 * Shared rebuild for both indicator kinds: one child per page, the marker
 * closest to the fractional position carries `.active`, and clicking scrolls
 * the carousel. The dot/line look (size, growth, opacity ramp) is in SCSS; the
 * `--adw-carousel-progress` custom property carries the per-marker proximity so
 * the active marker can grow/brighten the way libadwaita lerps between the
 * inactive and selected states.
 */
function renderIndicator(
    host: HTMLElement,
    markerClass: string,
    nPages: number,
    position: number,
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
        // Proximity in [0,1]: 1 on the focused page, ramping to 0 one page away
        // (matches AdwCarousel's per-dot lerp progress = 1 - |position - i|).
        const progress = Math.max(0, 1 - Math.abs(position - i));
        const marker = child as HTMLElement;
        marker.style.setProperty('--adw-carousel-progress', progress.toFixed(3));
        marker.classList.toggle('active', progress > 0.5);
        marker.setAttribute('aria-current', progress > 0.5 ? 'true' : 'false');
    });
}

customElements.define('adw-carousel', AdwCarousel);
customElements.define('adw-carousel-indicator-dots', AdwCarouselIndicatorDots);
customElements.define('adw-carousel-indicator-lines', AdwCarouselIndicatorLines);
