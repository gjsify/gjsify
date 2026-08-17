// DOM-level conformance tests for <adw-carousel>, driven by the SAME vectors the
// NativeScript renderer asserts against (`@gjsify/adwaita-core/conformance`).
//
// The suite exists because the two renderers used to carry independent,
// differently-wrong copies of the carousel's arithmetic with nothing comparing them;
// each rule that drifted is pinned by a test below.
//
// Scrolls are made instant by overriding the track's `scroll-behavior`; the
// element sets it as an inline style precisely so it stays overridable.
import { describe, expect, it } from '@gjsify/unit';

import type { CarouselPageMeasurement } from '@gjsify/adwaita-core';
import {
    CAROUSEL_PAGE_ALLOCATION_VECTORS,
    CAROUSEL_PAGE_AT_POSITION_VECTORS,
    CAROUSEL_PAGE_LIST_VECTORS,
} from '@gjsify/adwaita-core/conformance';
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
 * Mount a carousel with the given page labels. The host gets an explicit size because
 * the page pitch is MEASURED: a carousel with no width has no distance, so every scroll
 * would be a no-op.
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
    // Instant scrolls: the assertions are about WHERE it lands, never the animation.
    // Snapping is off for the same reason — `mandatory` re-snaps a programmatic
    // `scrollLeft` to the nearest page, the very fractional position under test.
    track.style.setProperty('scroll-behavior', 'auto');
    track.style.setProperty('scroll-snap-type', 'none');
    return { carousel, host, track };
}

/**
 * One page that MEASURES what a conformance row says it does. `expand` is spelled
 * `width: 100%`, the CSS of hexpand; `flex: none` keeps the slot's own flex layout from
 * shrinking a natural size that is wider than the carousel before it can be measured.
 */
function sizedCard(page: CarouselPageMeasurement, index: number): HTMLElement {
    const element = document.createElement('div');
    element.dataset.label = `p${index}`;
    const width = page.expand ? '100%' : `${page.natural}px`;
    element.style.cssText = `flex:none;height:100%;width:${width};`;
    return element;
}

/** Mount a carousel `available` px wide whose pages measure what `pages` says. */
function mountSized(available: number, pages: readonly CarouselPageMeasurement[]) {
    const host = document.createElement('div');
    host.style.cssText = `width:${available}px;height:80px;`;
    document.body.appendChild(host);

    const carousel = document.createElement('adw-carousel') as CarouselElement;
    carousel.style.cssText = `display:block;width:${available}px;height:80px;`;
    pages.forEach((page, index) => carousel.appendChild(sizedCard(page, index)));
    host.appendChild(carousel);

    const track = carousel.querySelector('.adw-carousel-track') as HTMLElement;
    // Instant scrolls; snapping stays ON here, because where a page SNAPS is half of
    // what these tests are about.
    track.style.setProperty('scroll-behavior', 'auto');
    return { carousel, host, track };
}

/** Each page's left edge relative to the carousel, rounded off the subpixel noise. */
function pageEdges(carousel: HTMLElement): number[] {
    const origin = carousel.getBoundingClientRect().left;
    return Array.from(carousel.querySelectorAll('.adw-carousel-page')).map((slot) =>
        Math.round(slot.getBoundingClientRect().left - origin),
    );
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
            // Position ops need a settled scroll and are driven by the scroll tests
            // below, not through this replay.
            return true;
    }
}

export const AdwCarouselTest = async () => {
    await describe('adw-carousel page list (libadwaita conformance vectors)', async () => {
        // Only the structural rows: the page methods are what the DOM exposes.
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
                // The DOM order IS the model order: a reorder that moved only the model
                // would leave the pages painted where they were.
                expect(domOrder(carousel)).toStrictEqual([...vector.expected.ids]);
                // The position compensation reaches the scroll container: a page revealed
                // before the current one must not push it aside.
                expect(carousel.position).toBe(vector.expected.position);
                host.remove();
            });
        }
    });

    await describe('adw-carousel page allocation (libadwaita conformance vectors)', async () => {
        // The rows the DOM can express. The element measures a RENDERED width, so a page
        // whose MINIMUM exceeds the carousel has already been resolved by CSS before the
        // element sees it, and a carousel with no pages has nothing to measure at all.
        const measurable = CAROUSEL_PAGE_ALLOCATION_VECTORS.filter(
            (vector) => vector.pages.length > 0 && vector.pages.every((page) => page.minimum === undefined),
        );

        for (const vector of measurable) {
            await it(vector.rule, async () => {
                const { carousel, host, track } = mountSized(vector.available, vector.pages);
                await flush();

                const widths = Array.from(carousel.querySelectorAll('.adw-carousel-page')).map((slot) =>
                    Math.round(slot.getBoundingClientRect().width),
                );
                expect(widths).toStrictEqual(vector.pages.map(() => vector.pageSize));
                // The half-gap is the track's own padding, which is what lets the page
                // strip start inside the carousel instead of flush against its edge.
                expect(Math.round(Number.parseFloat(getComputedStyle(track).paddingInlineStart))).toBe(
                    vector.leadingInset,
                );
                host.remove();
            });
        }

        await it('shows the previous and next page at the edges', async () => {
            // THE REPORTED DEFECT. With `flex: 0 0 100%` the pages of the Carousel story
            // (440px cards in a 480px carousel) filled the width and both neighbours sat
            // entirely off screen, where GTK leaves 20px of each showing.
            const pages: CarouselPageMeasurement[] = [{ natural: 440 }, { natural: 440 }, { natural: 440 }];
            const { carousel, host } = mountSized(480, pages);
            await flush();

            // At rest on page 0: centred, with page 1 starting 20px before the right edge.
            expect(pageEdges(carousel)).toStrictEqual([20, 460, 900]);

            carousel.scrollToPage(1);
            await flush();
            // Page 1 centred, 20px of page 0 showing at the left and 20px of page 2 at the right.
            expect(pageEdges(carousel)).toStrictEqual([-420, 20, 460]);
            host.remove();
        });

        await it('leaves the LAST page room to centre as well', async () => {
            // The trailing half-gap is track padding too. A scroll container that dropped
            // its end padding would stop `leadingInset` short of the last snap point, and
            // the last page would never reach the middle.
            const pages: CarouselPageMeasurement[] = [{ natural: 440 }, { natural: 440 }, { natural: 440 }];
            const { carousel, host, track } = mountSized(480, pages);
            await flush();

            carousel.scrollToPage(2);
            await flush();
            expect(Math.round(track.scrollLeft)).toBe(880);
            expect(carousel.currentPage).toBe(2);
            expect(pageEdges(carousel)).toStrictEqual([-860, -420, 20]);
            host.remove();
        });

        await it('re-aims the scroll in flight instead of rewinding it', async () => {
            // Mounted inside a HIDDEN ancestor, which is how real markup reaches this:
            // `connectedCallback` measures 0, so the declared position waits for a
            // layout, and revealing the host delivers the pending-position observer and
            // the layout observer in ONE resize pass. The first fires a scroll to page
            // 2 at the fallback pitch; the second narrows the pages and has to put the
            // offset back, and `state.position` is still 0 there, because the `scroll`
            // event that will teach it 2 fires a frame later. Restoring THAT parks the
            // carousel on page 0 and swallows `position="2"`. GTK re-aims instead: it
            // pushes the recomputed snap point into the running animation (:786-788).
            //
            // A carousel already laid out when it is mounted does NOT reach this: it
            // allocates during `connectedCallback` and the pending observer never
            // arms, which is why the mounted-visible spelling of this test passes
            // either way and is not the one kept.
            const host = document.createElement('div');
            host.style.cssText = 'width:480px;height:80px;display:none;';
            document.body.appendChild(host);

            const carousel = document.createElement('adw-carousel') as CarouselElement;
            carousel.style.cssText = 'display:block;width:480px;height:80px;';
            carousel.setAttribute('position', '2');
            for (let index = 0; index < 3; index++) carousel.appendChild(sizedCard({ natural: 440 }, index));
            host.appendChild(carousel);
            await flush();

            host.style.display = 'block';
            await flush();

            const track = carousel.querySelector('.adw-carousel-track') as HTMLElement;
            expect(Math.round(track.scrollLeft)).toBe(880);
            expect(carousel.currentPage).toBe(2);
            host.remove();
        });
    });

    await describe('adw-carousel page lookup (libadwaita conformance vectors)', async () => {
        for (const vector of CAROUSEL_PAGE_AT_POSITION_VECTORS) {
            // Only rows whose snap points are a settled page list are reachable through
            // the DOM; mid-reveal geometry rows need a reveal ramp this port lacks.
            const settled = vector.snapPoints.length > 0 && vector.snapPoints.every((point, i) => point === i);
            if (!settled) continue;

            await it(`${vector.position} → page ${vector.page} — ${vector.rule}`, async () => {
                // Driven through the `position` property, not a real scroll: a scroll
                // offset is quantised to device pixels, so the ±1e-7 rows around the tie
                // are not expressible as a drag. The tie itself is, below.
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
            // This element used to require an explicit `allow-scroll-wheel` attribute,
            // inverting the libadwaita default.
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
            // The old code returned early whenever |deltaY| <= |deltaX|, so a dx-only
            // event did nothing at all.
            const { carousel, host } = mount(['a', 'b', 'c']);
            expect(wheel(carousel, { deltaX: 120 })).toBe(true);
            await flush();
            expect(carousel.currentPage).toBe(1);
            host.remove();
        });

        await it('locks out a second notch for 150 ms', async () => {
            // The old accumulator had no time component, so a fast wheel paged as many
            // times as it had deltas.
            const { carousel, host } = mount(['a', 'b', 'c']);
            expect(wheel(carousel, { deltaY: 120 })).toBe(true);
            expect(wheel(carousel, { deltaY: 120 })).toBe(false);
            await flush();
            expect(carousel.currentPage).toBe(1);
            host.remove();
        });

        await it('leaves a touchpad gesture to the native scroll-snap', async () => {
            // A touchpad is ignored outright: its own kinetic scroll already drives the
            // strip, here the track's scroll-snap.
            const { carousel, host } = mount(['a', 'b', 'c']);
            expect(wheel(carousel, { deltaX: 12, deltaY: 7 })).toBe(false);
            await flush();
            expect(carousel.currentPage).toBe(0);
            host.remove();
        });

        await it('does not consume a wheel event it did not act on', async () => {
            // GDK_EVENT_STOP only when it paged; the old code called preventDefault()
            // BEFORE its threshold test.
            const { carousel, host } = mount(['a', 'b', 'c'], { interactive: 'false' });
            expect(wheel(carousel, { deltaY: 120 })).toBe(false);
            host.remove();
        });
    });

    await describe('adw-carousel page-changed (scroll_animation_done_cb)', async () => {
        await it('reports every completed scroll, including back onto the same page', async () => {
            // Gating the emission on the ROUNDED index means a settle back onto the page
            // it started from says nothing.
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
            // Math.round would say page 1; every libadwaita lookup resolves the tie down.
            expect(carousel.currentPage).toBe(0);
            host.remove();
        });
    });

    await describe('adw-carousel declarative position', async () => {
        await it('honours <adw-carousel position="2"> at upgrade time', async () => {
            // Attribute changes are delivered BEFORE connectedCallback, so a guard that
            // drops them drops a declared position.
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
            // `current + step`. FALSE means "each swipe moves only to an adjacent
            // page", which `scroll-snap-stop: always` enforces.
            const { carousel, host } = mount(['a', 'b', 'c']);
            const slot = carousel.querySelector('.adw-carousel-page') as HTMLElement;
            expect(carousel.allowLongSwipes).toBe(false);
            expect(slot.style.getPropertyValue('scroll-snap-stop')).toBe('always');

            carousel.allowLongSwipes = true;
            expect(slot.style.getPropertyValue('scroll-snap-stop')).toBe('normal');
            host.remove();
        });

        await it('spaces the pages by the spacing property', async () => {
            // `distance = size + spacing`; with no gap in the track the property would
            // have nowhere to show up.
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
