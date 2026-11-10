// The local engine's body: a GGUF embedding model through node-llama-cpp, on
// Node and on GJS (ADR 0132 § 7: the existing N-API engine moves in as it is).
// It takes node-llama-cpp as a parameter; `./llama.ts` hands it over.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    checkFit,
    createGpuGuard,
    defaultGuardDir,
    readMachineMemory,
    systemProbe,
    type GpuGuard,
    type GpuPin,
    type GpuSetting,
    type MachineProbe,
} from '@gjsify/machine-fit';
import { ModelStore } from '@gjsify/model-store';

import type {
    Availability,
    EmbedDocument,
    EmbeddingEngine,
    EmbeddingEngineFactory,
    EngineCreateOptions,
    EngineInfo,
} from './engine.js';
import {
    BUILD_METADATA_FILE,
    backendCandidates,
    currentTarget,
    hasPrebuiltBins,
    prebuiltBinsDir,
} from './llama-bins.js';
import { DEFAULT_EMBEDDING_MODEL, EMBEDDING_MODELS, type EmbeddingModelEntry } from './llama-models.js';
import { documentPrompt, fitTokens, queryPrompt } from './llama-prompts.js';
import { collectGarbage, runningOnGjs } from './llama-runtime.js';
import { embedAcross } from './pool.js';
import { normalize, truncateVector } from './vectors.js';

export const LLAMA_ENGINE: EngineInfo = { name: 'llama.cpp', locality: 'local' };

/** Two, not "all cores": an indexer may run for hours next to the person's own work. */
export const DEFAULT_THREADS = 2;

/**
 * Contexts that evaluate side by side on a GPU. One context holds one
 * sequence and node-llama-cpp serialises calls on it, so a lone context leaves
 * the device idle between calls. Measured on an RX 6600, 400 documents in
 * batches of 16: one context 24.6/s, two 27.5/s, four and six no more than
 * two. The CPU keeps one: there the threads are the budget.
 */
export const DEFAULT_GPU_CONTEXTS = 2;

export interface LlamaEmbeddingsOptions {
    /** An id from {@link EMBEDDING_MODELS}. */
    readonly model?: string;
    /** A directory containing the model files; checked against the manifest's sizes and digests. */
    readonly modelPath?: string;
    /** Directories the app ships models in, read-only, searched before the cache. */
    readonly appDataDirs?: readonly string[];
    /** A store of {@link EMBEDDING_MODELS}; tests and apps with their own cache root. */
    readonly store?: ModelStore<EmbeddingModelEntry>;
    /** One of the model's `truncations`. Default: its native size. */
    readonly dimensions?: number;
    /** The person's GPU switch, e.g. `parseGpuSetting(env.MYAPP_GPU)`. `on` also lifts a pin. */
    readonly gpu?: GpuSetting;
    readonly threads?: number;
    readonly gpuContexts?: number;
    /**
     * Where the GPU guard keeps its pin. Default: the one shared by every
     * gjsify GPU engine (ADR 0132 § 6), so a hang under one app warns the next.
     */
    readonly gpuGuardDir?: string;
    /** Told once per process when a pin keeps this engine on the CPU. Default: a line on stderr. */
    readonly onGpuPinned?: (pin: GpuPin) => void;
    /** Run the GC after each `embedDocuments` on GJS; see `collectGarbage`. Default `true`. */
    readonly collectGarbage?: boolean;
    /** The machine `availability()` asks. */
    readonly probe?: MachineProbe;
}

// Only the parts of node-llama-cpp this module touches.
interface EmbeddingContextLike {
    getEmbeddingFor(text: string): Promise<{ vector: readonly number[] }>;
    dispose(): Promise<void>;
}
interface ModelLike {
    tokenize(text: string): readonly number[];
    detokenize(tokens: readonly number[]): string;
    createEmbeddingContext(options: { contextSize: number; threads?: number }): Promise<EmbeddingContextLike>;
    dispose(): Promise<void>;
}
interface LlamaLike {
    gpu: false | string;
    loadModel(options: { modelPath: string; gpuLayers?: number }): Promise<ModelLike>;
    dispose(): Promise<void>;
}
export interface NodeLlamaCpp {
    getLlama(options: { gpu: 'auto' | false; build?: 'never' }): Promise<LlamaLike>;
    Llama: { _create(options: Record<string, unknown>): Promise<LlamaLike>; defaultConsoleLogger: unknown };
    LlamaLogLevel: { warn: unknown };
}

/**
 * An optional peer like node-llama-cpp: only the GJS route needs it, and it is
 * not a member of this workspace (it has its own native build).
 */
async function loadNapi(): Promise<{ loadAddon(path: string): Record<string, unknown> }> {
    // @ts-ignore TS2307: an optional peer, not a workspace member
    return import('@gjsify/napi');
}

interface Session {
    llama: LlamaLike;
    model: ModelLike;
    contexts: EmbeddingContextLike[];
    gpu: boolean;
}

interface OpenOptions {
    readonly modelPath: string;
    readonly entry: EmbeddingModelEntry;
    readonly threads: number;
    readonly gpuContexts: number;
}

/**
 * The GJS route: node-llama-cpp's `getLlama()` `fork`s a second interpreter
 * to self-test the binary and loads it through `process.dlopen`, so the
 * engine loads the addon with `@gjsify/napi` and hands it over.
 */
async function createLlamaOnGjs(nlc: NodeLlamaCpp, target: string, threads: number): Promise<LlamaLike> {
    const [{ loadAddon }, binsDir] = await Promise.all([loadNapi(), prebuiltBinsDir(target)]);
    const bindingPath = join(binsDir, 'llama-addon.node');
    return nlc.Llama._create({
        bindings: loadAddon(bindingPath),
        bindingPath,
        extBackendsPath: binsDir,
        buildType: 'prebuilt',
        buildMetadata: JSON.parse(readFileSync(join(binsDir, BUILD_METADATA_FILE), 'utf8')) as unknown,
        logLevel: nlc.LlamaLogLevel.warn,
        logger: nlc.Llama.defaultConsoleLogger,
        maxThreads: threads,
        vramPadding: 0,
        ramPadding: 0,
        debug: false,
        numa: false,
        tempDir: false,
    });
}

/**
 * `onCpu` is set when the CPU was asked for but only a GPU build loaded: the
 * model is then loaded with no GPU layers.
 */
async function createLlamaOnNode(nlc: NodeLlamaCpp, cpuOnly: boolean): Promise<{ llama: LlamaLike; onCpu: boolean }> {
    if (!cpuOnly) return { llama: await nlc.getLlama({ gpu: 'auto' }), onCpu: false };
    try {
        return { llama: await nlc.getLlama({ gpu: false, build: 'never' }), onCpu: false };
    } catch {
        const llama = await nlc.getLlama({ gpu: 'auto', build: 'never' });
        return { llama, onCpu: llama.gpu !== false };
    }
}

async function openOn(llama: LlamaLike, options: OpenOptions, onCpu = false): Promise<Session> {
    const gpu = llama.gpu !== false && !onCpu;
    const count = gpu ? Math.max(1, Math.trunc(options.gpuContexts)) : 1;
    const model = await llama.loadModel({ modelPath: options.modelPath, ...(onCpu ? { gpuLayers: 0 } : {}) });
    const contexts: EmbeddingContextLike[] = [];
    try {
        for (let i = 0; i < count; i++) {
            contexts.push(
                await model.createEmbeddingContext({
                    contextSize: options.entry.contextTokens,
                    threads: options.threads,
                }),
            );
        }
        return { llama, model, contexts, gpu };
    } catch (err) {
        await Promise.all(contexts.map((context) => context.dispose().catch(() => undefined)));
        await model.dispose();
        throw err;
    }
}

/** Tries each build, best first; a GPU build that found no GPU counts as failed. */
async function openOnGjs(nlc: NodeLlamaCpp, candidates: readonly string[], options: OpenOptions): Promise<Session> {
    for (const [index, target] of candidates.entries()) {
        const last = index === candidates.length - 1;
        let llama: LlamaLike | undefined;
        try {
            llama = await createLlamaOnGjs(nlc, target, options.threads);
            if (!last && llama.gpu === false) throw new Error(`${target} found no GPU`);
            return await openOn(llama, options);
        } catch (err) {
            await llama?.dispose().catch(() => undefined);
            if (last) throw err;
        }
    }
    throw new Error('no llama.cpp build to try');
}

let pinReported = false;

function defaultOnGpuPinned(pin: GpuPin): void {
    console.error(
        `The GPU is switched off for embeddings: process ${pin.pid} died while using it (${pin.at}). ` +
            'Turn the GPU setting on to try it again.',
    );
}

function storeFor(options: LlamaEmbeddingsOptions): ModelStore<EmbeddingModelEntry> {
    return (
        options.store ??
        new ModelStore({
            capability: 'embeddings',
            models: EMBEDDING_MODELS,
            defaultModel: DEFAULT_EMBEDDING_MODEL,
            appDataDirs: options.appDataDirs,
        })
    );
}

/** {@link llamaEmbeddings} with node-llama-cpp passed in. */
export function createLlamaEmbeddings(nlc: NodeLlamaCpp, options: LlamaEmbeddingsOptions = {}): EmbeddingEngineFactory {
    const store = storeFor(options);
    const entry = store.require(options.model);
    const dimensions = options.dimensions ?? entry.dimensions;
    if (!entry.truncations.includes(dimensions)) {
        throw new RangeError(`${entry.id} gives ${entry.truncations.join(' or ')} dimensions, not ${dimensions}`);
    }
    const gpuSetting = options.gpu ?? 'auto';
    const threads = options.threads ?? DEFAULT_THREADS;
    let guard: GpuGuard | undefined;
    const gpuGuard = (): GpuGuard =>
        (guard ??= createGpuGuard({ dir: options.gpuGuardDir ?? defaultGuardDir('gjsify') }));

    /** CPU only by setting, or because a GPU session died earlier. */
    const gpuBarred = (): boolean => {
        if (gpuSetting === 'off') return true;
        if (gpuSetting === 'on') {
            gpuGuard().clear();
            return false;
        }
        const pin = gpuGuard().pin();
        if (pin === undefined) return false;
        if (!pinReported) {
            pinReported = true;
            (options.onGpuPinned ?? defaultOnGpuPinned)(pin);
        }
        return true;
    };

    const openSession = async (modelPath: string, forceCpu: boolean): Promise<Session> => {
        const cpuOnly = forceCpu || gpuBarred();
        const open = async (): Promise<Session> => {
            const openOptions: OpenOptions = {
                modelPath,
                entry,
                threads,
                gpuContexts: options.gpuContexts ?? DEFAULT_GPU_CONTEXTS,
            };
            if (runningOnGjs()) {
                const target = currentTarget();
                const candidates = cpuOnly
                    ? [target]
                    : backendCandidates(target, gpuSetting, options.probe ?? systemProbe());
                return openOnGjs(nlc, candidates, openOptions);
            }
            const { llama, onCpu } = await createLlamaOnNode(nlc, cpuOnly);
            return openOn(llama, openOptions, onCpu);
        };
        // A CPU session cannot lose a device; only the GPU attempt is marked.
        return cpuOnly ? open() : gpuGuard().during(open);
    };

    const closeSession = async (session: Session): Promise<void> => {
        const close = async (): Promise<void> => {
            await Promise.all(session.contexts.map((context) => context.dispose()));
            await session.model.dispose();
            await session.llama.dispose();
        };
        await (session.gpu ? gpuGuard().during(close) : close());
    };

    return {
        info: LLAMA_ENGINE,

        async availability(): Promise<Availability> {
            const probe = options.probe ?? systemProbe();
            if (!hasPrebuiltBins(currentTarget(probe))) return 'unavailable';
            const memory = readMachineMemory(probe);
            if (checkFit(entry.footprintBytes, memory).placement === 'none') return 'unavailable';
            return store.availability(entry.id, { path: options.modelPath });
        },

        async create(createOptions: EngineCreateOptions = {}): Promise<EmbeddingEngine> {
            const resolved = await store.install(entry.id, {
                path: options.modelPath,
                monitor: createOptions.monitor,
                signal: createOptions.signal,
            });
            createOptions.signal?.throwIfAborted();
            const modelPath = resolved.files[entry.files[0].file];
            let session = await openSession(modelPath, false);

            const embedOnce = async (
                on: Session,
                context: EmbeddingContextLike,
                text: string,
            ): Promise<Float32Array> => {
                const { vector } = await context.getEmbeddingFor(fitTokens(on.model, text, entry.contextTokens));
                return dimensions === entry.dimensions ? normalize(vector) : truncateVector(vector, dimensions);
            };

            // A GPU backend can return NaN or zeros for a model (float16 overflow). Once every
            // context has settled, the session reopens on the CPU and embeds what is missing;
            // there a bad vector is a real error.
            const embed = async (texts: readonly string[]): Promise<Float32Array[]> => {
                const current = session;
                const { vectors, failure } = await embedAcross(current.contexts, texts, (context, text) =>
                    embedOnce(current, context, text),
                );
                if (failure !== undefined) {
                    if (!current.gpu) throw failure.error;
                    await closeSession(current);
                    session = await openSession(modelPath, true);
                    for (const [index, text] of texts.entries()) {
                        vectors[index] ??= await embedOnce(session, session.contexts[0], text);
                    }
                }
                return vectors as Float32Array[];
            };

            // One marker per call, not per text: the batch is what a hang interrupts.
            const guarded = <T>(work: () => Promise<T>): Promise<T> => (session.gpu ? gpuGuard().during(work) : work());

            return {
                info: LLAMA_ENGINE,
                modelId: entry.modelId,
                dimensions,
                get backend(): 'gpu' | 'cpu' {
                    return session.gpu ? 'gpu' : 'cpu';
                },
                async embedQuery(text: string): Promise<Float32Array> {
                    const [vector] = await guarded(() => embed([queryPrompt(entry, text)]));
                    return vector;
                },
                async embedDocuments(documents: readonly EmbedDocument[]): Promise<Float32Array[]> {
                    const out = await guarded(() =>
                        embed(documents.map((document) => documentPrompt(entry, document))),
                    );
                    if (options.collectGarbage !== false) collectGarbage();
                    return out;
                },
                async destroy(): Promise<void> {
                    await closeSession(session);
                },
            };
        },
    };
}
