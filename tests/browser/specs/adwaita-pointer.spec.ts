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
async function mount(page: Page, attributes: Record<string, string> = {}, pageWidth = PAGE) {
    await page.evaluate(
        ({ attrs, width }) => {
            document.body.replaceChildren();
            document.body.style.margin = '0';
            const carousel = document.createElement('adw-carousel');
            carousel.id = 'carousel';
            for (const [name, value] of Object.entries(attrs)) carousel.setAttribute(name, value);
            // OFFSET FROM THE LEFT EDGE, so a drag longer than the carousel still has room
            // inside the viewport: a synthetic pointer taken to a negative coordinate gets no
            // ending event at all, and the gesture then never settles (see the header).
            carousel.style.cssText = `width:${width}px;height:260px;margin-left:480px;`;
            for (const title of ['Welcome', 'Discover', 'Get started']) {
                const child = document.createElement('div');
                child.style.cssText = `width:${width}px;height:260px;display:flex;align-items:center;justify-content:center;`;
                const button = document.createElement('button');
                button.textContent = title;
                button.className = 'page-button';
                // FILLS its page, so "did the click land" does not depend on where inside the
                // carousel a drag happened to start. A press near an edge otherwise misses a
                // centred button and reads as a swallowed click.
                button.style.cssText = 'width:100%;height:100%;';

                child.append(button);
                carousel.append(child);
            }
            (window as unknown as { clicks: number }).clicks = 0;
            // COUNTED ON THE CAROUSEL, in the BUBBLE phase, and not on the button — which is
            // what a first draft did, vacuously. Pointer capture is set at the claim, so the
            // `click` that follows any claimed drag is dispatched AT the capturing element:
            // measured, a 30 px drag that began and ended inside a button still produced a
            // click whose target was the track. A counter on a descendant is structurally
            // blind to the suppression, so deleting the suppression left it green.
            carousel.addEventListener('click', () => {
                (window as unknown as { clicks: number }).clicks =
                    ((window as unknown as { clicks?: number }).clicks ?? 0) + 1;
            });
            document.body.append(carousel);
        },
        { attrs: attributes, width: pageWidth },
    );
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
    // Rounded: a fractional client coordinate is quantised by the browser, and an
    // un-rounded step leaves the last move short of the intended travel.
    const step = (i: number) => Math.round(from + (travel * i) / steps);
    await page.mouse.move(from, y);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) {
        await page.mouse.move(step(i), y);
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
    expect(await state(page)).toMatchObject({ position: 0, scrollLeft: 0, snap: 'x mandatory' });

    // ---- A slow short drag snaps back ----------------------------------------------
    box = await mount(page);
    // 40 px over 8 moves 40 ms apart is 0.125 px/ms, under VELOCITY_THRESHOLD_TOUCH
    // (0.3): below the threshold `get_end_progress` takes the NEAREST snap point, and
    // from 0.09 of a page that is the one it started on.
    await drag(page, box, -40, 8, 40);
    // `snap` in every assertion that has an object to put it in: a mutation restoring it
    // on the forward path only would otherwise pass on all but one line.
    expect(await state(page)).toMatchObject({ position: 0, scrollLeft: 0, snap: 'x mandatory' });

    // ---- A fast short flick pages anyway -------------------------------------------
    box = await mount(page);
    // The same 40 px in TWO moves of 20, delivered fast. Over the threshold the
    // projection runs, and `find_point_for_projection` refuses to round back onto the page
    // it started on — which is what makes a flick always move.
    //
    // Two large moves rather than four small ones for margin: the velocity is the second
    // move's delta over the gap between the two, so 20 px needs that gap under 66 ms to
    // clear VELOCITY_THRESHOLD_TOUCH. Four moves of 10 px halve that budget, and a loaded
    // machine stretching a requested 4 ms past 33 turns a real assertion into a flake —
    // measured, this file failed exactly that way in a grouped run and passed alone.
    await drag(page, box, -40, 2, 4);
    expect(await state(page)).toMatchObject({ position: 1, scrollLeft: PAGE, snap: 'x mandatory' });

    // ---- allow-long-swipes decides how far one drag may reach ----------------------
    // The only pair in this file where the tracker's answer and the browser's own re-snap
    // differ by more than one page, so it is what holds `swipeBounds` end to end.
    //
    // DELIBERATELY SLOW, and on a narrow carousel so the travel fits inside the viewport.
    // A fast flick would reach page 2 through the velocity PROJECTION, whose input is
    // wall-clock pacing — under load that turns into a flake. Dragging two full pages
    // takes the projection out of it: the reach is then the bound and nothing else.
    const narrow = 200;
    box = await mount(page, {}, narrow);
    await drag(page, box, -1.6 * narrow, 16, 12);
    // Clamped to the ADJACENT page while the drag itself went past it — `get_bounds`
    // measured from where the gesture began (adw-swipe-tracker.c:250-269), which is the
    // whole meaning of the default.
    expect(await state(page)).toMatchObject({ position: 1, scrollLeft: narrow, snap: 'x mandatory' });

    box = await mount(page, { 'allow-long-swipes': '' }, narrow);
    await drag(page, box, -1.6 * narrow, 16, 12);
    // Unbounded: the same drag reaches the far page.
    expect(await state(page)).toMatchObject({ position: 2, scrollLeft: 2 * narrow, snap: 'x mandatory' });

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
    expect(await state(page)).toMatchObject({ position: 0, scrollLeft: 0, snap: 'x mandatory', userSelect: 'auto' });
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
        // No default. Firefox's mouse `pointerId` is 0, so seeding it to 0 made the
        // synthetic cancel below match even if this listener never ran.
        (window as unknown as { pointerId: number | null }).pointerId = null;
        track.addEventListener('pointerdown', (event) => {
            (window as unknown as { pointerId: number | null }).pointerId = event.pointerId;
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
        expect(await page.evaluate(() => (window as unknown as { pointerId: number | null }).pointerId)).not.toBe(null);
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

    // ---- A drag that cannot go anywhere is not claimed, and keeps its click ---------
    box = await mount(page);
    // On the FIRST page, dragging backwards. Upstream refuses to claim at all: with
    // overshoot disabled, `is_overshooting_lower` is true and `drag_update_cb` denies the
    // sequence (adw-swipe-tracker.c:725-739). Claiming anyway would move nothing — the
    // bound clamps it — and then suppress the click of whatever the drag started on.
    await drag(page, box, 300, 15, 8);
    const atLowerBound = await state(page);
    expect(atLowerBound).toMatchObject({ position: 0, scrollLeft: 0 });
    // The button under the cursor DID fire, because no gesture was ever claimed.
    expect(atLowerBound.clicks).toBe(1);
    expect(atLowerBound.snap).toBe('x mandatory');

    // ---- and a one-page carousel is the same refusal --------------------------------
    box = await mount(page);
    const remaining = await page.evaluate(() => {
        const carousel = document.getElementById('carousel') as HTMLElement & {
            removePage(page: HTMLElement): boolean;
            readonly nPages: number;
        };
        // Through the API, not by removing DOM nodes: the snap points come from the
        // element's state, and a page pulled out from under it leaves the state — and so
        // the refusal this asserts — still counting three.
        const pages = Array.from(carousel.querySelectorAll('.adw-carousel-page'));
        for (const slot of pages.slice(1)) carousel.removePage(slot.firstElementChild as HTMLElement);
        (window as unknown as { clicks: number }).clicks = 0;
        return carousel.nPages;
    });
    expect(remaining).toBe(1);
    await page.waitForTimeout(150);
    // `first_point ≈ last_point` — nowhere to swipe to (:720).
    await drag(page, box, -300, 15, 8);
    expect((await state(page)).clicks).toBe(1);

    // ---- Vertical jitter at the start belongs to the page --------------------------
    box = await mount(page);
    {
        const y = box.y + box.height / 2;
        const x = box.x + box.width / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        // Two pixels DOWN first, then a long horizontal pull. The C tests the axis on the
        // first move at STATE_NONE, at any distance (:673), so this whole gesture is the
        // page's — deferring the test to the 16 px threshold claimed it instead.
        await page.mouse.move(x, y + 2);
        for (let i = 1; i <= 14; i++) await page.mouse.move(x - i * 20, y + 2);
        await page.mouse.up();
        await page.waitForTimeout(700);
    }
    expect(await state(page)).toMatchObject({ position: 0, scrollLeft: 0 });

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
