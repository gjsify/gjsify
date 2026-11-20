// `transcribe()` against the REAL sherpa-onnx offline engine and the cached Parakeet model.
// SILENT and FILE-ONLY; skips — loudly, with the reason — without the prebuild or the
// cached model (every CI runner today). The fixture is a synthetic espeak-ng voice, so it
// is committable; accuracy is asserted as words the text must contain, never an exact string.

import GLib from 'gi://GLib?version=2.0';
import { describe, expect, it } from '@gjsify/unit';

import { describeRecognitionBackend, hasRecognitionBackend } from './backend.js';
import { DEFAULT_TRANSCRIBE_MODEL, findRecognitionModel } from './model-manifest.js';
import { isModelCached } from './models.js';
import { transcribe } from './transcribe.js';

function blocker(): string | null {
    if (!hasRecognitionBackend()) return `no native engine — ${describeRecognitionBackend()}`;
    if (!isModelCached(findRecognitionModel(DEFAULT_TRANSCRIBE_MODEL)!)) {
        return `model '${DEFAULT_TRANSCRIBE_MODEL}' is not cached; install() is not run from tests`;
    }
    return null;
}

function fixture(name: string): string {
    return GLib.filename_from_uri(new URL(`./src/fixtures/${name}`, import.meta.url).href)[0];
}

export default async () => {
    await describe('transcribe() on the real offline engine', async () => {
        const reason = blocker();
        if (reason !== null) {
            await it(`skips: ${reason}`, async () => {
                console.warn(`[speech-recognition] real transcribe suite skipped — ${reason}`);
            });
            return;
        }

        await it('returns no words for silence', async () => {
            const result = await transcribe(new Float32Array(16000 * 2));
            expect(result.engine).toBe(`sherpa-onnx/${DEFAULT_TRANSCRIBE_MODEL}`);
            expect(result.text.trim().split(/\s+/).filter(Boolean).length).toBeLessThan(3);
        });

        for (const name of ['speech-de.wav', 'speech-de.opus']) {
            await it(`transcribes ${name} to text containing the spoken words`, async () => {
                const result = await transcribe(fixture(name), { lang: 'de-DE' });
                const text = result.text.toLowerCase();
                for (const word of ['test', 'spracherkennung']) expect(text.includes(word)).toBe(true);
            });
        }
    });
};
