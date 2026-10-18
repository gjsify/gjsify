// `g_uri_escape_string` — the one URI helper of `gi://GLib` an app reaches for to build a query by
// hand (Learn6502's share dialog). Needs no host: it is a pure function over UTF-8 bytes, so both
// ports' `GLib` doors re-export it unchanged.
//
// GLib decides per BYTE of the UTF-8 encoding: an unreserved ASCII byte (`A-Za-z0-9-._~`) stays, a
// byte found in `reserved_chars_allowed` stays (C's `strchr`, so the test is byte-wise too), and with
// `allow_utf8` every byte >= 0x80 stays; anything else becomes `%XX` in uppercase hex. Not
// `encodeURIComponent`: that keeps `!'()*`, which GLib escapes.
//
// Reference: GLib glib/guri.c (g_uri_escape_string, _uri_encoder)
// Copyright (c) GNOME contributors (GLib). LGPLv2.1+.

const HEX = '0123456789ABCDEF';

function isUnreserved(byte: number): boolean {
    return (
        (byte >= 0x30 && byte <= 0x39) ||
        (byte >= 0x41 && byte <= 0x5a) ||
        (byte >= 0x61 && byte <= 0x7a) ||
        byte === 0x2d ||
        byte === 0x2e ||
        byte === 0x5f ||
        byte === 0x7e
    );
}

function utf8Bytes(codePoint: number): number[] {
    if (codePoint < 0x80) return [codePoint];
    if (codePoint < 0x800) return [0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f)];
    if (codePoint < 0x10000) {
        return [0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f)];
    }
    return [
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
    ];
}

function byteSet(chars: string): Set<number> {
    const set = new Set<number>();
    for (const char of chars) for (const byte of utf8Bytes(char.codePointAt(0)!)) set.add(byte);
    return set;
}

/** `g_uri_escape_string (unescaped, reserved_chars_allowed, allow_utf8)`. */
export function uriEscapeString(unescaped: string, reservedCharsAllowed: string | null, allowUtf8: boolean): string {
    const allowed = byteSet(reservedCharsAllowed ?? '');
    let result = '';
    for (const char of unescaped) {
        const codePoint = char.codePointAt(0)!;
        if (codePoint >= 0x80 && allowUtf8) {
            result += char;
            continue;
        }
        for (const byte of utf8Bytes(codePoint)) {
            if (isUnreserved(byte) || allowed.has(byte)) result += String.fromCharCode(byte);
            else result += `%${HEX[byte >> 4]}${HEX[byte & 0xf]}`;
        }
    }
    return result;
}
