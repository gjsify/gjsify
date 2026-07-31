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

/** One-shot compression via `Gio.ZlibCompressor`. */
export function compressWithGio(data: Uint8Array, format: GioFormat): Uint8Array {
    const compressor = new Gio.ZlibCompressor({ format: getGioFormat(format) });
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
