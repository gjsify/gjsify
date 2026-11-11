// The session against the REAL sherpa-onnx engine and the real zipformer model.
// SILENT and FILE-ONLY: no microphone, no audio output, nothing downloaded
// (ADR 0127 decision 14). Skips — loudly, with the reason — on a host without the
// prebuild or without the cached model, which is every CI runner today.
//
// A real recording is someone's voice and cannot be committed, so the speech leg
// runs only when GJSIFY_SPEECHREC_TEST_WAV points at a 16 kHz mono PCM16 German
// file and GJSIFY_SPEECHREC_EXPECT lists words (comma-separated, case-insensitive)
// the final must contain. Accuracy is never an exact string: the engine's
// mishearings are a measurement, not a regression. Without them the suite proves
// that silence produces no result, which catches a model read at the wrong rate.

import GLib from 'gi://GLib?version=2.0';
import { describe, expect, it } from '@gjsify/unit';

import { describeRecognitionBackend, hasRecognitionBackend } from './backend.js';
import { DEFAULT_RECOGNITION_MODEL, findRecognitionModel } from './model-manifest.js';
import { isModelCached } from './models.js';
import { SpeechRecognition, type PcmReader } from './recognition.js';
import type { SpeechRecognitionErrorEvent, SpeechRecognitionEvent } from './events.js';

function blocker(): string | null {
    if (!hasRecognitionBackend()) return `no native engine — ${describeRecognitionBackend()}`;
    if (!isModelCached(findRecognitionModel(DEFAULT_RECOGNITION_MODEL)!)) {
        return `model '${DEFAULT_RECOGNITION_MODEL}' is not cached; install() is not run from tests`;
    }
    return null;
}

/** Samples of a canonical mono PCM16 WAV; refuses any other layout instead of reinterpreting it. */
function readWavPcm16(path: string): Int16Array {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok) throw new Error(`Cannot read ${path}`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error(`${path} is not a RIFF/WAVE file`);
    let data: Int16Array | null = null;
    for (let at = 12; at + 8 <= view.byteLength;) {
        const size = view.getUint32(at + 4, true);
        const body = at + 8;
        if (tag(at) === 'fmt ') {
            const rate = view.getUint32(body + 4, true);
            if (view.getUint16(body + 2, true) !== 1 || view.getUint16(body + 14, true) !== 16 || rate !== 16000) {
                throw new Error(`${path} must be 16 kHz mono PCM16`);
            }
        } else if (tag(at) === 'data') {
            const length = Math.min(size, view.byteLength - body) >> 1;
            data = new Int16Array(length);
            for (let i = 0; i < length; i++) data[i] = view.getInt16(body + i * 2, true);
        }
        at = body + size + (size & 1);
    }
    if (data === null) throw new Error(`${path} has no data chunk`);
    return data;
}

function readerOf(samples: Int16Array): PcmReader {
    let at = 0;
    return {
        sampleRate: 16000,
        format: 'S16LE',
        async read() {
            if (at >= samples.length) return null;
            const chunk = samples.subarray(at, at + 1600);
            at += 1600;
            return chunk;
        },
        stop() {
            at = samples.length;
        },
    };
}

async function recognize(samples: Int16Array): Promise<{ finals: string[]; errors: string[] }> {
    const recognition = new SpeechRecognition({ source: () => readerOf(samples) });
    recognition.lang = 'de-DE';
    recognition.continuous = true;
    const finals: string[] = [];
    const errors: string[] = [];
    recognition.onresult = (event) => {
        const { results } = event as unknown as SpeechRecognitionEvent;
        const last = results.item(results.length - 1);
        if (last.isFinal) finals.push(last.item(0).transcript);
    };
    recognition.onerror = (event) => errors.push((event as unknown as SpeechRecognitionErrorEvent).error);
    await new Promise<void>((resolve) => {
        recognition.onend = () => resolve();
        recognition.start();
    });
    return { finals, errors };
}

export default async () => {
    await describe('SpeechRecognition on the real engine', async () => {
        const reason = blocker();
        if (reason !== null) {
            await it(`skips: ${reason}`, async () => {
                console.warn(`[speech-recognition] real-engine suite skipped — ${reason}`);
            });
            return;
        }

        await it('produces no result for silence', async () => {
            const { finals, errors } = await recognize(new Int16Array(16000 * 2));
            expect(finals.length).toBe(0);
            expect(errors).toStrictEqual(['no-speech']);
        });

        const wav = GLib.getenv('GJSIFY_SPEECHREC_TEST_WAV');
        const expected = (GLib.getenv('GJSIFY_SPEECHREC_EXPECT') ?? '')
            .split(',')
            .map((w) => w.trim().toLowerCase())
            .filter(Boolean);
        if (wav === null || expected.length === 0) return;

        await it('transcribes a German recording to a final containing the expected words', async () => {
            const { finals } = await recognize(readWavPcm16(wav));
            const text = finals.join(' ').toLowerCase();
            for (const word of expected) expect(text.includes(word)).toBe(true);
        });
    });
};
