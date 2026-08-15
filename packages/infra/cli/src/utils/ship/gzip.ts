// Deterministic gzip.
//
// The gzip header carries its own modification time in bytes 4-7 and the
// compressing OS in byte 9. Leaving them alone makes two runs over identical
// input produce different bytes — which no test notices, because every test
// compares the DECOMPRESSED content. It is the single most-missed
// reproducibility bug in package writers, and it costs nothing to close.

import { gzip } from '@gjsify/tar';

/** gzip with the header's timestamp zeroed and the OS byte pinned to Unix. */
export async function gzipDeterministic(input: Uint8Array): Promise<Uint8Array> {
    const out = await gzip(input);
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
