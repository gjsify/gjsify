// Where stable-diffusion.cpp's N-API addon is, and whether this machine can
// load it. Nothing here imports the package itself: availability checks the
// filesystem, and create() loads the `.node` through `@gjsify/napi`.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { hasVulkan, type GpuSetting, type MachineProbe } from '@gjsify/machine-fit';

export const ADDON_ENV = 'GJSIFY_SDCPP_ADDON';
export const ADDON_FILE = 'node_stable_diffusion.node';
export const SDCPP_PACKAGE = '@stable-diffusion-cpp-node-api';

function ancestors(start: string): string[] {
    const dirs: string[] = [];
    for (let dir = resolve(start); ; dir = dirname(dir)) {
        dirs.push(dir);
        if (dirname(dir) === dir) return dirs;
    }
}

/** This machine, as stable-diffusion-cpp-node-api names its binary directories. */
export function currentTarget(probe: Pick<MachineProbe, 'platform' | 'arch'> = process): string {
    return `${probe.platform}-${probe.arch}`;
}

/** The addon file inside the package's per-target directory. */
export function addonPath(root: string, target: string): string {
    return join(root, 'node_modules', SDCPP_PACKAGE, target, ADDON_FILE);
}

/**
 * Where the addon is: `GJSIFY_SDCPP_ADDON` (a `.node` file or its directory)
 * first, then the `node_modules` above the running bundle and above the working
 * directory — a bundle cannot resolve a package at run time, but it sits inside
 * the checkout that installed it.
 */
export function findAddon(env: Record<string, string | undefined> = process.env, here?: string): string {
    return findAddonForTarget(currentTarget(), here, env);
}

export class AddonMissingError extends Error {}

const GJS_TARGETS: ReadonlySet<string> = new Set(['linux-x64', 'linux-arm64']);
const NODE_TARGETS: ReadonlySet<string> = new Set([
    'linux-x64',
    'linux-arm64',
    'darwin-arm64',
    'darwin-x64',
    'win32-x64',
]);

/** Is there an addon build for this machine? A table lookup, so it is free to ask. */
export function hasPrebuiltBins(target: string = currentTarget(), onGjs: boolean = runningOnGjs()): boolean {
    return onGjs ? GJS_TARGETS.has(target) : NODE_TARGETS.has(target);
}

/** What {@link runningOnGjs} looks at; injected so the Node-with-node-gi case is testable. */
export interface RuntimeHost {
    imports?: unknown;
    process?: { versions?: { gjs?: string } };
}

/**
 * Is this GJS? Not "is there an `imports`": node-gi defines `globalThis.imports`
 * on Node too, and asking only that sent a Node app down the `@gjsify/napi` route.
 */
export function runningOnGjs(host: RuntimeHost = globalThis as RuntimeHost): boolean {
    return host.imports !== undefined && host.process?.versions?.gjs !== undefined;
}

/**
 * The GJS builds to try, best first; the last is always the CPU build. Only
 * Linux x64 has a Vulkan variant.
 */
export function backendCandidates(target: string, gpu: GpuSetting, probe: MachineProbe): string[] {
    if (!GJS_TARGETS.has(target) || gpu === 'off' || target !== 'linux-x64') return [target];
    const withGpu = `${target}-vulkan`;
    return gpu === 'on' || hasVulkan(probe) ? [withGpu, target] : [target];
}

/** The directory holding the addon and its backends, for `@gjsify/napi`. */
export function addonDir(target: string = currentTarget(), here?: string): string {
    const file = findAddonForTarget(target, here);
    return dirname(file);
}

function findAddonForTarget(
    target: string,
    here?: string,
    env: Record<string, string | undefined> = process.env,
): string {
    const explicit = env[ADDON_ENV]?.trim();
    if (explicit) {
        const file = explicit.endsWith('.node') ? explicit : join(explicit, ADDON_FILE);
        if (existsSync(file)) return file;
        throw new AddonMissingError(`${ADDON_ENV}=${explicit} has no ${ADDON_FILE}`);
    }
    const roots = [...(here ? ancestors(here) : []), ...ancestors(process.cwd())];
    for (const root of roots) {
        const file = addonPath(root, target);
        if (existsSync(file)) return file;
    }
    throw new AddonMissingError(
        `No stable-diffusion.cpp addon for ${target}: install stable-diffusion-cpp-node-api or set ${ADDON_ENV}.`,
    );
}
