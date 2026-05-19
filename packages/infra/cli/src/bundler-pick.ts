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
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { RolldownOutput } from 'rolldown';
import type { BundlerOptions } from './types/index.js';

// npm `rolldown` is a Rust crate with platform-specific prebuilds; loading
// it eagerly at module init pulls musl-detection code that does
// `require('node:fs')` synchronously — fine on Node, but fatal under GJS
// where the createRequire polyfill rejects synchronous builtin loads.
// Dynamic import keeps it off the GJS code path entirely; the native
// branch (`@gjsify/rolldown-native`) handles bundling there.
async function loadNpmRolldown(): Promise<typeof import('rolldown').rolldown> {
    // Indirect specifier so Rolldown's static-analysis doesn't try to
    // bundle the npm crate into a GJS target build.
    const specifier = 'rolldown';
    const mod = (await import(/* @vite-ignore */ specifier)) as typeof import('rolldown');
    return mod.rolldown;
}

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

export interface NativePluginContext {
    resolve(specifier: string, importer?: string, opts?: { skipSelf?: boolean; isEntry?: boolean }): Promise<{ id: string; external: boolean } | null>;
    warn(message: string): void;
    error(message: string): never;
}

export interface NativePlugin {
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
 * In-memory bundle used by `--globals auto` for AST-driven detection.
 * Mirrors the shape of `AnalysisBundler` in
 * `@gjsify/rolldown-plugin-gjsify/utils/auto-globals`. Routes through the
 * same engine as the final build (npm rolldown on Node, native on GJS) so
 * the GJS-bundled CLI doesn't try to load the unloadable npm crate.
 */
export async function bundleToChunks(input: {
    rolldownInput: import('rolldown').InputOptions;
    format: 'esm' | 'cjs' | 'iife';
}): Promise<string[]> {
    if (await shouldUseNative()) {
        const native = await tryLoadNative();
        if (!native) throw new Error('@gjsify/rolldown-native not loadable');
        const rawPlugins = (input.rolldownInput.plugins ?? []) as unknown[];
        const nativePlugins: NativePlugin[] = [];
        for (const p of rawPlugins) {
            if (isPluginObject(p)) nativePlugins.push(toNativePlugin(p));
        }
        const opts = liftTransformExtras(stripUnserializable({
            ...input.rolldownInput,
            input: normalizeInputForNative(input.rolldownInput.input),
            format: input.format,
        }));
        delete (opts as { plugins?: unknown }).plugins;
        const result = await native.bundleWithPlugins(
            opts as unknown as Record<string, unknown>,
            nativePlugins,
        );
        const codes: string[] = [];
        for (const item of result.output) {
            if (item.type === 'chunk') codes.push(item.code);
        }
        return codes;
    }
    const rolldown = await loadNpmRolldown();
    const build = await rolldown(input.rolldownInput);
    try {
        const result = await build.generate({ format: input.format, minify: false, sourcemap: false });
        const codes: string[] = [];
        for (const entry of result.output) {
            if (entry.type === 'chunk') codes.push(entry.code);
        }
        return codes;
    } finally {
        await build.close();
    }
}

/**
 * Watch source files and rebuild on change. Only npm rolldown supports
 * this path — `@gjsify/rolldown-native` does not surface a watcher API yet.
 * Returns the watcher; the caller registers `event` / `close` listeners
 * and is responsible for invoking `watcher.close()` on shutdown.
 */
export async function runWatch(
    finalOpts: BundlerOptions,
): Promise<import('rolldown').RolldownWatcher> {
    if (await shouldUseNative()) {
        throw new Error(
            '`gjsify build --watch` requires the npm `rolldown` engine. The native engine ' +
                '(`@gjsify/rolldown-native`) does not expose a watcher API. Run the watch loop ' +
                'under Node (`node lib/index.js build … --watch`) or set `GJSIFY_BUNDLER=npm`.',
        );
    }
    const specifier = 'rolldown';
    const mod = (await import(/* @vite-ignore */ specifier)) as typeof import('rolldown');
    const output = finalOpts.output ?? {};
    return mod.watch({ ...finalOpts, output });
}

/**
 * Run a bundle with the picked engine. Drop-in replacement for the
 * `rolldown(opts).write(opts.output)` flow used directly in build.ts.
 */
export async function runBundle(finalOpts: BundlerOptions): Promise<RolldownOutput> {
    if (await shouldUseNative()) {
        return await runNativeBundle(finalOpts);
    }
    const rolldown = await loadNpmRolldown();
    const build = await rolldown(finalOpts);
    try {
        return await build.write(finalOpts.output ?? {});
    } finally {
        await build.close();
    }
}

let _nativeProbe: Promise<NativeRolldownSurface | null> | null = null;

export async function shouldUseNative(): Promise<boolean> {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
    const choice = env.GJSIFY_BUNDLER;

    // Explicit env-var override always wins.
    if (choice === 'npm') return false;
    if (choice === 'native') {
        const native = await tryLoadNative();
        if (!native) {
            throw new Error('GJSIFY_BUNDLER=native but @gjsify/rolldown-native is not loadable (no prebuild for this architecture, or not running under GJS).');
        }
        return true;
    }

    // Phase D-3.1 — runtime-aware default.
    //   Node:    use npm rolldown (no FFI loading cost at install time).
    //   GJS:     try @gjsify/rolldown-native — it's the only engine
    //            that can actually run here (npm rolldown is a Rust
    //            crate). Fall back to npm only on Node.
    const isGjs = typeof (globalThis as { imports?: { gi?: unknown } }).imports?.gi !== 'undefined';
    if (!isGjs) return false;
    const native = await tryLoadNative();
    return native !== null;
}

async function tryLoadNative(): Promise<NativeRolldownSurface | null> {
    if (_nativeProbe) return _nativeProbe;
    _nativeProbe = (async (): Promise<NativeRolldownSurface | null> => {
        const isGjs = typeof (globalThis as { imports?: { gi?: unknown } }).imports?.gi !== 'undefined';
        if (!isGjs) return null;
        try {
            // Under GJS the ESM loader has no node_modules resolver — a bare
            // `import('@gjsify/rolldown-native')` would throw `Module not
            // found`. Resolve via createRequire (PnP+node_modules-aware) to
            // a real path, then dynamic-import the resulting file:// URL.
            // Under Node a bare specifier import works directly, so we keep
            // the simpler form there.
            //
            // `createRequire` + `pathToFileURL` are statically imported at
            // the top of this file so the GJS bundle inlines them via
            // `@gjsify/module` / `@gjsify/url`. A *dynamic* `import('node:…')`
            // would instead hit the GJS native ESM loader which doesn't
            // know the `node:` URI scheme and throws — silently swallowed
            // by the surrounding catch, leaving the caller to fall back
            // to npm rolldown (which then throws ImportError for `rolldown`).
            const specifier = '@gjsify/rolldown-native';
            let target: string = specifier;
            if (isGjs) {
                const require = createRequire(import.meta.url);
                const resolved = require.resolve(specifier);
                target = pathToFileURL(resolved).href;
            }
            const mod = (await import(/* @vite-ignore */ target)) as NativeRolldownSurface;
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
    // own plugin chain. Normalize `input` to the Rust deserializer's
    // expected `InputItem[]` shape, and flatten `output: { … }` (npm
    // rolldown's JS-side shape) into the top-level keys the Rust
    // BundlerOptions deserializer expects.
    const { output: outputOpts, plugins: _droppedPlugins, ...rest } = finalOpts as unknown as Record<string, unknown> & { output?: Record<string, unknown> };
    void _droppedPlugins;
    const bundlerOpts = liftTransformExtras(stripUnserializable({
        ...rest,
        ...(outputOpts ?? {}),
        input: normalizeInputForNative(finalOpts.input as import('rolldown').InputOptions['input']),
    }));
    if ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GJSIFY_DEBUG_NATIVE_OPTS) {
        // Debug switch to inspect the shape we ship to the native facade —
        // mismatches surface as Rust serde parse errors that point at column
        // numbers in this JSON.
        console.error('[gjsify-bundler-pick] native opts JSON:', JSON.stringify(bundlerOpts));
    }
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

/**
 * Drop fields the JSON encoder can't ship to the Rust deserializer.
 * `external` may be a function predicate (npm rolldown supports this);
 * functions vanish under `JSON.stringify` and surface as parse errors on
 * the Rust side. Strip top-level function values so the option object
 * is JSON-clean. (The actual external behavior under native rolldown
 * comes from arrays/regex strings, set elsewhere by the orchestrator.)
 *
 * Also drops `sourcemap: false` — the JS API accepts a boolean while
 * the Rust deserializer expects an enum (`'File' | 'Inline' | 'Hidden'`).
 * Omitting the field has the same effect as `false`.
 */
function stripUnserializable<T extends Record<string, unknown>>(opts: T): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(opts)) {
        if (typeof v === 'function') continue;
        if (k === 'sourcemap' && typeof v === 'boolean') continue;
        out[k] = v;
    }
    return out as T;
}

/**
 * The Rust deserializer in the native facade treats `define` and `inject`
 * as top-level fields on `BundlerOptions`, while npm rolldown's JS API
 * groups them under `transform.{define,inject}`. Lift them out so the
 * orchestrator's shape (built around the JS API) is accepted by the Rust
 * side too. Other transform sub-options (`target`, `dropLabels`, …) stay
 * where they are because they are real TransformOptions fields.
 */
function liftTransformExtras<T extends Record<string, unknown>>(opts: T): T {
    const transform = opts['transform'] as Record<string, unknown> | undefined;
    if (!transform) return opts;
    const lift: Record<string, unknown> = {};
    const remaining: Record<string, unknown> = { ...transform };
    for (const key of ['define', 'inject'] as const) {
        if (key in remaining) {
            lift[key] = remaining[key];
            delete remaining[key];
        }
    }
    // `inject` shape diverges between engines: npm rolldown accepts a map
    // `{ alias: 'module' | [module, named] }`; the native Rust deserializer
    // expects an array of named-import descriptors. Convert if needed.
    if (lift['inject'] !== undefined && !Array.isArray(lift['inject'])) {
        lift['inject'] = mapToInjectArray(lift['inject'] as Record<string, string | [string, string]>);
    }
    return {
        ...opts,
        transform: Object.keys(remaining).length === 0 ? undefined : remaining,
        ...lift,
    } as T;
}

function mapToInjectArray(
    map: Record<string, string | [string, string]>,
): Array<Record<string, string>> {
    const out: Array<Record<string, string>> = [];
    for (const [alias, value] of Object.entries(map)) {
        if (typeof value === 'string') {
            // Default-import binding: `import alias from 'module'`
            out.push({ type: 'default', from: value, alias });
        } else {
            // Named-import binding: `import { imported as alias } from 'from'`
            const [from, imported] = value;
            out.push({ type: 'named', from, imported, alias });
        }
    }
    return out;
}

/**
 * The native rolldown facade's Rust deserializer requires
 * `input: BundleInputItem[]` (i.e. `[{ import, name? }]`). Normalize the
 * other shapes npm rolldown accepts (string, string[], record) into that
 * shape so callers can pass either engine the same options object.
 */
function normalizeInputForNative(
    input: import('rolldown').InputOptions['input'],
): Array<{ name?: string; import: string }> {
    if (input === undefined) return [];
    if (typeof input === 'string') return [{ import: input }];
    if (Array.isArray(input)) {
        return input.map((v) =>
            typeof v === 'string' ? { import: v } : (v as { name?: string; import: string }),
        );
    }
    return Object.entries(input as Record<string, string>).map(([name, file]) => ({ name, import: file }));
}

export type PluginRecord = { name?: string; [k: string]: unknown };

export function isPluginObject(p: unknown): p is PluginRecord {
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

export function toNativePlugin(p: PluginRecord): NativePlugin {
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
