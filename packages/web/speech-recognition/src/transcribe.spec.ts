// `transcribe()` on the scripted offline engine. SILENT and FILE-ONLY: the file legs decode
// the committed fixtures through media-capture's `filesrc ! decodebin ! appsink` chain, so
// nothing is played, recorded or downloaded.

import GLib from 'gi://GLib?version=2.0';
import { describe, expect, it } from '@gjsify/unit';

import { createFakeOfflineEngine } from './fake-offline-engine.js';
import { DEFAULT_TRANSCRIBE_MODEL, findRecognitionModel, modelFor } from './model-manifest.js';
import { SpeechRecognitionPhrase } from './results.js';
import { transcribe } from './transcribe.js';

async function rejectionName(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
    } catch (error) {
        return (error as Error).name;
    }
    return 'resolved';
}

function fixture(name: string): string {
    const uri = new URL(`./src/fixtures/${name}`, import.meta.url).href;
    return GLib.filename_from_uri(uri)[0];
}

export default async () => {
    await describe('offline model manifest', async () => {
        await it('keeps the streaming and the offline pick apart', async () => {
            expect(modelFor('de', 'command')?.kind).toBe('streaming');
            expect(modelFor('de', 'conversation', 'offline')?.id).toBe(DEFAULT_TRANSCRIBE_MODEL);
            expect(modelFor('de', 'conversation')).toBe(undefined);
        });

        await it('verifies the offline model by size and digest', async () => {
            const entry = findRecognitionModel(DEFAULT_TRANSCRIBE_MODEL)!;
            expect(entry.kind).toBe('offline');
            expect(entry.modelType).toBe('nemo_transducer');
            for (const file of entry.files) {
                expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
                expect(file.bytes).toBeGreaterThan(0);
            }
        });
    });

    await describe('transcribe()', async () => {
        await it('decodes PCM and reports text, language and engine', async () => {
            const engine = createFakeOfflineEngine({ name: 'fake/test' });
            engine.answer({ text: 'hallo welt', language: 'de' });
            const pcm = new Float32Array(16000);
            const result = await transcribe(pcm, { engine: () => engine });
            expect(result).toStrictEqual({ text: 'hallo welt', language: 'de', engine: 'fake/test' });
            expect(engine.recordings[0]).toBe(pcm);
            expect(engine.opened).toBe(true);
            expect(engine.closed).toBe(true);
        });

        await it('passes phrases only to an engine that supports hotwords', async () => {
            const phrases = [new SpeechRecognitionPhrase('Curlew', 3), new SpeechRecognitionPhrase('Lotsman')];
            const biased = createFakeOfflineEngine({ hotwords: true });
            await transcribe(new Float32Array(160), { phrases, engine: () => biased });
            expect(biased.calls[0]?.hotwords).toStrictEqual(['Curlew', 'Lotsman']);

            const plain = createFakeOfflineEngine({ hotwords: false });
            await transcribe(new Float32Array(160), { phrases, engine: () => plain });
            expect(plain.calls[0]?.hotwords).toBe(undefined);
        });

        await it('closes the engine when decoding fails', async () => {
            const engine = createFakeOfflineEngine();
            engine.failWith(new Error('boom'));
            expect(await rejectionName(transcribe(new Float32Array(160), { engine: () => engine }))).toBe('Error');
            expect(engine.closed).toBe(true);
        });

        await it('rejects with AbortError before touching the engine', async () => {
            const engine = createFakeOfflineEngine();
            const controller = new AbortController();
            controller.abort();
            const name = await rejectionName(
                transcribe(new Float32Array(160), { signal: controller.signal, engine: () => engine }),
            );
            expect(name).toBe('AbortError');
            expect(engine.opened).toBe(false);
        });

        await it('rejects a streaming model, an unknown model and a bad source', async () => {
            const engine = () => createFakeOfflineEngine();
            expect(await rejectionName(transcribe(new Float32Array(1), { model: 'zipformer-de-kroko', engine }))).toBe(
                'TypeError',
            );
            expect(await rejectionName(transcribe(new Float32Array(1), { model: 'nope', engine }))).toBe(
                'NotFoundError',
            );
            expect(await rejectionName(transcribe(42 as unknown as string, { engine }))).toBe('TypeError');
        });

        await it('decodes a WAV file to 16 kHz mono floats through media-capture', async () => {
            const engine = createFakeOfflineEngine();
            await transcribe(fixture('speech-de.wav'), { engine: () => engine });
            const seconds = engine.recordings[0].length / 16000;
            expect(seconds).toBeGreaterThan(3);
            expect(seconds).toBeLessThan(4);
        });

        await it('decodes an Ogg/Opus voice note and accepts a Gio.File-like source', async () => {
            const engine = createFakeOfflineEngine();
            const path = fixture('speech-de.opus');
            await transcribe({ get_path: () => path }, { engine: () => engine });
            const seconds = engine.recordings[0].length / 16000;
            expect(seconds).toBeGreaterThan(3);
            expect(seconds).toBeLessThan(4);
        });
    });
};
