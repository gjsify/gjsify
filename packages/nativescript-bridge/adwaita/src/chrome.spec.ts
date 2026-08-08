// Window chrome for NativeScript, against the shared conformance vectors.
//
// The widget classes cannot be imported here (`extends GridLayout` evaluates the
// bare `@nativescript/core` specifier at module-eval, which is unresolvable off
// NativeScript), so this suite drives `widgets/chrome.ts` — the SHIPPING pure
// half the widgets themselves call, never a transcription of it.
//
// What it holds the port to: the clamp used to write `view.width = maximumSize`,
// and an NS `width` is an EXACT size, so a 360 DIP phone was handed a 600 DIP
// child; the spinner defaulted to 32 and applied `size = 200` unclamped; the
// toolbar view had none of libadwaita's four derived style classes. All three now
// answer through `@gjsify/adwaita-core`, and these are the same rows the browser
// suite asserts.

import { describe, expect, it } from '@gjsify/unit';

import { ADW_SPINNER_MIN_SIZE, spinnerGeometry } from '@gjsify/adwaita-core';
import {
    CLAMP_ALLOCATE_VECTORS,
    CLAMP_PROPERTY_VECTORS,
    SPINNER_GEOMETRY_VECTORS,
    SPINNER_SIZE_VECTORS,
    TOOLBAR_VIEW_CLASS_VECTORS,
} from '@gjsify/adwaita-core/conformance';

import {
    DEFAULT_CLAMP_MAX_SIZE,
    DEFAULT_CLAMP_TIGHTENING_THRESHOLD,
    DEFAULT_SPINNER_SIZE,
    clampAllocationFor,
    clampChildClassName,
    defaultClampProps,
    defaultToolbarViewProps,
    normalizeClampProp,
    replaceClasses,
    spinnerDiameter,
    toolbarViewClassNames,
} from './widgets/chrome.js';

/** The classes `AdwToolbarView` starts with, before anything is derived. */
const BASE_CLASSES = {
    view: 'adw-toolbar-view',
    topBar: 'adw-toolbar-view-top',
    bottomBar: 'adw-toolbar-view-bottom',
};

/** The classes on a NativeScript `className` string, as a set. */
function classSet(className: string): Set<string> {
    return new Set(className.split(/\s+/).filter((token) => token.length > 0));
}

export default async () => {
    await describe('defaultClampProps (Adw.Clamp properties)', async () => {
        await it('takes both from libadwaita, not from a local constant', () => {
            expect(defaultClampProps()).toStrictEqual({ maximumSize: 600, tighteningThreshold: 400 });
            expect(DEFAULT_CLAMP_MAX_SIZE).toBe(600);
            expect(DEFAULT_CLAMP_TIGHTENING_THRESHOLD).toBe(400);
        });

        await it("hands out a fresh object, so one clamp cannot edit another's", () => {
            const first = defaultClampProps();
            first.maximumSize = 999;
            expect(defaultClampProps().maximumSize).toBe(600);
        });
    });

    await describe('clampAllocationFor (AdwClampLayout conformance vectors)', async () => {
        // NativeScript cannot report a child's measured minimum before layout, so
        // only the rows that pass a zero child minimum describe this widget.
        const vectors = CLAMP_ALLOCATE_VECTORS.filter((v) => v.params.childMin === 0);

        for (const { availableSize, params, childSize, sizeClass, rule } of vectors) {
            await it(`${availableSize} DIP available → a ${childSize} DIP ${sizeClass} child — ${rule}`, () => {
                expect(
                    clampAllocationFor(availableSize, {
                        maximumSize: params.maximumSize,
                        tighteningThreshold: params.tighteningThreshold,
                    }),
                ).toStrictEqual({ width: childSize, sizeClass });
            });
        }

        await it('gives a narrow phone ALL of its width, never the maximum', () => {
            // The bug this replaces: `view.width = 600` on a 360 DIP screen.
            const props = defaultClampProps();
            expect(clampAllocationFor(360, props).width).toBe(360);
            // The 411 DIP emulator the split-view suite runs against (1080px at
            // density 420) is just past the 400 threshold, so it loses exactly one
            // pixel to the easing — the curve starts flat, it does not step.
            expect(clampAllocationFor(411, props).width).toBe(410);
            expect(clampAllocationFor(800, props).width).toBe(592);
        });

        await it('leaves the child unconstrained until the first layout pass', () => {
            // NativeScript reports a zero size before it has laid the view out;
            // pinning a width derived from that would collapse the child.
            const props = defaultClampProps();
            expect(clampAllocationFor(0, props)).toStrictEqual({ width: 'auto', sizeClass: null });
            expect(clampAllocationFor(-1, props)).toStrictEqual({ width: 'auto', sizeClass: null });
        });

        await it('responds to tighteningThreshold, which the widget did not even have', () => {
            const tightened = clampAllocationFor(700, { maximumSize: 600, tighteningThreshold: 400 });
            const untightened = clampAllocationFor(700, { maximumSize: 600, tighteningThreshold: 800 });
            expect(tightened.width).toBe(575);
            expect(untightened.width).toBe(600);
        });
    });

    await describe('normalizeClampProp (g_param_spec_int range)', async () => {
        for (const { value, fallback, size, rule } of CLAMP_PROPERTY_VECTORS) {
            await it(`${JSON.stringify(value ?? null)} → ${size} — ${rule}`, () => {
                expect(normalizeClampProp(value, fallback)).toBe(size);
            });
        }

        await it('keeps a maximumSize of 0 instead of substituting the default', () => {
            // `Number.isFinite(value) && value > 0 ? value : DEFAULT` turned an
            // explicit 0 into 600, which is a different widget.
            expect(normalizeClampProp(0, DEFAULT_CLAMP_MAX_SIZE)).toBe(0);
            expect(clampAllocationFor(800, { maximumSize: 0, tighteningThreshold: 400 }).width).toBe(0);
        });
    });

    await describe('spinnerDiameter (Adw.Spinner sizing contract)', async () => {
        for (const { value, size, rule } of SPINNER_SIZE_VECTORS) {
            await it(`${JSON.stringify(value ?? null)} → a ${spinnerGeometry(size, size).diameter} DIP ring — ${rule}`, () => {
                expect(spinnerDiameter(value)).toBe(spinnerGeometry(size, size).diameter);
            });
        }

        for (const { width, height, diameter, rule } of SPINNER_GEOMETRY_VECTORS) {
            // The indicator fills its view, so only square, allocatable boxes
            // describe what a `size` assignment can produce.
            if (width !== height || width < ADW_SPINNER_MIN_SIZE) continue;

            await it(`size ${width} draws a ${diameter} DIP ring — ${rule}`, () => {
                expect(spinnerDiameter(width)).toBe(diameter);
            });
        }

        await it('defaults to the measured 16, not the invented 32', () => {
            expect(DEFAULT_SPINNER_SIZE).toBe(ADW_SPINNER_MIN_SIZE);
            expect(DEFAULT_SPINNER_SIZE).not.toBe(32);
            expect(spinnerDiameter(null)).toBe(16);
        });

        await it('caps an oversized request at 64 instead of applying it', () => {
            // `size = 200` used to produce a 200 DIP indicator.
            expect(spinnerDiameter(200)).toBe(64);
            expect(spinnerDiameter(1000)).toBe(64);
        });
    });

    await describe('toolbarViewClassNames (update_undershoots + the style setters)', async () => {
        for (const { input, view, topBar, bottomBar, rule } of TOOLBAR_VIEW_CLASS_VECTORS) {
            await it(`${input.topBarStyle}/${input.bottomBarStyle} → [${view.join(' ')}] — ${rule}`, () => {
                const names = toolbarViewClassNames(
                    BASE_CLASSES,
                    {
                        topBarStyle: input.topBarStyle,
                        bottomBarStyle: input.bottomBarStyle,
                        extendContentToTopEdge: input.extendContentToTopEdge,
                        extendContentToBottomEdge: input.extendContentToBottomEdge,
                    },
                    { topBarHeight: input.topBarHeight, bottomBarHeight: input.bottomBarHeight },
                );

                expect(classSet(names.view)).toStrictEqual(new Set([BASE_CLASSES.view, ...view]));
                expect(classSet(names.topBar)).toStrictEqual(new Set([BASE_CLASSES.topBar, ...topBar]));
                expect(classSet(names.bottomBar)).toStrictEqual(new Set([BASE_CLASSES.bottomBar, ...bottomBar]));
            });
        }

        await it('starts flat and unextended, like Adw.ToolbarView does', () => {
            expect(defaultToolbarViewProps()).toStrictEqual({
                topBarStyle: 'flat',
                bottomBarStyle: 'flat',
                extendContentToTopEdge: false,
                extendContentToBottomEdge: false,
            });
        });

        await it('takes a style class back off again instead of accumulating them', () => {
            // NS views carry a className STRING, so there is no `classList.toggle`
            // — the whole string is rewritten, and getting that wrong leaves
            // `raised border` on a bar that went back to flat.
            const props = defaultToolbarViewProps();
            const heights = { topBarHeight: 46, bottomBarHeight: 0 };
            const raised = toolbarViewClassNames(BASE_CLASSES, { ...props, topBarStyle: 'raised-border' }, heights);
            const flatAgain = toolbarViewClassNames({ ...BASE_CLASSES, topBar: raised.topBar }, props, heights);
            expect(classSet(raised.topBar)).toStrictEqual(new Set(['adw-toolbar-view-top', 'raised', 'border']));
            expect(classSet(flatAgain.topBar)).toStrictEqual(new Set(['adw-toolbar-view-top']));
        });

        await it('keeps a class the CONSUMER put on the view', () => {
            // The storybook appends `sb-sidebar-pane` to an AdwToolbarView; a
            // derivation composed from a fixed base would take it away again on
            // the next layout pass.
            const names = toolbarViewClassNames(
                { ...BASE_CLASSES, view: 'adw-toolbar-view sb-sidebar-pane' },
                defaultToolbarViewProps(),
                { topBarHeight: 46, bottomBarHeight: 0 },
            );
            expect(classSet(names.view)).toStrictEqual(
                new Set(['adw-toolbar-view', 'sb-sidebar-pane', 'undershoot-top']),
            );
        });
    });

    await describe('replaceClasses / clampChildClassName (the NS className string)', async () => {
        await it('swaps only what the widget manages', () => {
            expect(clampChildClassName('card', 'medium')).toBe('card medium');
            expect(clampChildClassName('card medium', 'large')).toBe('card large');
            expect(clampChildClassName('card large', null)).toBe('card');
        });

        await it('is idempotent, so repeated layout passes do not grow the string', () => {
            let className = 'card';
            for (let pass = 0; pass < 5; pass++) className = clampChildClassName(className, 'small');
            expect(className).toBe('card small');
        });

        await it('survives an empty or whitespace-only className', () => {
            expect(clampChildClassName('', 'small')).toBe('small');
            expect(clampChildClassName('   ', 'small')).toBe('small');
            expect(replaceClasses('card', ['small'], [])).toBe('card');
        });
    });
};
