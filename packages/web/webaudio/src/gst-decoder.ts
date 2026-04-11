// GStreamer decode pipeline: ArrayBuffer (MP3/WAV/OGG) → AudioBuffer (PCM Float32)
//
// Pipeline: appsrc → decodebin → audioconvert → audioresample → capsfilter(F32LE) → appsink
// Uses try_pull_sample() for synchronous decoding (avoids GJS thread-safety issues).
//
// Reference: GStreamer 1.0 via gi://Gst, GstApp via gi://GstApp

import { ensureGstInit, Gst } from './gst-init.js';
import { AudioBuffer } from './audio-buffer.js';

// Force GstApp typelib load so get_by_name() resolves AppSrc/AppSink types
import GstApp from 'gi://GstApp?version=1.0';
void GstApp;

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

    const pipeline = Gst.parse_launch(PIPELINE_DESC) as Gst.Bin;
    const appsrc = pipeline.get_by_name('src')!;
    const appsink = pipeline.get_by_name('sink')!;

    pipeline.set_state(Gst.State.PLAYING);

    // Push encoded data into the pipeline
    const data = new Uint8Array(arrayBuffer);
    (appsrc as any).push_buffer(Gst.Buffer.new_wrapped(data));
    (appsrc as any).end_of_stream();

    // Pull decoded PCM samples
    const chunks: Uint8Array[] = [];
    let sampleRate = 0;
    let channels = 0;

    while (true) {
        const sample = (appsink as any).try_pull_sample(2 * Number(Gst.SECOND));
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

        const [ok, mapInfo] = buffer.map(Gst.MapFlags.READ);
        if (ok) {
            // Copy data — mapInfo.data is only valid until unmap
            chunks.push(new Uint8Array(mapInfo.data));
            buffer.unmap(mapInfo);
        }
    }

    pipeline.set_state(Gst.State.NULL);

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
