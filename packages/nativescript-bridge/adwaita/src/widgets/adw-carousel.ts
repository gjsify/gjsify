// AdwCarousel — a Libadwaita-style swipeable pager for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` holding a horizontal `ScrollView` of
// full-width pages. Mirrors `Adw.Carousel`: `insert`/`remove`/`reorder`,
// `position`, `scroll_to()`, `nPages`, `notify::position` and `page-changed`.
//
// NO INDICATOR OF ITS OWN, AS UPSTREAM. An `Adw.Carousel` draws no dots; the page
// indicator is a separate widget bound through its `carousel` property —
// `Adw.CarouselIndicatorDots` or `…Lines` (`adw-carousel-indicator-dots.ts`,
// `adw-carousel-indicator-lines.ts`) — so an app places it where it wants, or picks the
// lines, or has none. This port used to build a dot row into the carousel's own grid,
// which put two rows of dots under a Blueprint that binds an indicator as GTK does.
//
// The BEHAVIOUR is headless in `@gjsify/adwaita-core` (ADR 0004) as `CarouselState`,
// shared with the `@gjsify/adwaita-web` twin and pinned by the conformance vectors;
// `carousel-state.ts` holds the NS projection onto scroll offsets and dot classes.
// This class is the `GridLayout` wiring only. `position` is a FRACTIONAL double fed by
// the `ScrollView` scroll listener, so a drag in progress is observable.
//
// FIDELITY: compromised. NS has no native carousel and no paging-snap on `ScrollView`,
// so pages are fixed-width children of a horizontal `ScrollView` and a scroll to a page
// calls `scrollToHorizontalOffset`. (1) No snap-to-page: a free flick can rest between
// pages and nothing pulls it to a snap point. (2) The page width must be known to
// compute offsets — set `pageWidth` to the carousel's on-screen width (default 320
// DIP). (3) No scroll wheel and no reveal animation, so `allow-scroll-wheel` and
// `reveal-duration` are absent rather than present and inert.
//
// Reference: refs/libadwaita/src/adw-carousel.c (Adw.Carousel)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';
import { GridLayout, ItemSpec, ScrollView, StackLayout, type EventData } from '@nativescript/core';
import type { CarouselScrollRequest } from '@gjsify/adwaita-core';
import {
    CarouselScrollSync,
    DEFAULT_CAROUSEL_PAGE_WIDTH,
    carouselNotifyPayload,
    carouselPositionAtOffset,
    carouselScrollOffset,
    createCarouselState,
    normalizeCarouselPageWidth,
    type CarouselNotifyPayload,
} from './carousel-state.js';
import { xmlBoolean, xmlNumber } from './xml-values.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { withSignals } from './signals.js';

// Re-exported so the widget module stays the one import site, as
// `widgets/index.ts` and every consumer already expect.
export { DEFAULT_CAROUSEL_PAGE_WIDTH };

/** Event name emitted when {@link AdwCarousel.position} changes. Mirrors GObject `notify::position`. */
export const NOTIFY_POSITION = 'notify::position';

/** Event name emitted when the page count changes. Mirrors GObject `notify::n-pages`. */
export const NOTIFY_N_PAGES = 'notify::n-pages';

/** Event name emitted after a completed scroll. Mirrors the `AdwCarousel::page-changed` signal. */
export const PAGE_CHANGED = 'page-changed';

/** Payload of the {@link NOTIFY_POSITION} and {@link NOTIFY_N_PAGES} events. */
export interface NotifyPositionEventData extends EventData, CarouselNotifyPayload {}

/** Payload of the {@link PAGE_CHANGED} event. `index` is `-1` for an empty carousel. */
export interface PageChangedEventData extends EventData {
    /** The page the carousel came to rest on, `-1` when it has none. */
    index: number;
}

/** NativeScript's `ScrollView` scroll event, which the ambient type slice does not name. */
interface ScrollEventData extends EventData {
    scrollX: number;
    scrollY: number;
}

export class AdwCarousel extends withSignals(GridLayout) {
    /** The horizontal scroller holding the pages. */
    protected readonly _scroller: ScrollView;
    /** The horizontal track inside the scroller (holds fixed-width pages). */
    protected readonly _track: StackLayout;
    private readonly _state = createCarouselState({ onScrollTo: (request) => this._performScroll(request) });
    private readonly _sync = new CarouselScrollSync();
    /** Page id → its content view, so a DOM-free model can still be projected. */
    private readonly _views = new Map<string, View>();
    private _nextPageId = 0;
    private _pageWidth = DEFAULT_CAROUSEL_PAGE_WIDTH;

    constructor(props?: ConstructProps<AdwCarousel>) {
        super();

        this.className = 'adw-carousel';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star'));

        const scroller = new ScrollView();
        scroller.orientation = 'horizontal';
        scroller.className = 'adw-carousel-scroller';
        GridLayout.setRow(scroller, 0);

        const track = new StackLayout();
        track.orientation = 'horizontal';
        track.className = 'adw-carousel-track';
        scroller.content = track;
        this.addChild(scroller);
        this._scroller = scroller;
        this._track = track;

        // A free swipe is the only scroll nobody declared, so it is the one that
        // drives the model — `update_swipe_cb` (adw-carousel.c:418-424).
        scroller.addEventListener('scroll', (data: EventData) => {
            const position = carouselPositionAtOffset((data as ScrollEventData).scrollX, this._distance());
            this._sync.apply(this._state, position);
        });

        this._state.subscribe((change) => {
            const data: NotifyPositionEventData = {
                eventName: change.reason === 'n-pages' ? NOTIFY_N_PAGES : NOTIFY_POSITION,
                object: this,
                ...carouselNotifyPayload(change),
            };
            this.notify(data);
        });
        this._state.onPageChanged((index) => {
            const data: PageChangedEventData = { eventName: PAGE_CHANGED, object: this, index };
            this.notify(data);
        });

        applyConstructProps(this, props);
    }

    /** Append a page — `adw_carousel_append` (adw-carousel.c:1348-1357). */
    append(view: View): void {
        this.insert(view, -1);
    }

    /**
     * An XML child is a PAGE, appended in document order.
     *
     * The name is ignored: a carousel has one kind of child. Without this,
     * `LayoutBase`'s default puts the view straight into the grid the carousel builds
     * its scroller in — on top of the track rather than on it, and the page never gets
     * a width or a `adw-carousel-page` class.
     */
    _addChildFromBuilder(_name: string, view: View): void {
        this.append(view);
    }

    /**
     * Insert a page at `position` — `adw_carousel_insert` (adw-carousel.c:1370-1407).
     * `-1` or a position past the end appends. Returns whether it was added.
     */
    insert(view: View, position = -1): boolean {
        const id = `page-${this._nextPageId++}`;

        view.width = this._pageWidth;
        view.className = `${view.className ?? ''} adw-carousel-page`.trim();

        // Registered BEFORE the model knows about the page: `insert` notifies
        // synchronously, and a bound indicator reads the pages back from the track.
        this._views.set(id, view);

        if (!this._state.insertPage(id, position)) {
            this._views.delete(id);
            return false;
        }

        // No reveal ramp in this port: with reveal-duration 0 the page is at full
        // size immediately, which is what a zero-duration AdwTimedAnimation does.
        this._state.skipReveal(id);
        this._syncTrack();
        return true;
    }

    /** Remove a page — `adw_carousel_remove` (adw-carousel.c:1508-1532). */
    remove(view: View): boolean {
        const id = this._idOf(view);
        if (id === null) return false;
        if (!this._state.removePage(id)) return false;
        // reveal-duration is 0 and this port has no shrink ramp, so the removal
        // completes at once — `adw_animation_skip` (:331).
        this._state.skipReveal(id);
        this._views.delete(id);
        this._syncTrack();
        return true;
    }

    /** Move a page — `adw_carousel_reorder` (adw-carousel.c:1419-1499). */
    reorder(view: View, position: number): boolean {
        const id = this._idOf(view);
        if (id === null) return false;
        if (!this._state.reorderPage(id, position)) return false;
        this._syncTrack();
        return true;
    }

    /**
     * Scroll to a page — `adw_carousel_scroll_to` (adw-carousel.c:1600-1640).
     *
     * Takes the PAGE, as its siblings `insert`, `remove` and `reorder` already do, and
     * resolves it through the same `_idOf` they use; a view this carousel does not hold
     * is refused, which is C's precondition — and it is what a bound indicator calls
     * with `pages[i]` when a marker is tapped, as `adw-carousel-indicator-dots.c` does.
     * The INDEX door is {@link position}.
     */
    scroll_to(page: View): void {
        const id = this._idOf(page);
        if (id === null) return;
        this._scrollToIndex(this._state.indexOf(id));
    }

    /** One keynav step — `navigate_to_direction` (adw-carousel.c:475-508). */
    navigate(direction: 'back' | 'forward'): boolean {
        return this._state.navigate(direction);
    }

    /** The pages on the track, in order — the read-back for `append`/`insert`. */
    get pages(): readonly View[] {
        const out: View[] = [];
        for (let i = 0; i < this._track.getChildrenCount(); i++) out.push(this._track.getChildAt(i));
        return out;
    }

    /** The number of pages. */
    get nPages(): number {
        return this._state.nPages;
    }

    /** The fractional scroll position; 1 matches 1 page. */
    get position(): number {
        return this._state.position;
    }

    /**
     * Scroll to the page this position settles on.
     *
     * `AdwCarousel:position` is READ-ONLY in C (adw-carousel.c:1036-1041) — the
     * setter is a port convenience, and it resolves the value with the same
     * `get_page_at_position` rule used everywhere else, so 0.5 lands on page 0
     * where the old `Math.round` picked page 1.
     */
    set position(raw: number | string) {
        const value = xmlNumber(raw, this.position);
        if (!Number.isFinite(value)) return;
        const page = this._state.pageAt(value);
        if (page >= 0) this._scrollToIndex(page);
    }

    /** The page the current position settles on, `-1` when the carousel is empty. */
    get currentPage(): number {
        return this._state.pageAt(this._state.position);
    }

    /** Whether the carousel can be navigated (`AdwCarousel:interactive`, default TRUE). */
    get interactive(): boolean {
        return this._state.interactive;
    }

    set interactive(raw: boolean | string) {
        const value = xmlBoolean(raw, this.interactive);
        this._state.setInteractive(value);
    }

    /**
     * The per-page width in DIPs used for scroll-offset math. Set this to the
     * carousel's on-screen width so `scroll_to` lands cleanly. Re-applies to
     * all existing pages.
     */
    get pageWidth(): number {
        return this._pageWidth;
    }

    set pageWidth(raw: number | string) {
        const value = xmlNumber(raw, this.pageWidth);
        this._pageWidth = normalizeCarouselPageWidth(value);
        for (const view of this._views.values()) view.width = this._pageWidth;
    }

    /** The px pitch between two page origins — `self->distance` (adw-carousel.c:767). */
    private _distance(): number {
        return this._state.pageDistance(this._pageWidth);
    }

    /**
     * Scroll to a page by index. Out-of-range, fractional and NaN indices are
     * refused rather than clamped, matching `adw_carousel_get_nth_page`'s
     * precondition (adw-carousel.c:1616) — an index of NaN used to set the
     * position to NaN and leave no dot selected.
     */
    private _scrollToIndex(index: number): void {
        this._state.scrollTo(index, { interactive: true });
    }

    /** The state's id for a page view, or `null` when it is not one of ours. */
    private _idOf(view: View): string | null {
        for (const [id, candidate] of this._views) if (candidate === view) return id;
        return null;
    }

    /** Run the scroll the state asked for. */
    private _performScroll(request: CarouselScrollRequest): void {
        this._sync.expect(request.position);
        this._scroller.scrollToHorizontalOffset(carouselScrollOffset(request.position, this._distance()), true);
    }

    /**
     * Make the track's child list match the model order.
     *
     * Detach-then-reattach rather than a positional patch: NS has no "move
     * child", `insertChild` on an already-parented view double-parents it, and
     * the page counts here are small enough that the simple version is the one
     * that cannot be subtly wrong after a reorder.
     */
    private _syncTrack(): void {
        while (this._track.getChildrenCount() > 0) this._track.removeChild(this._track.getChildAt(0));
        for (const id of this._state.ids) {
            const view = this._views.get(id);
            if (view) this._track.addChild(view);
        }
    }
}
