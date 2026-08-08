// Wrap-box specs — driven by the shared conformance vectors, so this suite and
// the two renderer suites assert the SAME tables.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_WRAP_BOX_DEFAULT_ALIGN,
    ADW_WRAP_BOX_DEFAULT_JUSTIFY,
    ADW_WRAP_BOX_DEFAULT_JUSTIFY_LAST_LINE,
    ADW_WRAP_BOX_DEFAULT_LENGTH_UNIT,
    ADW_WRAP_BOX_DEFAULT_PACK_DIRECTION,
    ADW_WRAP_BOX_DEFAULT_SPACING,
    ADW_WRAP_BOX_DEFAULT_WRAP_POLICY,
    ADW_WRAP_BOX_NATURAL_LINE_LENGTH_UNSET,
    normalizeNaturalLineLength,
    normalizeWrapBoxAlign,
    normalizeWrapBoxJustify,
    normalizeWrapBoxLengthUnit,
    normalizeWrapBoxPackDirection,
    normalizeWrapBoxSpacing,
    normalizeWrapPolicy,
    resolveWrapBoxChildOrder,
    resolveWrapBoxLine,
    wrapBoxLengthToPx,
    wrapPolicyFlexShrink,
} from './wrap-box.js';
import {
    WRAP_BOX_CHILD_ORDER_VECTORS,
    WRAP_BOX_LENGTH_VECTORS,
    WRAP_BOX_LINE_VECTORS,
    WRAP_BOX_NATURAL_LENGTH_VECTORS,
    WRAP_BOX_NOTIFY_PROPERTIES,
    WRAP_BOX_POLICY_VECTORS,
    WRAP_BOX_SPACING_NOTIFY_VECTORS,
    WRAP_BOX_SPACING_VECTORS,
} from './conformance/wrap-box.js';

export default async () => {
    await describe('resolveWrapBoxLine (the justify/align/last-line decision)', async () => {
        for (const vector of WRAP_BOX_LINE_VECTORS) {
            const { justify, justifyLastLine, align, lastLine, childrenInLine, layout, rule } = vector;
            const label = `${justify}${justifyLastLine ? '+last' : ''} align=${align} ${
                lastLine ? 'last' : 'mid'
            } line ×${childrenInLine}`;
            await it(`${label} — ${rule}`, () => {
                expect(resolveWrapBoxLine({ justify, justifyLastLine, align, lastLine, childrenInLine })).toStrictEqual(
                    layout,
                );
            });
        }

        await it('every mode grows EITHER the children or the gaps, never both', () => {
            const both = WRAP_BOX_LINE_VECTORS.filter((v) => v.layout.growChildren && v.layout.growGaps);
            expect(both).toHaveLength(0);
        });

        await it('a justified line always reports align 0 — C never computes length_delta there', () => {
            const leaked = WRAP_BOX_LINE_VECTORS.filter((v) => v.layout.justify !== 'none' && v.layout.align !== 0);
            expect(leaked).toHaveLength(0);
        });
    });

    await describe('property defaults (adw-wrap-box.c pspecs)', async () => {
        await it('spacing 0, align 0, justify none, justify-last-line false', () => {
            expect(ADW_WRAP_BOX_DEFAULT_SPACING).toBe(0);
            expect(ADW_WRAP_BOX_DEFAULT_ALIGN).toBe(0);
            expect(ADW_WRAP_BOX_DEFAULT_JUSTIFY).toBe('none');
            expect(ADW_WRAP_BOX_DEFAULT_JUSTIFY_LAST_LINE).toBe(false);
        });

        await it('wrap-policy natural, pack-direction start-to-end, unit px, natural-line-length -1', () => {
            expect(ADW_WRAP_BOX_DEFAULT_WRAP_POLICY).toBe('natural');
            expect(ADW_WRAP_BOX_DEFAULT_PACK_DIRECTION).toBe('start-to-end');
            expect(ADW_WRAP_BOX_DEFAULT_LENGTH_UNIT).toBe('px');
            expect(ADW_WRAP_BOX_NATURAL_LINE_LENGTH_UNSET).toBe(-1);
        });

        await it('the unit default is px, NOT the split views’ sp — the same helper, two defaults', () => {
            expect(normalizeWrapBoxLengthUnit(undefined)).toBe('px');
            expect(normalizeWrapBoxLengthUnit('sp')).toBe('sp');
            expect(normalizeWrapBoxLengthUnit('rem')).toBe('px');
        });
    });

    await describe('normalizeWrapBoxSpacing (the negative clamp)', async () => {
        for (const { value, spacing, rule } of WRAP_BOX_SPACING_VECTORS) {
            await it(`${JSON.stringify(value)} → ${spacing} — ${rule}`, () => {
                expect(normalizeWrapBoxSpacing(value)).toBe(spacing);
            });
        }
    });

    await describe('the spacing setter early return (adw-wrap-box.c:592-593)', async () => {
        for (const { from, value, notifies, rule } of WRAP_BOX_SPACING_NOTIFY_VECTORS) {
            await it(`${from} ← ${JSON.stringify(value)} ${notifies ? 'notifies' : 'is silent'} — ${rule}`, () => {
                expect(normalizeWrapBoxSpacing(value) !== normalizeWrapBoxSpacing(from)).toBe(notifies);
            });
        }
    });

    await describe('normalizeWrapBoxAlign (g_param_spec_float 0..1)', async () => {
        await it('clamps into the declared range rather than passing the value on', () => {
            expect(normalizeWrapBoxAlign(0.25)).toBe(0.25);
            expect(normalizeWrapBoxAlign(-2)).toBe(0);
            expect(normalizeWrapBoxAlign(7)).toBe(1);
            expect(normalizeWrapBoxAlign('0.5')).toBe(0.5);
            expect(normalizeWrapBoxAlign('half')).toBe(0);
            expect(normalizeWrapBoxAlign(null)).toBe(0);
        });
    });

    await describe('normalizeWrapBoxJustify / normalizeWrapBoxPackDirection (enum gates)', async () => {
        await it('an out-of-enum value leaves the property at its default', () => {
            expect(normalizeWrapBoxJustify('spread')).toBe('spread');
            expect(normalizeWrapBoxJustify('Spread')).toBe('none');
            expect(normalizeWrapBoxJustify(null)).toBe('none');
            expect(normalizeWrapBoxPackDirection('end-to-start')).toBe('end-to-start');
            expect(normalizeWrapBoxPackDirection('reverse')).toBe('start-to-end');
        });
    });

    await describe('wrap-policy (adw-wrap-box.c:476-495)', async () => {
        for (const { value, policy, flexShrink, rule } of WRAP_BOX_POLICY_VECTORS) {
            await it(`${JSON.stringify(value)} → ${policy} / flex-shrink ${flexShrink} — ${rule}`, () => {
                expect(normalizeWrapPolicy(value)).toBe(policy);
                expect(wrapPolicyFlexShrink(policy)).toBe(flexShrink);
            });
        }

        await it('the DEFAULT forbids shrinking, which is the opposite of the CSS default', () => {
            expect(wrapPolicyFlexShrink(normalizeWrapPolicy(undefined))).toBe(0);
        });
    });

    await describe('natural-line-length (g_param_spec_int -1..G_MAXINT, default -1)', async () => {
        for (const { value, length, rule } of WRAP_BOX_NATURAL_LENGTH_VECTORS) {
            await it(`${JSON.stringify(value)} → ${length} — ${rule}`, () => {
                expect(normalizeNaturalLineLength(value)).toBe(length);
            });
        }
    });

    await describe('wrapBoxLengthToPx (adw_length_unit_to_px, px default)', async () => {
        for (const { value, unit, dpi, px, rule } of WRAP_BOX_LENGTH_VECTORS) {
            await it(`${value}${String(unit)} @${dpi}dpi → ${px}px — ${rule}`, () => {
                expect(wrapBoxLengthToPx(value, normalizeWrapBoxLengthUnit(unit), dpi)).toBe(px);
            });
        }
    });

    await describe('resolveWrapBoxChildOrder (insert/reorder after, NULL = FIRST)', async () => {
        for (const { op, children, child, sibling, result, rule } of WRAP_BOX_CHILD_ORDER_VECTORS) {
            const label = `${op} ${child} after ${sibling ?? 'NULL'} in [${children.join(',')}]`;
            await it(`${label} → ${result ? `[${result.join(',')}]` : 'refused'} — ${rule}`, () => {
                const next = resolveWrapBoxChildOrder({ children, child, sibling, op });
                if (result === null) expect(next).toBe(null);
                else expect(next).toStrictEqual([...result]);
            });
        }

        await it('never mutates the array it was handed', () => {
            const children = ['a', 'b', 'c'];
            resolveWrapBoxChildOrder({ children, child: 'd', sibling: 'b', op: 'insert-after' });
            expect(children).toStrictEqual(['a', 'b', 'c']);
        });
    });

    await describe('the notify roster (adw-wrap-box.c:284-497)', async () => {
        await it('names all fourteen properties an Adw.WrapBox emits notify:: for', () => {
            expect(WRAP_BOX_NOTIFY_PROPERTIES).toHaveLength(14);
            expect(new Set(WRAP_BOX_NOTIFY_PROPERTIES).size).toBe(14);
        });

        await it('includes the OVERRIDDEN orientation, which is not one of the installed pspecs', () => {
            expect(WRAP_BOX_NOTIFY_PROPERTIES).toContain('orientation');
        });
    });
};
