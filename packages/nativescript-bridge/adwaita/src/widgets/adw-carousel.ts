// AdwCarousel — a Libadwaita-style swipeable pager for NativeScript.
//
// Renders a REAL NativeScript `GridLayout` (rows `*, auto`): a horizontal
// `ScrollView` of full-width pages (row 0) and a row of page-indicator dots
// (row 1). Mirrors `Adw.Carousel`: `addPage()`, `position`, `scrollToPage()`,
// `nPages`, and a `notify::position` event.
//
// FIDELITY: compromised. NS has NO native carousel and no paging-snap on
// `ScrollView`. This approximates one: pages are full-viewport-width children of a
// horizontal `ScrollView`; `scrollToPage(i)` calls `scrollToHorizontalOffset`.
// COMPROMISES: (1) no snap-to-page on free swipe (the page only "lands" when you
// call `scrollToPage`/`position`, or via the dots) — a free flick can rest
// between pages; (2) the page width must be known to compute offsets — set
// `pageWidth` to the carousel's on-screen width (defaults to a sensible 320 DIP
// until the consumer sets it); (3) dot indicators are tappable `Label`s, not the
// animated libadwaita dots. For true paging an NS app would use a swipe gesture +
// `view.animate()`, which lives outside this CSS-subset widget contract.
//
// Visual spec ported from `@gjsify/adwaita-web`'s `adw-carousel`.
// Reference: refs/libadwaita/src/stylesheet/widgets/_carousel.scss
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, ScrollView, StackLayout, View, type EventData } from '@nativescript/core';

/** Event name emitted when {@link AdwCarousel.position} changes. Mirrors GObject `notify::position`. */
export const NOTIFY_POSITION = 'notify::position';

/** Payload of the `notify::position` event. */
export interface NotifyPositionEventData extends EventData {
    /** The new page index. */
    position: number;
}

/** Default page width (DIPs) used for offset math until the consumer sets `pageWidth`. */
export const DEFAULT_CAROUSEL_PAGE_WIDTH = 320;

export class AdwCarousel extends GridLayout {
    /** The horizontal scroller holding the pages. */
    protected readonly _scroller: ScrollView;
    /** The horizontal track inside the scroller (holds full-width pages). */
    protected readonly _track: StackLayout;
    /** The dot-indicator row. */
    protected readonly _dots: StackLayout;
    private readonly _pages: View[] = [];
    private readonly _dotLabels: Label[] = [];
    private _position = 0;
    private _pageWidth = DEFAULT_CAROUSEL_PAGE_WIDTH;

    constructor() {
        super();

        this.className = 'adw-carousel';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'star')); // scroller
        this.addRow(new ItemSpec(1, 'auto')); // dots

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

        const dots = new StackLayout();
        dots.orientation = 'horizontal';
        dots.className = 'adw-carousel-dots';
        dots.horizontalAlignment = 'center';
        GridLayout.setRow(dots, 1);
        this.addChild(dots);
        this._dots = dots;
    }

    /** Append a page. The page is forced to the current `pageWidth`. */
    addPage(view: View): void {
        view.width = this._pageWidth;
        view.className = `${view.className ?? ''} adw-carousel-page`.trim();
        this._track.addChild(view);
        this._pages.push(view);

        const dot = new Label();
        dot.text = '●';
        dot.className = 'adw-carousel-dot';
        const index = this._dotLabels.length;
        dot.addEventListener('tap', () => this.scrollToPage(index));
        this._dots.addChild(dot);
        this._dotLabels.push(dot);

        this._applyDots();
    }

    /** Scroll to a page by index (clamped) and update the position. */
    scrollToPage(index: number): void {
        const clamped = Math.max(0, Math.min(this._pages.length - 1, index));
        this._scroller.scrollToHorizontalOffset(clamped * this._pageWidth, true);
        this._setPosition(clamped, true);
    }

    private _setPosition(index: number, emit: boolean): void {
        if (index === this._position) {
            this._applyDots();
            return;
        }
        this._position = index;
        this._applyDots();
        if (emit) {
            const data: NotifyPositionEventData = {
                eventName: NOTIFY_POSITION,
                object: this,
                position: index,
            };
            this.notify(data);
        }
    }

    private _applyDots(): void {
        this._dotLabels.forEach((dot, i) => {
            dot.className = i === this._position ? 'adw-carousel-dot active' : 'adw-carousel-dot';
        });
    }

    /** The number of pages. */
    get nPages(): number {
        return this._pages.length;
    }

    /** The current page index. Setting it scrolls to that page. */
    get position(): number {
        return this._position;
    }

    set position(value: number) {
        this.scrollToPage(Number.isFinite(value) ? Math.round(value) : 0);
    }

    /**
     * The per-page width in DIPs used for scroll-offset math. Set this to the
     * carousel's on-screen width so `scrollToPage` lands cleanly. Re-applies to
     * all existing pages.
     */
    get pageWidth(): number {
        return this._pageWidth;
    }

    set pageWidth(value: number) {
        this._pageWidth = Number.isFinite(value) && value > 0 ? value : DEFAULT_CAROUSEL_PAGE_WIDTH;
        for (const page of this._pages) page.width = this._pageWidth;
    }
}
