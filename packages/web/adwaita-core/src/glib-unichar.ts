// `g_unichar_isalpha` — general category L* (`Lu|Ll|Lt|Lm|Lo`) — and `g_unichar_isprint` — not
// `Cc|Cf|Cn|Cs` — answered from generated range tables instead of `\p{…}` regexes. NativeScript's
// V8 is built without ICU and refuses a property escape at MODULE compile time, which twice took
// Learn6502's whole Android bundle down; see `scripts/generate-glib-unichar.mjs` for the
// incidents and the pinned Unicode version. Not `toLowerCase() !== toUpperCase()` either: that
// misses every uncased letter (Hebrew, CJK, Thai…).
//
// Reference: GLib glib/guniprop.c (g_unichar_isalpha, g_unichar_isprint)
// Copyright (c) GNOME contributors (GLib). LGPLv2.1+.

import { GLIB_UNICHAR_ALPHA_RANGES, GLIB_UNICHAR_NONPRINT_RANGES } from './glib-unichar.generated.js';

/** A generated table, decoded on first use into parallel start/end arrays for a binary search. */
class RangeTable {
    #source: readonly string[];
    #starts: Uint32Array | null = null;
    #ends: Uint32Array | null = null;

    constructor(source: readonly string[]) {
        this.#source = source;
    }

    #decode(): void {
        const numbers = this.#source.join('').split(',');
        const count = numbers.length / 2;
        this.#starts = new Uint32Array(count);
        this.#ends = new Uint32Array(count);
        let next = 0;
        for (let i = 0; i < count; i++) {
            const start = next + parseInt(numbers[2 * i], 36);
            const end = start + parseInt(numbers[2 * i + 1], 36);
            this.#starts[i] = start;
            this.#ends[i] = end;
            next = end + 1;
        }
    }

    has(code: number): boolean {
        if (this.#starts === null) this.#decode();
        const starts = this.#starts!;
        const ends = this.#ends!;
        let low = 0;
        let high = starts.length - 1;
        while (low <= high) {
            const middle = (low + high) >> 1;
            if (code < starts[middle]) high = middle - 1;
            else if (code > ends[middle]) low = middle + 1;
            else return true;
        }
        return false;
    }
}

const alpha = new RangeTable(GLIB_UNICHAR_ALPHA_RANGES);
const nonprint = new RangeTable(GLIB_UNICHAR_NONPRINT_RANGES);

/** `g_unichar_isalpha` for the first code point of `c`; `false` for the empty string. */
export function unicharIsalpha(c: string): boolean {
    const code = c.codePointAt(0);
    return code !== undefined && alpha.has(code);
}

/**
 * `g_unichar_isprint` for the first code point of `c`: false for control, format, unassigned
 * and surrogate code points; `false` for the empty string.
 */
export function unicharIsprint(c: string): boolean {
    const code = c.codePointAt(0);
    return code !== undefined && !nonprint.has(code);
}
