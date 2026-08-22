import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { discoverBundles } from '../scripts/discover-bundles.mjs';

// REAL pointer drags against `<adw-carousel>`.
//
// It exists beside `packages/web/adwaita-web/src/keyboard-operable.spec.ts` and its
// gesture equivalents for the reason that file's header gives: a DISPATCHED
// `pointermove` has no default action, and here the default action is most of the
// behaviour — pointer capture, the click a drag has to swallow, and the browser's own
// smooth scroll settling on a snap point. None of that is reproducible without a pointer
// the browser routes, so `page.mouse` is the instrument.
//
// WHAT IT MEASURED BEFORE. On this exact page a 300 px mouse drag moved `position` 0 → 0
// and `scrollLeft` 0 → 0, while a touchpad two-finger swipe moved 0 → 2 and writing
// `scrollLeft = 440` moved `position` to 1. So the strip was scrollable and the position
// feedback worked; the gesture upstream turns on in `init`
// (`adw_swipe_tracker_set_allow_mouse_drag`, adw-carousel.c:1209) was simply absent.
//
// THE POINTER STAYS INSIDE THE VIEWPORT, deliberately. A synthetic pointer moved to a
// negative coordinate gets neither `pointerup` nor `lostpointercapture` — measured, the
// gesture then never ends — which is a property of synthetic input, not of a browser: a
// held button cannot leave the OS's capture, and a window that loses focus mid-drag does
// fire `lostpointercapture`, which the adapter listens for. Every drag below therefore
// starts at the edge it is dragging away from.

const HARNESS_PATH = '/tests/browser/harness/index.html';
const DONE_SELECTOR = '[data-tests-done="true"]';
const BUNDLE_TIMEOUT = 110_000;

/** Page width, and therefore the scroll pitch: `scrollLeft = position * 440`. */
const PAGE = 440;

const adwaita = discoverBundles().find((bundle) => bundle.packageName === 'adwaita-web');

// BOUND TO THE STAGED SET, as `unit.spec.ts` and the keyboard spec are: a selective CI
// run stages only the affected closure, so an unconditional test here would fail a PR
// over a package it never touched.
if (adwaita === undefined) {
    test('adwaita-web pointer gestures — bundle not staged', () => {
        console.warn(
            'No packages/web/adwaita-web/dist/test.browser.mjs — the pointer-gesture spec did not run.\n' +
                'Build it: node tests/browser/scripts/build-bundles.mjs --include @gjsify/adwaita-web',
        );
    });
} else {
    const bundleUrl = adwaita.url;
    test('adw-carousel drags with the pointer (real mouse)', ({ page }) => driveDrags(page, bundleUrl));
}

/** Build a three-page carousel, optionally with attributes, and report its box. */
async function mount(page: Page, attributes: Record<string, string> = {}) {
    await page.evaluate((attrs) => {
        document.body.replaceChildren();
        document.body.style.margin = '0';
        const carousel = document.createElement('adw-carousel');
        carousel.id = 'carousel';
        for (const [name, value] of Object.entries(attrs)) carousel.setAttribute(name, value);
        carousel.style.cssText = 'width:440px;height:260px;';
        for (const title of ['Welcome', 'Discover', 'Get started']) {
            const child = document.createElement('div');
            child.style.cssText = 'width:440px;height:260px;display:flex;align-items:center;justify-content:center;';
            const button = document.createElement('button');
            button.textContent = title;
            button.className = 'page-button';
            button.addEventListener('click', () => {
                (window as unknown as { clicks: number }).clicks =
                    ((window as unknown as { clicks?: number }).clicks ?? 0) + 1;
            });
            child.append(button);
            carousel.append(child);
        }
        (window as unknown as { clicks: number }).clicks = 0;
        document.body.append(carousel);
    }, attributes);
    // One frame for the ResizeObserver to measure the pages the scroll pitch comes from.
    await page.waitForTimeout(120);
    return page.evaluate(() => {
        const box = document.getElementById('carousel')!.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
    });
}

/** `position`, `scrollLeft`, and the two styles a claimed gesture overrides. */
function state(page: Page) {
    return page.evaluate(() => {
        const carousel = document.getElementById('carousel') as HTMLElement & { position: number };
        const track = carousel.querySelector('.adw-carousel-track') as HTMLElement;
        const computed = getComputedStyle(track);
        return {
            position: carousel.position,
            scrollLeft: Math.round(track.scrollLeft),
            snap: computed.scrollSnapType,
            userSelect: computed.userSelect,
            clicks: (window as unknown as { clicks: number }).clicks,
        };
    });
}

/**
 * Drag `travel` px horizontally, in `steps` moves `pause` ms apart.
 *
 * The pause is what sets the VELOCITY the tracker reads, and the velocity decides
 * everything past the threshold — so it is a parameter, not a constant.
 */
async function drag(
    page: Page,
    box: { x: number; y: number; width: number; height: number },
    travel: number,
    steps: number,
    pause: number,
) {
    const y = box.y + box.height / 2;
    // Start at the edge being dragged away from, so `travel` fits inside the viewport.
    const from = travel < 0 ? box.x + box.width - 8 : box.x + 8;
    await page.mouse.move(from, y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
        await page.mouse.move(from + (travel * i) / steps, y);
        await page.waitForTimeout(pause);
    }
    await page.mouse.up();
    // Long enough for the settle, which is the browser's own smooth scroll.
    await page.waitForTimeout(700);
}

async function driveDrags(page: Page, bundleUrl: string) {
    await page.goto(`${HARNESS_PATH}?bundle=${encodeURIComponent(bundleUrl)}`);
    await page.waitForSelector(DONE_SELECTOR, { timeout: BUNDLE_TIMEOUT });

    // ---- A deliberate drag pages, and leaves nothing behind -------------------------
    let box = await mount(page);
    expect(await state(page)).toMatchObject({ position: 0, scrollLeft: 0 });

    await drag(page, box, -300, 15, 8);
    const paged = await state(page);
    // Landed exactly on the next page, not somewhere between two.
    expect(paged).toMatchObject({ position: 1, scrollLeft: PAGE });
    // Snapping and text selection are restored: a gesture that leaves either switched
    // off leaves the widget in a state no later scroll can recover from, which is how
    // the first draft of this adapter wedged the strip mid-page.
    expect(paged.snap).toBe('x mandatory');
    expect(paged.userSelect).not.toBe('none');
    // The button under the cursor did NOT fire. GTK loses that click to the drag once it
    // claims the sequence; here the claim suppresses exactly one click.
    expect(paged.clicks).toBe(0);

    // ---- and back ------------------------------------------------------------------
    await drag(page, box, 300, 15, 8);
    expect(await state(page)).toMatchObject({ position: 0, scrollLeft: 0 });

    // ---- A slow short drag snaps back ----------------------------------------------
    box = await mount(page);
    // 40 px over 8 moves 40 ms apart is 0.125 px/ms, under VELOCITY_THRESHOLD_TOUCH
    // (0.3): below the threshold `get_end_progress` takes the NEAREST snap point, and
    // from 0.09 of a page that is the one it started on.
    await drag(page, box, -40, 8, 40);
    expect(await state(page)).toMatchObject({ position: 0, scrollLeft: 0 });

    // ---- A fast short flick pages anyway -------------------------------------------
    box = await mount(page);
    // The same 40 px, delivered fast. Over the threshold the projection runs, and
    // `find_point_for_projection` refuses to round back onto the page it started on —
    // which is what makes a flick always move.
    await drag(page, box, -40, 4, 4);
    expect(await state(page)).toMatchObject({ position: 1, scrollLeft: PAGE });

    // ---- A click that is not a drag still clicks -----------------------------------
    box = await mount(page);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(120);
    const clicked = await state(page);
    // Below the 16 px threshold nothing is claimed, so the click is not swallowed. The
    // suppression is armed by a CLAIM, never by a press.
    expect(clicked).toMatchObject({ position: 0, clicks: 1 });

    // ---- The two off switches ------------------------------------------------------
    box = await mount(page, { 'allow-mouse-drag': 'false' });
    await drag(page, box, -300, 15, 8);
    // `allow-mouse-drag="false"` is upstream's "dragging is only available on touch".
    expect(await state(page)).toMatchObject({ position: 0, scrollLeft: 0 });
    expect(
        await page.evaluate(
            () => (document.getElementById('carousel') as HTMLElement & { allowMouseDrag: boolean }).allowMouseDrag,
        ),
    ).toBe(false);

    box = await mount(page, { interactive: 'false' });
    await drag(page, box, -300, 15, 8);
    // `interactive` gates it because that is literally what it does upstream:
    // `adw_carousel_set_interactive` is `adw_swipe_tracker_set_enabled` (:1705).
    expect(await state(page)).toMatchObject({ position: 0, scrollLeft: 0 });

    // ---- A cancelled gesture ENDS, and the destination is not assertable here -------
    box = await mount(page);
    // `pointercancel` is what interrupts a gesture the browser decides is no longer one.
    // What is asserted is that it ENDS it: snapping back on, nothing left tracking. That
    // is the failure that actually happened during this work — a gesture whose end was
    // never seen left the strip stopped mid-page with snapping off, permanently.
    //
    // The DESTINATION is deliberately NOT asserted, and the reason is worth keeping.
    // `AdwCarousel` answers `get_cancel_progress` with `get_closest_snap_point`
    // (adw-carousel.c:1294-1299), which is precisely what CSS scroll-snap does to a
    // container the moment `scroll-snap-type` comes back on. The two agree by
    // construction, so no assertion in this renderer can tell the wiring from its
    // absence — measured: with `cancelProgress` mutated to a constant 0 the strip still
    // landed on the same page, because the browser's own re-snap got there first. The
    // wiring stays because it is the model upstream declares and the one a settle that
    // stops going through CSS snap would need; what a test can hold is the ending.
    await page.evaluate(() => {
        const track = document.querySelector('.adw-carousel-track') as HTMLElement;
        (window as unknown as { pointerId: number }).pointerId = 0;
        track.addEventListener('pointerdown', (event) => {
            (window as unknown as { pointerId: number }).pointerId = event.pointerId;
        });
    });
    {
        const y = box.y + box.height / 2;
        const from = box.x + box.width - 8;
        await page.mouse.move(from, y);
        await page.mouse.down();
        for (let i = 1; i <= 13; i++) await page.mouse.move(from - i * 20, y);
        // Claimed, so snapping is off and the gesture owns the strip.
        expect((await state(page)).snap).toBe('none');
        await page.evaluate(() => {
            const track = document.querySelector('.adw-carousel-track') as HTMLElement;
            const pointerId = (window as unknown as { pointerId: number }).pointerId;
            track.dispatchEvent(new PointerEvent('pointercancel', { pointerId, bubbles: true }));
        });
        // The cancel alone put the widget back in a usable state, before any `pointerup`.
        expect((await state(page)).snap).toBe('x mandatory');
        await page.mouse.up();
        await page.waitForTimeout(700);
    }
    const cancelled = await state(page);
    // Wherever it landed, it landed ON a page rather than between two.
    expect(cancelled.scrollLeft % PAGE).toBe(0);
    expect(cancelled.snap).toBe('x mandatory');

    // ---- A vertical drag belongs to the page ---------------------------------------
    box = await mount(page);
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2, y + i * 6);
    await page.mouse.up();
    await page.waitForTimeout(400);
    // Whichever axis moved more decides whose gesture it is (`is_offset_vertical`,
    // adw-swipe-tracker.c:661), so a vertical drag through a horizontal carousel does
    // not page it — and leaves snapping alone, because it never claimed.
    const vertical = await state(page);
    expect(vertical).toMatchObject({ position: 0, scrollLeft: 0 });
    expect(vertical.snap).toBe('x mandatory');
}
