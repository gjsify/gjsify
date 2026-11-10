// The engine interface (ADR 0132 § 3): what gjsify's own engines implement,
// and what an app implements for a provider gjsify does not ship. `ImageGenerator`
// wraps one and owns the checks every engine would otherwise repeat.

import type { CreateMonitorCallback } from '@gjsify/model-store';

/** The WebML CG availability states. */
export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

/** Which engine runs, so a surface can say where the image is drawn (ADR 0132 § 3). */
export interface EngineInfo {
    readonly name: string;
    readonly locality: 'local' | 'remote';
}

export interface LoraRef {
    /** Verified file path for this LoRA. */
    readonly path: string;
    /** Strength, typically 0..1. */
    readonly multiplier: number;
}

/** A starting image for img2img; `strength` 0..1 says how far to move from it. */
export interface InitImage {
    readonly width: number;
    readonly height: number;
    /** Tightly packed RGB, `width * height * 3` bytes. */
    readonly rgb: Uint8Array;
    readonly strength: number;
}

/** What to draw. Defaults and upper bounds are the engine's. */
export interface ImageRequest {
    readonly prompt: string;
    readonly negativePrompt?: string;
    readonly width?: number;
    readonly height?: number;
    readonly steps?: number;
    /** Classifier-free guidance scale. */
    readonly guidance?: number;
    readonly seed?: number;
    readonly sampler?: string;
    readonly scheduler?: string;
    readonly loras?: readonly LoraRef[];
    readonly init?: InitImage;
}

export interface GenerateProgress {
    readonly step: number;
    readonly steps: number;
    /** Seconds spent so far on the current step. */
    readonly seconds: number;
}

export interface GenerateOptions {
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: GenerateProgress) => void;
}

/** The structural shape of `ImageData` from `@gjsify/canvas2d-core`, without the dependency. */
export interface DecodedImage {
    readonly width: number;
    readonly height: number;
    /** RGBA, `width * height * 4` bytes. */
    readonly data: Uint8ClampedArray;
}

/** One generated image: the engine's PNG bytes plus the metadata needed to record it. */
export interface ImageResult {
    readonly blob: Blob;
    readonly width: number;
    readonly height: number;
    /** The seed the engine used, so a liked image can be reproduced. */
    readonly seed: number;
    readonly modelId: string;
}

export interface EngineCreateOptions {
    readonly monitor?: CreateMonitorCallback;
    readonly signal?: AbortSignal;
}

/** A loaded model. Every method may be called again after the previous call settled. */
export interface ImageEngine {
    readonly info: EngineInfo;
    /** What produced the image, recorded by a gallery next to it. */
    readonly modelId: string;
    /** Where the image is drawn right now, when the engine knows; it can change mid-run. */
    readonly backend?: 'gpu' | 'cpu';
    generate(request: ImageRequest, options?: GenerateOptions): Promise<ImageResult>;
    destroy(): Promise<void>;
}

/** How `ImageGenerator` asks an engine whether it can run, and starts it. */
export interface ImageEngineFactory {
    readonly info: EngineInfo;
    availability(): Promise<Availability>;
    create(options?: EngineCreateOptions): Promise<ImageEngine>;
}
