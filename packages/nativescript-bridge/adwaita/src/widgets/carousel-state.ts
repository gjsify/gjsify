// AdwCarousel's NativeScript-specific half — the parts that are not the
// position arithmetic.
//
// Everything about WHERE the carousel is — snap points, the clamped range, which page
// a fractional position settles on, the wheel rules, the keynav step, the
// insert/reorder/remove position compensation — is HEADLESS in `@gjsify/adwaita-core`
// as `CarouselState` (ADR 0004). NativeScript-specific is how a position becomes
// pixels: NS has no paging `ScrollView`, so a page index becomes a horizontal offset
// against a consumer-supplied page width, and an indicator's markers are views whose
// class carries the selection. No NS imports at all, so specs run off-device (AGENTS.md).
//
// Reference: refs/libadwaita/src/adw-carousel.c (Adw.Carousel)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { CAROUSEL_SETTLE_EPSILON, CarouselState } from '@gjsify/adwaita-core';
import type { CarouselScrollRequest, CarouselStateChange } from '@gjsify/adwaita-core';

/**
 * Default page width (DIPs) for the offset math until the consumer sets `pageWidth`.
 * libadwaita MEASURES its pages; NS gives a widget no size before its first layout
 * pass, so a plausible phone width keeps the offsets sane until then.
 */
export const DEFAULT_CAROUSEL_PAGE_WIDTH = 320;

/** Construction seams an `AdwCarousel` hands to its state machine. */
export interface NsCarouselStateOptions {
    /** Clock for the wheel lockout — injected so a spec can step past it. */
    now?: () => number;
    /** Invoked for every accepted scroll; the widget turns it into a `scrollToHorizontalOffset`. */
    onScrollTo?: (request: CarouselScrollRequest) => void;
}

/**
 * The state machine an `AdwCarousel` delegates to.
 *
 * `animateScroll` is FALSE: the `ScrollView` animates the pixels but reports nothing
 * until it has, and on an untested platform it may report nothing at all. Keeping the
 * model authoritative makes a `scrollToPage` correct the instant it is called;
 * {@link CarouselScrollSync} keeps the two from fighting.
 */
export function createCarouselState(options: NsCarouselStateOptions = {}): CarouselState {
    return new CarouselState({ ...options, animateScroll: false });
}

/** A page width that can be divided by — anything else falls back to the default. */
export function normalizeCarouselPageWidth(value: number): number {
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_CAROUSEL_PAGE_WIDTH;
}

/** The horizontal scroll offset in DIPs for a position — `distance * position`. */
export function carouselScrollOffset(position: number, distance: number): number {
    return position * distance;
}

/** The inverse: the position a `ScrollView` at `offset` is showing. */
export function carouselPositionAtOffset(offset: number, distance: number): number {
    return distance > 0 ? offset / distance : 0;
}

/**
 * Keeps the model in step with a `ScrollView` that animates its own scrolls.
 *
 * Without this the two fight: the widget moves the model the moment `scrollToPage`
 * is called, then the animation replays every intermediate offset back at it, so the
 * dots run backwards to where the scroll STARTED and crawl forward again, emitting a
 * second `page-changed` on arrival.
 *
 * So a programmatic scroll declares its destination with {@link expect} and every
 * offset before it is ignored. A scroll nobody declared is a user swipe and drives the
 * model directly — which is how a free flick gets a fractional position.
 */
export class CarouselScrollSync {
    /** Position a programmatic scroll is animating towards, `null` while idle. */
    private _expected: number | null = null;

    /** Declare where a programmatic scroll is heading; its intermediate offsets are then ignored. */
    expect(position: number): void {
        this._expected = position;
    }

    /**
     * Feed one `ScrollView` scroll event. Returns whether the model was updated
     * — `false` while a programmatic scroll is still in flight.
     */
    apply(state: CarouselState, position: number, epsilon = CAROUSEL_SETTLE_EPSILON): boolean {
        if (this._expected !== null) {
            // Arrival ends the programmatic scroll; the model is already there,
            // and `page-changed` already fired when it was set.
            if (Math.abs(position - this._expected) < epsilon) this._expected = null;
            return false;
        }
        state.setPosition(position, true);
        state.settleIfArrived(epsilon);
        return true;
    }
}

/**
 * The class string each marker of a page indicator carries, in page order: `markerClass`,
 * and `active` on the page the carousel settles on (`current`, `-1` for none).
 *
 * The CURRENT page comes from `get_page_at_position` (adw-carousel.c:222-239) — the
 * carousel's `currentPage` — never from `Math.round(position)`, so a carousel resting
 * half-way between two pages marks the LOWER one, and a swipe in progress still marks one.
 */
export function indicatorMarkerClasses(markerClass: string, count: number, current: number): string[] {
    return Array.from({ length: count }, (_unused, index) =>
        index === current ? `${markerClass} active` : markerClass,
    );
}

/** {@link indicatorMarkerClasses} for a dot indicator bound to a carousel in `state`. */
export function carouselDotClasses(state: CarouselState): string[] {
    return indicatorMarkerClasses('adw-carousel-dot', state.ids.length, state.pageAt(state.position));
}

/** Push marker classes onto the real marker views, in page order. */
export function applyMarkerClasses(markers: readonly { className: string }[], classes: readonly string[]): void {
    markers.forEach((marker, index) => {
        const next = classes[index];
        if (next !== undefined) marker.className = next;
    });
}

/** The data half of the `notify::position` event (minus NS's `eventName`/`object`). */
export interface CarouselNotifyPayload {
    /** The clamped fractional scroll position. */
    position: number;
    /** The number of pages. */
    nPages: number;
    /** The page the position settles on, `-1` when the carousel is empty. */
    page: number;
    /** `true` for a user navigation (swipe, dot tap, keynav). */
    interactive: boolean;
}

/**
 * Project a core change onto the event payload. Kept as a function rather than
 * spreading the change so the internal `reason` discriminator — which names a C
 * notification site, not an NS event — never leaks into consumer code.
 */
export function carouselNotifyPayload(change: CarouselStateChange): CarouselNotifyPayload {
    return { position: change.position, nPages: change.nPages, page: change.page, interactive: change.interactive };
}
