// `Embedder` in the WebML CG lifecycle shape (ADR 0132 § 2): a static
// `availability()`, `create({ monitor, signal })`, and `destroy()`. The engine
// does the work; this class owns what every engine would otherwise repeat:
// the vector check, the size check, one call at a time, and the destroyed state.

import type {
    Availability,
    EmbedCallOptions,
    EmbedDocument,
    EmbeddingEngine,
    EmbeddingEngineFactory,
    EngineCreateOptions,
    EngineInfo,
} from './engine.js';
import { checkVector } from './vectors.js';

export interface EmbedderAvailabilityOptions {
    readonly engine: EmbeddingEngineFactory;
}

export interface EmbedderCreateOptions extends EngineCreateOptions {
    readonly engine: EmbeddingEngineFactory;
}

/** Rejects with the signal's reason once it aborts; the work itself runs on. */
function untilAborted(signal: AbortSignal | undefined): { promise: Promise<never>; dispose(): void } {
    if (signal === undefined) return { promise: new Promise<never>(() => {}), dispose() {} };
    let onAbort = (): void => {};
    const promise = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
    });
    return { promise, dispose: () => signal.removeEventListener('abort', onAbort) };
}

export class Embedder {
    readonly #engine: EmbeddingEngine;
    /** The previous call, settled or not: an engine takes one call at a time. */
    #queue: Promise<unknown> = Promise.resolve();
    #destroyed = false;

    private constructor(engine: EmbeddingEngine) {
        this.#engine = engine;
    }

    static availability(options: EmbedderAvailabilityOptions): Promise<Availability> {
        return options.engine.availability();
    }

    /** Downloads the model when the engine needs one and it is missing, then loads it. */
    static async create(options: EmbedderCreateOptions): Promise<Embedder> {
        options.signal?.throwIfAborted();
        const engine = await options.engine.create({ monitor: options.monitor, signal: options.signal });
        if (options.signal?.aborted) {
            await engine.destroy().catch(() => undefined);
            options.signal.throwIfAborted();
        }
        if (!Number.isInteger(engine.dimensions) || engine.dimensions <= 0) {
            await engine.destroy().catch(() => undefined);
            throw new Error(`engine ${engine.info.name} reports ${engine.dimensions} dimensions`);
        }
        return new Embedder(engine);
    }

    get engine(): EngineInfo {
        return this.#engine.info;
    }

    get modelId(): string {
        return this.#engine.modelId;
    }

    get dimensions(): number {
        return this.#engine.dimensions;
    }

    get backend(): 'gpu' | 'cpu' | undefined {
        return this.#engine.backend;
    }

    async embedQuery(text: string, options: EmbedCallOptions = {}): Promise<Float32Array> {
        const [vector] = await this.#run(1, options, (signal) =>
            this.#engine.embedQuery(text, { signal }).then((v) => [v]),
        );
        return vector;
    }

    async embedDocuments(documents: readonly EmbedDocument[], options: EmbedCallOptions = {}): Promise<Float32Array[]> {
        if (documents.length === 0) return [];
        return this.#run(documents.length, options, (signal) => this.#engine.embedDocuments(documents, { signal }));
    }

    /** Waits for a running call, then frees the model. Later calls reject. */
    async destroy(): Promise<void> {
        if (this.#destroyed) return;
        this.#destroyed = true;
        await this.#queue.catch(() => undefined);
        await this.#engine.destroy();
    }

    #run(
        count: number,
        options: EmbedCallOptions,
        work: (signal: AbortSignal | undefined) => Promise<Float32Array[]>,
    ): Promise<Float32Array[]> {
        if (this.#destroyed) return Promise.reject(new Error('Embedder was destroyed'));
        const { signal } = options;
        if (signal?.aborted) return Promise.reject(signal.reason);
        // A call accepted before `destroy()` still runs: destroy waits for the queue.
        const call = this.#queue
            .catch(() => undefined)
            .then(async () => {
                signal?.throwIfAborted();
                const vectors = await work(signal);
                if (vectors.length !== count) {
                    throw new Error(
                        `engine ${this.#engine.info.name} returned ${vectors.length} vectors for ${count} inputs`,
                    );
                }
                for (const vector of vectors) {
                    if (!(vector instanceof Float32Array))
                        throw new TypeError('engine returned a vector that is not a Float32Array');
                    if (vector.length !== this.#engine.dimensions) {
                        throw new Error(
                            `engine returned ${vector.length} dimensions, ${this.#engine.dimensions} expected`,
                        );
                    }
                    checkVector(vector);
                }
                return vectors;
            });
        this.#queue = call;
        // Aborting rejects the caller at once; the queue still waits for the engine to settle.
        const aborted = untilAborted(signal);
        return Promise.race([call, aborted.promise]).finally(aborted.dispose);
    }
}
