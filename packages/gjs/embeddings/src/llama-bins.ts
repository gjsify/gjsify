// Where node-llama-cpp's prebuilt binaries for this machine are, and whether
// there are any. Nothing here imports node-llama-cpp itself: a bins package
// holds one function that returns a path, so asking costs no model load.

import { join } from 'node:path';
import process from 'node:process';

import { hasVulkan, type GpuSetting, type MachineProbe } from '@gjsify/machine-fit';

import { runningOnGjs } from './llama-runtime.js';

/** The build description node-llama-cpp writes beside every prebuilt binary. */
export const BUILD_METADATA_FILE = '_nlcBuildMetadata.json';

interface BinsPackage {
    getBinsDir(): { readonly binsDir: string };
}

// The prebuilt packages ship JavaScript without type declarations. A
// `@ts-ignore` on the import travels with the file into every program that
// compiles it, which an ambient `declare module` would not.

async function loadLinuxX64(): Promise<BinsPackage> {
    // @ts-ignore TS2307/TS7016: an optional peer, without type declarations
    return import('@node-llama-cpp/linux-x64');
}

async function loadLinuxArm64(): Promise<BinsPackage> {
    // @ts-ignore TS2307/TS7016: an optional peer, without type declarations
    return import('@node-llama-cpp/linux-arm64');
}

/**
 * The Vulkan build is a superset of the CPU one, so a machine without a usable
 * GPU still runs it on the CPU. There is no arm64 build.
 */
async function loadLinuxX64Vulkan(): Promise<BinsPackage> {
    // @ts-ignore TS2307/TS7016: an optional peer, without type declarations
    return import('@node-llama-cpp/linux-x64-vulkan');
}

/**
 * The prebuilt packages the GJS route can load, by build target, which is also
 * the directory the binary sits in. Static specifiers in a table, not one
 * computed specifier: a bundler can only follow a literal.
 */
const PREBUILT_BINS: Record<string, (() => Promise<BinsPackage>) | undefined> = {
    'linux-x64': loadLinuxX64,
    'linux-x64-vulkan': loadLinuxX64Vulkan,
    'linux-arm64': loadLinuxArm64,
};

/**
 * Machines node-llama-cpp ships a binary for that `getLlama()` finds on its
 * own. macOS and Windows appear only here: {@link PREBUILT_BINS} exists for
 * the GJS route, which has to be handed a path.
 */
const NODE_PREBUILT_TARGETS: ReadonlySet<string> = new Set([
    'darwin-arm64',
    'darwin-x64',
    'win32-arm64',
    'win32-x64',
    'linux-arm64',
    'linux-x64',
]);

/** This machine, as node-llama-cpp names its binary directories. */
export function currentTarget(probe: Pick<MachineProbe, 'platform' | 'arch'> = process): string {
    return `${probe.platform}-${probe.arch}`;
}

/**
 * Is there a prebuilt binary for this machine? A table lookup, so it is free
 * to ask; `true` does not promise the model loads.
 *
 * Two answers, because the runtimes reach the binary differently: under GJS
 * the engine hands node-llama-cpp a directory, under Node `getLlama()` looks
 * for it. Answering from the GJS table on Node would rule out every Mac.
 */
export function hasPrebuiltBins(target: string = currentTarget(), onGjs: boolean = runningOnGjs()): boolean {
    return onGjs ? PREBUILT_BINS[target] !== undefined : NODE_PREBUILT_TARGETS.has(target);
}

/**
 * The GJS builds to try, best first; the last is always the CPU build. Only
 * Linux x64 has two. Not asking `getLlama()` is deliberate: it `fork`s a
 * second interpreter to self-test the binary.
 */
export function backendCandidates(target: string, gpu: GpuSetting, probe: MachineProbe): string[] {
    const withGpu = `${target}-vulkan`;
    if (PREBUILT_BINS[withGpu] === undefined || gpu === 'off') return [target];
    // `on` skips the hint: the user says the driver works.
    return gpu === 'on' || hasVulkan(probe) ? [withGpu, target] : [target];
}

/** The directory holding the addon and its backends, or an error naming the machine. */
export async function prebuiltBinsDir(target: string): Promise<string> {
    const load = PREBUILT_BINS[target];
    if (load === undefined) throw new Error(`no prebuilt llama.cpp binaries for ${target}`);
    const { binsDir } = (await load()).getBinsDir();
    // `getBinsDir()` stops one level above the per-target directory.
    return join(binsDir, target);
}
