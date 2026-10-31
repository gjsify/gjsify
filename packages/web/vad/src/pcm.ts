// Turning whatever a capture source produced into the mono float samples the
// detector takes.
//
// `@gjsify/media-capture`'s `openPcmSource()` is the source this is built for,
// and it is NOT a dependency (ADR 0127 decision 9 puts capture in its own
// package; a VAD that drags GStreamer in would be unusable on a stream that
// came from a file or a socket). The shape below is structural, so that source
// satisfies it without either package knowing the other: `sampleRate`,
// `format`, and an async iterator of byte chunks.

/** The byte layouts `openPcmSource()` can be asked for. */
export type PcmFormat = 'S16LE' | 'F32LE';

/** A chunk of interleaved mono samples. `Uint8Array` is raw bytes in {@link PcmFormat}. */
export type PcmChunk = Uint8Array | Int16Array | Float32Array;

/**
 * As much of `@gjsify/media-capture`'s `PcmSource` as this package reads.
 *
 * Both fields are optional so a bare `AsyncIterable` works too — then the
 * sample rate falls back to the detector's own and the format has to be either
 * inferable from the chunk type or given explicitly.
 */
export interface PcmSourceLike extends AsyncIterable<PcmChunk> {
    readonly sampleRate?: number;
    readonly format?: PcmFormat;
}

/** Any source `run()` accepts: a `PcmSource`-like object or a plain async iterable of chunks. */
export type VadInput = PcmSourceLike | AsyncIterable<PcmChunk>;

/**
 * The format a chunk carries in its own type, or `null` for raw bytes.
 *
 * `Uint8Array` is deliberately NOT guessed at: `S16LE` and `F32LE` are both
 * plausible for a byte buffer, and guessing wrong does not fail — it produces
 * audio that is silently wrong, which a VAD then reports as silence.
 */
export function inferFormat(chunk: PcmChunk): PcmFormat | null {
    if (chunk instanceof Float32Array) return 'F32LE';
    if (chunk instanceof Int16Array) return 'S16LE';
    return null;
}

const INT16_SCALE = 1 / 32768;

/**
 * Convert `chunk` to mono float samples in [-1, 1].
 *
 * A `Float32Array` is returned as-is — the detector only reads it, and the
 * caller owns the buffer either way. An odd trailing byte in an `S16LE` buffer
 * is dropped rather than read past the end; GStreamer does not split a sample
 * across buffers, so this is a guard for a hand-built chunk.
 */
export function toFloatSamples(chunk: PcmChunk, format?: PcmFormat): Float32Array {
    if (chunk instanceof Float32Array) return chunk;

    const resolved = format ?? inferFormat(chunk);
    if (resolved === null) {
        throw new TypeError(
            "A Uint8Array chunk carries no sample format — pass format: 'S16LE' or 'F32LE' " +
                '(openPcmSource() reports its own as source.format), or hand over an Int16Array/Float32Array.',
        );
    }

    if (chunk instanceof Int16Array) {
        const out = new Float32Array(chunk.length);
        for (let i = 0; i < chunk.length; i++) out[i] = chunk[i] * INT16_SCALE;
        return out;
    }

    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    if (resolved === 'F32LE') {
        const n = view.byteLength >> 2;
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) out[i] = view.getFloat32(i * 4, true);
        return out;
    }
    const n = view.byteLength >> 1;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true) * INT16_SCALE;
    return out;
}
