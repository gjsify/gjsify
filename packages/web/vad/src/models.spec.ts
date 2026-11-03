// The manifest and the model cache. NOTHING HERE DOWNLOADS ANYTHING (ADR 0127
// decision 14): `install()` is exercised through an injected `fetchImpl`, and
// every case asserted is one that is refused BEFORE a byte reaches disk, so the
// suite neither reaches the network nor writes into the real cache directory.
//
// The successful write path — digest, atomic rename, the in-flight share — is
// covered by `real-vad.spec.ts`, which runs only where a model is already
// cached.

import { describe, expect, it } from '@gjsify/unit';

import { _resetVadBackendCache, loadVadBackend, type VadBackend } from './backend.js';
import { DEFAULT_VAD_MODEL, findVadModel, requireVadModel, VAD_MODELS } from './model-manifest.js';
import { available, install, listModels, modelCacheDir, modelPath, resolveModel } from './models.js';

/** Make the probe report a usable engine without loading one. */
function withFakeBackend<T>(body: () => T): T {
    _resetVadBackendCache();
    loadVadBackend({ load: () => ({}) as unknown as NonNullable<VadBackend['module']> });
    try {
        return body();
    } finally {
        _resetVadBackendCache();
    }
}

/** A `Response` with just the fields `install()` reads. */
function fakeResponse(body: Uint8Array, init: { status?: number; contentLength?: string | null } = {}) {
    const contentLength = init.contentLength === undefined ? String(body.length) : init.contentLength;
    return {
        ok: (init.status ?? 200) < 400,
        status: init.status ?? 200,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-length' ? contentLength : null) },
        arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asFetch = (impl: (url: any, init?: any) => Promise<any>) => impl as any;

export default async () => {
    await describe('VAD model manifest', async () => {
        await it('has a default entry and unique ids', async () => {
            expect(VAD_MODELS.length > 0).toBe(true);
            expect(findVadModel(DEFAULT_VAD_MODEL)?.id).toBe(DEFAULT_VAD_MODEL);
            expect(new Set(VAD_MODELS.map((m) => m.id)).size).toBe(VAD_MODELS.length);
            expect(new Set(VAD_MODELS.map((m) => m.file)).size).toBe(VAD_MODELS.length);
        });

        await it('records a size, a lowercase sha256 and a licence for every entry', async () => {
            for (const model of VAD_MODELS) {
                expect(model.bytes > 0).toBe(true);
                expect(/^[0-9a-f]{64}$/.test(model.sha256)).toBe(true);
                expect(model.license.length > 0).toBe(true);
                expect(model.sampleRate > 0).toBe(true);
                expect(model.windowSize > 0).toBe(true);
            }
        });

        await it('fetches from upstream over https, never from a mirror of ours', async () => {
            for (const model of VAD_MODELS) {
                expect(model.url.startsWith('https://github.com/k2-fsa/sherpa-onnx/releases/')).toBe(true);
                expect(model.url.endsWith(model.file)).toBe(true);
            }
        });

        await it('names the known ids when asked for one that does not exist', async () => {
            expect(findVadModel('nope')).toBe(undefined);
            expect(() => requireVadModel('nope')).toThrow(/silero-v5/);
        });
    });

    await describe('VAD model cache', async () => {
        await it('caches under gjsify/speech-models, shared with the other speech packages', async () => {
            expect(modelCacheDir().endsWith('/gjsify/speech-models')).toBe(true);
            expect(modelPath(DEFAULT_VAD_MODEL).endsWith('/silero_vad_v5.onnx')).toBe(true);
            expect(() => modelPath('nope')).toThrow(RangeError);
        });

        await it('passes a path through resolveModel and refuses an uncached id', async () => {
            expect(resolveModel('/tmp/some/silero.onnx')).toBe('/tmp/some/silero.onnx');
            // A relative path still counts as a path: it has a separator.
            expect(resolveModel('./silero.onnx')).toBe('./silero.onnx');
            const entry = requireVadModel('silero-v4');
            if (available('silero-v4') === 'available') {
                expect(resolveModel('silero-v4').endsWith(entry.file)).toBe(true);
            } else {
                // The message has to carry the size and the URL — it is what an
                // app shows when a model is missing.
                expect(() => resolveModel('silero-v4')).toThrow(new RegExp(String(entry.bytes)));
            }
        });

        await it('reports unavailable, not downloadable, when there is no engine', async () => {
            _resetVadBackendCache();
            loadVadBackend({ load: () => null, loadError: () => new Error('no typelib (test)') });
            try {
                expect(available()).toBe('unavailable');
                for (const { availability } of listModels()) expect(availability).toBe('unavailable');
                await expect(install()).rejects.toThrow(/no native VAD engine/);
            } finally {
                _resetVadBackendCache();
            }
        });

        await it('refuses an unknown id before anything else', async () => {
            expect(() => available('nope')).toThrow(RangeError);
            await expect(install('nope')).rejects.toThrow(RangeError);
        });
    });

    await describe('install() verification', async () => {
        await it('refuses a Content-Length that disagrees with the manifest, without reading the body', async () => {
            await withFakeBackend(async () => {
                let bodyRead = false;
                const fetchImpl = asFetch(async () => ({
                    ...fakeResponse(new Uint8Array(0), { contentLength: '123' }),
                    arrayBuffer: async () => {
                        bodyRead = true;
                        return new ArrayBuffer(0);
                    },
                }));
                await expect(install('silero-v4', { fetchImpl })).rejects.toThrow(/declares 123 bytes/);
                expect(bodyRead).toBe(false);
            });
        });

        await it('refuses a body whose length is not the manifest size', async () => {
            await withFakeBackend(async () => {
                const fetchImpl = asFetch(async () => fakeResponse(new Uint8Array(17), { contentLength: null }));
                await expect(install('silero-v4', { fetchImpl })).rejects.toThrow(/got 17 bytes/);
            });
        });

        await it('refuses a body of the right length whose digest is wrong', async () => {
            await withFakeBackend(async () => {
                const entry = requireVadModel('silero-v4');
                const fetchImpl = asFetch(async () => fakeResponse(new Uint8Array(entry.bytes)));
                await expect(install('silero-v4', { fetchImpl })).rejects.toThrow(
                    new RegExp(`sha256 [0-9a-f]{64}, expected ${entry.sha256}`),
                );
            });
        });

        await it('reports an HTTP failure with its status', async () => {
            await withFakeBackend(async () => {
                const fetchImpl = asFetch(async () => fakeResponse(new Uint8Array(0), { status: 404 }));
                await expect(install('silero-v4', { fetchImpl })).rejects.toThrow(/HTTP 404/);
            });
        });

        await it('shares one download between two overlapping calls', async () => {
            await withFakeBackend(async () => {
                let calls = 0;
                const fetchImpl = asFetch(async () => {
                    calls++;
                    await Promise.resolve();
                    return fakeResponse(new Uint8Array(1), { contentLength: null });
                });
                const both = Promise.all([
                    install('silero-v4', { fetchImpl }).catch(() => 'rejected'),
                    install('silero-v4', { fetchImpl }).catch(() => 'rejected'),
                ]);
                expect(await both).toStrictEqual(['rejected', 'rejected']);
                expect(calls).toBe(1);
            });
        });
    });
};
