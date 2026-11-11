// The local sd.cpp engine body: a diffusion model through
// stable-diffusion-cpp-node-api, on Node and on GJS (ADR 0132 § 7: the existing
// N-API engine moves in as it is). It takes the addon as a parameter; `./sdcpp.ts`
// hands it over.

import { existsSync } from 'node:fs';

import type { ModelEntry, ModelStore } from '@gjsify/model-store';
import {
    checkFit,
    createGpuGuard,
    defaultGuardDir,
    onBattery,
    readMachineMemory,
    systemProbe,
    type GpuGuard,
    type GpuPin,
    type GpuSetting,
    type MachineProbe,
} from '@gjsify/machine-fit';

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
import { encodePng } from './encode.js';
import { currentTarget, hasPrebuiltBins, runningOnGjs } from './sdcpp-bin.js';

export const SDCPP_ENGINE: EngineInfo = { name: 'sd.cpp', locality: 'local' };

/** A fetchable image model: one or more verified files plus sd.cpp's role mapping. */
export interface ImageModelEntry extends ModelEntry {
    /** What a gallery records next to the image (`ImageGenerator.modelId`). */
    readonly modelId: string;
    /** Which file in {@link ModelEntry.files} is the diffusion checkpoint. */
    readonly diffusionModel: string;
    /** Optional VAE file name. */
    readonly vae?: string;
    /** Optional text-encoder / LLM file name (e.g. Qwen for Z-Image). */
    readonly llm?: string;
    /** Per-module device assignment, e.g. `te=cpu` — see sd.cpp's docs/backend.md. */
    readonly backend?: string;
    /** Default width the footprint was measured at. */
    readonly defaultWidth: number;
    /** Default height the footprint was measured at. */
    readonly defaultHeight: number;
    /** Working set at defaultWidth/defaultHeight, measured, not derived from file size. */
    readonly footprintBytes: number;
}

/** Fields every sd.cpp engine takes, whatever supplies the model files. */
export interface SdCppCommonOptions {
    /** The person's GPU switch, e.g. `parseGpuSetting(env.MYAPP_GPU)`. `on` also lifts a pin. */
    readonly gpu?: GpuSetting;
    /**
     * Where the GPU guard keeps its pin. Default: the one shared by every
     * gjsify GPU engine (ADR 0132 § 6).
     */
    readonly gpuGuardDir?: string;
    /** Told once per process when a pin keeps this engine on the CPU. Default: a line on stderr. */
    readonly onGpuPinned?: (pin: GpuPin) => void;
    /** The machine `availability()` asks. */
    readonly probe?: MachineProbe;
}

/** The model comes from a {@link ModelStore}: fetched, verified and placed by the store. */
export interface SdCppEngineOptions<E extends ImageModelEntry = ImageModelEntry> extends SdCppCommonOptions {
    /** A store that contains the model manifest. */
    readonly store: ModelStore<E>;
    /** Model id from the store; `create()` requires one. */
    readonly model: string;
}

/**
 * A model that already sits on disk, chosen by the person (a checkpoint they downloaded
 * themselves). Nothing is fetched or verified: the files either exist or the engine is
 * `unavailable`.
 */
export interface LocalImageModel {
    /** What a gallery records next to the image (`ImageGenerator.modelId`). */
    readonly modelId: string;
    /** Path of the diffusion checkpoint. */
    readonly diffusionModel: string;
    /** Path of the VAE, if the model needs a separate one. */
    readonly vae?: string;
    /** Path of the text encoder / LLM, if the model family needs one. */
    readonly llm?: string;
    /** Per-module device assignment, e.g. `te=cpu` — see sd.cpp's docs/backend.md. */
    readonly backend?: string;
    /** Size used when a request names none. Default 512x512. */
    readonly defaultWidth?: number;
    readonly defaultHeight?: number;
    /**
     * Working set at the default size. Optional: without it `availability()` cannot say the
     * machine is too small, and the model simply tries to load.
     */
    readonly footprintBytes?: number;
}

export interface SdCppLocalOptions extends SdCppCommonOptions {
    readonly local: LocalImageModel;
}

export type SdCppOptions<E extends ImageModelEntry = ImageModelEntry> = SdCppEngineOptions<E> | SdCppLocalOptions;

export interface NativeGenerateOptions {
    prompt: string;
    negativePrompt?: string;
    width: number;
    height: number;
    seed: number;
    sampleParams: {
        sampleSteps: number;
        guidance: { txtCfg: number };
        sampleMethod?: string;
        scheduler?: string;
    };
    loras?: Array<{ path: string; multiplier: number }>;
    initImage?: { width: number; height: number; channel: number; data: Uint8Array };
    strength?: number;
}

export interface NativeImage {
    width: number;
    height: number;
    channel: number;
    data: ArrayLike<number>;
}

export interface NativeContext {
    generateImage(options: NativeGenerateOptions): Promise<NativeImage[]>;
    abort(): void;
    close(): void;
}

/** The slice of the addon this engine uses; also what tests fake. */
export interface SdAddon {
    StableDiffusionContext: { create(options: Record<string, unknown>): Promise<NativeContext> };
    setProgressCallback(callback: ((data: { step: number; steps: number; time: number }) => void) | null): void;
    setLogCallback?(callback: ((level: number, message: string) => void) | null): void;
}

export class GenerationAborted extends Error {
    constructor() {
        super('Aborted');
        this.name = 'AbortError';
    }
}

/** Request → the addon's option object. Pure, so the mapping is testable without a GPU. */
export function toNativeOptions(request: ImageRequest, width: number, height: number): NativeGenerateOptions {
    const native: NativeGenerateOptions = {
        prompt: request.prompt,
        width,
        height,
        seed: request.seed ?? Math.floor(Math.random() * 2 ** 32),
        sampleParams: {
            sampleSteps: request.steps ?? 20,
            guidance: { txtCfg: request.guidance ?? 7.5 },
        },
    };
    if (request.negativePrompt) native.negativePrompt = request.negativePrompt;
    if (request.sampler) native.sampleParams.sampleMethod = request.sampler;
    if (request.scheduler) native.sampleParams.scheduler = request.scheduler;
    if (request.loras?.length) {
        native.loras = request.loras.map((lora) => ({ path: lora.path, multiplier: lora.multiplier }));
    }
    if (request.init) {
        native.initImage = {
            width: request.init.width,
            height: request.init.height,
            channel: 3,
            data: request.init.rgb,
        };
        native.strength = request.init.strength;
    }
    return native;
}

/** Where each role's file is, and the device assignment: what the addon's context takes. */
interface ModelPaths {
    readonly diffusionModel: string;
    readonly vae?: string;
    readonly llm?: string;
    readonly backend?: string;
}

function contextOptions(paths: ModelPaths): Record<string, unknown> {
    const options: Record<string, unknown> = { diffusionModelPath: paths.diffusionModel };
    if (paths.vae) options.vaePath = paths.vae;
    if (paths.llm) options.llmPath = paths.llm;
    if (paths.backend) options.backend = paths.backend;
    return options;
}

export function toNativeContext(model: ImageModelEntry, files: Record<string, string>): Record<string, unknown> {
    return contextOptions({
        diffusionModel: files[model.diffusionModel],
        vae: model.vae ? files[model.vae] : undefined,
        llm: model.llm ? files[model.llm] : undefined,
        backend: model.backend,
    });
}

const LOCAL_DEFAULT_SIZE = 512;

/** What the engine needs of a model, whether a store supplies it or the person points at files. */
interface ModelSource {
    readonly modelId: string;
    readonly backend: string | undefined;
    readonly footprintBytes: number | undefined;
    readonly width: number;
    readonly height: number;
    availability(): Promise<Availability>;
    /** Make the files present (a store downloads here) and say where they are. */
    prepare(options: EngineCreateOptions): Promise<ModelPaths>;
}

function storeSource<E extends ImageModelEntry>(options: SdCppEngineOptions<E>): ModelSource {
    const { store } = options;
    const entry = store.require(options.model);
    assertModelFiles(entry);
    return {
        modelId: entry.modelId,
        backend: entry.backend,
        footprintBytes: entry.footprintBytes,
        width: entry.defaultWidth,
        height: entry.defaultHeight,
        availability: async () => store.availability(entry.id),
        async prepare(createOptions) {
            const resolved = await store.install(entry.id, {
                monitor: createOptions.monitor,
                signal: createOptions.signal,
            });
            return {
                diffusionModel: resolved.files[entry.diffusionModel],
                vae: entry.vae ? resolved.files[entry.vae] : undefined,
                llm: entry.llm ? resolved.files[entry.llm] : undefined,
                backend: entry.backend,
            };
        },
    };
}

function missingFiles(model: LocalImageModel): string[] {
    return [model.diffusionModel, model.vae, model.llm].filter(
        (file): file is string => file !== undefined && file !== '' && !existsSync(file),
    );
}

function localSource(model: LocalImageModel): ModelSource {
    if (!model.modelId) throw new Error('sd.cpp local model needs a modelId');
    if (!model.diffusionModel) throw new Error(`sd.cpp local model '${model.modelId}' needs a diffusionModel path`);
    return {
        modelId: model.modelId,
        backend: model.backend,
        footprintBytes: model.footprintBytes,
        width: model.defaultWidth ?? LOCAL_DEFAULT_SIZE,
        height: model.defaultHeight ?? LOCAL_DEFAULT_SIZE,
        availability: async () => (missingFiles(model).length === 0 ? 'available' : 'unavailable'),
        async prepare() {
            const missing = missingFiles(model);
            if (missing.length > 0) {
                throw new Error(`sd.cpp model '${model.modelId}' has missing files: ${missing.join(', ')}`);
            }
            return { diffusionModel: model.diffusionModel, vae: model.vae, llm: model.llm, backend: model.backend };
        },
    };
}

function resolveSize(request: ImageRequest, source: ModelSource): { width: number; height: number } {
    return { width: request.width ?? source.width, height: request.height ?? source.height };
}

let pinReported = false;

function defaultOnGpuPinned(pin: GpuPin): void {
    console.error(
        `The GPU is switched off for image generation: process ${pin.pid} died while using it (${pin.at}). ` +
            'Turn the GPU setting on to try it again.',
    );
}

function assertModelFiles(entry: ImageModelEntry): void {
    const fileNames = new Set(entry.files.map((f) => f.file));
    if (!fileNames.has(entry.diffusionModel)) {
        throw new Error(
            `sd.cpp model '${entry.id}' names '${entry.diffusionModel}' as diffusionModel, but it is not in files`,
        );
    }
    if (entry.vae && !fileNames.has(entry.vae)) {
        throw new Error(`sd.cpp model '${entry.id}' names '${entry.vae}' as vae, but it is not in files`);
    }
    if (entry.llm && !fileNames.has(entry.llm)) {
        throw new Error(`sd.cpp model '${entry.id}' names '${entry.llm}' as llm, but it is not in files`);
    }
}

/**
 * Whether the configured backend is CPU-only. A missing backend means sd.cpp
 * will probe for GPU itself, so we guard in that case.
 */
function isCpuOnly(backend: string | undefined): boolean {
    if (backend === undefined) return false;
    return backend.split(',').every((part) => part.trim().toLowerCase() === 'cpu');
}

/** {@link sdCppImageGeneration} with the addon loader passed in. */
export function createSdCppEngine<E extends ImageModelEntry = ImageModelEntry>(
    loadAddon: () => Promise<SdAddon>,
    options: SdCppOptions<E>,
): ImageEngineFactory {
    const source = 'local' in options ? localSource(options.local) : storeSource(options);
    const gpuSetting = options.gpu ?? 'auto';
    let guard: GpuGuard | undefined;
    const gpuGuard = (): GpuGuard =>
        (guard ??= createGpuGuard({ dir: options.gpuGuardDir ?? defaultGuardDir('gjsify') }));

    const gpuBarred = (): boolean => {
        if (isCpuOnly(source.backend)) return true;
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

    return {
        info: SDCPP_ENGINE,

        async availability(): Promise<Availability> {
            const probe = options.probe ?? systemProbe();
            if (onBattery(probe)) return 'unavailable';
            if (!hasPrebuiltBins(currentTarget(probe), runningOnGjs())) return 'unavailable';
            if (source.footprintBytes !== undefined) {
                const memory = readMachineMemory(probe);
                if (checkFit(source.footprintBytes, memory).placement === 'none') return 'unavailable';
            }
            return source.availability();
        },

        async create(createOptions: EngineCreateOptions = {}): Promise<ImageEngine> {
            const paths = await source.prepare(createOptions);
            createOptions.signal?.throwIfAborted();

            let addon: SdAddon | undefined;
            let context: NativeContext | undefined;
            let gpu = false;

            const open = async (): Promise<void> => {
                addon ??= await loadAddon();
                const cpuOnly = gpuBarred();
                const modelOptions = contextOptions(paths);
                if (cpuOnly && !modelOptions.backend) {
                    modelOptions.backend = 'cpu';
                }
                context ??= await addon.StableDiffusionContext.create(modelOptions);
                gpu = !cpuOnly;
            };

            await open();
            if (!context) throw new Error('sd.cpp context did not open');

            const generate = async (request: ImageRequest): Promise<ImageResult> => {
                const { width, height } = resolveSize(request, source);
                const native = toNativeOptions(request, width, height);
                const images = await context!.generateImage(native);
                const image = images[0];
                if (!image) throw new Error('The engine returned no image.');
                if (image.channel !== 3) {
                    throw new Error(`sd.cpp returned ${image.channel} channels, expected 3`);
                }
                const rgb = new Uint8Array(image.data);
                const png = encodePng({ width: image.width, height: image.height, rgb });
                return {
                    blob: png,
                    width: image.width,
                    height: image.height,
                    seed: native.seed,
                    modelId: source.modelId,
                };
            };

            return {
                info: SDCPP_ENGINE,
                modelId: source.modelId,
                get backend(): 'gpu' | 'cpu' {
                    return gpu ? 'gpu' : 'cpu';
                },
                async generate(request: ImageRequest, callOptions: GenerateOptions = {}): Promise<ImageResult> {
                    const { signal, onProgress } = callOptions;
                    if (signal?.aborted) throw new GenerationAborted();
                    const onAbort = () => context!.abort();
                    signal?.addEventListener('abort', onAbort, { once: true });
                    const work = async (): Promise<ImageResult> => {
                        addon!.setProgressCallback(
                            onProgress ? ({ step, steps, time }) => onProgress({ step, steps, seconds: time }) : null,
                        );
                        const result = await generate(request);
                        return result;
                    };
                    try {
                        return gpu ? await gpuGuard().during(work) : await work();
                    } catch (err) {
                        if (signal?.aborted) throw new GenerationAborted();
                        throw err;
                    } finally {
                        signal?.removeEventListener('abort', onAbort);
                        addon!.setProgressCallback(null);
                    }
                },
                async destroy(): Promise<void> {
                    context?.close();
                    context = undefined;
                },
            };
        },
    };
}
