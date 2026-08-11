// Wrap-box layout for NativeScript, against the shared conformance vectors.
//
// The widget class cannot be imported here (`extends FlexboxLayout` evaluates the bare
// `@nativescript/core` specifier at module-eval), so this suite drives
// `widgets/wrap-box-layout.ts` — the SHIPPING pure half the widget calls.
//
// Invariants held: both spacings default to libadwaita's 0, a negative value is
// CLAMPED (which is what makes the "did anything change" comparison meaningful — it
// decides whether every child's margin is rewritten), and the justify / align /
// justify-last-line table resolves through `@gjsify/adwaita-core`, so this port and the
// browser element land the same decision.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_WRAP_BOX_DEFAULT_SPACING,
    normalizeNaturalLineLength,
    normalizeWrapBoxLengthUnit,
    normalizeWrapPolicy,
    resolveWrapBoxChildOrder,
    wrapBoxLengthToPx,
} from '@gjsify/adwaita-core';
import {
    WRAP_BOX_CHILD_ORDER_VECTORS,
    WRAP_BOX_LENGTH_VECTORS,
    WRAP_BOX_LINE_VECTORS,
    WRAP_BOX_NATURAL_LENGTH_VECTORS,
    WRAP_BOX_POLICY_VECTORS,
    WRAP_BOX_SPACING_NOTIFY_VECTORS,
    WRAP_BOX_SPACING_VECTORS,
} from '@gjsify/adwaita-core/conformance';

import {
    DEFAULT_WRAP_BOX_SPACING,
    normalizeWrapBoxSpacing,
    wrapBoxChildFlex,
    wrapBoxChildMargin,
    wrapBoxFlexStyle,
    wrapBoxSpacingChanges,
    type WrapBoxFlexInput,
} from './widgets/wrap-box-layout.js';

/** A vector value as it reads in a test name (`JSON.stringify` flattens NaN to null). */
function label(value: unknown): string {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** The property defaults a fresh `AdwWrapBox` holds, so a row states only what it varies. */
function props(overrides: Partial<WrapBoxFlexInput> = {}): WrapBoxFlexInput {
    return {
        orientation: 'horizontal',
        packDirection: 'start-to-end',
        wrapReverse: false,
        justify: 'none',
        justifyLastLine: false,
        align: 0,
        lineHomogeneous: false,
        wrapPolicy: 'natural',
        ...overrides,
    };
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

    await describe('wrapBoxChildMargin (NativeScript has no gap property)', async () => {
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

    await describe('wrapBoxFlexStyle: the CONTAINER half of the line decision', async () => {
        // `FlexboxLayout`, like a flex container, has ONE `justifyContent` for
        // every line, so only the complete-line rows land here.
        for (const vector of WRAP_BOX_LINE_VECTORS.filter((v) => !v.lastLine && v.childrenInLine > 1)) {
            const { justify, justifyLastLine, align, layout, rule } = vector;
            await it(`${justify} align=${align} → ${layout.growGaps ? 'space-between' : 'align'} — ${rule}`, () => {
                const style = wrapBoxFlexStyle(props({ justify, justifyLastLine, align }));
                expect(style.justifyContent === 'space-between').toBe(layout.growGaps);
                expect(style.childFlexGrow).toBe(layout.growChildren ? 1 : 0);
            });
        }

        await it('align lands on the MAIN axis — justifyContent, never alignItems', () => {
            expect(wrapBoxFlexStyle(props({ align: 0 })).justifyContent).toBe('flex-start');
            expect(wrapBoxFlexStyle(props({ align: 0.5 })).justifyContent).toBe('center');
            expect(wrapBoxFlexStyle(props({ align: 1 })).justifyContent).toBe('flex-end');
        });

        await it('fill grows the children where spread grows the gaps', () => {
            expect(wrapBoxFlexStyle(props({ justify: 'fill' }))).toMatchObject({
                justifyContent: 'flex-start',
                childFlexGrow: 1,
            });
            expect(wrapBoxFlexStyle(props({ justify: 'spread' }))).toMatchObject({
                justifyContent: 'space-between',
                childFlexGrow: 0,
            });
        });

        await it('orientation and pack-direction pick the flexDirection between them', () => {
            expect(wrapBoxFlexStyle(props()).flexDirection).toBe('row');
            expect(wrapBoxFlexStyle(props({ packDirection: 'end-to-start' })).flexDirection).toBe('row-reverse');
            expect(wrapBoxFlexStyle(props({ orientation: 'vertical' })).flexDirection).toBe('column');
            expect(
                wrapBoxFlexStyle(props({ orientation: 'vertical', packDirection: 'end-to-start' })).flexDirection,
            ).toBe('column-reverse');
        });

        await it('wrap-reverse and line-homogeneous reach their own knobs', () => {
            expect(wrapBoxFlexStyle(props()).flexWrap).toBe('wrap');
            expect(wrapBoxFlexStyle(props({ wrapReverse: true })).flexWrap).toBe('wrap-reverse');
            expect(wrapBoxFlexStyle(props()).alignContent).toBe('flex-start');
            expect(wrapBoxFlexStyle(props({ lineHomogeneous: true })).alignContent).toBe('stretch');
        });
    });

    await describe('wrapBoxChildFlex: the PER-CHILD half a container knob cannot carry', async () => {
        // A box's own CHILD COUNT — the most either renderer knows without a
        // layout pass — names exactly two of the table's four shapes: one child
        // (alone, on the box's single and therefore final line) and several
        // children (at least one complete line). The other two need to know how
        // the children actually broke: a FINAL line with several children in it,
        // and a lone child on a line that is NOT the final one. Neither renderer
        // can reach those — the browser element has the same limit and says so,
        // since flexbox cannot express "every line but the last" — so they are
        // left out rather than asserted against a count that does not mean them.
        const childCountFor = (v: (typeof WRAP_BOX_LINE_VECTORS)[number]) => {
            if (v.lastLine && v.childrenInLine === 1) return 1;
            if (!v.lastLine && v.childrenInLine > 1) return 2;
            return 0;
        };
        for (const vector of WRAP_BOX_LINE_VECTORS.filter((v) => childCountFor(v) > 0)) {
            const { justify, justifyLastLine, align, childrenInLine, layout, rule } = vector;
            await it(`${justify}${justifyLastLine ? '+last' : ''} ×${childrenInLine} — ${rule}`, () => {
                const flex = wrapBoxChildFlex(props({ justify, justifyLastLine, align }), childCountFor(vector));
                expect(flex.flexGrow).toBe(layout.growChildren ? 1 : 0);
            });
        }

        await it('names what a child count cannot reach, so the omission cannot grow silently', () => {
            const undrivable = WRAP_BOX_LINE_VECTORS.filter((v) => childCountFor(v) === 0);
            for (const vector of undrivable) {
                expect(vector.lastLine ? vector.childrenInLine > 1 : vector.childrenInLine === 1).toBe(true);
            }
            expect(undrivable).toHaveLength(8);
            expect(WRAP_BOX_LINE_VECTORS).toHaveLength(16);
        });

        await it('a LONE child in a spread box is stretched, not spread (n_children > 1)', () => {
            expect(wrapBoxChildFlex(props({ justify: 'spread', justifyLastLine: true }), 1).flexGrow).toBe(1);
            expect(wrapBoxChildFlex(props({ justify: 'spread', justifyLastLine: true }), 3).flexGrow).toBe(0);
        });

        await it('the DEFAULT single-child box justifies nothing — its one line is the last', () => {
            expect(wrapBoxChildFlex(props({ justify: 'fill' }), 1).flexGrow).toBe(0);
            expect(wrapBoxChildFlex(props({ justify: 'fill', justifyLastLine: true }), 1).flexGrow).toBe(1);
        });
    });

    await describe('wrap-policy (adw-wrap-box.c:476-495)', async () => {
        for (const { value, policy, flexShrink, rule } of WRAP_BOX_POLICY_VECTORS) {
            await it(`${label(value)} → ${policy} / shrink ${flexShrink} — ${rule}`, () => {
                const resolved = normalizeWrapPolicy(value);
                expect(resolved).toBe(policy);
                expect(wrapBoxFlexStyle(props({ wrapPolicy: resolved })).childFlexShrink).toBe(flexShrink);
            });
        }

        await it('a fresh box forbids shrinking — the CSS default is the other one', () => {
            expect(wrapBoxFlexStyle(props()).childFlexShrink).toBe(0);
        });
    });

    await describe('length units (the three the port had none of)', async () => {
        for (const { value, unit, dpi, px, rule } of WRAP_BOX_LENGTH_VECTORS) {
            await it(`${value}${String(unit)} @${dpi}dpi → ${px} — ${rule}`, () => {
                expect(wrapBoxLengthToPx(value, normalizeWrapBoxLengthUnit(unit), dpi)).toBe(px);
            });
        }

        await it('a spacing in sp reaches the child margin already converted', () => {
            // 12sp at 144dpi is 18px, and half of it lands on each facing edge.
            expect(wrapBoxChildMargin(wrapBoxLengthToPx(12, 'sp', 144), 0)).toBe('0 9 0 9');
        });
    });

    await describe('natural-line-length (carried, not applied on NativeScript)', async () => {
        for (const { value, length, rule } of WRAP_BOX_NATURAL_LENGTH_VECTORS) {
            await it(`${label(value)} → ${length} — ${rule}`, () => {
                expect(normalizeNaturalLineLength(value)).toBe(length);
            });
        }
    });

    await describe('resolveWrapBoxChildOrder (insert/reorder after, NULL = FIRST)', async () => {
        for (const { op, children, child, sibling, result, rule } of WRAP_BOX_CHILD_ORDER_VECTORS) {
            const name = `${op} ${child} after ${sibling ?? 'NULL'} in [${children.join(',')}]`;
            await it(`${name} — ${rule}`, () => {
                const next = resolveWrapBoxChildOrder({ children, child, sibling, op });
                if (result === null) expect(next).toBe(null);
                else expect(next).toStrictEqual([...result]);
            });
        }
    });
};
