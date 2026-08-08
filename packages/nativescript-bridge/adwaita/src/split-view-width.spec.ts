// Sidebar width for the NativeScript split views, against the shared vectors.
//
// The widget has no stored width: it has a fraction of the container clamped
// between a min and a max. The port carried a single invented 240 DIP, which is
// wrong at both ends of the range it serves — on the 411 DIP emulator this suite
// runs beside, 240 is 58% of the screen where libadwaita draws 180.

import { describe, expect, it } from '@gjsify/unit';

import { SIDEBAR_WIDTH_VECTORS } from '@gjsify/adwaita-core/conformance';

import {
    appliesDerivedSidebarWidth,
    DEFAULT_MAX_SIDEBAR_WIDTH,
    DEFAULT_MIN_SIDEBAR_WIDTH,
    DEFAULT_SIDEBAR_WIDTH_FRACTION,
    defaultSidebarWidthProps,
    normalizeWidthFraction,
    normalizeWidthProp,
    sidebarWidthFor,
} from './widgets/split-view-width.js';

export default async () => {
    await describe('defaultSidebarWidthProps (Adw.OverlaySplitView properties)', async () => {
        await it('takes all three from the widget, not from a constant', () => {
            expect(defaultSidebarWidthProps()).toStrictEqual({
                minSidebarWidth: 180,
                maxSidebarWidth: 280,
                sidebarWidthFraction: 0.25,
            });
        });

        await it('re-exports the core constants rather than restating them', () => {
            expect(DEFAULT_MIN_SIDEBAR_WIDTH).toBe(180);
            expect(DEFAULT_MAX_SIDEBAR_WIDTH).toBe(280);
            expect(DEFAULT_SIDEBAR_WIDTH_FRACTION).toBe(0.25);
        });

        await it("hands out a fresh object, so one view cannot edit another's", () => {
            const first = defaultSidebarWidthProps();
            first.minSidebarWidth = 999;
            expect(defaultSidebarWidthProps().minSidebarWidth).toBe(180);
        });
    });

    await describe('sidebarWidthFor across real container sizes', async () => {
        const props = defaultSidebarWidthProps();

        await it('lifts a narrow phone to the minimum instead of a quarter of nothing', () => {
            // The emulator this was verified on: 1080px at density 420 = 411 DIP.
            // A quarter is 102, which the clamp lifts to 180. The old fixed 240
            // would have taken 58% of the screen.
            expect(sidebarWidthFor(411, props)).toBe(180);
            expect(sidebarWidthFor(360, props)).toBe(180);
        });

        await it('uses the fraction once the container is wide enough', () => {
            expect(sidebarWidthFor(800, props)).toBe(200);
            expect(sidebarWidthFor(1000, props)).toBe(250);
        });

        await it('holds a wide container down to the maximum', () => {
            expect(sidebarWidthFor(1200, props)).toBe(280);
            expect(sidebarWidthFor(4000, props)).toBe(280);
        });

        await it('grows monotonically — a wider container never narrows the sidebar', () => {
            const regressions: number[] = [];
            let previous = -1;
            for (let width = 1; width <= 2000; width++) {
                const sidebar = sidebarWidthFor(width, props);
                if (sidebar < previous) regressions.push(width);
                previous = sidebar;
            }
            expect(regressions).toStrictEqual([]);
        });

        await it('returns the minimum before the first layout pass', () => {
            // NativeScript reports a zero size until the view is laid out; the
            // smallest thing libadwaita would draw is the safe starting point,
            // because the first real pass can then only widen it.
            expect(sidebarWidthFor(0, props)).toBe(180);
            expect(sidebarWidthFor(-1, props)).toBe(180);
        });
    });

    await describe('sidebarWidthFor against the shared conformance vectors', async () => {
        for (const vector of SIDEBAR_WIDTH_VECTORS) {
            // `sp`-at-another-dpi has no NativeScript surface — DIPs are the
            // unit here — so those rows stay in the core suite.
            if (vector.spec.sidebarWidthUnit !== undefined || vector.spec.dpi !== undefined) continue;

            const props = {
                minSidebarWidth: vector.spec.minSidebarWidth ?? DEFAULT_MIN_SIDEBAR_WIDTH,
                maxSidebarWidth: vector.spec.maxSidebarWidth ?? DEFAULT_MAX_SIDEBAR_WIDTH,
                sidebarWidthFraction: vector.spec.sidebarWidthFraction ?? DEFAULT_SIDEBAR_WIDTH_FRACTION,
            };
            const mode = vector.collapsed ? 'collapsed' : 'uncollapsed';

            await it(`${vector.widget} ${mode} ${vector.totalWidth} DIP → ${vector.width} — ${vector.rule}`, () => {
                expect(
                    sidebarWidthFor(vector.totalWidth, props, vector.widget, {
                        contentMin: vector.contentMin,
                        sidebarChildMin: vector.sidebarChildMin,
                        collapsed: vector.collapsed,
                    }),
                ).toBe(vector.width);
            });
        }
    });

    await describe('the collapsed overlay ignores the fraction (get_sidebar_width :462-463)', async () => {
        await it('draws 280 on a 360 DIP phone where the fraction would give 180', () => {
            // The divergence this parameter closes: COLLAPSED, libadwaita clamps
            // the VIEW width instead of a share of it, so the overlay keeps its
            // natural size on a phone. Without the flag NativeScript drew 180
            // where GTK draws 280 — the whole point of an overlay is that it is
            // not a quarter of the screen.
            const props = defaultSidebarWidthProps();
            expect(sidebarWidthFor(360, props, 'overlay', { collapsed: true })).toBe(280);
            expect(sidebarWidthFor(360, props, 'overlay', { collapsed: false })).toBe(180);
        });

        await it('may end up WIDER than a very narrow view', () => {
            const props = defaultSidebarWidthProps();
            expect(sidebarWidthFor(150, props, 'overlay', { collapsed: true })).toBe(180);
        });

        await it('leaves the navigation rule alone — its collapsed pane takes no derived width', () => {
            // `appliesDerivedSidebarWidth` already stops the write, so the flag
            // must not quietly change the number the navigation rule computes.
            const props = defaultSidebarWidthProps();
            for (const width of [150, 360, 800, 1200]) {
                expect(sidebarWidthFor(width, props, 'navigation', { collapsed: true })).toBe(
                    sidebarWidthFor(width, props, 'navigation', { collapsed: false }),
                );
            }
        });
    });

    await describe('the two widgets differ once a pane has a minimum', async () => {
        await it('a container narrower than the minimum already splits them', () => {
            const props = defaultSidebarWidthProps();
            // No content minimum needed: overlay's closing min() caps the sidebar
            // at what the view has, navigation's lower bound wins and exceeds it.
            expect(sidebarWidthFor(100, props, 'navigation')).toBe(180);
            expect(sidebarWidthFor(100, props, 'overlay')).toBe(100);
        });

        await it('agrees once the container can hold the minimum', () => {
            const props = defaultSidebarWidthProps();
            for (const width of [360, 411, 800, 1000, 1200]) {
                expect(sidebarWidthFor(width, props, 'navigation')).toBe(sidebarWidthFor(width, props, 'overlay'));
            }
        });
    });

    await describe('appliesDerivedSidebarWidth (the collapsed navigation exemption)', async () => {
        await it('stops the post-layout re-measure overwriting a full-screen pane', () => {
            // The regression this exists for: `_applySidebarWidth` is bound to
            // `layoutChanged`, which fires AFTER a collapse. The collapsed
            // navigation split view had just set its pane to `'auto'` spanning
            // both columns (adw-navigation-split-view.c:538 — the visible page
            // fills the view), and the re-measure wrote 180-280 DIP over it one
            // frame later. Nothing failed, because no vector said a collapsed
            // pane is full-width.
            expect(appliesDerivedSidebarWidth(true, 'navigation')).toBe(false);
        });

        await it('still sizes a collapsed OVERLAY sidebar', () => {
            // Not the same case, and a shared "collapsed means auto" rule would
            // have been wrong here: the overlay's collapsed sidebar really is a
            // clamped-width pane drawn above the content
            // (adw-overlay-split-view.c:462-463).
            expect(appliesDerivedSidebarWidth(true, 'overlay')).toBe(true);
        });

        await it('derives the width for both widgets while uncollapsed', () => {
            expect(appliesDerivedSidebarWidth(false, 'navigation')).toBe(true);
            expect(appliesDerivedSidebarWidth(false, 'overlay')).toBe(true);
        });
    });

    await describe('property normalisation', async () => {
        await it('falls back to the default rather than to zero', () => {
            // A zero-width sidebar is indistinguishable from a missing one on
            // screen, which turns a typo into a widget that looks broken.
            expect(normalizeWidthProp(Number.NaN, 180)).toBe(180);
            expect(normalizeWidthProp(-5, 180)).toBe(180);
            expect(normalizeWidthProp(Number.POSITIVE_INFINITY, 180)).toBe(180);
            expect(normalizeWidthProp(0, 180)).toBe(0);
            expect(normalizeWidthProp(240, 180)).toBe(240);
        });

        await it('clamps the fraction into the [0, 1] its GTK property declares', () => {
            expect(normalizeWidthFraction(-1)).toBe(0);
            expect(normalizeWidthFraction(2)).toBe(1);
            expect(normalizeWidthFraction(0.4)).toBe(0.4);
            expect(normalizeWidthFraction(Number.NaN)).toBe(0.25);
        });
    });
};
