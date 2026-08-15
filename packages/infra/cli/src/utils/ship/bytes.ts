// The byte-level helpers all three writers need.
//
// `concatBytes` existed once per writer before this file did — the same nine
// lines in `ar.ts`, `cpio.ts` and `rpm.ts`. The second copy is where a helper
// belongs (root AGENTS.md § Code anti-patterns): a drifted copy of THIS
// function would not throw, it would silently produce a truncated archive.

/** Join byte chunks into one buffer. */
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
    let total = 0;
    for (const chunk of chunks) total += chunk.byteLength;
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return out;
}

/** UTF-8 encode. The archive formats are byte formats; every length is a BYTE length. */
export function encodeUtf8(value: string): Uint8Array {
    return new TextEncoder().encode(value);
}
