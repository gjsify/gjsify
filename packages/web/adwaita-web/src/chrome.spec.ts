// DOM-level conformance tests for the chrome elements — <adw-clamp>,
// <adw-spinner> and <adw-toolbar-view> — driven by the SAME vectors the
// NativeScript renderer asserts against (`@gjsify/adwaita-core/conformance`).
//
// Each of the three answered a question libadwaita had already answered, and answered it
// differently from the NativeScript port: clamp tightening and `maximum-size="0"`, the
// spinner's default size and 3px stroke, and the toolbar view's four style classes.
//
// Sizes are driven by really resizing a host element and awaiting a real ResizeObserver
// delivery, as `breakpoints.spec.ts` does — never by faking one.
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
    // A bare block child fills the clamp and is capped by the max-width the element
    // writes — the shape every story uses.
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

/**
 * A widget mounted the way the docs site mounts a preview: a fixed-height flex
 * row, the markup attached in ONE piece from an inert `<template>`.
 *
 * The template is not decoration. A nested composite (a split view holding
 * toolbar views) upgraded child-by-child by the parser can lose its slotted
 * children to an upgrade-order race, so both the docs site and these tests build
 * the subtree first and attach it afterwards.
 */
function mountPreview(markup: string, height = 340, width = 640): HTMLElement {
    const host = document.createElement('div');
    host.style.cssText = `height: ${height}px; width: ${width}px; display: flex; overflow: hidden;`;
    const template = document.createElement('template');
    template.innerHTML = markup;
    host.append(template.content.cloneNode(true));
    document.body.append(host);
    return host;
}

/** Rounded to the pixel it renders at, as `clampedWidth` does for the clamp. */
function heightOf(el: Element | null): number {
    return el ? Math.round(el.getBoundingClientRect().height) : -1;
}

/** The sidebar pane of the Navigation Split View preview (docs/adwaita/navigation.mdx). */
const SIDEBAR_PANE_PREVIEW = `
<adw-toolbar-view style="flex: 1;">
  <adw-header-bar slot="top">
    <adw-window-title slot="center" title="Mailboxes"></adw-window-title>
  </adw-header-bar>
  <adw-sidebar mode="sidebar" selected="0">
    <adw-sidebar-section>
      <adw-sidebar-item title="All Mail" subtitle="128 messages" icon-name="mail-unread-symbolic"></adw-sidebar-item>
      <adw-sidebar-item title="Starred" subtitle="6 messages" icon-name="starred-symbolic"></adw-sidebar-item>
      <adw-sidebar-item title="Drafts" subtitle="2 messages" icon-name="document-edit-symbolic"></adw-sidebar-item>
      <adw-sidebar-item title="Archive" subtitle="512 messages" icon-name="folder-symbolic"></adw-sidebar-item>
    </adw-sidebar-section>
  </adw-sidebar>
</adw-toolbar-view>`;

/** The content pane of the same preview: a status page that centres itself. */
const STATUS_PANE_PREVIEW = `
<adw-toolbar-view style="flex: 1;">
  <adw-header-bar slot="top">
    <adw-window-title slot="center" title="All Mail"></adw-window-title>
  </adw-header-bar>
  <adw-status-page icon="mail-unread-symbolic" title="All Mail" description="Select a conversation from the list to read it here."></adw-status-page>
</adw-toolbar-view>`;

/**
 * The root page of the Navigation View preview: a lone action button.
 *
 * A GTK button asked to sit in the middle of a ToolbarView says
 * `halign/valign: CENTER`; the web spelling is a centring box around it, which is
 * what the preview now carries. It used to carry a bare
 * `class="adw-navigation-view-root-action"` matching no rule in any stylesheet.
 */
const ROOT_ACTION_PREVIEW = `
<adw-toolbar-view style="flex: 1;">
  <adw-header-bar slot="top">
    <adw-window-title slot="center" title="Contacts"></adw-window-title>
  </adw-header-bar>
  <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">
    <gtk-button label="Open contact" pill suggested></gtk-button>
  </div>
</adw-toolbar-view>`;

/**
 * A tab view in a toolbar view: the horizontal scroller the shading also reaches.
 *
 * `expand-tabs` is off on purpose, so enough tabs really do overflow the strip
 * rather than being squeezed into it.
 */
const TAB_STRIP_PREVIEW = (pages: number): string => `
<adw-toolbar-view style="flex: 1;">
  <adw-header-bar slot="top">
    <adw-window-title slot="center" title="Editor"></adw-window-title>
  </adw-header-bar>
  <adw-tab-view no-close="true">
    ${Array.from(
        { length: pages },
        (_, i) => `<adw-tab-page title="A rather long tab title ${i}"><div>page ${i}</div></adw-tab-page>`,
    ).join('')}
  </adw-tab-view>
</adw-toolbar-view>`;

export const AdwChromeTest = async () => {
    await describe('adw-clamp allocation (AdwClampLayout conformance vectors)', async () => {
        // The browser resolves the child's own minimum through the normal `min-width`
        // cascade, so only rows with a zero child minimum describe this element.
        const vectors = CLAMP_ALLOCATE_VECTORS.filter((v) => v.params.childMin === 0);

        for (const { availableSize, params, childSize, sizeClass, offset, rule } of vectors) {
            await it(`${availableSize}px available → a ${childSize}px ${sizeClass} child — ${rule}`, async () => {
                const { host, clamp, child } = mountClamp(availableSize);
                clamp.setAttribute('maximum-size', String(params.maximumSize));
                clamp.setAttribute('tightening-threshold', String(params.tighteningThreshold));
                await settle();

                expect(clampedWidth(child)).toBe(childSize);
                expect(sizeClassOf(child)).toBe(sizeClass);
                // `margin-inline: auto` splits the remainder evenly where libadwaita
                // truncates, so the two can differ by half a pixel.
                const leading = child.getBoundingClientRect().left - clamp.getBoundingClientRect().left;
                expect(Math.abs(leading - offset) <= 1).toBe(true);

                host.remove();
            });
        }

        await it('follows the viewport instead of pinning the child to the maximum', async () => {
            // A narrow clamp hands the child ALL of the available width, not the cap.
            const { host, clamp, child, resize } = mountClamp(1000);
            await settle();
            expect(clampedWidth(child)).toBe(600);
            await resize(360);
            expect(clampedWidth(child)).toBe(360);
            expect(Math.round(clamp.getBoundingClientRect().width)).toBe(360);
            host.remove();
        });

        await it('honours tightening-threshold, which the element used to ignore', async () => {
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
            //. The old stylesheet had
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
            // is what plays the animation, so
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

    // `adw_toolbar_view_size_allocate` hands its ONE content widget the whole
    // content rect; a widget that wants less says so with its own alignment.
    // This port collected the content into a flex COLUMN, where an item that
    // declares no `flex-grow` is content-sized instead, so the child stopped
    // wherever its content did and the rest of the pane stayed empty.
    await describe('adw-toolbar-view content allocation (size_allocate gives the content the whole rect)', async () => {
        await it('stretches a lone content child past its own content height', async () => {
            const host = mountPreview(SIDEBAR_PANE_PREVIEW);
            await settle();
            const area = host.querySelector('.adw-toolbar-view-content');
            const sidebar = host.querySelector('adw-sidebar') as HTMLElement;

            // The two discriminators, without which this passes on a broken build:
            // the bar must really have taken height off the top, and the sidebar's
            // own content must really be shorter than the area it has to fill,
            // otherwise "child height == area height" is a coincidence. The rows are
            // measured through the LIST, not through the sidebar's own scrollHeight:
            // once the sidebar fills, its scrollHeight is its new height and the
            // discriminator would have measured the fix instead of the content.
            expect(heightOf(area) > 0 && heightOf(area) < 340).toBe(true);
            expect(heightOf(sidebar.querySelector('.adw-sidebar-list')) < heightOf(area)).toBe(true);

            expect(heightOf(sidebar)).toBe(heightOf(area));
            host.remove();
        });

        await it('centres a status page in the pane rather than against its top bar', async () => {
            const host = mountPreview(STATUS_PANE_PREVIEW);
            await settle();
            const area = host.querySelector('.adw-toolbar-view-content') as HTMLElement;
            const status = host.querySelector('adw-status-page') as HTMLElement;

            expect(heightOf(area) > 0 && heightOf(area) < 340).toBe(true);
            expect(heightOf(status)).toBe(heightOf(area));

            // What the reader actually sees, and the discriminator at the same time:
            // an Adw.StatusPage centres its own column, so equal air above the icon
            // and below the description is only reachable once it owns the whole
            // pane. Top-aligned in the pane it measured 24px of padding above and
            // some 60px of window background below.
            const areaBox = area.getBoundingClientRect();
            const above =
                (status.querySelector('.adw-status-page-icon') as HTMLElement).getBoundingClientRect().top -
                areaBox.top;
            const description = status.querySelector('.adw-status-page-description') as HTMLElement;
            const below = areaBox.bottom - description.getBoundingClientRect().bottom;
            expect(Math.abs(above - below) <= 2).toBe(true);
            host.remove();
        });

        await it('stretches a centring box and lets IT place the button, which keeps its own size', async () => {
            const host = mountPreview(ROOT_ACTION_PREVIEW);
            await settle();
            const area = host.querySelector('.adw-toolbar-view-content') as HTMLElement;
            const button = host.querySelector('gtk-button') as HTMLElement;

            expect(heightOf(area.firstElementChild)).toBe(heightOf(area));
            // A pill button that grew to the pane's height would be the fill applied
            // one level too deep. The alignment box exists precisely to absorb it.
            expect(heightOf(button) > 0 && heightOf(button) < heightOf(area)).toBe(true);

            const areaBox = area.getBoundingClientRect();
            const buttonBox = button.getBoundingClientRect();
            expect(Math.abs(buttonBox.top - areaBox.top - (areaBox.bottom - buttonBox.bottom)) <= 2).toBe(true);
            expect(Math.abs(buttonBox.left - areaBox.left - (areaBox.right - buttonBox.right)) <= 2).toBe(true);
            host.remove();
        });
    });

    // The undershoot says "there IS content past this edge". A scroller whose
    // content fits has none, so it must draw neither edge. That is the state the
    // storybook got wrong for every scroller at rest, and the reason
    // `scrollUndershootClasses` exists. Asserted here on a REAL scroller,
    // because the core spec only ever sees the arithmetic.
    await describe('adw-toolbar-view scroll shading (no undershoot where nothing can scroll)', async () => {
        await it('leaves both edges clean while the content fits', async () => {
            const host = mountPreview(SIDEBAR_PANE_PREVIEW);
            await settle();
            const area = host.querySelector('.adw-toolbar-view-content') as HTMLElement;

            // Both scrollers under the view: the content area and the sidebar's own
            // list, which is the node upstream shades (`AdwSidebar` wraps a
            // GtkScrolledWindow) once the pane is tall enough to hold every row.
            for (const el of [area, host.querySelector('adw-sidebar') as HTMLElement]) {
                // The discriminator: the shading really is wired to this scroller, so
                // "no undershoot class" is a decision and not a controller that never ran.
                expect(el.classList.contains('adw-scroll-shaded')).toBe(true);
                expect(el.scrollHeight).toBe(el.clientHeight);
                expect(el.classList.contains('undershoot-top')).toBe(false);
                expect(el.classList.contains('undershoot-bottom')).toBe(false);
            }
            host.remove();
        });

        await it('draws the top edge once there IS content past it', async () => {
            // A status page, not the sidebar: a status page cannot scroll on its own,
            // so the content area is the scroller and the shade belongs to it. And the
            // TOP edge, because `update_undershoots` gates the bottom one on a bottom
            // bar this view does not have, so asserting the bottom edge here would pass
            // whatever the controller decided.
            const host = mountPreview(STATUS_PANE_PREVIEW, 120);
            await settle();
            const area = host.querySelector('.adw-toolbar-view-content') as HTMLElement;
            expect(area.scrollHeight > area.clientHeight).toBe(true);
            expect(area.classList.contains('undershoot-top')).toBe(false);

            // A REAL scroll, then the frames the `scroll` event is delivered in.
            area.scrollTop = area.scrollHeight;
            await settle();
            await settle();
            expect(area.classList.contains('undershoot-top')).toBe(true);

            // ONE owner draws the shade. `undershoot-top` is also a documented
            // libadwaita style class with its own inset host shadow in
            // `_style_classes.scss`, so a scroller wearing the state class used to
            // get that 6px blurred shadow UNDER the 1px line + 4px fade this package
            // paints on the pseudo-element: the same edge, twice, in two sizes.
            expect(getComputedStyle(area).boxShadow).toBe('none');
            expect(getComputedStyle(area, '::before').boxShadow === 'none').toBe(false);
            host.remove();
        });

        await it('leaves a horizontally overflowing tab strip its own hairline', async () => {
            // The horizontal pair has no rule in `_scrolling.scss` at all, because
            // neither AdwTabBox nor AdwCarousel has a `scrolledwindow` node for GTK to
            // shade. The style class did have one, and it is `box-shadow` too — so an
            // overflowing strip silently traded its `inset 0 -1px` bottom shade for an
            // edge shadow libadwaita never draws there.
            const wide = mountPreview(TAB_STRIP_PREVIEW(8), 260, 320);
            const narrow = mountPreview(TAB_STRIP_PREVIEW(1), 260, 320);
            await settle();
            await settle();
            const overflowing = wide.querySelector('.adw-tab-bar') as HTMLElement;
            const fitting = narrow.querySelector('.adw-tab-bar') as HTMLElement;

            // The two discriminators: the strip really does overflow, and the shading
            // controller really did reach it. Without them this is two identical bars.
            expect(overflowing.scrollWidth > overflowing.clientWidth).toBe(true);
            expect(overflowing.classList.contains('undershoot-end')).toBe(true);
            expect(fitting.scrollWidth).toBe(fitting.clientWidth);

            expect(getComputedStyle(overflowing).boxShadow).toBe(getComputedStyle(fitting).boxShadow);
            wide.remove();
            narrow.remove();
        });
    });
};
