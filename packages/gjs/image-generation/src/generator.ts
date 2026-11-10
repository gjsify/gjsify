// `ImageGenerator` in the WebML CG lifecycle shape (ADR 0132 § 2): a static
// `availability()`, `create({ monitor, signal })`, and `destroy()`. The engine
// does the work; this class owns what every engine would otherwise repeat:
// request validation, one call at a time, and the destroyed state.

import type {
    Availability,
    EngineCreateOptions,
    EngineInfo,
    GenerateOptions,
    ImageEngine,
    ImageEngineFactory,
    ImageRequest,
    ImageResult,
} from './engine.js';

export interface ImageGeneratorAvailabilityOptions {
    readonly engine: ImageEngineFactory;
}

export interface ImageGeneratorCreateOptions extends EngineCreateOptions {
    readonly engine: ImageEngineFactory;
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

function validateRequest(request: ImageRequest): void {
    if (!request.prompt || typeof request.prompt !== 'string') {
        throw new TypeError('ImageRequest.prompt must be a non-empty string');
    }
    if (request.width !== undefined && (!Number.isInteger(request.width) || request.width <= 0)) {
        throw new RangeError('ImageRequest.width must be a positive integer');
    }
    if (request.height !== undefined && (!Number.isInteger(request.height) || request.height <= 0)) {
        throw new RangeError('ImageRequest.height must be a positive integer');
    }
    if (request.steps !== undefined && (!Number.isInteger(request.steps) || request.steps <= 0)) {
        throw new RangeError('ImageRequest.steps must be a positive integer');
    }
    if (request.guidance !== undefined && (!Number.isFinite(request.guidance) || request.guidance < 0)) {
        throw new RangeError('ImageRequest.guidance must be a non-negative finite number');
    }
    if (request.seed !== undefined && !Number.isInteger(request.seed)) {
        throw new RangeError('ImageRequest.seed must be an integer');
    }
    if (request.init !== undefined) {
        const { width, height, rgb, strength } = request.init;
        if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
            throw new RangeError('InitImage.width and height must be positive integers');
        }
        if (!(rgb instanceof Uint8Array) || rgb.length !== width * height * 3) {
            throw new RangeError('InitImage.rgb must be a Uint8Array of width * height * 3 bytes');
        }
        if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
            throw new RangeError('InitImage.strength must be between 0 and 1');
        }
    }
    if (request.loras !== undefined) {
        for (const lora of request.loras) {
            if (typeof lora.path !== 'string' || lora.path.length === 0) {
                throw new TypeError('LoraRef.path must be a non-empty string');
            }
            if (!Number.isFinite(lora.multiplier)) {
                throw new TypeError('LoraRef.multiplier must be a finite number');
            }
        }
    }
}

export class ImageGenerator {
    readonly #engine: ImageEngine;
    /** The previous call, settled or not: an engine takes one call at a time. */
    #queue: Promise<unknown> = Promise.resolve();
    #destroyed = false;

    private constructor(engine: ImageEngine) {
        this.#engine = engine;
    }

    static availability(options: ImageGeneratorAvailabilityOptions): Promise<Availability> {
        return options.engine.availability();
    }

    /** Downloads the model when the engine needs one and it is missing, then loads it. */
    static async create(options: ImageGeneratorCreateOptions): Promise<ImageGenerator> {
        options.signal?.throwIfAborted();
        const engine = await options.engine.create({ monitor: options.monitor, signal: options.signal });
        if (options.signal?.aborted) {
            await engine.destroy().catch(() => undefined);
            options.signal.throwIfAborted();
        }
        if (!engine.modelId || typeof engine.modelId !== 'string') {
            await engine.destroy().catch(() => undefined);
            throw new Error(`engine ${engine.info.name} reports no modelId`);
        }
        return new ImageGenerator(engine);
    }

    get engine(): EngineInfo {
        return this.#engine.info;
    }

    get modelId(): string {
        return this.#engine.modelId;
    }

    get backend(): 'gpu' | 'cpu' | undefined {
        return this.#engine.backend;
    }

    async generate(request: ImageRequest, options: GenerateOptions = {}): Promise<ImageResult> {
        validateRequest(request);
        return this.#run(options, (signal) =>
            this.#engine.generate(request, { signal, onProgress: options.onProgress }),
        );
    }

    /** Waits for a running call, then frees the model. Later calls reject. */
    async destroy(): Promise<void> {
        if (this.#destroyed) return;
        this.#destroyed = true;
        await this.#queue.catch(() => undefined);
        await this.#engine.destroy();
    }

    #run(
        options: GenerateOptions,
        work: (signal: AbortSignal | undefined) => Promise<ImageResult>,
    ): Promise<ImageResult> {
        if (this.#destroyed) return Promise.reject(new Error('ImageGenerator was destroyed'));
        const { signal } = options;
        if (signal?.aborted) return Promise.reject(signal.reason);
        const call = this.#queue
            .catch(() => undefined)
            .then(async () => {
                signal?.throwIfAborted();
                const result = await work(signal);
                if (!result.blob || !(result.blob instanceof Blob)) {
                    throw new TypeError(`engine ${this.#engine.info.name} returned no Blob`);
                }
                if (result.blob.size === 0) {
                    throw new Error(`engine ${this.#engine.info.name} returned an empty PNG`);
                }
                if (
                    !Number.isInteger(result.width) ||
                    !Number.isInteger(result.height) ||
                    result.width <= 0 ||
                    result.height <= 0
                ) {
                    throw new Error(
                        `engine ${this.#engine.info.name} returned invalid size ${result.width}x${result.height}`,
                    );
                }
                return result;
            });
        this.#queue = call;
        const aborted = untilAborted(signal);
        return Promise.race([call, aborted.promise]).finally(aborted.dispose);
    }
}
