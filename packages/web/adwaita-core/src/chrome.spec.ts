// Window-chrome derivation specs — driven by the shared conformance vectors, so
// this suite and the two renderer suites assert the SAME table.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_CLAMP_DEFAULTS,
    ADW_CLAMP_SIZE_CLASSES,
    ADW_SPINNER_MAX_SIZE,
    ADW_SPINNER_MIN_SIZE,
    ADW_TOOLBAR_BAR_CLASSES,
    ADW_TOOLBAR_VIEW_CLASSES,
    ADW_TOOLBAR_VIEW_DEFAULTS,
    clampAllocate,
    clampChildSize,
    clampSizeFromChild,
    clampThresholds,
    normalizeClampSize,
    parseToolbarStyle,
    resolveSpinnerSize,
    spinnerGeometry,
    toolbarBarStyleClasses,
    toolbarViewAllocate,
    toolbarViewClasses,
    toolbarViewContentForSize,
    toolbarViewMeasure,
} from './chrome.js';
import {
    CLAMP_ALLOCATE_VECTORS,
    CLAMP_CHILD_SIZE_VECTORS,
    CLAMP_PROPERTY_VECTORS,
    CLAMP_SIZE_FROM_CHILD_VECTORS,
    CLAMP_THRESHOLD_VECTORS,
    SPINNER_GEOMETRY_VECTORS,
    SPINNER_SIZE_VECTORS,
    TOOLBAR_VIEW_ALLOCATE_VECTORS,
    TOOLBAR_VIEW_CLASS_VECTORS,
    TOOLBAR_VIEW_CONTENT_FOR_SIZE_VECTORS,
    TOOLBAR_VIEW_MEASURE_VECTORS,
} from './conformance/chrome.js';

export default async () => {
    await describe('clampThresholds (AdwClampLayout lower/max/upper)', async () => {
        for (const { params, lower, max, upper, rule } of CLAMP_THRESHOLD_VECTORS) {
            await it(`${JSON.stringify(params)} → ${lower}/${max}/${upper} — ${rule}`, () => {
                expect(clampThresholds(params)).toStrictEqual({ lower, max, upper });
            });
        }

        await it('ships the libadwaita property defaults, not a renderer constant', () => {
            expect(ADW_CLAMP_DEFAULTS.maximumSize).toBe(600);
            expect(ADW_CLAMP_DEFAULTS.tighteningThreshold).toBe(400);
        });
    });

    await describe('clampChildSize (child_size_from_clamp)', async () => {
        for (const { forSize, params, childSize, rule } of CLAMP_CHILD_SIZE_VECTORS) {
            await it(`for_size ${forSize} → ${childSize} — ${rule}`, () => {
                expect(clampChildSize(forSize, params)).toBe(childSize);
            });
        }

        await it('never hands the child MORE than the available size', () => {
            // `view.width = maximumSize` hands a 360 DIP phone a 600 DIP child. One
            // assertion over the whole range, reporting every offender.
            const offenders: number[] = [];
            for (let available = 0; available <= 2000; available++) {
                if (clampChildSize(available, { ...ADW_CLAMP_DEFAULTS, childMin: 0, childNat: 1000 }) > available) {
                    offenders.push(available);
                }
            }
            expect(offenders).toStrictEqual([]);
        });

        await it('grows monotonically — widening the clamp never narrows the child', () => {
            const regressions: number[] = [];
            let previous = -1;
            for (let available = 0; available <= 2000; available++) {
                const size = clampChildSize(available, { ...ADW_CLAMP_DEFAULTS, childMin: 0, childNat: 1000 });
                if (size < previous) regressions.push(available);
                previous = size;
            }
            expect(regressions).toStrictEqual([]);
        });
    });

    await describe('clampSizeFromChild (clamp_size_from_child, the inverse ease)', async () => {
        for (const { childSize, params, clampSize, rule } of CLAMP_SIZE_FROM_CHILD_VECTORS) {
            await it(`child ${childSize} → clamp ${clampSize} — ${rule}`, () => {
                expect(clampSizeFromChild(childSize, params)).toBe(clampSize);
            });
        }

        await it('round-trips back to at least the child size it was asked for', () => {
            // The measure path must never report a size that would allocate the
            // child LESS than it asked for, which is why the two directions round
            // in opposite directions.
            const params = { ...ADW_CLAMP_DEFAULTS, childMin: 0, childNat: 1000 };
            const short: number[] = [];
            for (let child = 0; child <= 600; child++) {
                if (clampChildSize(clampSizeFromChild(child, params), params) < child) short.push(child);
            }
            expect(short).toStrictEqual([]);
        });
    });

    await describe('clampAllocate (adw_clamp_layout_allocate)', async () => {
        for (const vector of CLAMP_ALLOCATE_VECTORS) {
            const { availableSize, params, rule, ...expected } = vector;
            await it(`${availableSize}px available → ${expected.sizeClass} — ${rule}`, () => {
                expect(clampAllocate(availableSize, params)).toStrictEqual(expected);
            });
        }

        await it('declares every class it can stamp, so a renderer can clear them all', () => {
            // A derived class missing from the list is one no renderer ever removes: it
            // sticks to the child through every later pass.
            const produced = new Set(CLAMP_ALLOCATE_VECTORS.map((v) => v.sizeClass));
            for (const cls of produced) expect(ADW_CLAMP_SIZE_CLASSES.includes(cls)).toBe(true);
            expect(ADW_CLAMP_SIZE_CLASSES).toStrictEqual(['small', 'medium', 'large']);
        });

        await it('centres the child, so the two margins differ by at most a pixel', () => {
            const params = { ...ADW_CLAMP_DEFAULTS, childMin: 0, childNat: 1000 };
            for (const available of [301, 701, 1001, 1501]) {
                const { childSize, offset } = clampAllocate(available, params);
                const trailing = available - childSize - offset;
                expect(trailing - offset <= 1 && trailing >= offset).toBe(true);
            }
        });
    });

    await describe('normalizeClampSize (g_param_spec_int range)', async () => {
        for (const { value, fallback, size, rule } of CLAMP_PROPERTY_VECTORS) {
            await it(`${JSON.stringify(value ?? null)} → ${size} — ${rule}`, () => {
                expect(normalizeClampSize(value, fallback)).toBe(size);
            });
        }
    });

    await describe('toolbarViewAllocate (adw_toolbar_view_size_allocate)', async () => {
        for (const vector of TOOLBAR_VIEW_ALLOCATE_VECTORS) {
            const { input, rule, ...expected } = vector;
            await it(`${input.height}px view → bars ${expected.topBarHeight}/${expected.bottomBarHeight} — ${rule}`, () => {
                expect(toolbarViewAllocate(input)).toStrictEqual(expected);
            });
        }

        await it('keeps the three slots inside the view even when it is over-constrained', () => {
            // GLib CLAMP tests the HIGH bound first, which is what keeps the bars
            // whole and lets the CONTENT go short instead of the layout overflowing.
            const { topBarHeight, bottomBarHeight, contentHeight, contentOffset } = toolbarViewAllocate({
                height: 100,
                topMin: 46,
                topNat: 46,
                bottomMin: 30,
                bottomNat: 30,
                contentMin: 200,
                extendContentToTopEdge: false,
                extendContentToBottomEdge: false,
            });
            expect(contentOffset + contentHeight + bottomBarHeight).toBe(100);
            expect(topBarHeight).toBe(contentOffset);
        });
    });

    await describe('toolbarViewMeasure (adw_toolbar_view_measure)', async () => {
        for (const { input, minimum, natural, rule } of TOOLBAR_VIEW_MEASURE_VECTORS) {
            await it(`${input.orientation} → ${minimum}/${natural} — ${rule}`, () => {
                expect(toolbarViewMeasure(input)).toStrictEqual({ minimum, natural });
            });
        }
    });

    await describe('toolbarViewContentForSize (the height-for-width branch)', async () => {
        for (const { forSize, input, forSizeMin, forSizeNat, rule } of TOOLBAR_VIEW_CONTENT_FOR_SIZE_VECTORS) {
            await it(`for_size ${forSize} → ${forSizeMin}/${forSizeNat} — ${rule}`, () => {
                expect(toolbarViewContentForSize(forSize, input)).toStrictEqual({ forSizeMin, forSizeNat });
            });
        }
    });

    await describe('toolbarViewClasses (update_undershoots + the style setters)', async () => {
        for (const { input, view, topBar, bottomBar, rule } of TOOLBAR_VIEW_CLASS_VECTORS) {
            await it(`${input.topBarStyle}/${input.bottomBarStyle} → [${view.join(' ')}] — ${rule}`, () => {
                expect(toolbarViewClasses(input)).toStrictEqual({
                    view: [...view],
                    topBar: [...topBar],
                    bottomBar: [...bottomBar],
                });
            });
        }

        await it('ships the libadwaita property defaults', () => {
            expect(ADW_TOOLBAR_VIEW_DEFAULTS.topBarStyle).toBe('flat');
            expect(ADW_TOOLBAR_VIEW_DEFAULTS.bottomBarStyle).toBe('flat');
            expect(ADW_TOOLBAR_VIEW_DEFAULTS.extendContentToTopEdge).toBe(false);
            expect(ADW_TOOLBAR_VIEW_DEFAULTS.extendContentToBottomEdge).toBe(false);
        });

        await it('declares every class it can derive, so a renderer can clear them all', () => {
            // Same mechanism as the clamp's: an undeclared class is one no
            // renderer removes, so a raised bar would stay raised after going flat.
            for (const { view, topBar, bottomBar } of TOOLBAR_VIEW_CLASS_VECTORS) {
                for (const cls of view) expect(ADW_TOOLBAR_VIEW_CLASSES.includes(cls)).toBe(true);
                for (const cls of [...topBar, ...bottomBar]) {
                    expect(ADW_TOOLBAR_BAR_CLASSES.includes(cls)).toBe(true);
                }
            }
            expect(ADW_TOOLBAR_VIEW_CLASSES).toStrictEqual(['undershoot-top', 'undershoot-bottom']);
            expect(ADW_TOOLBAR_BAR_CLASSES).toStrictEqual(['raised', 'border']);
        });

        await it('maps the enum onto the stylesheet classes', () => {
            expect(toolbarBarStyleClasses('flat')).toStrictEqual([]);
            expect(toolbarBarStyleClasses('raised')).toStrictEqual(['raised']);
            expect(toolbarBarStyleClasses('raised-border')).toStrictEqual(['raised', 'border']);
        });

        await it('falls back to flat for a value the enum does not contain', () => {
            expect(parseToolbarStyle('raised')).toBe('raised');
            expect(parseToolbarStyle('raised-border')).toBe('raised-border');
            expect(parseToolbarStyle('flat')).toBe('flat');
            expect(parseToolbarStyle('shadowed')).toBe('flat');
            expect(parseToolbarStyle(null)).toBe('flat');
        });
    });

    await describe('spinnerGeometry (AdwSpinnerPaintable ring)', async () => {
        for (const vector of SPINNER_GEOMETRY_VECTORS) {
            const { width, height, legacyWebLineWidth, rule, ...expected } = vector;
            await it(`${width}×${height} → ${expected.diameter}px ring, ${expected.lineWidth}px stroke — ${rule}`, () => {
                expect(spinnerGeometry(width, height)).toStrictEqual(expected);
            });

            if (legacyWebLineWidth !== null) {
                await it(`${width}×${height}: the old browser stroke (${legacyWebLineWidth}px) is judged here`, () => {
                    // Records which sizes `max(2, round(size / 12))` got wrong, so
                    // a "simplification" back to it fails on this line.
                    const matched = legacyWebLineWidth === spinnerGeometry(width, height).lineWidth;
                    expect(matched).toBe(width === 16);
                });
            }
        }

        await it('never draws a ring wider than the 64px maximum', () => {
            const offenders: number[] = [];
            for (let size = 1; size <= 400; size++) {
                if (spinnerGeometry(size, size).diameter > ADW_SPINNER_MAX_SIZE) offenders.push(size);
            }
            expect(offenders).toStrictEqual([]);
        });

        await it('keeps the ring inside the box it was given', () => {
            const offenders: number[] = [];
            for (let size = 1; size <= 400; size++) {
                if (spinnerGeometry(size, size).diameter > size) offenders.push(size);
            }
            expect(offenders).toStrictEqual([]);
        });
    });

    await describe('resolveSpinnerSize (adw_spinner_measure minimum = natural)', async () => {
        for (const { value, size, rule } of SPINNER_SIZE_VECTORS) {
            await it(`${JSON.stringify(value ?? null)} → ${size} — ${rule}`, () => {
                expect(resolveSpinnerSize(value)).toBe(size);
            });
        }

        await it('takes its floor from the measured minimum, not an invented default', () => {
            expect(ADW_SPINNER_MIN_SIZE).toBe(16);
            expect(ADW_SPINNER_MAX_SIZE).toBe(64);
            // The two constants the renderers used to carry instead.
            expect(resolveSpinnerSize(null)).not.toBe(24);
            expect(resolveSpinnerSize(null)).not.toBe(32);
        });
    });
};
