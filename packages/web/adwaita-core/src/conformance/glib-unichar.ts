// `GLib.unichar_isalpha` as observable behaviour. The SAME vectors run on real `gi://GLib` (the
// ORACLE), on the core and on each port's `GLib` door. The uncased rows are the point: a
// case-mapping shortcut answers them false, and a `\p{L}` regex cannot run on NativeScript.

import type { ConstructHarness } from './constructs.js';

/** The part of `GLib` the vectors read. */
export interface GLibUnicharLike {
    unichar_isalpha(c: string): boolean;
}

export interface GLibUnicharSubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly GLib: GLibUnicharLike;
}

export const GLIB_UNICHAR_ROWS = ['ascii', 'latin1', 'cjk', 'uncased', 'notLetter', 'unicode17'] as const;

export type GLibUnicharRow = (typeof GLIB_UNICHAR_ROWS)[number];

export interface GLibUnicharVector {
    readonly row: GLibUnicharRow;
    readonly rule: string;
    readonly chars: readonly string[];
    readonly shows: boolean;
}

export const GLIB_UNICHAR_VECTORS: readonly GLibUnicharVector[] = [
    { row: 'ascii', rule: 'an ASCII letter is alpha', chars: ['A', 'z'], shows: true },
    {
        row: 'ascii',
        rule: 'an ASCII digit, underscore or space is not',
        chars: ['0', '9', '_', ' ', '-'],
        shows: false,
    },
    {
        row: 'latin1',
        rule: 'Latin-1 letters, the ordinal indicators and the micro sign are alpha',
        chars: ['é', 'ß', 'ÿ', 'ª', 'º', 'µ'],
        shows: true,
    },
    { row: 'latin1', rule: 'Latin-1 operators and superscript digits are not', chars: ['×', '÷', '²'], shows: false },
    {
        row: 'cjk',
        rule: 'Han, kana, Hangul and the iteration mark are alpha',
        chars: ['中', 'あ', '가', '〆', '𠀀'],
        shows: true,
    },
    {
        row: 'uncased',
        rule: 'a letter with no case is alpha: Hebrew, Arabic, Devanagari, Thai, a modifier letter',
        chars: ['א', 'ب', 'क', 'ก', 'ʰ', '𝐀'],
        shows: true,
    },
    {
        row: 'notLetter',
        rule: 'an emoji, a non-ASCII digit, a combining mark or a letter-like number is not',
        chars: ['😀', '٣', '\u0301', 'ः', 'Ⅷ'],
        shows: false,
    },
    { row: 'unicode17', rule: 'a letter new in Unicode 17 is alpha', chars: ['\u{10940}'], shows: true },
];

export async function driveGLibUnicharVectors(
    subject: GLibUnicharSubject,
    harness: ConstructHarness,
    vectors: readonly GLibUnicharVector[] = GLIB_UNICHAR_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: GLib unichar`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = vector.chars.map((c) => [c, subject.GLib.unichar_isalpha(c)]);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.chars.map((c) => [c, vector.shows])));
            });
        }
    });
}
