// Deterministic gzip.
//
// The gzip header carries its own modification time in bytes 4-7 and the
// compressing OS in byte 9. Leaving them alone makes two runs over identical
// input produce different bytes — which no test notices, because every test
// compares the DECOMPRESSED content. It is the single most-missed
// reproducibility bug in package writers, and it costs nothing to close.
//
// WHAT "DETERMINISTIC" DOES NOT COVER, measured 2026-09-11 and named here because
// the function's own name overstates it: the bytes are reproducible for a given
// HOST, not for a given artifact. `@gjsify/tar`'s gzip runs on the platform's
// zlib, and the platforms do not ship the same one — Fedora's libz is
// `zlib-ng-compat` (2.3.3) while Node bundles its own zlib (1.3.2.1-motley). Over
// this repo's `CHANGELOG.md` (876 192 bytes) at the DEFAULT level they produce
// 272 003 and 272 000 bytes respectively, so a `.deb` packed under GJS and one
// packed under Node already differ, today, before any level argument exists.
// Levels 1-4 differ too, in the other direction (zlib-ng is smaller). Two
// consequences worth keeping:
//
//   * `tests/e2e/ship-from-stage` asserts byte-equality between a direct pack and
//     a `--from-stage` pack, and it holds because both run on ONE host. It is
//     structurally blind to this, and a cross-host pack is exactly what
//     `--from-stage` exists to enable.
//   * zlib-ng's level 9 is WORSE than its level 8 on large inputs — 277 974 vs
//     270 255 bytes on the file above, ~2.9 % bigger — which is why `level: 9` is
//     asked for only where a reader demands it (see below) and not blanket-applied
//     to the payload tarballs.
//
// Ledgered in `status/open-todos.md`; closing it means pinning ONE deflate
// implementation, which is a larger decision than this file.

import { gzip } from '@gjsify/tar';

/**
 * gzip with the header's timestamp zeroed and the OS byte pinned to Unix.
 *
 * @param level 0-9, or omitted for zlib's default. THE ONLY HONEST WAY TO SET XFL:
 *   byte 8 of the header records how hard the compressor tried (2 = maximum,
 *   4 = fastest, 0 = neither), `lintian` reads it to raise
 *   `changelog-not-compressed-with-max-compression`, and `file` prints it as
 *   "max compression". Stamping that byte here beside the mtime and OS bytes would
 *   be a different thing entirely and was rejected for it: mtime and OS are facts
 *   about the build ENVIRONMENT, which a reproducible build is entitled to
 *   normalise, while XFL is a statement about the compression actually performed.
 *   Writing a 2 we had not earned would make the artifact lie to the tool reading
 *   it. So the level travels down to the compressor instead.
 *
 *   AND THE TEMPTATION IS REAL, which is why this is worth writing down: measured
 *   on gjsify's own `.deb`, the changelog member compressed at the default level
 *   and at 9 differs in EXACTLY ONE BYTE — position 9, XFL, 0 against 2 — and is
 *   1152 bytes either way. For this input, stamping the byte would have produced
 *   the identical artifact. It is identical by coincidence of a small input: over
 *   this repo's full `CHANGELOG.md` the same two levels differ by thousands of
 *   bytes. A rule that happens to hold on today's input is not the rule.
 */
export async function gzipDeterministic(input: Uint8Array, level?: number): Promise<Uint8Array> {
    const out = await gzip(input, level === undefined ? undefined : { level });
    if (out.byteLength < 10 || out[0] !== 0x1f || out[1] !== 0x8b) {
        throw new Error('gjsify ship: internal error — gzip did not produce a gzip stream.');
    }
    out[4] = 0;
    out[5] = 0;
    out[6] = 0;
    out[7] = 0;
    out[9] = 3;
    return out;
}

/**
 * `gzip -9`, the level Debian Policy § 4.4 asks of a packaging changelog.
 *
 * Named rather than spelled `9` at the call site so the reason travels with the
 * number: the `-n` half of Policy's `gzip -9 -n` is what {@link gzipDeterministic}
 * already does to bytes 4-7.
 */
export const POLICY_MAX_COMPRESSION = 9;
