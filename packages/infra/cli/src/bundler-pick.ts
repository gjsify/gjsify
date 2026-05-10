// Phase D-2.B.5b — runtime bundler pick.
//
// Default behavior: call npm `rolldown(opts).write(opts.output)` exactly
// as before. Setting `GJSIFY_BUNDLER=native` opts into the
// `@gjsify/rolldown-native` Vala/Rust prebuild via `bundleWithPlugins()`.
//
// The native path is only attempted under GJS — under Node it falls
// back to npm rolldown silently. Under GJS, if the prebuild isn't
// loadable for the running architecture, we throw so the caller
// notices the configuration mismatch instead of silently using a
// different code path.
//
// Plugin shape conversion: rolldown plugins may declare hooks either
// as bare functions (`load(id)`) or as `{filter, handler}` objects.
// Both shapes are translated to `NativePlugin` form. `filter.id`
// regex/string sources become `idFilter.<hook>` regex strings on the
// Rust side. `this.resolve()` / `this.warn()` / `this.error()` calls
// inside hook handlers route through the B.3 nested protocol.
//
// Plugins that depend on rolldown context methods we don't implement
// (`this.parse`, `this.emitFile`, `this.getModuleInfo`, …) will fail
// at hook-call time. The current gjsify plugin set doesn't use any
// of those, so we don't gate on it; future incompatibilities surface
// as build errors rather than silent wrong behavior.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { rolldown, type RolldownOutput } from 'rolldown';
import type { BundlerOptions } from './types/index.js';

interface BundleResult {
    warnings: string[];
    output: Array<
        | { type: 'chunk'; fileName: string; name: string; isEntry: boolean; isDynamicEntry: boolean; code: string; map?: string; sourcemapFilename?: string; imports: string[]; dynamicImports: string[] }
        | { type: 'asset'; fileName: string; names: string[]; originalFileNames: string[]; sourceText?: string; sourceBytesLen: number }
    >;
}

interface NativeRolldownSurface {
    hasNativeRolldown(): boolean;
    bundleWithPlugins(opts: unknown, plugins: NativePlugin[]): Promise<BundleResult>;
}

interface NativePluginContext {
    resolve(specifier: string, importer?: string, opts?: { skipSelf?: boolean; isEntry?: boolean }): Promise<{ id: string; external: boolean } | null>;
    warn(message: string): void;
    error(message: string): never;
}

interface NativePlugin {
    name: string;
    idFilter?: { load?: string; transform?: string; resolveId?: string };
    load?: (this: NativePluginContext, id: string) => unknown;
    transform?: (this: NativePluginContext, code: string, id: string, moduleType: string) => unknown;
    resolveId?: (this: NativePluginContext, specifier: string, importer: string | undefined, opts: { isEntry: boolean }) => unknown;
    renderChunk?: (this: NativePluginContext, code: string, chunk: { fileName: string; name: string; isEntry: boolean }) => unknown;
    banner?: (this: NativePluginContext, chunk: { fileName: string; name: string; isEntry: boolean }) => unknown;
    footer?: (this: NativePluginContext, chunk: { fileName: string; name: string; isEntry: boolean }) => unknown;
    intro?: (this: NativePluginContext, chunk: { fileName: string; name: string; isEntry: boolean }) => unknown;
    outro?: (this: NativePluginContext, chunk: { fileName: string; name: string; isEntry: boolean }) => unknown;
    buildStart?: (this: NativePluginContext) => unknown;
    buildEnd?: (this: NativePluginContext) => unknown;
    generateBundle?: (this: NativePluginContext) => unknown;
    writeBundle?: (this: NativePluginContext) => unknown;
    closeBundle?: (this: NativePluginContext) => unknown;
}

/**
 * Run a bundle with the picked engine. Drop-in replacement for the
 * `rolldown(opts).write(opts.output)` flow used directly in build.ts.
 */
export async function runBundle(finalOpts: BundlerOptions): Promise<RolldownOutput> {
    if (await shouldUseNative()) {
        return await runNativeBundle(finalOpts);
    }
    const build = await rolldown(finalOpts);
    try {
        return await build.write(finalOpts.output ?? {});
    } finally {
        await build.close();
    }
}

let _nativeProbe: Promise<NativeRolldownSurface | null> | null = null;

async function shouldUseNative(): Promise<boolean> {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    const choice = env.GJSIFY_BUNDLER;
    if (choice === 'npm') return false;
    if (choice !== 'native') return false; // default = npm; native is opt-in
    const native = await tryLoadNative();
    if (!native) {
        throw new Error('GJSIFY_BUNDLER=native but @gjsify/rolldown-native is not loadable (no prebuild for this architecture, or not running under GJS).');
    }
    return true;
}

async function tryLoadNative(): Promise<NativeRolldownSurface | null> {
    if (_nativeProbe) return _nativeProbe;
    _nativeProbe = (async (): Promise<NativeRolldownSurface | null> => {
        const isGjs = typeof (globalThis as { imports?: { gi?: unknown } }).imports?.gi !== 'undefined';
        if (!isGjs) return null;
        try {
            // Indirect specifier so tsc + Rolldown don't try to resolve
            // the optional peer dep at build time. Resolution happens
            // only at runtime under GJS.
            const specifier = '@gjsify/rolldown-native';
            const mod = (await import(/* @vite-ignore */ specifier)) as NativeRolldownSurface;
            if (!mod.hasNativeRolldown()) return null;
            return mod;
        } catch {
            return null;
        }
    })();
    return _nativeProbe;
}

async function runNativeBundle(finalOpts: BundlerOptions): Promise<RolldownOutput> {
    const native = await tryLoadNative();
    if (!native) {
        throw new Error('@gjsify/rolldown-native not loadable');
    }

    const rawPlugins = (finalOpts.plugins ?? []) as unknown[];
    const nativePlugins: NativePlugin[] = [];
    for (const p of rawPlugins) {
        if (isPluginObject(p)) nativePlugins.push(toNativePlugin(p));
    }

    // Strip plugins from opts — bundleWithPlugins gets them as a
    // separate argument and the Rust side wires them into rolldown's
    // own plugin chain.
    const bundlerOpts = { ...finalOpts };
    delete bundlerOpts.plugins;
    const result = await native.bundleWithPlugins(bundlerOpts as unknown as Record<string, unknown>, nativePlugins);

    // The native facade returns the BundleOutput shape but doesn't
    // write files — replicate `.write()` here so callers see the same
    // on-disk layout whether they used npm rolldown or native.
    const outputCfg = (finalOpts.output ?? {}) as { dir?: string; file?: string };
    const outDir = outputCfg.dir ?? (outputCfg.file ? path.dirname(outputCfg.file) : process.cwd());
    if (outDir) await fs.mkdir(outDir, { recursive: true });
    for (const item of result.output) {
        if (item.type === 'chunk') {
            const target = outputCfg.file && result.output.length === 1
                ? outputCfg.file
                : path.join(outDir, item.fileName);
            await fs.writeFile(target, item.code, 'utf8');
        }
    }

    // Synthesize the RolldownOutput shape downstream code touches.
    return synthRolldownOutput(result);
}

type PluginRecord = { name?: string; [k: string]: unknown };

function isPluginObject(p: unknown): p is PluginRecord {
    return p !== null && typeof p === 'object' && !Array.isArray(p);
}

interface RolldownHookFilter { id?: RegExp | string | Array<RegExp | string> }
interface RolldownHookObject { filter?: RolldownHookFilter; handler: (...args: never[]) => unknown }

function pickHook<F extends (...args: never[]) => unknown>(
    raw: unknown,
): { fn: F; idFilter?: string } | undefined {
    if (typeof raw === 'function') return { fn: raw as F };
    if (raw !== null && typeof raw === 'object' && 'handler' in raw) {
        const obj = raw as RolldownHookObject;
        const idFilter = filterToRegexSource(obj.filter?.id);
        const out: { fn: F; idFilter?: string } = { fn: obj.handler as F };
        if (idFilter !== undefined) out.idFilter = idFilter;
        return out;
    }
    return undefined;
}

function filterToRegexSource(f: RegExp | string | Array<RegExp | string> | undefined): string | undefined {
    if (f === undefined) return undefined;
    if (Array.isArray(f)) {
        const sources = f.map(oneToSource).filter((x): x is string => x !== undefined);
        return sources.length === 0 ? undefined : sources.length === 1 ? sources[0] : `(?:${sources.join('|')})`;
    }
    return oneToSource(f);
}

function oneToSource(f: RegExp | string): string | undefined {
    if (f instanceof RegExp) return f.source;
    if (typeof f === 'string') {
        // Treat plain strings as substring match. Escape regex metas
        // so glob-like inputs don't accidentally turn into wild
        // regexes.
        return f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    return undefined;
}

function toNativePlugin(p: PluginRecord): NativePlugin {
    const name = typeof p.name === 'string' ? p.name : 'unnamed-plugin';
    const out: NativePlugin = { name };
    const idFilter: { load?: string; transform?: string; resolveId?: string } = {};

    const load = pickHook(p.load);
    if (load) { out.load = load.fn as NativePlugin['load']; if (load.idFilter) idFilter.load = load.idFilter; }
    const transform = pickHook(p.transform);
    if (transform) { out.transform = transform.fn as NativePlugin['transform']; if (transform.idFilter) idFilter.transform = transform.idFilter; }
    const resolveId = pickHook(p.resolveId);
    if (resolveId) { out.resolveId = resolveId.fn as NativePlugin['resolveId']; if (resolveId.idFilter) idFilter.resolveId = resolveId.idFilter; }
    const renderChunk = pickHook(p.renderChunk);
    if (renderChunk) out.renderChunk = renderChunk.fn as NativePlugin['renderChunk'];
    const banner = pickHook(p.banner);
    if (banner) out.banner = banner.fn as NativePlugin['banner'];
    const footer = pickHook(p.footer);
    if (footer) out.footer = footer.fn as NativePlugin['footer'];
    const intro = pickHook(p.intro);
    if (intro) out.intro = intro.fn as NativePlugin['intro'];
    const outro = pickHook(p.outro);
    if (outro) out.outro = outro.fn as NativePlugin['outro'];
    const buildStart = pickHook(p.buildStart);
    if (buildStart) out.buildStart = buildStart.fn as NativePlugin['buildStart'];
    const buildEnd = pickHook(p.buildEnd);
    if (buildEnd) out.buildEnd = buildEnd.fn as NativePlugin['buildEnd'];
    const generateBundle = pickHook(p.generateBundle);
    if (generateBundle) out.generateBundle = generateBundle.fn as NativePlugin['generateBundle'];
    const writeBundle = pickHook(p.writeBundle);
    if (writeBundle) out.writeBundle = writeBundle.fn as NativePlugin['writeBundle'];
    const closeBundle = pickHook(p.closeBundle);
    if (closeBundle) out.closeBundle = closeBundle.fn as NativePlugin['closeBundle'];

    if (Object.keys(idFilter).length > 0) out.idFilter = idFilter;
    return out;
}

function synthRolldownOutput(result: BundleResult): RolldownOutput {
    // RolldownOutput's exact shape in the npm types is rich; we fill
    // in what downstream code in `build.ts` actually touches (none of
    // it inspects the output beyond logging the file count today).
    // Cast through unknown to satisfy the structural type without
    // pulling in every internal field.
    return {
        output: result.output.map((item) => {
            if (item.type === 'chunk') {
                return {
                    type: 'chunk' as const,
                    fileName: item.fileName,
                    code: item.code,
                    name: item.name,
                    isEntry: item.isEntry,
                    isDynamicEntry: item.isDynamicEntry,
                    map: item.map ?? null,
                    sourcemapFileName: item.sourcemapFilename ?? null,
                    imports: item.imports,
                    dynamicImports: item.dynamicImports,
                    facadeModuleId: null,
                    moduleIds: [],
                    modules: {},
                    exports: [],
                    referencedFiles: [],
                    importedBindings: {},
                };
            }
            return {
                type: 'asset' as const,
                fileName: item.fileName,
                names: item.names,
                originalFileNames: item.originalFileNames,
                source: item.sourceText ?? '',
                needsCodeReference: false,
            };
        }),
    } as unknown as RolldownOutput;
}
