// `ImageGenerator` against a fake engine: the checks it owns, the queue, abort
// and destroy. No model, no addon.

import { describe, expect, it } from '@gjsify/unit';

import { encodePng } from './encode.js';
import type { ImageEngine, ImageEngineFactory, ImageRequest, ImageResult } from './engine.js';
import { ImageGenerator } from './generator.js';

interface FakeOptions {
    /** What the engine returns; default a 1x1 PNG. */
    result?: (request: ImageRequest) => ImageResult;
    /** Held until released, to observe queueing and abort. */
    gate?: Promise<void>;
}

function rgbPng(width: number, height: number): Blob {
    const rgb = new Uint8Array(width * height * 3).fill(0xff);
    return encodePng({ width, height, rgb });
}

function fakeEngine(options: FakeOptions = {}) {
    const log: ImageRequest[] = [];
    let destroyed = 0;
    let running = 0;
    let overlap = false;
    const result =
        options.result ??
        ((request: ImageRequest): ImageResult => ({
            blob: rgbPng(request.width ?? 64, request.height ?? 64),
            width: request.width ?? 64,
            height: request.height ?? 64,
            seed: request.seed ?? 1,
            modelId: 'fake-model',
        }));
    const engine: ImageEngine = {
        info: { name: 'fake', locality: 'local' },
        modelId: 'fake-model',
        backend: 'cpu',
        generate: async (request) => {
            running++;
            if (running > 1) overlap = true;
            log.push(request);
            try {
                await options.gate;
                return result(request);
            } finally {
                running--;
            }
        },
        destroy: async () => {
            destroyed++;
        },
    };
    const factory: ImageEngineFactory = {
        info: engine.info,
        availability: async () => 'available',
        create: async () => engine,
    };
    return {
        factory,
        log,
        get destroyed() {
            return destroyed;
        },
        get overlap() {
            return overlap;
        },
    };
}

function deferred() {
    let release = () => {};
    const promise = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { promise, release };
}

export default async () => {
    await describe('ImageGenerator', async () => {
        await it('forwards availability and exposes the engine', async () => {
            const fake = fakeEngine();
            expect(await ImageGenerator.availability({ engine: fake.factory })).toBe('available');
            const generator = await ImageGenerator.create({ engine: fake.factory });
            expect(generator.engine.name).toBe('fake');
            expect(generator.modelId).toBe('fake-model');
            expect(generator.backend).toBe('cpu');
            await generator.destroy();
        });

        await it('generates an image', async () => {
            const generator = await ImageGenerator.create({ engine: fakeEngine().factory });
            const result = await generator.generate({ prompt: 'a cat' });
            expect(result.blob.size).toBeGreaterThan(0);
            expect(result.width).toBe(64);
            expect(result.height).toBe(64);
            expect(result.modelId).toBe('fake-model');
            await generator.destroy();
        });

        await it('validates the request', async () => {
            const generator = await ImageGenerator.create({ engine: fakeEngine().factory });
            await expect(generator.generate({ prompt: '' })).rejects.toThrow(/prompt/);
            await expect(generator.generate({ prompt: 'x', width: 0 })).rejects.toThrow(/width/);
            await expect(generator.generate({ prompt: 'x', height: -1 })).rejects.toThrow(/height/);
            await expect(generator.generate({ prompt: 'x', steps: 1.5 })).rejects.toThrow(/steps/);
            await expect(generator.generate({ prompt: 'x', guidance: -1 })).rejects.toThrow(/guidance/);
            await expect(generator.generate({ prompt: 'x', seed: 1.5 })).rejects.toThrow(/seed/);
            await expect(
                generator.generate({
                    prompt: 'x',
                    init: { width: 2, height: 2, rgb: new Uint8Array(10), strength: 0.5 },
                }),
            ).rejects.toThrow(/rgb/);
            await expect(
                generator.generate({
                    prompt: 'x',
                    init: { width: 2, height: 2, rgb: new Uint8Array(12), strength: 2 },
                }),
            ).rejects.toThrow(/strength/);
            await expect(
                generator.generate({
                    prompt: 'x',
                    loras: [{ path: '', multiplier: 1 }],
                }),
            ).rejects.toThrow(/path/);
            await generator.destroy();
        });

        await it('rejects an engine that reports no modelId', async () => {
            const factory: ImageEngineFactory = {
                info: { name: 'bad', locality: 'local' },
                availability: async () => 'available',
                create: async () =>
                    ({
                        info: { name: 'bad', locality: 'local' },
                        modelId: '',
                        generate: async () => ({ blob: new Blob(), width: 1, height: 1, seed: 1, modelId: '' }),
                        destroy: async () => {},
                    }) as unknown as ImageEngine,
            };
            await expect(ImageGenerator.create({ engine: factory })).rejects.toThrow(/modelId/);
        });

        await it('rejects malformed engine results', async () => {
            const noBlob = fakeEngine({
                result: () => ({ blob: new Blob([]), width: 1, height: 1, seed: 1, modelId: 'fake-model' }),
            });
            const generator = await ImageGenerator.create({ engine: noBlob.factory });
            await expect(generator.generate({ prompt: 'x' })).rejects.toThrow(/empty/);
            await generator.destroy();
        });

        await it('runs one call at a time', async () => {
            const gate = deferred();
            const fake = fakeEngine({ gate: gate.promise });
            const generator = await ImageGenerator.create({ engine: fake.factory });
            const first = generator.generate({ prompt: 'one' });
            const second = generator.generate({ prompt: 'two' });
            await Promise.resolve();
            gate.release();
            await Promise.all([first, second]);
            expect(fake.overlap).toBe(false);
            expect(fake.log.map((r) => r.prompt)).toStrictEqual(['one', 'two']);
            await generator.destroy();
        });

        await it('rejects at once on abort, and the next call still runs', async () => {
            const gate = deferred();
            const fake = fakeEngine({ gate: gate.promise });
            const generator = await ImageGenerator.create({ engine: fake.factory });
            const controller = new AbortController();
            const call = generator.generate({ prompt: 'slow' }, { signal: controller.signal });
            controller.abort(new Error('stop'));
            await expect(call).rejects.toThrow(/stop/);
            gate.release();
            expect((await generator.generate({ prompt: 'next' })).width).toBe(64);
            await generator.destroy();
        });

        await it('rejects an already aborted call without asking the engine', async () => {
            const fake = fakeEngine();
            const generator = await ImageGenerator.create({ engine: fake.factory });
            await expect(
                generator.generate({ prompt: 'x' }, { signal: AbortSignal.abort(new Error('early')) }),
            ).rejects.toThrow(/early/);
            expect(fake.log).toStrictEqual([]);
            await expect(
                ImageGenerator.create({ engine: fake.factory, signal: AbortSignal.abort(new Error('no')) }),
            ).rejects.toThrow(/no/);
            await generator.destroy();
        });

        await it('destroys once, after the running call, and rejects later calls', async () => {
            const gate = deferred();
            const fake = fakeEngine({ gate: gate.promise });
            const generator = await ImageGenerator.create({ engine: fake.factory });
            const running = generator.generate({ prompt: 'q' });
            const destroying = generator.destroy();
            await Promise.resolve();
            expect(fake.destroyed).toBe(0);
            gate.release();
            expect((await running).width).toBe(64);
            await destroying;
            await generator.destroy();
            expect(fake.destroyed).toBe(1);
            await expect(generator.generate({ prompt: 'q' })).rejects.toThrow(/destroyed/);
        });
    });
};
