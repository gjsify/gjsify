// `Gdk.RGBA` as observable behaviour: the channels, `equal()` and the `to_string()` spelling that
// `Adw.StyleManager.get_accent_color_rgba()` hands back. The SAME vectors run on real `gi://Gdk` (the
// ORACLE), on the core and on each port's door.

import type { ConstructHarness } from './constructs.js';

export interface RGBALike {
    red: number;
    green: number;
    blue: number;
    alpha: number;
    equal(other: RGBALike): boolean;
    to_string(): string;
}

/** The part of `Gdk` the vectors read. */
export interface GdkRGBALike {
    RGBA: new (init?: { red?: number; green?: number; blue?: number; alpha?: number }) => RGBALike;
}

export interface RGBASubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly Gdk: GdkRGBALike;
}

export const RGBA_ROWS = ['opaque', 'alpha', 'rounding', 'equal'] as const;

export type RGBARow = (typeof RGBA_ROWS)[number];

export interface RGBAVector {
    readonly row: RGBARow;
    readonly rule: string;
    readonly a: { red: number; green: number; blue: number; alpha: number };
    /** The second colour `equal()` is asked about; absent for the string rows. */
    readonly b?: { red: number; green: number; blue: number; alpha: number };
    /** `to_string()` of `a`, or `equal()` as "true"/"false". */
    readonly shows: string;
}

export const RGBA_VECTORS: readonly RGBAVector[] = [
    {
        row: 'opaque',
        rule: 'an opaque colour is rgb(r,g,b) in 0…255',
        a: { red: 53 / 255, green: 132 / 255, blue: 228 / 255, alpha: 1 },
        shows: 'rgb(53,132,228)',
    },
    { row: 'opaque', rule: 'black and white', a: { red: 0, green: 0, blue: 0, alpha: 1 }, shows: 'rgb(0,0,0)' },
    {
        row: 'alpha',
        rule: 'a translucent colour is rgba(r,g,b,a)',
        a: { red: 1, green: 0, blue: 0, alpha: 0.5 },
        shows: 'rgba(255,0,0,0.5)',
    },
    {
        row: 'alpha',
        rule: 'fully transparent keeps the alpha',
        a: { red: 0, green: 0, blue: 0, alpha: 0 },
        shows: 'rgba(0,0,0,0)',
    },
    {
        row: 'rounding',
        rule: 'a channel rounds to the nearest 0…255 step',
        a: { red: 0.5, green: 0.2, blue: 0.999, alpha: 1 },
        shows: 'rgb(128,51,255)',
    },
    {
        row: 'equal',
        rule: 'equal colours are equal',
        a: { red: 0.1, green: 0.2, blue: 0.3, alpha: 1 },
        b: { red: 0.1, green: 0.2, blue: 0.3, alpha: 1 },
        shows: 'true',
    },
    {
        row: 'equal',
        rule: 'a differing alpha is not equal',
        a: { red: 0.1, green: 0.2, blue: 0.3, alpha: 1 },
        b: { red: 0.1, green: 0.2, blue: 0.3, alpha: 0.5 },
        shows: 'false',
    },
];

export async function driveRGBAVectors(
    subject: RGBASubject,
    harness: ConstructHarness,
    vectors: readonly RGBAVector[] = RGBA_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: Gdk.RGBA`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const a = new subject.Gdk.RGBA(vector.a);
                const observed =
                    vector.b === undefined ? a.to_string() : String(a.equal(new subject.Gdk.RGBA(vector.b)));
                expect(observed).toBe(vector.shows);
            });
        }
    });
}
