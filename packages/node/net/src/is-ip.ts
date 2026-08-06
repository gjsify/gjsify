// Reference: Node.js lib/net.js `isIP` / `isIPv4` / `isIPv6` (`uv_inet_pton`).
//
// Pure string classification, ONE implementation, no platform contact — and
// that is the whole point of the file existing.
//
// WHAT THIS REPLACED, AND WHY IT MATTERED
//
// The GJS root entry used to answer by handing the string to
// `Gio.InetAddress.new_from_string()`, i.e. to the HOST's `inet_pton(3)`. That
// reads like the most authoritative possible source and is in fact the least
// portable one: BSD's parser accepts leading zeros in an IPv4 octet and glibc's
// rejects them, so the same call returns a different answer per OS. Measured on
// darwin-x64 / gjs 1.88.1 against Node 24.18.1 on the same machine:
//
//     input               GLib/BSD    Node
//     '01.02.03.04'          IPv4        0
//     '127.000.000.001'      IPv4        0
//     '0177.0.0.1'           IPv4        0
//
// Node's answer is `0` on every platform, and `net.isIP` is not a formatting
// nicety: leading-zero octets are the classic parser-confusion vector, because
// a consumer that later hands `0177.0.0.1` to something treating it as OCTAL
// reaches 127.0.0.1. A validator that says "valid IPv4" on one OS and "not an
// IP" on another is worse than either answer alone.
//
// The `browser.ts` entry already carried a correct pure classifier — with
// `Reject leading zeros (Node does)` spelled out in a comment — so the platform
// whose implementation was called "an implementation detail" was the one that
// had it right, and the two had been disagreeing for as long as both existed.
// This module is that classifier, now imported by both entries.
//
// It takes NO imports, which is what lets `browser.ts` use it without weakening
// the rule it documents (a browser platform entry imports nothing that could
// transitively reach GJS — a module with no imports at all cannot).

/**
 * Classify `input` as an IP address: `0` (no), `4` (IPv4) or `6` (IPv6).
 *
 * Matches Node's answer, including the parts that are easy to get wrong:
 * leading zeros in an IPv4 octet are rejected, an IPv6 zone id (`fe80::1%en0`)
 * is not part of the address proper, at most one `::` run is allowed, and an
 * IPv4-mapped tail (`::ffff:127.0.0.1`) must itself be a valid IPv4 address.
 */
export function isIP(input: string): 0 | 4 | 6 {
    if (typeof input !== 'string') return 0;
    // An IPv6 zone id (`fe80::1%eth0`) is not part of the address proper.
    const host = input.includes('%') ? input.slice(0, input.indexOf('%')) : input;
    const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (v4) {
        // Reject leading zeros (Node does) and out-of-range octets.
        return v4.slice(1).every((o) => (o.length === 1 || o[0] !== '0') && Number(o) <= 255) ? 4 : 0;
    }
    if (host.length === 0 || !host.includes(':')) return 0;
    // At most one `::` run, 2-8 groups of 1-4 hex digits, optional trailing
    // IPv4-mapped tail (`::ffff:127.0.0.1`).
    const tail = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host);
    // `tail[0]`, not `tail[1]`: the match INCLUDES the separating colon, and
    // leaving that colon on the head made the last run end in an empty group.
    // `::ffff:127.0.0.1` classified as NOT an IP for as long as this classifier
    // existed — invisible on GJS, where `Gio.InetAddress` was answering instead.
    const head = tail ? host.slice(0, host.length - tail[0].length) : host;
    if (tail && isIP(tail[1]) !== 4) return 0;
    const runs = head.split('::');
    if (runs.length > 2) return 0;
    let count = 0;
    for (const run of runs) {
        // An EMPTY run is legal — it is the side of `::` with nothing on it
        // (`::1`, `fe80::`, `::`). An empty GROUP inside a non-empty run is
        // not, and skipping those instead of rejecting them is what let
        // `:::1` and `:2001:252:0:1::2008:6:` through as valid IPv6.
        if (run === '') continue;
        for (const group of run.split(':')) {
            if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return 0;
            count++;
        }
    }
    // An IPv4-mapped tail occupies the last two groups.
    const want = tail ? 6 : 8;
    // `::` must stand for AT LEAST one omitted group, so a compressed address
    // with a full complement is invalid (`1:2:3:4:5:6:7::8`).
    if (runs.length === 2) return count < want ? 6 : 0;
    return count === want ? 6 : 0;
}

/** Check whether `input` is a valid IPv4 address. */
export function isIPv4(input: string): boolean {
    return isIP(input) === 4;
}

/** Check whether `input` is a valid IPv6 address. */
export function isIPv6(input: string): boolean {
    return isIP(input) === 6;
}
