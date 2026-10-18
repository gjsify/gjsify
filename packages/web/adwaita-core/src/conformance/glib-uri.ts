// `GLib.uri_escape_string` as observable behaviour. The SAME vectors run on real `gi://GLib` (the
// ORACLE), on the core and on each port's `GLib` door.

import type { ConstructHarness } from './constructs.js';

/** The part of `GLib` the vectors read. */
export interface GLibUriLike {
    uri_escape_string(unescaped: string, reserved_chars_allowed: string | null, allow_utf8: boolean): string;
}

export interface GLibUriSubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly GLib: GLibUriLike;
}

export const GLIB_URI_ROWS = ['ascii', 'reserved', 'utf8', 'empty'] as const;

export type GLibUriRow = (typeof GLIB_URI_ROWS)[number];

export interface GLibUriVector {
    readonly row: GLibUriRow;
    readonly rule: string;
    readonly observe: (subject: GLibUriSubject) => unknown;
    readonly shows: unknown;
}

const PUNCTUATION = "-_.~!$&'()*+,;=:@/?#[]%";

export const GLIB_URI_VECTORS: readonly GLibUriVector[] = [
    {
        row: 'ascii',
        rule: 'only A-Za-z0-9 and -._~ stay; every other byte is %XX in uppercase hex',
        observe: ({ GLib }) => [
            GLib.uri_escape_string('a b/c?d=e&f', null, false),
            GLib.uri_escape_string(PUNCTUATION, null, false),
        ],
        shows: ['a%20b%2Fc%3Fd%3De%26f', '-_.~%21%24%26%27%28%29%2A%2B%2C%3B%3D%3A%40%2F%3F%23%5B%5D%25'],
    },
    {
        row: 'reserved',
        rule: 'a character in reserved_chars_allowed stays',
        observe: ({ GLib }) => [
            GLib.uri_escape_string('a b/c?d=e&f', '/', false),
            GLib.uri_escape_string(PUNCTUATION, "!$&'()*+,;=:@/", false),
        ],
        shows: ['a%20b/c%3Fd%3De%26f', "-_.~!$&'()*+,;=:@/%3F%23%5B%5D%25"],
    },
    {
        row: 'utf8',
        rule: 'non-ASCII is escaped per UTF-8 byte unless allow_utf8; control characters are always escaped',
        observe: ({ GLib }) => [
            GLib.uri_escape_string('ä€😀', null, false),
            GLib.uri_escape_string('ä€😀', null, true),
            GLib.uri_escape_string('\n\t', null, true),
        ],
        shows: ['%C3%A4%E2%82%AC%F0%9F%98%80', 'ä€😀', '%0A%09'],
    },
    {
        row: 'empty',
        rule: 'the empty string escapes to the empty string',
        observe: ({ GLib }) => GLib.uri_escape_string('', null, false),
        shows: '',
    },
];

export async function driveGLibUriVectors(
    subject: GLibUriSubject,
    harness: ConstructHarness,
    vectors: readonly GLibUriVector[] = GLIB_URI_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: GLib URI`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = await vector.observe(subject);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
