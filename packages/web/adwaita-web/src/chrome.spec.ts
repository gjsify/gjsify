// DOM-level conformance tests for the chrome elements — <adw-clamp>,
// <adw-spinner> and <adw-toolbar-view> — driven by the SAME vectors the
// NativeScript renderer asserts against (`@gjsify/adwaita-core/conformance`).
//
// Each of the three used to answer a question libadwaita had already answered,
// and answered it differently from the NativeScript port: the clamp was a plain
// `max-width` with no tightening and a `maximum-size="0"` that collapsed the
// child to nothing, the spinner defaulted to 24px and stroked a 2px ring where
// Adwaita strokes 3px, and the toolbar view carried none of the four style
// classes at all. Nothing failed, because nothing compared them.
//
// Sizes are driven by really resizing a host element and awaiting a real
// ResizeObserver delivery, the same way `breakpoints.spec.ts` does — never by
// faking one.
import { describe, expect, it } from '@gjsify/unit';

import { ADW_SPINNER_MIN_SIZE, ADW_SPINNER_TRACK_OPACITY, spinnerGeometry } from '@gjsify/adwaita-core';
import {
    CLAMP_ALLOCATE_VECTORS,
    CLAMP_PROPERTY_VECTORS,
    SPINNER_GEOMETRY_VECTORS,
    SPINNER_SIZE_VECTORS,
    TOOLBAR_VIEW_CLASS_VECTORS,
} from '@gjsify/adwaita-core/conformance';

/** Wait for a ResizeObserver delivery (it runs after layout, before paint). */
function settle(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

/** A fixed-width host in the document, plus a way to resize it. */
function mountSized(width: number): { host: HTMLElement; resize: (w: number) => Promise<void> } {
    const host = document.createElement('div');
    host.style.width = `${width}px`;
    document.body.appendChild(host);
    return {
        host,
        resize: async (w: number) => {
            host.style.width = `${w}px`;
            await settle();
        },
    };
}

/** A clamp with one block child, mounted in a host of `available` px. */
function mountClamp(available: number): {
    host: HTMLElement;
    clamp: HTMLElement;
    child: HTMLElement;
    resize: (w: number) => Promise<void>;
} {
    const { host, resize } = mountSized(available);
    const clamp = document.createElement('adw-clamp');
    const child = document.createElement('div');
    // A bare block child fills the clamp and is capped by the max-width the
    // element writes — the same shape every story uses.
    child.textContent = 'clamped';
    clamp.appendChild(child);
    host.appendChild(clamp);
    return { host, clamp, child, resize };
}

/** The child width a clamp settles on, rounded to the pixel it renders at. */
function clampedWidth(child: HTMLElement): number {
    return Math.round(child.getBoundingClientRect().width);
}

/** The three classes `adw_clamp_layout_allocate` stamps on the child. */
function sizeClassOf(child: HTMLElement): string | null {
    for (const cls of ['small', 'medium', 'large']) {
        if (child.classList.contains(cls)) return cls;
    }
    return null;
}

/** A toolbar view with bars of the given pixel heights (0 = no bar at all). */
function mountToolbarView(topBarHeight: number, bottomBarHeight: number): { host: HTMLElement; view: HTMLElement } {
    const { host } = mountSized(400);
    host.style.height = '300px';
    const view = document.createElement('adw-toolbar-view');
    for (const [slot, height] of [
        ['top', topBarHeight],
        ['bottom', bottomBarHeight],
    ] as const) {
        if (height <= 0) continue;
        const bar = document.createElement('div');
        bar.setAttribute('slot', slot);
        bar.style.height = `${height}px`;
        view.appendChild(bar);
    }
    host.appendChild(view);
    return { host, view };
}

export const AdwChromeTest = async () => {
    await describe('adw-clamp allocation (AdwClampLayout conformance vectors)', async () => {
        // The browser resolves the child's own minimum through the normal
        // `min-width` cascade, so only the rows that pass a zero child minimum
        // describe what this element can be held to.
        const vectors = CLAMP_ALLOCATE_VECTORS.filter((v) => v.params.childMin === 0);

        for (const { availableSize, params, childSize, sizeClass, offset, rule } of vectors) {
            await it(`${availableSize}px available → a ${childSize}px ${sizeClass} child — ${rule}`, async () => {
                const { host, clamp, child } = mountClamp(availableSize);
                clamp.setAttribute('maximum-size', String(params.maximumSize));
                clamp.setAttribute('tightening-threshold', String(params.tighteningThreshold));
                await settle();

                expect(clampedWidth(child)).toBe(childSize);
                expect(sizeClassOf(child)).toBe(sizeClass);
                // `margin-inline: auto` splits the remainder evenly; libadwaita
                // truncates, so the two can differ by half a pixel.
                const leading = child.getBoundingClientRect().left - clamp.getBoundingClientRect().left;
                expect(Math.abs(leading - offset) <= 1).toBe(true);

                host.remove();
            });
        }

        await it('follows the viewport instead of pinning the child to the maximum', async () => {
            // The NativeScript twin's bug in browser form: a narrow clamp must
            // hand the child ALL of the available width, not the cap.
            const { host, clamp, child, resize } = mountClamp(1000);
            await settle();
            expect(clampedWidth(child)).toBe(600);
            await resize(360);
            expect(clampedWidth(child)).toBe(360);
            expect(Math.round(clamp.getBoundingClientRect().width)).toBe(360);
            host.remove();
        });

        await it('honours tightening-threshold, which the element used to ignore', async () => {
            // The storybook has exposed this control all along and only the GTK
            // pane responded to it.
            const { host, clamp, child } = mountClamp(700);
            clamp.setAttribute('maximum-size', '600');
            clamp.setAttribute('tightening-threshold', '400');
            await settle();
            expect(clampedWidth(child)).toBe(575);

            // Raising the threshold above the maximum removes the easing.
            clamp.setAttribute('tightening-threshold', '800');
            await settle();
            expect(clampedWidth(child)).toBe(600);
            host.remove();
        });

        await it('clamps children appended after it was connected', async () => {
            // The element only saw its children once, at connect time — the same
            // "evaluated once" shape the toolbar view's empty-bar handling has.
            const { host } = mountSized(1000);
            const clamp = document.createElement('adw-clamp');
            host.appendChild(clamp);
            await settle();

            const late = document.createElement('div');
            late.textContent = 'appended later';
            clamp.appendChild(late);
            await settle();

            expect(clampedWidth(late)).toBe(600);
            host.remove();
        });
    });

    await describe('adw-clamp maximum-size parsing (g_param_spec_int range)', async () => {
        for (const { value, fallback, size, rule } of CLAMP_PROPERTY_VECTORS) {
            // Only the rows whose fallback is the real property default describe
            // what an attribute on THIS element resolves to.
            if (fallback !== 600) continue;

            await it(`maximum-size ${JSON.stringify(value ?? null)} caps at ${size}px — ${rule}`, async () => {
                const { host, clamp, child } = mountClamp(1000);
                // `null`/`undefined` are the ABSENT attribute, so nothing is set.
                if (value !== null && value !== undefined) clamp.setAttribute('maximum-size', String(value));
                await settle();

                // 1000px is past `upper` for every cap in the table, so the child
                // sits exactly at the resolved property and it is readable off
                // the rendered width.
                expect(clampedWidth(child)).toBe(size);
                host.remove();
            });
        }

        await it('recovers the default after an unparsable value, instead of freezing on the old cap', async () => {
            // `parseFloat('abc')` produced `max-width: NaNpx`, which the CSSOM
            // rejects — so the element silently kept whatever cap it had.
            const { host, clamp, child } = mountClamp(1000);
            clamp.setAttribute('maximum-size', '300');
            await settle();
            expect(clampedWidth(child)).toBe(300);

            clamp.setAttribute('maximum-size', 'abc');
            await settle();
            expect(clampedWidth(child)).toBe(600);
            host.remove();
        });
    });

    await describe('adw-spinner geometry (AdwSpinnerPaintable conformance vectors)', async () => {
        /** The `<svg>` the element draws its ring into. */
        const ringOf = (spinner: HTMLElement) => spinner.querySelector('svg') as SVGSVGElement;

        for (const { width, height, diameter, lineWidth, rule } of SPINNER_GEOMETRY_VECTORS) {
            // Only square, allocatable boxes describe what a `size` attribute
            // can produce; the rectangular rows exercise the paintable directly.
            if (width !== height || width < ADW_SPINNER_MIN_SIZE) continue;

            await it(`size ${width} draws a ${diameter}px ring stroked ${lineWidth}px — ${rule}`, () => {
                const { host } = mountSized(400);
                const spinner = document.createElement('adw-spinner');
                spinner.setAttribute('size', String(width));
                host.appendChild(spinner);

                const svg = ringOf(spinner);
                expect(svg.getAttribute('width')).toBe(String(diameter));
                expect(svg.getAttribute('height')).toBe(String(diameter));
                const arc = svg.querySelectorAll('circle')[1] as SVGCircleElement;
                expect(Number(arc.getAttribute('stroke-width'))).toBe(lineWidth);
                host.remove();
            });
        }

        await it('strokes 3px at 24 and 6px at 48, where it used to stroke 2 and 4', () => {
            const { host } = mountSized(400);
            const spinner = document.createElement('adw-spinner');
            host.appendChild(spinner);
            const strokeAt = (size: number) => {
                spinner.setAttribute('size', String(size));
                return Number(ringOf(spinner).querySelector('circle')?.getAttribute('stroke-width'));
            };
            expect(strokeAt(24)).toBe(3);
            expect(strokeAt(48)).toBe(6);
            expect(strokeAt(64)).toBe(8);
            host.remove();
        });

        await it('rounds its arc ends — GSK_LINE_CAP_ROUND, square-cut before', () => {
            const { host } = mountSized(400);
            const spinner = document.createElement('adw-spinner');
            spinner.setAttribute('size', '64');
            host.appendChild(spinner);
            const [track, arc] = [...ringOf(spinner).querySelectorAll('circle')];
            expect(arc.getAttribute('stroke-linecap')).toBe('round');
            // The TRACK is the widget colour at CIRCLE_OPACITY, not a grey.
            expect(track.getAttribute('stroke')).toBe('currentColor');
            expect(Number(track.getAttribute('stroke-opacity'))).toBe(ADW_SPINNER_TRACK_OPACITY);
            host.remove();
        });
    });

    await describe('adw-spinner sizing — the BOX and the RING are different things', async () => {
        for (const { value, size, rule } of SPINNER_SIZE_VECTORS) {
            await it(`size ${JSON.stringify(value ?? null)} → a ${size}px box — ${rule}`, () => {
                const { host } = mountSized(400);
                const spinner = document.createElement('adw-spinner');
                if (value !== null && value !== undefined) spinner.setAttribute('size', String(value));
                host.appendChild(spinner);

                // THE BOX takes the whole request — this suite used to assert the
                // ring's diameter here, contradicting the core table it drives.
                expect(spinner.offsetWidth).toBe(size);
                expect(spinner.offsetHeight).toBe(size);
                // THE RING is capped and centred inside it.
                const svg = spinner.querySelector('svg') as SVGSVGElement;
                expect(Number(svg.getAttribute('width'))).toBe(spinnerGeometry(size, size).diameter);
                host.remove();
            });
        }

        await it('a 200px spinner occupies 200px and draws a 64px ring', () => {
            const { host } = mountSized(400);
            const spinner = document.createElement('adw-spinner');
            spinner.setAttribute('size', '200');
            host.appendChild(spinner);
            expect(spinner.offsetWidth).toBe(200);
            expect(Number((spinner.querySelector('svg') as SVGSVGElement).getAttribute('width'))).toBe(64);
            host.remove();
        });

        await it('defaults to the measured 16, not the invented 24', () => {
            const { host } = mountSized(400);
            const spinner = document.createElement('adw-spinner');
            host.appendChild(spinner);
            expect(spinner.offsetWidth).toBe(ADW_SPINNER_MIN_SIZE);
            host.remove();
        });
    });

    await describe('adw-spinner animation + accessibility (#1066)', async () => {
        await it('announces itself — role progressbar, aria-busy (zero hits before)', () => {
            const { host } = mountSized(400);
            const spinner = document.createElement('adw-spinner');
            host.appendChild(spinner);
            expect(spinner.getAttribute('role')).toBe('progressbar');
            expect(spinner.getAttribute('aria-busy')).toBe('true');
            host.remove();
        });

        await it('BREATHES — the drawn arc length changes across a turn', () => {
            const { host } = mountSized(400);
            const spinner = document.createElement('adw-spinner') as HTMLElement & { drawAt(now: number): void };
            spinner.setAttribute('size', '64');
            host.appendChild(spinner);
            const arc = spinner.querySelectorAll('circle')[1] as SVGCircleElement;

            const drawnAt = (ms: number) => {
                spinner.drawAt(ms);
                return Number.parseFloat((arc.getAttribute('stroke-dasharray') ?? '0').split(' ')[0]);
            };
            // `drawAt` takes the FIRST call as the origin, so these are offsets
            // into one animation, sampled across a cycle.
            const lengths = [0, 200, 500, 900, 1300, 1900].map(drawnAt);
            const spread = Math.max(...lengths) - Math.min(...lengths);
            // A fixed 90-degree border chase — what this element used to draw —
            // has a spread of exactly zero.
            expect(spread).toBeGreaterThan(0);
            host.remove();
        });

        await it('KEEPS SPINNING under reduced motion — a frozen busy indicator reads as a hang', () => {
            // libadwaita opts the spinner out of the animation setting on purpose
            // (adw-spinner-paintable.c:537). The old stylesheet had
            // `@media (prefers-reduced-motion: reduce) { animation: none }`, so
            // this asserts the ABSENCE of any CSS animation to switch off: the
            // arc is driven per frame from JS and cannot be disabled by a query.
            const { host } = mountSized(400);
            const spinner = document.createElement('adw-spinner');
            host.appendChild(spinner);
            expect(getComputedStyle(spinner).animationName).toBe('none');
            host.remove();
        });

        await it('advances while mapped and stops when it is not', () => {
            const { host } = mountSized(400);
            const spinner = document.createElement('adw-spinner') as HTMLElement & { drawAt(now: number): void };
            host.appendChild(spinner);
            const arc = spinner.querySelectorAll('circle')[1] as SVGCircleElement;
            spinner.drawAt(0);
            const first = arc.getAttribute('stroke-dashoffset');
            spinner.drawAt(400);
            expect(arc.getAttribute('stroke-dashoffset')).not.toBe(first);

            // Unmapping removes it from the shared ticker — `widget_map_cb`
            // (adw-spinner-paintable.c:181-185) is what plays the animation, so
            // an off-screen spinner burns nothing.
            spinner.remove();
            const parked = arc.getAttribute('stroke-dashoffset');
            spinner.drawAt(800); // only reachable directly; the ticker has dropped it
            expect(arc.getAttribute('stroke-dashoffset')).not.toBe(parked);
            host.remove();
        });
    });

    await describe('adw-toolbar-view style classes (update_undershoots + the style setters)', async () => {
        for (const { input, view, topBar, bottomBar, rule } of TOOLBAR_VIEW_CLASS_VECTORS) {
            await it(`${input.topBarStyle}/${input.bottomBarStyle} → [${view.join(' ')}] — ${rule}`, () => {
                const { host, view: element } = mountToolbarView(input.topBarHeight, input.bottomBarHeight);
                element.setAttribute('top-bar-style', input.topBarStyle);
                element.setAttribute('bottom-bar-style', input.bottomBarStyle);
                if (input.extendContentToTopEdge) element.setAttribute('extend-content-to-top-edge', '');
                if (input.extendContentToBottomEdge) element.setAttribute('extend-content-to-bottom-edge', '');

                const topEl = element.querySelector('.adw-toolbar-view-top') as HTMLElement;
                const bottomEl = element.querySelector('.adw-toolbar-view-bottom') as HTMLElement;

                for (const cls of ['undershoot-top', 'undershoot-bottom']) {
                    expect(element.classList.contains(cls)).toBe(view.includes(cls));
                }
                for (const cls of ['raised', 'border']) {
                    expect(topEl.classList.contains(cls)).toBe(topBar.includes(cls));
                    expect(bottomEl.classList.contains(cls)).toBe(bottomBar.includes(cls));
                }
                host.remove();
            });
        }

        await it('drops the undershoot again when the style stops being flat', () => {
            const { host, view } = mountToolbarView(46, 0);
            expect(view.classList.contains('undershoot-top')).toBe(true);
            view.setAttribute('top-bar-style', 'raised');
            expect(view.classList.contains('undershoot-top')).toBe(false);
            view.setAttribute('top-bar-style', 'flat');
            expect(view.classList.contains('undershoot-top')).toBe(true);
            host.remove();
        });

        await it('treats an unknown style as flat, the way the enum guard does', () => {
            const { host, view } = mountToolbarView(46, 0);
            view.setAttribute('top-bar-style', 'shadowed');
            const topEl = view.querySelector('.adw-toolbar-view-top') as HTMLElement;
            expect(topEl.classList.contains('raised')).toBe(false);
            expect(view.classList.contains('undershoot-top')).toBe(true);
            host.remove();
        });
    });
};
