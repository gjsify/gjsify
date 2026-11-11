// The manifest and the Web Speech `available()` / `install()` additions. NOTHING HERE
// DOWNLOADS ANYTHING (ADR 0127 decision 14): the cache is a temporary directory and
// `install()` is only ever asked for what it must refuse.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { hasRecognitionBackend } from './backend.js';
import { DEFAULT_RECOGNITION_MODEL, findRecognitionModel, modelFor, RECOGNITION_MODELS } from './model-manifest.js';
import { SpeechRecognition } from './recognition.js';
import { SpeechRecognitionPhrase } from './results.js';

async function withTempCache(body: () => Promise<void>): Promise<void> {
    const saved = process.env.XDG_CACHE_HOME;
    const dir = mkdtempSync(join(tmpdir(), 'speechrec-cache-'));
    process.env.XDG_CACHE_HOME = dir;
    try {
        await body();
    } finally {
        if (saved === undefined) delete process.env.XDG_CACHE_HOME;
        else process.env.XDG_CACHE_HOME = saved;
        rmSync(dir, { recursive: true, force: true });
    }
}

async function rejectionName(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
        return '';
    } catch (error) {
        return (error as Error).name;
    }
}

export default async () => {
    await describe('recognition model manifest', async () => {
        await it('has a default entry, unique ids and a measured digest for every file', async () => {
            expect(findRecognitionModel(DEFAULT_RECOGNITION_MODEL)?.id).toBe(DEFAULT_RECOGNITION_MODEL);
            expect(new Set(RECOGNITION_MODELS.map((m) => m.id)).size).toBe(RECOGNITION_MODELS.length);
            for (const model of RECOGNITION_MODELS) {
                expect(model.license.length > 0).toBe(true);
                for (const file of model.files) {
                    expect(file.bytes > 0).toBe(true);
                    expect(/^[0-9a-f]{64}$/.test(file.sha256)).toBe(true);
                    expect(file.url.startsWith('https://')).toBe(true);
                }
                for (const role of [model.encoder, model.decoder, model.joiner, model.tokens]) {
                    expect(model.files.some((f) => f.file === role)).toBe(true);
                }
            }
        });

        await it('matches a primary subtag and refuses more quality than the model offers', async () => {
            expect(modelFor('de-AT')?.id).toBe(DEFAULT_RECOGNITION_MODEL);
            expect(modelFor('DE')?.id).toBe(DEFAULT_RECOGNITION_MODEL);
            expect(modelFor('en-US')).toBe(undefined);
            expect(modelFor('de', 'dictation')?.id).toBe(DEFAULT_RECOGNITION_MODEL);
            expect(modelFor('de', 'conversation')).toBe(undefined);
        });
    });

    await describe('SpeechRecognition.available()', async () => {
        await it('answers unavailable for an empty list and for a language without a model', async () => {
            expect(await SpeechRecognition.available({ langs: [] })).toBe('unavailable');
            expect(await SpeechRecognition.available({ langs: ['xx-XX'] })).toBe('unavailable');
            expect(await SpeechRecognition.available({ langs: ['de-DE'], quality: 'conversation' })).toBe(
                'unavailable',
            );
        });

        await it('rejects an invalid BCP 47 tag with SyntaxError', async () => {
            expect(await rejectionName(SpeechRecognition.available({ langs: ['not a tag'] }))).toBe('SyntaxError');
            expect(await rejectionName(SpeechRecognition.available({ langs: ['de', ''] }))).toBe('SyntaxError');
        });

        await it('is downloadable (never available) on a host with an engine and an empty cache', async () => {
            await withTempCache(async () => {
                const state = await SpeechRecognition.available({ langs: ['de-DE'] });
                expect(state).toBe(hasRecognitionBackend() ? 'downloadable' : 'unavailable');
            });
        });

        await it('takes the worst status over several languages', async () => {
            await withTempCache(async () => {
                expect(await SpeechRecognition.available({ langs: ['de', 'xx'] })).toBe('unavailable');
            });
        });
    });

    await describe('SpeechRecognition.install()', async () => {
        await it('resolves false for an empty list and for a language no model serves', async () => {
            expect(await SpeechRecognition.install({ langs: [] })).toBe(false);
            expect(await SpeechRecognition.install({ langs: ['de', 'xx'] })).toBe(false);
        });

        await it('rejects an invalid BCP 47 tag with SyntaxError', async () => {
            expect(await rejectionName(SpeechRecognition.install({ langs: ['???'] }))).toBe('SyntaxError');
        });

        await it('resolves false when the download is refused, and leaves nothing cached', async () => {
            if (!hasRecognitionBackend()) return;
            await withTempCache(async () => {
                const refuse = async () => ({ ok: false, status: 503, headers: { get: () => null } });
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const ok = await SpeechRecognition.install({ langs: ['de'], fetchImpl: refuse as any });
                expect(ok).toBe(false);
                expect(await SpeechRecognition.available({ langs: ['de'] })).toBe('downloadable');
            });
        });
    });

    await describe('SpeechRecognitionPhrase', async () => {
        await it('defaults boost to 1 and refuses a boost outside [0, 10]', async () => {
            expect(new SpeechRecognitionPhrase('gjsify').boost).toBe(1);
            expect(new SpeechRecognitionPhrase('x', 10).boost).toBe(10);
            for (const boost of [-0.1, 10.1, NaN]) {
                let name = '';
                try {
                    new SpeechRecognitionPhrase('x', boost);
                } catch (error) {
                    name = (error as Error).name;
                }
                expect(name).toBe('SyntaxError');
            }
        });
    });
};
