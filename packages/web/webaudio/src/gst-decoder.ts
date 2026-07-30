// GStreamer decode pipeline: ArrayBuffer (MP3/WAV/OGG) → AudioBuffer (PCM Float32)
//
// Pipeline: appsrc → decodebin → audioconvert → audioresample → capsfilter(F32LE) → appsink
// Uses try_pull_sample() for synchronous decoding (avoids GJS thread-safety issues).
//
// Reference: GStreamer 1.0 via gi://Gst, GstApp via gi://GstApp

import { ensureGstInit, Gst } from './gst-init.js';
import { stopPipeline, trackPipeline } from './gst-teardown.js';
import { AudioBuffer } from './audio-buffer.js';

// The GstApp typelib is loaded by ensureGstInit() — see gst-init.ts for why a
// bare `import`/`void` does not do it on the node-gi reverse bridge.

const PIPELINE_DESC =
    'appsrc name=src ! decodebin ! audioconvert ! audioresample ! ' +
    'capsfilter caps=audio/x-raw,format=F32LE,layout=interleaved ! ' +
    'appsink name=sink sync=false';

/**
 * Decode encoded audio data (MP3, WAV, OGG, FLAC, etc.) into an AudioBuffer
 * containing PCM Float32 channel data.
 *
 * This is a synchronous operation that blocks until decoding completes.
 * It must be called from the main thread (GJS requirement).
 */
export function decodeAudioDataSync(arrayBuffer: ArrayBuffer): AudioBuffer {
    ensureGstInit();

    // Reject non-ArrayBuffer / empty input before touching GStreamer —
    // gst_memory_new_wrapped() asserts data != NULL and empty TypedArrays
    // marshal to a NULL pointer through GI.
    if (!(arrayBuffer instanceof ArrayBuffer) || arrayBuffer.byteLength === 0) {
        throw new DOMException('Unable to decode audio data', 'EncodingError');
    }

    const pipeline = Gst.parse_launch(PIPELINE_DESC) as Gst.Bin;
    // `get_by_name()` returns a base Gst.Element; the AppSrc/AppSink methods
    // we use here (push_buffer / end_of_stream / try_pull_sample) live on the
    // GstApp subclasses but the GIR types don't auto-narrow. Cast through
    // local structural shapes once instead of `as any` at each call site.
    interface _AppSrc extends Gst.Element {
        push_buffer(buf: Gst.Buffer): Gst.FlowReturn;
        end_of_stream(): Gst.FlowReturn;
    }
    interface _AppSink extends Gst.Element {
        try_pull_sample(timeout: number): Gst.Sample | null;
    }

    const appsrc = pipeline.get_by_name('src') as _AppSrc;
    const appsink = pipeline.get_by_name('sink') as _AppSink;

    // Registered + torn down in `finally`: anything between PLAYING and NULL can
    // throw (a push/pull failure, a malformed sample), and an early return left
    // the pipeline PLAYING to be disposed later — one GStreamer-CRITICAL per
    // element, emitted long after the decode that caused it.
    trackPipeline(pipeline);
    pipeline.set_state(Gst.State.PLAYING);

    const chunks: Uint8Array[] = [];
    let sampleRate = 0;
    let channels = 0;

    try {
        // Push encoded data into the pipeline
        const data = new Uint8Array(arrayBuffer);
        appsrc.push_buffer(Gst.Buffer.new_wrapped(data));
        appsrc.end_of_stream();

        // Pull decoded PCM samples
        while (true) {
            const sample = appsink.try_pull_sample(2 * Number(Gst.SECOND));
            if (!sample) break;

            // Read format from the first sample's negotiated caps
            if (sampleRate === 0) {
                const caps = sample.get_caps();
                if (caps) {
                    const struct = caps.get_structure(0);
                    [, sampleRate] = struct.get_int('rate');
                    [, channels] = struct.get_int('channels');
                }
            }

            const buffer = sample.get_buffer();
            if (!buffer) continue;

            // `extract_dup` rather than map/unmap + `GstMapInfo.data`.
            //
            // `data` is a raw `guint8*` FIELD whose length lives in a sibling
            // `size` field — a dependency GI cannot express for a struct field
            // read. gjs resolves it anyway; `@gjsify/node-gi` marshals it as an
            // EMPTY array, and nothing says so: measured on a decoded sample,
            // `mapInfo.size` is 8192 and `mapInfo.data.length` is 0. Decode
            // therefore produced an AudioBuffer of ZERO frames on the reverse
            // bridge, `_interleave` returned nothing, `GstPlayer` fired `ended`
            // without ever building a pipeline, and audio was silent on node with
            // no error at any layer.
            //
            // `gst_buffer_extract_dup` is an ordinary GI method that returns a
            // COPY with a real length on BOTH runtimes (verified: 8192 on node,
            // correct bytes on gjs), so it sidesteps the field-marshalling gap
            // entirely — and it needs no unmap, which removes a lifetime pairing
            // from this loop. The node-gi field gap is tracked in STATUS.md.
            const size = buffer.get_size();
            if (size > 0) {
                chunks.push(new Uint8Array(buffer.extract_dup(0, size)));
            }
        }
    } finally {
        stopPipeline(pipeline);
    }

    if (sampleRate === 0 || channels === 0) {
        throw new DOMException('Unable to decode audio data', 'EncodingError');
    }

    // Concatenate chunks into a single interleaved Float32 buffer
    let totalBytes = 0;
    for (const c of chunks) totalBytes += c.length;
    const totalFrames = totalBytes / (4 * channels);

    const audioBuffer = new AudioBuffer({
        numberOfChannels: channels,
        length: totalFrames,
        sampleRate,
    });

    // De-interleave into per-channel Float32Arrays
    let offset = 0;
    for (const chunk of chunks) {
        const f32 = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.length / 4);
        const framesInChunk = f32.length / channels;
        for (let frame = 0; frame < framesInChunk; frame++) {
            for (let ch = 0; ch < channels; ch++) {
                audioBuffer._channelData[ch][offset + frame] = f32[frame * channels + ch];
            }
        }
        offset += framesInChunk;
    }

    return audioBuffer;
}
