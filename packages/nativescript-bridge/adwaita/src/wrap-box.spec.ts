// Wrap-box spacing for NativeScript, against the shared conformance vectors.
//
// The widget class cannot be imported here (`extends WrapLayout` evaluates the
// bare `@nativescript/core` specifier at module-eval, which is unresolvable off
// NativeScript), so this suite drives `widgets/wrap-box-layout.ts` — the SHIPPING
// pure half the widget itself calls, never a transcription of it.
//
// What it holds the port to: the property contract libadwaita declares and the
// port invented its own answers to. Both spacings defaulted to 6 DIPs against a
// C default of 0 (adw-wrap-box.c:285-287, :393-395), so the same markup was
// looser on a phone than in the browser — and with the equally invented
// `.adw-wrap-box { margin: 6 }` in the theme, an EMPTY wrap box already occupied
// 12 DIPs. A negative value was passed straight through where C clamps it, and
// the clamp is what makes the "did anything change" comparison meaningful: on
// this port that comparison decides whether every child's margin is rewritten.
//
// The justify / align / justify-last-line table in the same conformance file is
// NOT driven from here, and deliberately: NS `WrapLayout` exposes `orientation`,
// `itemWidth` and `itemHeight` and nothing else, so there is no knob for the
// decision to land on and a resolver on this side would have no consumer. The
// browser suite drives those rows.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_WRAP_BOX_DEFAULT_SPACING,
    WRAP_BOX_SPACING_NOTIFY_VECTORS,
    WRAP_BOX_SPACING_VECTORS,
} from '@gjsify/adwaita-core/conformance';

import {
    DEFAULT_WRAP_BOX_SPACING,
    normalizeWrapBoxSpacing,
    wrapBoxChildMargin,
    wrapBoxSpacingChanges,
} from './widgets/wrap-box-layout.js';

/** A vector value as it reads in a test name (`JSON.stringify` flattens NaN to null). */
function label(value: number | string | null): string {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

export default async () => {
    await describe('AdwWrapBox spacing defaults (Adw.WrapBox properties)', async () => {
        await it('takes the default from libadwaita, not from a local constant', () => {
            expect(DEFAULT_WRAP_BOX_SPACING).toBe(0);
            expect(DEFAULT_WRAP_BOX_SPACING).toBe(ADW_WRAP_BOX_DEFAULT_SPACING);
        });

        await it('a box at the defaults adds nothing to its children', () => {
            expect(wrapBoxChildMargin(DEFAULT_WRAP_BOX_SPACING, DEFAULT_WRAP_BOX_SPACING)).toBe('0 0 0 0');
        });
    });

    await describe('normalizeWrapBoxSpacing (adw_wrap_box_set_child_spacing)', async () => {
        for (const vector of WRAP_BOX_SPACING_VECTORS) {
            await it(`${label(vector.value)} → ${vector.spacing}: ${vector.rule}`, () => {
                expect(normalizeWrapBoxSpacing(vector.value)).toBe(vector.spacing);
            });
        }
    });

    await describe('wrapBoxSpacingChanges (the early return at adw-wrap-box.c:592-593)', async () => {
        for (const vector of WRAP_BOX_SPACING_NOTIFY_VECTORS) {
            await it(`${vector.from} → ${label(vector.value)} = ${vector.notifies}: ${vector.rule}`, () => {
                expect(wrapBoxSpacingChanges(vector.from, vector.value)).toBe(vector.notifies);
            });
        }
    });

    await describe('wrapBoxChildMargin (WrapLayout has no gap property)', async () => {
        await it('splits each gap across the two facing edges, so neighbours add up to it', () => {
            // NS shorthand is `top right bottom left`: the line spacing goes on
            // the block edges, the child spacing on the inline ones.
            expect(wrapBoxChildMargin(12, 8)).toBe('4 6 4 6');
        });

        await it('normalises through the same clamp, so a negative spacing cannot reach a layout', () => {
            expect(wrapBoxChildMargin(-12, -8)).toBe('0 0 0 0');
            expect(wrapBoxChildMargin(Number.NaN, 8)).toBe('4 0 4 0');
        });

        await it('halves an odd spacing rather than rounding it away', () => {
            expect(wrapBoxChildMargin(5, 0)).toBe('0 2.5 0 2.5');
        });
    });
};
