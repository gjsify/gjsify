// `Embedder` against a fake engine: the checks it owns, the queue, abort and
// destroy. No model, no addon.

import { describe, expect, it } from '@gjsify/unit';

import { Embedder } from './embedder.js';
import type { EmbedDocument, EmbeddingEngine, EmbeddingEngineFactory } from './engine.js';

interface FakeOptions {
    dimensions?: number;
    /** What the engine returns for one text; default a valid vector. */
    vector?: (text: string) => Float32Array | number[];
    /** Held until released, to observe queueing and abort. */
    gate?: Promise<void>;
}

function fakeEngine(options: FakeOptions = {}) {
    const dimensions = options.dimensions ?? 3;
    const log: string[] = [];
    let destroyed = 0;
    let running = 0;
    let overlap = false;
    const one = (text: string) =>
        (options.vector ?? (() => new Float32Array(dimensions).fill(1)))(text) as Float32Array;
    const call = async (texts: string[]) => {
        running++;
        if (running > 1) overlap = true;
        log.push(...texts);
        try {
            await options.gate;
            return texts.map(one);
        } finally {
            running--;
        }
    };
    const engine: EmbeddingEngine = {
        info: { name: 'fake', locality: 'local' },
        modelId: 'fake-model',
        dimensions,
        backend: 'cpu',
        embedQuery: async (text) => (await call([text]))[0],
        embedDocuments: async (documents: readonly EmbedDocument[]) => call(documents.map((d) => d.text)),
        destroy: async () => {
            destroyed++;
        },
    };
    const factory: EmbeddingEngineFactory = {
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
    await describe('Embedder', async () => {
        await it('forwards availability and exposes the engine', async () => {
            const fake = fakeEngine();
            expect(await Embedder.availability({ engine: fake.factory })).toBe('available');
            const embedder = await Embedder.create({ engine: fake.factory });
            expect(embedder.engine.name).toBe('fake');
            expect(embedder.modelId).toBe('fake-model');
            expect(embedder.dimensions).toBe(3);
            expect(embedder.backend).toBe('cpu');
        });

        await it('embeds a query and documents', async () => {
            const embedder = await Embedder.create({ engine: fakeEngine().factory });
            expect((await embedder.embedQuery('q')).length).toBe(3);
            const vectors = await embedder.embedDocuments([{ text: 'a' }, { title: 't', text: 'b' }]);
            expect(vectors.length).toBe(2);
            expect(await embedder.embedDocuments([])).toStrictEqual([]);
        });

        await it('rejects a non-finite, zero or wrongly sized vector', async () => {
            const nan = await Embedder.create({
                engine: fakeEngine({ vector: () => new Float32Array([1, Number.NaN, 1]) }).factory,
            });
            await expect(nan.embedQuery('q')).rejects.toThrow(/non-finite/);
            const zero = await Embedder.create({ engine: fakeEngine({ vector: () => new Float32Array(3) }).factory });
            await expect(zero.embedQuery('q')).rejects.toThrow(/zero-norm/);
            const short = await Embedder.create({
                engine: fakeEngine({ vector: () => new Float32Array([1, 1]) }).factory,
            });
            await expect(short.embedQuery('q')).rejects.toThrow(/2 dimensions, 3 expected/);
            const plain = await Embedder.create({ engine: fakeEngine({ vector: () => [1, 1, 1] }).factory });
            await expect(plain.embedQuery('q')).rejects.toThrow(/not a Float32Array/);
        });

        await it('refuses an engine without a usable size', async () => {
            const fake = fakeEngine({ dimensions: 0 });
            await expect(Embedder.create({ engine: fake.factory })).rejects.toThrow(/0 dimensions/);
            expect(fake.destroyed).toBe(1);
        });

        await it('runs one call at a time', async () => {
            const gate = deferred();
            const fake = fakeEngine({ gate: gate.promise });
            const embedder = await Embedder.create({ engine: fake.factory });
            const first = embedder.embedQuery('one');
            const second = embedder.embedQuery('two');
            await Promise.resolve();
            gate.release();
            await Promise.all([first, second]);
            expect(fake.overlap).toBe(false);
            expect(fake.log).toStrictEqual(['one', 'two']);
        });

        await it('rejects at once on abort, and the next call still runs', async () => {
            const gate = deferred();
            const fake = fakeEngine({ gate: gate.promise });
            const embedder = await Embedder.create({ engine: fake.factory });
            const controller = new AbortController();
            const call = embedder.embedQuery('slow', { signal: controller.signal });
            controller.abort(new Error('stop'));
            await expect(call).rejects.toThrow(/stop/);
            gate.release();
            expect((await embedder.embedQuery('next')).length).toBe(3);
        });

        await it('rejects an already aborted call without asking the engine', async () => {
            const fake = fakeEngine();
            const embedder = await Embedder.create({ engine: fake.factory });
            await expect(embedder.embedQuery('q', { signal: AbortSignal.abort(new Error('early')) })).rejects.toThrow(
                /early/,
            );
            expect(fake.log).toStrictEqual([]);
            await expect(
                Embedder.create({ engine: fake.factory, signal: AbortSignal.abort(new Error('no')) }),
            ).rejects.toThrow(/no/);
        });

        await it('destroys once, after the running call, and rejects later calls', async () => {
            const gate = deferred();
            const fake = fakeEngine({ gate: gate.promise });
            const embedder = await Embedder.create({ engine: fake.factory });
            const running = embedder.embedQuery('q');
            const destroying = embedder.destroy();
            await Promise.resolve();
            expect(fake.destroyed).toBe(0);
            gate.release();
            expect((await running).length).toBe(3);
            await destroying;
            await embedder.destroy();
            expect(fake.destroyed).toBe(1);
            await expect(embedder.embedQuery('q')).rejects.toThrow(/destroyed/);
        });
    });
};
