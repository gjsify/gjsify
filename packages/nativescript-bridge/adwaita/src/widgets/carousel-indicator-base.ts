// The shared half of `Adw.CarouselIndicatorDots` and `Adw.CarouselIndicatorLines` for
// NativeScript — a row of markers bound to an `AdwCarousel` through `carousel`.
//
// SEPARATE FROM THE CAROUSEL, AS UPSTREAM. libadwaita's carousel draws no indicator; each
// indicator is its own widget that reads the bound carousel's `position` and `n-pages` and
// asks it to scroll when a marker is clicked (adw-carousel-indicator-dots.c,
// adw-carousel-indicator-lines.c). A Blueprint binds one with `carousel: carousel`, which the
// shared-tree builder resolves by id (`builderReferences`, `builder-slots.ts`).
//
// ONE MARKER PER PAGE, the current one `active`. The current page is the carousel's
// `currentPage` — `get_page_at_position`, so a half-way position marks the lower page — and
// the classes come from `indicatorMarkerClasses` (`carousel-state.ts`), the same rule the
// spec holds against the core's carousel vectors.
//
// FIDELITY: approximated. The C indicators snapshot a per-marker progress ramp — a dot grows
// from radius 3 to 4 and its opacity from 0.3 to 0.9 with how close the position is — which
// needs the page sizes a reveal animation produces. This port marks the current page only.
//
// Reference: refs/libadwaita/src/adw-carousel-indicator-dots.c
// Reference: refs/libadwaita/src/adw-carousel-indicator-lines.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, Label, StackLayout } from '@nativescript/core';

import { NOTIFY_N_PAGES, NOTIFY_POSITION, type AdwCarousel } from './adw-carousel.js';
import { applyMarkerClasses, indicatorMarkerClasses } from './carousel-state.js';
import { withSignals } from './signals.js';

/** The two `Gtk.Orientation` nicks `GtkOrientable:orientation` takes. */
const GTK_ORIENTATIONS = ['horizontal', 'vertical'] as const;

export abstract class AdwCarouselIndicatorBase extends withSignals(GridLayout) {
    /** `carousel` names an `AdwCarousel` of the same tree — see `./builder-slots.ts`. */
    static readonly builderReferences: readonly string[] = ['carousel'];

    /** The marker row, centred in the indicator's cell as the C snapshot centres it. */
    protected readonly _row: StackLayout;
    private _carousel: AdwCarousel | null = null;
    private readonly _onChange = (): void => this._render();

    /** The class every marker carries — `adw-carousel-dot` or `adw-carousel-line`. */
    protected abstract readonly _markerClass: string;
    /** What a marker shows; the look is the theme's. */
    protected abstract readonly _markerText: string;

    constructor(indicatorClass: string) {
        super();
        this.className = indicatorClass;
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'auto'));

        const row = new StackLayout();
        row.orientation = 'horizontal';
        row.horizontalAlignment = 'center';
        row.verticalAlignment = 'middle';
        this.addChild(row);
        this._row = row;
    }

    /** `AdwCarouselIndicator*:carousel` — the carousel whose pages this marks, or `null`. */
    get carousel(): AdwCarousel | null {
        return this._carousel;
    }

    set carousel(carousel: AdwCarousel | null) {
        if (carousel === this._carousel) return;
        if (this._carousel !== null) {
            this._carousel.removeEventListener(NOTIFY_POSITION, this._onChange);
            this._carousel.removeEventListener(NOTIFY_N_PAGES, this._onChange);
        }
        this._carousel = carousel;
        if (carousel !== null) {
            carousel.addEventListener(NOTIFY_POSITION, this._onChange);
            carousel.addEventListener(NOTIFY_N_PAGES, this._onChange);
        }
        this._render();
    }

    /**
     * `GtkOrientable:orientation` — the axis the markers run along, `horizontal` by default.
     * The nick, as `Gtk.Box`'s `orientation` takes it; anything else is refused.
     */
    get orientation(): string {
        return this._row.orientation;
    }

    set orientation(value: string) {
        const nick = GTK_ORIENTATIONS.find((member) => member === value);
        if (nick === undefined) {
            throw new TypeError(
                `'${String(value)}' is not a Gtk.Orientation: the members are horizontal and vertical.`,
            );
        }
        this._row.orientation = nick;
        this._row.horizontalAlignment = nick === 'horizontal' ? 'center' : 'stretch';
        this._row.verticalAlignment = nick === 'horizontal' ? 'middle' : 'stretch';
    }

    /** Rebuild the markers when the page count moved, then mark the current page. */
    private _render(): void {
        const carousel = this._carousel;
        const count = carousel?.nPages ?? 0;
        if (this._row.getChildrenCount() !== count) {
            while (this._row.getChildrenCount() > 0) this._row.removeChild(this._row.getChildAt(0));
            for (let index = 0; index < count; index++) {
                const marker = new Label();
                marker.text = this._markerText;
                // The index is the marker's own position, read at tap time against the
                // carousel as it is then, so a reorder cannot make a marker tap a stranger.
                marker.addEventListener('tap', () => {
                    const page = this._carousel?.pages[index];
                    if (page !== undefined) this._carousel?.scroll_to(page);
                });
                this._row.addChild(marker);
            }
        }
        const markers: Label[] = [];
        for (let index = 0; index < this._row.getChildrenCount(); index++) {
            markers.push(this._row.getChildAt(index) as Label);
        }
        applyMarkerClasses(markers, indicatorMarkerClasses(this._markerClass, count, carousel?.currentPage ?? -1));
    }
}
