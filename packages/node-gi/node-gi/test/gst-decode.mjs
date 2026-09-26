// SPDX-License-Identifier: MIT
// Decode encoded bytes through the running GStreamer registry and count the PCM frames.
//
// Shared by gst-elements.test.mjs and by anyone re-running its negative controls, which is
// why it is a module and not a function inside the test: a control has to run the SAME
// pipeline against a registry with one feature ranked out, and a copy of the pipeline in a
// scratch script would measure the copy.
//
// The shape is @gjsify/webaudio's decoder (appsrc → decodebin → appsink, pulled with
// `try_pull_sample`), except for the source caps — which is how a test states what arrived
// over the wire without a network: `application/x-icy` is exactly the label souphttpsrc
// puts on an Icecast stream.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { requireGi } from '../gi.js';

/** 44.1 kHz mono S16: every fixture is encoded at that rate, so one frame is two bytes. */
export const PCM_RATE = 44100;
const PCM_CAPS = `audio/x-raw,format=S16LE,layout=interleaved,rate=${PCM_RATE},channels=1`;

/**
 * A 1.0 s 440 Hz sine, mono, MPEG-1 Layer III 32 kbit/s, behind an ID3v2.3 tag — the
 * shape a podcast enclosure has. Generated, so it carries no third-party content:
 *
 *   ffmpeg -f lavfi -i sine=frequency=440:sample_rate=44100:duration=1 -ac 1 -c:a pcm_s16le tone.wav
 *   lame -m m -b 32 --tt "gjsify test tone" --id3v2-only tone.wav tone-440hz-1s-mono.mp3
 */
export const MP3_FIXTURE = fileURLToPath(new URL('./fixtures/audio/tone-440hz-1s-mono.mp3', import.meta.url));
export const MP3_FIXTURE_SECONDS = 1;

/**
 * The same 1.0 s 440 Hz sine, AAC-LC 32 kbit/s, encoded two ways — the shapes a podcast
 * episode and a live AAC stream each ship as. Generated with ffmpeg's own `aac` encoder
 * (never `libfdk_aac` — which encoder makes the bytes is not a licence question for a
 * generated test tone, but it is a reproducibility one), so this carries no third-party
 * content:
 *
 *   ffmpeg -f lavfi -i sine=frequency=440:sample_rate=44100:duration=1 -ac 1 -c:a pcm_s16le tone.wav
 *   ffmpeg -i tone.wav -ac 1 -c:a aac -profile:a aac_low -b:a 32k -movflags +faststart tone-440hz-1s-mono.m4a
 *   ffmpeg -i tone.wav -ac 1 -c:a aac -profile:a aac_low -b:a 32k -f adts tone-440hz-1s-mono.aac
 *
 * M4A and raw ADTS decode through DIFFERENT elements, which is why both are fixtures and not
 * one: `qtdemux` demuxes the container and hands the decoder raw AAC directly (measured:
 * ranking `aacparse` out changes nothing for this file), while a bare ADTS stream carries no
 * container and reaches the decoder only via `aacparse` (measured: ranking `qtdemux` out
 * changes nothing for this one — there is no container to fail to demux — and ranking
 * `aacparse` out is what breaks it). A bundle can carry either element without the other.
 */
export const M4A_FIXTURE = fileURLToPath(new URL('./fixtures/audio/tone-440hz-1s-mono.m4a', import.meta.url));
export const ADTS_FIXTURE = fileURLToPath(new URL('./fixtures/audio/tone-440hz-1s-mono.aac', import.meta.url));
export const AAC_FIXTURE_SECONDS = 1;

/**
 * The MPEG frames of an MP3 file with its leading ID3v2 tag cut off.
 *
 * A live stream carries no ID3 tag, so a stream test fed the tagged file would also be
 * asking for id3demux — two questions in one failure.
 */
export function stripId3v2(bytes) {
    if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return bytes;
    // Syncsafe: four 7-bit bytes, then the 10-byte header itself (+10 more with a footer).
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    const footer = bytes[5] & 0x10 ? 10 : 0;
    return bytes.subarray(10 + size + footer);
}

/**
 * Interleave Icecast metadata into audio bytes, as a server does for `Icy-MetaData: 1`.
 *
 * After every `interval` audio bytes comes one length byte (in 16-byte units) and that many
 * bytes of `StreamTitle='…';`, zero-padded. The first block carries a title so the demuxer
 * has something to strip; the rest are empty, which is what most blocks on a real stream are.
 */
export function icyInterleave(audio, interval, title = 'gjsify test tone') {
    const text = new TextEncoder().encode(`StreamTitle='${title}';`);
    const titleBlock = new Uint8Array(1 + Math.ceil(text.length / 16) * 16);
    titleBlock[0] = (titleBlock.length - 1) / 16;
    titleBlock.set(text, 1);
    const parts = [];
    let first = true;
    for (let offset = 0; offset < audio.length; offset += interval) {
        const chunk = audio.subarray(offset, offset + interval);
        parts.push(chunk);
        if (chunk.length === interval) {
            parts.push(first ? titleBlock : new Uint8Array(1));
            first = false;
        }
    }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

/**
 * Push `bytes` through `appsrc ! decodebin3 ! … ! appsink` and count what comes out.
 *
 * Never throws for a decode that FAILS — that is the result under test, returned as
 * `error` with `frames: 0`, so a negative control can assert on it. `decodebin3` because
 * it is what `playbin3` autoplugs through, and an app hands playbin3 its URI.
 *
 * @param {Uint8Array} bytes the encoded input
 * @param {string} [srcCaps] caps to label the input with; omitted, typefind decides
 * @returns {{ frames: number, eos: boolean, error: string | null }}
 */
export function decodeToPcm(bytes, srcCaps) {
    const Gst = requireGi('Gst', '1.0');
    // Loaded for its side effect: without the GstApp typelib `get_by_name()` answers a bare
    // Gst.Element and `push_buffer` is not a function (see @gjsify/webaudio's gst-init).
    requireGi('GstApp', '1.0');
    const pipeline = Gst.parse_launch(
        `appsrc name=src format=bytes ! decodebin3 ! audioconvert ! audioresample ! ${PCM_CAPS} ! ` +
            'appsink name=sink sync=false',
    );
    const src = pipeline.get_by_name('src');
    const sink = pipeline.get_by_name('sink');
    if (srcCaps) src.set_property('caps', Gst.Caps.from_string(srcCaps));
    let frames = 0;
    try {
        pipeline.set_state(Gst.State.PLAYING);
        src.push_buffer(Gst.Buffer.new_wrapped(bytes));
        src.end_of_stream();
        for (;;) {
            const sample = sink.try_pull_sample(5 * Number(Gst.SECOND));
            if (!sample) break;
            frames += (sample.get_buffer()?.get_size() ?? 0) / 2;
        }
        const eos = sink.is_eos();
        const message = pipeline.get_bus().pop_filtered(Gst.MessageType.ERROR);
        const error = message ? String(message.parse_error()[0]?.message ?? message.parse_error()) : null;
        return { frames, eos, error };
    } finally {
        pipeline.set_state(Gst.State.NULL);
    }
}

/** A fixture's bytes, read once per call so a caller may mutate its copy. */
function readFixture(path) {
    return new Uint8Array(readFileSync(path));
}

export function readMp3Fixture() {
    return readFixture(MP3_FIXTURE);
}

export function readM4aFixture() {
    return readFixture(M4A_FIXTURE);
}

export function readAdtsFixture() {
    return readFixture(ADTS_FIXTURE);
}
