// The detector against the REAL sherpa-onnx engine and a real Silero model.
// SILENT and FILE-ONLY: no microphone, no audio output, nothing downloaded
// (ADR 0127 decision 14). Skips — loudly, with the reason — on a host without
// the prebuild or without a cached model, which is every CI runner today.
//
// The speech leg needs a WAV that cannot be committed: a real recording is
// someone's voice, and a synthetic one tells us nothing a VAD cares about. So
// it runs only when GJSIFY_VAD_TEST_WAV points at a 16 kHz mono PCM16 file,
// and otherwise the suite settles for proving that silence produces no events
// — which is itself the assertion that catches a model read at the wrong rate.

import GLib from 'gi://GLib?version=2.0';
import { describe, expect, it } from '@gjsify/unit';

import { hasVadBackend, describeVadBackend } from './backend.js';
import { DEFAULT_VAD_MODEL } from './model-manifest.js';
import { available, modelPath } from './models.js';
import { createVad, type SpeechEndEvent, type VadEvent } from './vad.js';

/** Why this suite cannot run here, or `null` when it can. */
function blocker(): string | null {
    if (!hasVadBackend()) return `no native engine — ${describeVadBackend()}`;
    const state = available(DEFAULT_VAD_MODEL);
    if (state !== 'available') {
        return `model '${DEFAULT_VAD_MODEL}' is ${state} (${modelPath(DEFAULT_VAD_MODEL)}); install() is not run from tests`;
    }
    return null;
}

/**
 * Samples from a canonical 16-bit PCM WAV, and the rate it claims.
 *
 * Deliberately minimal: it walks the RIFF chunks for `fmt ` and `data` rather
 * than assuming the 44-byte header, and refuses anything that is not mono
 * PCM16 instead of reinterpreting it — audio read at the wrong layout reaches
 * the detector as silence, and a test that silently passes on silence is worse
 * than no test.
 */
function readWavPcm16(path: string): { samples: Int16Array; sampleRate: number } {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) throw new Error(`Cannot read ${path}`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error(`${path} is not a RIFF/WAVE file`);

    let sampleRate = 0;
    let channels = 0;
    let bits = 0;
    let data: Int16Array | null = null;
    for (let at = 12; at + 8 <= view.byteLength;) {
        const id = tag(at);
        const size = view.getUint32(at + 4, true);
        const body = at + 8;
        if (id === 'fmt ') {
            channels = view.getUint16(body + 2, true);
            sampleRate = view.getUint32(body + 4, true);
            bits = view.getUint16(body + 14, true);
        } else if (id === 'data') {
            const length = Math.min(size, view.byteLength - body) >> 1;
            data = new Int16Array(length);
            for (let i = 0; i < length; i++) data[i] = view.getInt16(body + i * 2, true);
        }
        at = body + size + (size & 1);
    }
    if (data === null) throw new Error(`${path} has no data chunk`);
    if (channels !== 1 || bits !== 16) {
        throw new Error(`${path} is ${channels}ch/${bits}bit — this test needs mono PCM16`);
    }
    return { samples: data, sampleRate };
}

export default async () => {
    await describe('VoiceActivityDetector (real sherpa-onnx, no microphone)', async () => {
        await it('opens a cached model and reports the stack, or skips', async () => {
            const why = blocker();
            if (why !== null) {
                console.log(`SKIP: ${why}`);
                return;
            }
            const vad = createVad({ model: DEFAULT_VAD_MODEL });
            try {
                vad.open();
                expect(vad.isOpen).toBe(true);
                // Idempotent, and the second call must not reload the model.
                vad.open();
                expect(vad.isOpen).toBe(true);
                expect(describeVadBackend().startsWith('sherpa-onnx ')).toBe(true);
            } finally {
                vad.close();
            }
            expect(vad.isOpen).toBe(false);
        });

        await it('finds no speech in two seconds of digital silence, or skips', async () => {
            const why = blocker();
            if (why !== null) {
                console.log(`SKIP: ${why}`);
                return;
            }
            const vad = createVad({ model: DEFAULT_VAD_MODEL });
            try {
                const events: VadEvent[] = [];
                const chunk = new Float32Array(1600);
                for (let i = 0; i < 20; i++) events.push(...vad.accept(chunk));
                expect(events).toStrictEqual([]);
                expect(vad.speaking).toBe(false);
                expect(vad.positionSamples).toBe(32000);
                expect(vad.position).toBeCloseTo(2, 6);
                // A flush with nothing in progress closes nothing.
                expect(vad.flush()).toStrictEqual([]);
                expect(vad.flush()).toStrictEqual([]);
            } finally {
                vad.close();
            }
        });

        await it('resets the timeline without reopening, or skips', async () => {
            const why = blocker();
            if (why !== null) {
                console.log(`SKIP: ${why}`);
                return;
            }
            const vad = createVad({ model: DEFAULT_VAD_MODEL });
            try {
                vad.accept(new Float32Array(8000));
                expect(vad.positionSamples).toBe(8000);
                vad.reset();
                expect(vad.positionSamples).toBe(0);
                expect(vad.speaking).toBe(false);
                expect(vad.accept(new Float32Array(1600))).toStrictEqual([]);
            } finally {
                vad.close();
            }
        });

        await it('segments speech from a WAV when GJSIFY_VAD_TEST_WAV names one, or skips', async () => {
            const why = blocker();
            if (why !== null) {
                console.log(`SKIP: ${why}`);
                return;
            }
            const path = GLib.getenv('GJSIFY_VAD_TEST_WAV');
            if (path === null || path === '') {
                console.log('SKIP: GJSIFY_VAD_TEST_WAV is not set (no speech fixture is committed — see the header)');
                return;
            }
            const { samples, sampleRate } = readWavPcm16(path);
            const vad = createVad({ model: DEFAULT_VAD_MODEL, sampleRate });
            try {
                const events: VadEvent[] = [];
                // 100 ms chunks, the size a capture source actually delivers.
                const step = Math.max(1, Math.round(sampleRate / 10));
                for (let at = 0; at < samples.length; at += step) {
                    events.push(...vad.accept(samples.subarray(at, Math.min(at + step, samples.length))));
                }
                events.push(...vad.flush());

                const ends = events.filter((event): event is SpeechEndEvent => event.type === 'speech-end');
                expect(ends.length > 0).toBe(true);
                // Every end is preceded by a start, and each segment is inside
                // the stream it came from and at least `minSpeechMs` long.
                let starts = 0;
                for (const event of events) {
                    if (event.type === 'speech-start') starts++;
                    else expect(starts > 0).toBe(true);
                }
                expect(starts >= ends.length).toBe(true);
                const total = samples.length / sampleRate;
                for (const end of ends) {
                    expect(end.start >= 0).toBe(true);
                    expect(end.end <= total + 1e-6).toBe(true);
                    expect(end.duration >= vad.minSpeechMs / 1000).toBe(true);
                    expect(end.samples.length).toBe(Math.round(end.duration * sampleRate));
                    expect(end.startSample).toBe(Math.round(end.start * sampleRate));
                }
            } finally {
                vad.close();
            }
        });
    });
};
