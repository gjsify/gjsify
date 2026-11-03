// `px` in a GTK stylesheet, as NativeScript has to read it. GTK's `px` is a LOGICAL pixel; NativeScript's
// `12px` is a PHYSICAL one and a bare `12` is a dip, so the unit is dropped (`cssPxToDip`). The core
// and the NativeScript port (`Application.addCss` through `nativePlatformHost.setStyles`) are held to
// the same rows; the build-time twin is the PostCSS plugin of `@gjsify/nativescript-vite`.
//
// The rows that matter are the refusals: a conversion that reaches into a string, a `url()`, a comment
// or an identifier rewrites content that was never a length.

import type { ConstructHarness } from './constructs.js';

export interface CssLengthSubject {
    readonly name: string;
    readonly isOracle: boolean;
    /** The stylesheet as NativeScript is handed it. */
    toDip(css: string): string;
}

export const CSS_LENGTH_ROWS = [
    'length',
    'shorthand',
    'otherUnits',
    'untouched',
    'identifier',
    'customProperty',
] as const;

export type CssLengthRow = (typeof CSS_LENGTH_ROWS)[number];

export interface CssLengthVector {
    readonly row: CssLengthRow;
    readonly rule: string;
    readonly css: string;
    readonly dip: string;
}

export const CSS_LENGTH_VECTORS: readonly CssLengthVector[] = [
    { row: 'length', rule: 'a px length loses its unit', css: 'padding: 12px;', dip: 'padding: 12;' },
    {
        row: 'length',
        rule: 'zero, fractions and a leading dot keep their digits',
        css: 'a: 0px 1.5px .5px',
        dip: 'a: 0 1.5 .5',
    },
    { row: 'length', rule: 'the unit is read in any case', css: 'padding: 8PX', dip: 'padding: 8' },
    {
        row: 'shorthand',
        rule: 'every length of a shorthand converts, negatives included',
        css: 'margin: -4px 8px -2.5px 0',
        dip: 'margin: -4 8 -2.5 0',
    },
    { row: 'shorthand', rule: 'no space after the colon is no obstacle', css: 'margin:4px 8px', dip: 'margin:4 8' },
    {
        row: 'otherUnits',
        rule: 'unitless values, percentages, em, pt and rem are not px and stay',
        css: 'padding: 12; width: 50%; font-size: 1.2em; margin: 2pt 3rem',
        dip: 'padding: 12; width: 50%; font-size: 1.2em; margin: 2pt 3rem',
    },
    {
        row: 'untouched',
        rule: 'a string, a url() and a comment are copied as written',
        css: `content: "12px"; background: url(a-12px.png); /* 12px */ x: '3px'`,
        dip: `content: "12px"; background: url(a-12px.png); /* 12px */ x: '3px'`,
    },
    {
        row: 'untouched',
        rule: 'a length after a string is still converted',
        css: 'a { content: "x"; padding: 3px }',
        dip: 'a { content: "x"; padding: 3 }',
    },
    {
        row: 'identifier',
        rule: 'px inside an identifier or a hex colour is no unit',
        css: 'color: #12px; --a2px: 1; .w12px { top: 1px }',
        dip: 'color: #12px; --a2px: 1; .w12px { top: 1 }',
    },
    {
        row: 'customProperty',
        rule: 'a custom property that later feeds a length converts where it is declared',
        css: '--swatch-size: 44px; padding: var(--swatch-size)',
        dip: '--swatch-size: 44; padding: var(--swatch-size)',
    },
];

export async function driveCssLengthVectors(
    subject: CssLengthSubject,
    harness: ConstructHarness,
    vectors: readonly CssLengthVector[] = CSS_LENGTH_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: CSS px to dip`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                expect(subject.toDip(vector.css)).toBe(vector.dip);
            });
        }
    });
}
