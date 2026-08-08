// DOM-level conformance tests for <adw-carousel>, driven by the SAME vectors the
// NativeScript renderer asserts against (`@gjsify/adwaita-core/conformance`).
//
// The two renderers used to carry independent, differently-wrong copies of the
// carousel's arithmetic, and nothing compared them: this element defaulted
// `allow-scroll-wheel` to FALSE where libadwaita defaults it TRUE (so a plain
// <adw-carousel> ignored the wheel while its own header claimed the opposite),
// resolved a half-way position to the LATER page where every libadwaita lookup
// takes the earlier one, dropped `<adw-carousel position="2">` on the floor,
// dropped the horizontal-delta fallback its comment described, and emitted
// `page-changed` only when the index changed — which made the documented -1
// unreachable. This suite is that comparison.
//
// Scrolls are made instant by overriding the track's `scroll-behavior`; the
// element sets it as an inline style precisely so it stays overridable.
import { describe, expect, it } from '@gjsify/unit';

import { CAROUSEL_PAGE_AT_POSITION_VECTORS, CAROUSEL_PAGE_LIST_VECTORS } from '@gjsify/adwaita-core/conformance';
import type { CarouselPageOp } from '@gjsify/adwaita-core/conformance';

/** The carousel surface this suite drives — the element's own public API. */
interface CarouselElement extends HTMLElement {
    readonly nPages: number;
    readonly position: number;
    readonly currentPage: number;
    allowScrollWheel: boolean;
    allowLongSwipes: boolean;
    interactive: boolean;
    scrollToPage(index: number): void;
    insertPage(page: HTMLElement, position?: number): boolean;
    appendPage(page: HTMLElement): boolean;
    removePage(page: HTMLElement): boolean;
    reorderPage(page: HTMLElement, position: number): boolean;
    navigate(direction: 'back' | 'forward'): boolean;
}

/** One page-sized card, tagged so the DOM order can be read back. */
function card(label: string): HTMLElement {
    const element = document.createElement('div');
    element.dataset.label = label;
    element.textContent = label;
    element.style.cssText = 'width:100%;height:100%;';
    return element;
}

/**
 * Mount a carousel with the given page labels.
 *
 * The host gets an explicit size because the page pitch is MEASURED — a carousel
 * with no width has no distance, and every scroll would be a no-op.
 */
function mount(labels: readonly string[], attributes: Record<string, string> = {}) {
    const host = document.createElement('div');
    host.style.cssText = 'width:200px;height:80px;';
    document.body.appendChild(host);

    const carousel = document.createElement('adw-carousel') as CarouselElement;
    carousel.style.cssText = 'display:block;width:200px;height:80px;';
    for (const [name, value] of Object.entries(attributes)) carousel.setAttribute(name, value);
    for (const label of labels) carousel.appendChild(card(label));
    host.appendChild(carousel);

    const track = carousel.querySelector('.adw-carousel-track') as HTMLElement;
    // Instant scrolls: the assertions are about WHERE it lands, never about the
    // animation getting there. Snapping is off for the same reason — `mandatory`
    // re-snaps a programmatic `scrollLeft` to the nearest page, which is exactly
    // the fractional position several of these tests are about.
    track.style.setProperty('scroll-behavior', 'auto');
    track.style.setProperty('scroll-snap-type', 'none');
    return { carousel, host, track };
}

/** The page labels in DOM order — what the user actually sees, not what the model says. */
function domOrder(carousel: HTMLElement): string[] {
    return Array.from(carousel.querySelectorAll('.adw-carousel-page')).map(
        (slot) => (slot.firstElementChild as HTMLElement | null)?.dataset.label ?? '',
    );
}

/** Let the scroll event reach the rAF-throttled handler. */
function flush(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

/**
 * The px pitch between two page origins, MEASURED off the DOM — the same
 * quantity `self->distance` is, read back rather than recomputed.
 */
function pitch(carousel: HTMLElement): number {
    const track = carousel.querySelector('.adw-carousel-track') as HTMLElement;
    const slot = track.firstElementChild as HTMLElement | null;
    if (!slot) return 0;
    const gap = Number.parseFloat(getComputedStyle(track).columnGap);
    return slot.getBoundingClientRect().width + (Number.isFinite(gap) ? gap : 0);
}

/** Scroll the track by hand, as a user drag does, and let the element observe it. */
async function dragTo(carousel: HTMLElement, position: number): Promise<void> {
    const track = carousel.querySelector('.adw-carousel-track') as HTMLElement;
    track.scrollLeft = position * pitch(carousel);
    await flush();
}

/** Dispatch one wheel notch and report whether the carousel consumed it. */
function wheel(carousel: HTMLElement, init: WheelEventInit): boolean {
    const track = carousel.querySelector('.adw-carousel-track') as HTMLElement;
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
    track.dispatchEvent(event);
    return event.defaultPrevented;
}

/** Apply one page-list vector op through the element's public methods. */
function applyPageOp(carousel: CarouselElement, op: CarouselPageOp, pages: Map<string, HTMLElement>): boolean {
    switch (op.kind) {
        case 'insert': {
            const page = card(op.id);
            pages.set(op.id, page);
            return carousel.insertPage(page, op.position);
        }
        case 'remove': {
            const page = pages.get(op.id);
            // A page the carousel never had must be refused, not thrown at.
            return page ? carousel.removePage(page) : carousel.removePage(card(op.id));
        }
        case 'reorder': {
            const page = pages.get(op.id);
            return page ? carousel.reorderPage(page, op.position) : false;
        }
        case 'scrollTo':
        case 'setPosition':
        case 'settle':
            // Position ops need a settled scroll, so they are driven separately
            // by the scroll tests below rather than through this replay.
            return true;
    }
}

export const AdwCarouselTest = async () => {
    await describe('adw-carousel page list (libadwaita conformance vectors)', async () => {
        // Only the structural rows: the element's page methods are what the DOM
        // exposes, while position ops need a real scroll and are covered below.
        const structural = CAROUSEL_PAGE_LIST_VECTORS.filter((vector) =>
            vector.ops.every((op) => op.kind === 'insert' || op.kind === 'remove' || op.kind === 'reorder'),
        );

        for (const vector of structural) {
            await it(vector.rule, () => {
                const { carousel, host } = mount(vector.pages);
                const pages = new Map<string, HTMLElement>();
                Array.from(carousel.querySelectorAll('.adw-carousel-page')).forEach((slot, index) => {
                    pages.set(vector.pages[index]!, slot.firstElementChild as HTMLElement);
                });

                const results = vector.ops.map((op) => applyPageOp(carousel, op, pages));

                expect(results).toStrictEqual([...vector.opResults]);
                expect(carousel.nPages).toBe(vector.expected.nPages);
                // The DOM order IS the model order — a reorder that only moved
                // the model would leave the pages painted where they were.
                expect(domOrder(carousel)).toStrictEqual([...vector.expected.ids]);
                // And the position compensation reached the scroll container: a
                // page revealed before the current one must not push it aside.
                expect(carousel.position).toBe(vector.expected.position);
                host.remove();
            });
        }
    });

    await describe('adw-carousel page lookup (libadwaita conformance vectors)', async () => {
        for (const vector of CAROUSEL_PAGE_AT_POSITION_VECTORS) {
            // Only the rows whose snap points are a settled page list are
            // reachable through the DOM; the mid-reveal geometry rows need a
            // reveal ramp this port does not have.
            const settled = vector.snapPoints.length > 0 && vector.snapPoints.every((point, i) => point === i);
            if (!settled) continue;

            await it(`${vector.position} → page ${vector.page} — ${vector.rule}`, async () => {
                // Driven through the `position` property rather than a real
                // scroll: a scroll offset is quantised to device pixels, so the
                // ±1e-7 rows around the tie are not expressible as a drag. The
                // tie ITSELF is, and gets its own drag test below.
                const { carousel, host } = mount(vector.snapPoints.map((_point, index) => `p${index}`));
                (carousel as unknown as { position: number }).position = vector.position;
                await flush();
                expect(carousel.currentPage).toBe(vector.page);
                host.remove();
            });
        }
    });

    await describe('adw-carousel scroll wheel (scroll_cb)', async () => {
        await it('pages on a mouse wheel WITHOUT being asked to — the default is TRUE', async () => {
            // The regression pin: this element used to require an explicit
            // `allow-scroll-wheel` attribute, inverting adw-carousel.c:1103-1106.
            const { carousel, host } = mount(['a', 'b', 'c']);
            expect(carousel.allowScrollWheel).toBe(true);
            expect(wheel(carousel, { deltaY: 120 })).toBe(true);
            await flush();
            expect(carousel.currentPage).toBe(1);
            host.remove();
        });

        await it('honours allow-scroll-wheel="false"', async () => {
            const { carousel, host } = mount(['a', 'b', 'c'], { 'allow-scroll-wheel': 'false' });
            expect(carousel.allowScrollWheel).toBe(false);
            expect(wheel(carousel, { deltaY: 120 })).toBe(false);
            await flush();
            expect(carousel.currentPage).toBe(0);
            host.remove();
        });

        await it('pages on a horizontal delta — the fallback the port dropped', async () => {
            // adw-carousel.c:554-559. The old code returned early whenever
            // |deltaY| <= |deltaX|, so a dx-only event did nothing at all.
            const { carousel, host } = mount(['a', 'b', 'c']);
            expect(wheel(carousel, { deltaX: 120 })).toBe(true);
            await flush();
            expect(carousel.currentPage).toBe(1);
            host.remove();
        });

        await it('locks out a second notch for 150 ms', async () => {
            // adw-carousel.c:22, :526. The old accumulator had no time component
            // at all, so a fast wheel paged as many times as it had deltas.
            const { carousel, host } = mount(['a', 'b', 'c']);
            expect(wheel(carousel, { deltaY: 120 })).toBe(true);
            expect(wheel(carousel, { deltaY: 120 })).toBe(false);
            await flush();
            expect(carousel.currentPage).toBe(1);
            host.remove();
        });

        await it('leaves a touchpad gesture to the native scroll-snap', async () => {
            // A touchpad is ignored outright (:537-538) because its own kinetic
            // scroll already drives the strip — here, the track's scroll-snap.
            const { carousel, host } = mount(['a', 'b', 'c']);
            expect(wheel(carousel, { deltaX: 12, deltaY: 7 })).toBe(false);
            await flush();
            expect(carousel.currentPage).toBe(0);
            host.remove();
        });

        await it('does not consume a wheel event it did not act on', async () => {
            // GDK_EVENT_STOP only when it paged (:561-562 vs :576). The old code
            // called preventDefault BEFORE its threshold test.
            const { carousel, host } = mount(['a', 'b', 'c'], { interactive: 'false' });
            expect(wheel(carousel, { deltaY: 120 })).toBe(false);
            host.remove();
        });
    });

    await describe('adw-carousel page-changed (scroll_animation_done_cb)', async () => {
        await it('reports every completed scroll, including back onto the same page', async () => {
            // The old emission was gated on the ROUNDED index changing, so a
            // settle back onto the page it started from said nothing.
            const { carousel, host } = mount(['a', 'b', 'c']);
            const seen: number[] = [];
            carousel.addEventListener('page-changed', (event) => {
                seen.push((event as CustomEvent<{ index: number }>).detail.index);
            });

            await dragTo(carousel, 1);
            await dragTo(carousel, 1.4);
            await dragTo(carousel, 1);
            expect(seen).toStrictEqual([1, 1]);
            host.remove();
        });

        await it('reports the LOWER page for a half-way settle', async () => {
            const { carousel, host } = mount(['a', 'b']);
            await dragTo(carousel, 0.5);
            // Math.round would have said page 1 here; every libadwaita lookup
            // resolves the tie downwards (adw-carousel.c:198-201).
            expect(carousel.currentPage).toBe(0);
            host.remove();
        });
    });

    await describe('adw-carousel declarative position', async () => {
        await it('honours <adw-carousel position="2"> at upgrade time', async () => {
            // Attribute changes are delivered BEFORE connectedCallback, and the
            // old guard dropped them, so a declared position never applied.
            const { carousel, host } = mount(['a', 'b', 'c'], { position: '2' });
            await flush();
            expect(carousel.currentPage).toBe(2);
            host.remove();
        });

        await it('parses the attribute and the property the same way', async () => {
            // "1.7" used to mean page 1 through the attribute (parseInt) and page
            // 2 through the property (Math.round). Both now resolve it through
            // get_page_at_position, which answers 2.
            const { carousel, host } = mount(['a', 'b', 'c']);
            carousel.setAttribute('position', '1.7');
            await flush();
            expect(carousel.currentPage).toBe(2);

            (carousel as unknown as { position: number }).position = 0.4;
            await flush();
            expect(carousel.currentPage).toBe(0);
            host.remove();
        });

        await it('refuses an out-of-range scrollToPage instead of clamping', async () => {
            const { carousel, host } = mount(['a', 'b', 'c']);
            carousel.scrollToPage(1);
            await flush();
            carousel.scrollToPage(99);
            carousel.scrollToPage(Number.NaN);
            await flush();
            expect(carousel.currentPage).toBe(1);
            host.remove();
        });
    });

    await describe('adw-carousel indicators', async () => {
        await it('marks exactly one dot at a half-way position', async () => {
            // With two pages at position 0.5 both dots scored exactly 0.5, and
            // the old `progress > 0.5` test marked NEITHER — every dot reported
            // aria-current="false".
            const { carousel, host } = mount(['a', 'b']);
            carousel.id = 'carousel-indicator-halfway';
            const dots = document.createElement('adw-carousel-indicator-dots');
            dots.setAttribute('for', carousel.id);
            host.appendChild(dots);

            await dragTo(carousel, 0.5);
            const current = Array.from(dots.children).map((dot) => dot.getAttribute('aria-current'));
            expect(current).toStrictEqual(['true', 'false']);
            host.remove();
        });

        await it('follows the carousel when a page is added later', async () => {
            const { carousel, host } = mount(['a', 'b']);
            carousel.id = 'carousel-indicator-grow';
            const dots = document.createElement('adw-carousel-indicator-dots');
            dots.setAttribute('for', carousel.id);
            host.appendChild(dots);
            expect(dots.childElementCount).toBe(2);

            carousel.appendPage(card('c'));
            expect(dots.childElementCount).toBe(3);
            host.remove();
        });
    });

    await describe('adw-carousel properties', async () => {
        await it('defaults interactive TRUE and gates navigation on it', async () => {
            const { carousel, host } = mount(['a', 'b', 'c']);
            expect(carousel.interactive).toBe(true);
            expect(carousel.navigate('back')).toBe(false); // already at the first page
            expect(carousel.navigate('forward')).toBe(true);

            carousel.interactive = false;
            expect(carousel.navigate('forward')).toBe(false);
            host.remove();
        });

        await it('turns allow-long-swipes into scroll-snap-stop', async () => {
            // The property used to be inert: both branches of its ternary were
            // `current + step`. FALSE means "each swipe can only move to the
            // adjacent pages" (adw-carousel.c:1111-1113), which is what
            // scroll-snap-stop: always enforces.
            const { carousel, host } = mount(['a', 'b', 'c']);
            const slot = carousel.querySelector('.adw-carousel-page') as HTMLElement;
            expect(carousel.allowLongSwipes).toBe(false);
            expect(slot.style.getPropertyValue('scroll-snap-stop')).toBe('always');

            carousel.allowLongSwipes = true;
            expect(slot.style.getPropertyValue('scroll-snap-stop')).toBe('normal');
            host.remove();
        });

        await it('spaces the pages by the spacing property', async () => {
            // `distance = size + spacing` (adw-carousel.c:767); with no gap in the
            // track the property would have nowhere to show up.
            const { carousel, host, track } = mount(['a', 'b', 'c'], { spacing: '16' });
            expect(track.style.columnGap).toBe('16px');
            // The pitch a drag is measured in must include the gap; if it did not,
            // page 1 would sit 16px short of where the carousel thinks it is.
            expect(pitch(carousel)).toBe(track.getBoundingClientRect().width + 16);
            await dragTo(carousel, 1);
            expect(carousel.currentPage).toBe(1);
            host.remove();
        });
    });
};
