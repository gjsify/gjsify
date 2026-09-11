// Gio zlib codec for GJS — original implementation using Gio.ZlibCompressor /
// Gio.ZlibDecompressor.
//
// Internal module shared by the one-shot API (index.ts) and the streaming
// Transform classes (transform-streams.ts). Both previously carried their own
// copy of these primitives; the copies drifted apart in name only and shared
// the same performance bug, so they live here exactly once now.
//
// PERFORMANCE CONTRACT — every Gio call in this file marshals its typed-array
// arguments BY COPY across the GI boundary:
//
// - `Gio.Converter.convert(inbuf, outbuf, flags)` copies BOTH buffers JS→C on
//   every call, and the caller-allocated `outbuf` is NEVER written back to JS
//   (verified on gjs 1.88: the call returns `[result, bytes_read,
//   bytes_written]` and the JS outbuf stays untouched). Consequences:
//   (a) the decoded output of `convert()` cannot be captured from JS — only
//       `bytes_read` is usable, which is why the gzip member walk needs a
//       separate scan + decompress instead of one capture-as-you-go loop;
//   (b) the cost of one `convert()` call is proportional to `inbuf.length`
//       REGARDLESS of how much of it is consumed. Passing the full remaining
//       tail per call therefore makes a scan O(n²) in the member size —
//       measured on a real 78 MB npm tarball: 40.5 ms/call and ~84 s for the
//       single member, vs 0.19 ms/call once the input is sliced to 256 KiB.
//   Every `convert()` call site MUST bound its input slice; the shape guard in
//   gio-codec.gjs.spec.ts fails if an unbounded slice ever comes back.
// - `Gio.InputStream.read_bytes(n)` pays a fixed GI/GBytes overhead per call,
//   so the chunk size divides the call count: 4096-byte reads decompressed the
//   same 78 MB tarball at 246 MB/s, 1 MiB reads at 522 MB/s. 1 MiB is the
//   sweet spot — beyond it the throughput gain flattens while the transient
//   per-call allocation keeps growing.

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';

export type GioFormat = 'gzip' | 'deflate' | 'deflate-raw';

/**
 * Upper bound for the input slice handed to a single `Gio.Converter.convert()`
 * call. See the performance contract above — this bound is what keeps the
 * gzip member scan linear instead of quadratic.
 */
export const CONVERT_INPUT_SLICE = 256 * 1024;

/**
 * Out-buffer size for the member scan. The scan's call count is
 * `max(inputSize, outputSize) / min(CONVERT_INPUT_SLICE, outBufSize)`, so
 * matching the input slice keeps the total bytes marshalled bounded by
 * roughly one copy of the input plus one copy of the (discarded) output.
 */
const SCAN_OUT_BUF_SIZE = 256 * 1024;

/**
 * Read chunk for `ConverterInputStream`-driven decompression. 1 MiB measured
 * 522 MB/s vs 246 MB/s at the previous 4096 bytes (see contract above).
 */
export const STREAM_READ_CHUNK = 1024 * 1024;

export function getGioFormat(format: GioFormat): Gio.ZlibCompressorFormat {
    switch (format) {
        case 'gzip':
            return Gio.ZlibCompressorFormat.GZIP;
        case 'deflate':
            return Gio.ZlibCompressorFormat.ZLIB;
        case 'deflate-raw':
            return Gio.ZlibCompressorFormat.RAW;
    }
}

function concat(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
        out.set(c, off);
        off += c.length;
    }
    return out;
}

/** `Gio.ZlibCompressor:level`'s own "pick the zlib default" value. */
export const DEFAULT_LEVEL = -1;

/**
 * Reject a level `Gio.ZlibCompressor` would take differently than zlib does.
 *
 * MEASURED on gjs 1.86 / GLib 2.86, because the guess was wrong in the direction
 * that matters. An out-of-range construct value is not clamped to the paramspec's
 * bounds — GObject DISCARDS it, logs `GLib-GObject-CRITICAL: value "42" … is
 * invalid or out of range for property 'level'`, and leaves the property at 0.
 * Level 0 is zlib's STORE mode, so `level: 42` asks for maximum compression and
 * gets a stream that is compressed not at all, while a CRITICAL is a log line and
 * not an exception — the process carries on at exit 0. Node throws
 * `ERR_OUT_OF_RANGE` here, and throwing is the only answer that cannot be missed.
 *
 * RANGE ONLY, and not `Number.isInteger`, because the reference implementation is
 * the reference: measured on Node 24, `gzipSync(data, {level: 2.5})` is ACCEPTED
 * (C casts it) while 42 and -7 throw. A first version of this guard rejected 2.5
 * as well and the Node leg of the spec failed it — which is what that leg is for
 * (tests/AGENTS.md rule 3: the Node run proves the TEST, the GJS run proves our
 * implementation). The truncation that keeps GI happy is {@link compressWithGio}'s.
 *
 * Written as `!(level >= -1 && level <= 9)` rather than `level < -1 || level > 9`
 * so `NaN` — which compares false against everything — is refused rather than
 * passed through to a `gint` marshaller.
 */
export function assertLevel(level: number): void {
    if (!(level >= DEFAULT_LEVEL && level <= 9)) {
        throw new RangeError(`The value of "level" is out of range. It must be >= -1 and <= 9. Received ${level}`);
    }
}

/**
 * One-shot compression via `Gio.ZlibCompressor`.
 *
 * @param level 0 (store) to 9 (most), or {@link DEFAULT_LEVEL} for zlib's own choice.
 *   The level is not cosmetic: it is the only way to set the gzip header's XFL byte,
 *   which is how `lintian` and `file` read back a claim of maximum compression.
 *   TRUNCATED before it reaches the `gint` property, which is what Node's C cast
 *   does with the fractional level it also accepts.
 */
export function compressWithGio(data: Uint8Array, format: GioFormat, level: number = DEFAULT_LEVEL): Uint8Array {
    assertLevel(level);
    const compressor = new Gio.ZlibCompressor({ format: getGioFormat(format), level: Math.trunc(level) });
    const converter = new Gio.ConverterOutputStream({
        base_stream: Gio.MemoryOutputStream.new_resizable(),
        converter: compressor,
    });

    converter.write_bytes(new GLib.Bytes(data), null);
    converter.close(null);

    const memStream = converter.get_base_stream() as Gio.MemoryOutputStream;
    const bytes = memStream.steal_as_bytes();
    return new Uint8Array(bytes.get_data() ?? []);
}

/**
 * One-shot decompression of a single zlib/raw/gzip stream via
 * `Gio.ConverterInputStream`. For gzip this decodes exactly ONE member —
 * concatenated members need {@link gunzipWithGio}.
 */
export function decompressStreamWithGio(data: Uint8Array, format: GioFormat): Uint8Array {
    const decompressor = new Gio.ZlibDecompressor({ format: getGioFormat(format) });
    const memInput = Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(data));
    const converter = new Gio.ConverterInputStream({
        base_stream: memInput,
        converter: decompressor,
    });

    const chunks: Uint8Array[] = [];
    while (true) {
        const bytes = converter.read_bytes(STREAM_READ_CHUNK, null);
        const size = bytes.get_size();
        if (size === 0) break;
        chunks.push(new Uint8Array(bytes.get_data()!));
    }
    converter.close(null);

    return concat(chunks);
}

/**
 * Determine how many input bytes the gzip member starting at `data[0]`
 * consumes, using the low-level `convert()` API. The decoded output is
 * discarded — GJS does not write the out-buffer back to JS (see the
 * performance contract at the top of this file) — but `bytes_read` is
 * accurate, which is exactly what slicing one member off a concatenated gzip
 * stream needs.
 *
 * The input is fed in {@link CONVERT_INPUT_SLICE} slices, never as the full
 * remaining tail: `convert()` copies its whole `inbuf` across the GI boundary
 * per call, so unbounded slices made this scan quadratic in the member size.
 * A slice that ends mid-stream is fine — zlib consumes partial input
 * (including partial headers/trailers) and reports it via `bytes_read`.
 *
 * On malformed or truncated input the scan stops and reports the bytes
 * consumed so far; the caller's real decompression of that slice surfaces the
 * proper GLib error.
 */
export function findGzipMemberEnd(data: Uint8Array): number {
    const decompressor = new Gio.ZlibDecompressor({ format: Gio.ZlibCompressorFormat.GZIP });
    const outBuf = new Uint8Array(SCAN_OUT_BUF_SIZE);
    let totalRead = 0;
    while (true) {
        const input = data.subarray(totalRead, totalRead + CONVERT_INPUT_SLICE);
        try {
            const [result, bytesRead, bytesWritten] = decompressor.convert(input, outBuf, Gio.ConverterFlags.NONE);
            totalRead += bytesRead;
            if (result === Gio.ConverterResult.FINISHED) return totalRead;
            if (bytesRead === 0 && bytesWritten === 0) {
                // Termination backstop. Per Gio's contract a zero-progress
                // convert() raises instead (G_IO_ERROR_PARTIAL_INPUT /
                // NO_SPACE; zlib's Z_BUF_ERROR — verified on gjs 1.88), and
                // every non-FINISHED success consumes input or fills outBuf,
                // both finite. But GJS can also surface a failed GLib
                // precondition as a plain ERROR result with no exception, so
                // don't bet the loop on the contract: no progress means stop
                // and let the caller's real decode raise the actual error.
                return totalRead;
            }
        } catch {
            // Truncated (empty slice → G_IO_ERROR_PARTIAL_INPUT) or invalid
            // data. Report the consumed prefix; the caller re-decodes it and
            // raises the real error.
            return totalRead;
        }
    }
}

/**
 * Gzip decompression with Node's `gunzip` semantics: decode ALL concatenated
 * gzip members (multi-member streams are legal gzip and produced by e.g.
 * `gzip -c a b`, bgzip, and some HTTP servers), ignore trailing non-gzip
 * bytes after the last complete member.
 */
export function gunzipWithGio(data: Uint8Array): Uint8Array {
    const allChunks: Uint8Array[] = [];
    let inputOffset = 0;

    while (inputOffset < data.length) {
        // Only continue while the remainder looks like another gzip member.
        if (data.length - inputOffset < 2 || data[inputOffset] !== 0x1f || data[inputOffset + 1] !== 0x8b) {
            break;
        }

        const memberData = data.subarray(inputOffset);
        const consumed = findGzipMemberEnd(memberData);
        if (consumed <= 0) break; // No progress — avoid an infinite loop.

        allChunks.push(decompressStreamWithGio(memberData.subarray(0, consumed), 'gzip'));
        inputOffset += consumed;
    }

    if (allChunks.length === 0) {
        // No valid gzip members — let the member decoder surface the real error.
        return decompressStreamWithGio(data, 'gzip');
    }
    return concat(allChunks);
}
