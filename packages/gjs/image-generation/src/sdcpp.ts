// The local sd.cpp engine subpath. Optional native peers (`@gjsify/napi` and
// the stable-diffusion-cpp-node-api prebuilds) are only needed when this
// module is evaluated; the root package bundles without them.
//
// The `@gjsify/napi` import is static because a bundled dynamic import with
// top-level await hangs on GJS (issue #2546).

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// @ts-ignore TS2307: an optional peer, not installed in this repository
import { loadAddon } from '@gjsify/napi';

import type { ImageEngineFactory } from './engine.js';
import { findAddon } from './sdcpp-bin.js';
import { createSdCppEngine, type ImageModelEntry, type SdAddon, type SdCppEngineOptions } from './sdcpp-engine.js';

export {
    SDCPP_ENGINE,
    type ImageModelEntry,
    type NativeGenerateOptions,
    type NativeImage,
    type SdAddon,
    type SdCppEngineOptions,
    toNativeContext,
    toNativeOptions,
} from './sdcpp-engine.js';
export {
    addonDir,
    addonPath,
    AddonMissingError,
    backendCandidates,
    currentTarget,
    findAddon,
    hasPrebuiltBins,
    runningOnGjs,
} from './sdcpp-bin.js';

async function loadSdAddon(): Promise<SdAddon> {
    const file = findAddon(process.env, dirname(fileURLToPath(import.meta.url)));
    return loadAddon(file) as unknown as SdAddon;
}

/** The sd.cpp image-generation engine factory, for `ImageGenerator.availability()` and `ImageGenerator.create()`. */
export function sdCppImageGeneration<E extends ImageModelEntry = ImageModelEntry>(
    options: SdCppEngineOptions<E>,
): ImageEngineFactory {
    return createSdCppEngine(loadSdAddon, options);
}
