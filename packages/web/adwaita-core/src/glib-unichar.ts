// `g_unichar_isalpha` — general category L* (`Lu|Ll|Lt|Lm|Lo`), answered from a generated range
// table instead of `/\p{L}/u`. NativeScript's V8 is built without ICU and refuses a property
// escape at MODULE compile time, which once took Learn6502's whole Android bundle down; see
// `scripts/generate-glib-unichar.mjs` for the incident and the pinned Unicode version. Not
// `toLowerCase() !== toUpperCase()` either: that misses every uncased letter (Hebrew, CJK, Thai…).
//
// Reference: GLib glib/guniprop.c (g_unichar_isalpha)
// Copyright (c) GNOME contributors (GLib). LGPLv2.1+.

import { GLIB_UNICHAR_ALPHA_RANGES } from './glib-unichar.generated.js';

let starts: Uint32Array | null = null;
let ends: Uint32Array | null = null;

function decode(): void {
    const numbers = GLIB_UNICHAR_ALPHA_RANGES.join('').split(',');
    const count = numbers.length / 2;
    starts = new Uint32Array(count);
    ends = new Uint32Array(count);
    let next = 0;
    for (let i = 0; i < count; i++) {
        const start = next + parseInt(numbers[2 * i], 36);
        const end = start + parseInt(numbers[2 * i + 1], 36);
        starts[i] = start;
        ends[i] = end;
        next = end + 1;
    }
}

/** `g_unichar_isalpha` for the first code point of `c`; `false` for the empty string. */
export function unicharIsalpha(c: string): boolean {
    const code = c.codePointAt(0);
    if (code === undefined) return false;
    if (starts === null) decode();
    let low = 0;
    let high = starts!.length - 1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (code < starts![middle]) high = middle - 1;
        else if (code > ends![middle]) low = middle + 1;
        else return true;
    }
    return false;
}
