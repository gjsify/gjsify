// The GIR method doors of `Adw.Carousel` a GJS app reads its pages through —
// `get_nth_page`, `get_n_pages`, `get_position` and `scroll_to (widget, animate)` — against
// the widget each one hands back or lands on. The SAME vectors run on real `gi://Adw` (the
// ORACLE: a vector that fails there is wrong, never a port bug) and on each port.
//
// Every read comes after `settle()`: upstream defers a `scroll_to` issued before the first
// allocation to an idle (adw-carousel.c:1580-1595, issue #597), and the animated one runs on
// the frame clock, so a read straight after the call would pin GTK's timing, not the door.
//
// Reference: refs/libadwaita/src/adw-carousel.c (adw_carousel_scroll_to :1572,
// adw_carousel_get_nth_page :1610, adw_carousel_get_position :1661)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { ConstructHarness } from './constructs.js';

export interface CarouselDoorLike {
    get_nth_page(n: number): unknown;
    get_n_pages(): number;
    get_position(): number;
    scroll_to(widget: unknown, animate: boolean): void;
}

export interface CarouselDoorSubject {
    readonly name: string;
    readonly isOracle: boolean;
    /** A shown carousel holding `pages` fresh pages, appended in order. */
    makeCarousel(pages: number): { carousel: CarouselDoorLike; pages: readonly unknown[] };
    /** A widget that is NOT a page of any carousel. */
    makeStranger(): unknown;
    /** Let layout, idles and a running scroll animation finish. */
    settle(): Promise<void>;
    dispose(): void;
}

export interface CarouselDoorVector {
    readonly row: string;
    readonly rule: string;
    readonly observe: (subject: CarouselDoorSubject) => unknown;
    readonly shows: unknown;
}

export const CAROUSEL_DOOR_VECTORS: readonly CarouselDoorVector[] = [
    {
        row: 'nth-page',
        rule: 'get_nth_page hands back the page appended at that index; get_n_pages counts them',
        async observe(s) {
            const { carousel, pages } = s.makeCarousel(3);
            await s.settle();
            return [...pages.map((page, i) => carousel.get_nth_page(i) === page), carousel.get_n_pages()];
        },
        shows: [true, true, true, 3],
    },
    {
        row: 'nth-page-out-of-range',
        rule: 'get_nth_page past the last page fails its precondition and returns null',
        async observe(s) {
            const { carousel } = s.makeCarousel(2);
            await s.settle();
            return carousel.get_nth_page(2);
        },
        shows: null,
    },
    {
        row: 'position-initial',
        rule: 'get_position is 0 on a carousel nobody has scrolled',
        async observe(s) {
            const { carousel } = s.makeCarousel(3);
            await s.settle();
            return carousel.get_position();
        },
        shows: 0,
    },
    {
        row: 'scroll-to-instant',
        rule: 'scroll_to (page, false) lands get_position on that page',
        async observe(s) {
            const { carousel } = s.makeCarousel(3);
            await s.settle();
            carousel.scroll_to(carousel.get_nth_page(2), false);
            await s.settle();
            return carousel.get_position();
        },
        shows: 2,
    },
    {
        row: 'scroll-to-animated',
        rule: 'scroll_to (page, true) comes to rest on that page',
        async observe(s) {
            const { carousel } = s.makeCarousel(3);
            await s.settle();
            carousel.scroll_to(carousel.get_nth_page(1), true);
            await s.settle();
            return Math.round(carousel.get_position() * 1000) / 1000;
        },
        shows: 1,
    },
    {
        row: 'scroll-to-stranger',
        rule: 'scroll_to a widget that is not a page fails its precondition and does not move',
        async observe(s) {
            const { carousel } = s.makeCarousel(3);
            await s.settle();
            carousel.scroll_to(s.makeStranger(), false);
            await s.settle();
            return carousel.get_position();
        },
        shows: 0,
    },
];

export async function driveCarouselDoorVectors(
    subject: CarouselDoorSubject,
    harness: ConstructHarness,
    vectors: readonly CarouselDoorVector[] = CAROUSEL_DOOR_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: Adw.Carousel page and position doors`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                try {
                    const observed = await vector.observe(subject);
                    expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
                } finally {
                    subject.dispose();
                }
            });
        }
    });
}
