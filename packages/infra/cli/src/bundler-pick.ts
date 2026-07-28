// Runtime bundler pick (Phase D-2.B.5b → D-3.1 runtime-aware default).
//
// The engine is chosen by `shouldUseNative()` per host runtime:
//   - Node: npm `rolldown(opts).write(opts.output)`.
//   - GJS:  `@gjsify/rolldown-native` (the Vala/Rust prebuild) via
//           `bundleWithPlugins()`. npm `rolldown` is a Rust N-API addon
//           that CANNOT load under GJS, so the native engine is the GJS
//           DEFAULT — no env var needed (this is the Node-free build
//           chain's bundler). This writes the BundleOutput to disk
//           (`runNativeBundle`), replicating npm rolldown's `.write()`
//           incl. nested chunk/asset subdirectories.
//
// `GJSIFY_BUNDLER=native|npm` is an explicit override: `native` forces
// the native engine and throws if its prebuild isn't loadable for the
// running architecture (instead of silently switching engines); `npm`
// forces the npm crate (Node only).
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

import { promises as fs, existsSync } from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type { RolldownOutput, InputOptions, RolldownWatcher } from 'rolldown';
import type * as Rolldown from 'rolldown';
import type { BundlerOptions } from './types/index.js';
import { resolveNpmPackage } from './utils/resolve-npm-package.js';
import { isGjs } from '@gjsify/rolldown-plugin-gjsify/runtime';

// npm `rolldown` is a Rust crate with platform-specific prebuilds; loading
// it eagerly at module init pulls musl-detection code that does
// `require('node:fs')` synchronously — fine on Node, but fatal under GJS
// where the createRequire polyfill rejects synchronous builtin loads.
// Dynamic import keeps it off the GJS code path entirely; the native
// branch (`@gjsify/rolldown-native`) handles bundling there.
async function loadNpmRolldown(): Promise<typeof Rolldown.rolldown> {
    // Under GJS the npm crate can NEVER run (its JS wrapper requires a
    // napi binary). Reaching this loader under GJS means the native
    // engine probe failed — historically that surfaced as an opaque
    // `ImportError: Unsupported URI scheme for importing: node` from deep
    // inside the crate's wrapper (e.g. on a truly-cold workspace where
    // `@gjsify/rolldown-native`'s lib/ is not built yet, issue #497).
    // Fail with the actionable diagnosis instead.
    if (isGjs()) {
        throw new Error(
            'gjsify build: no usable bundler engine under GJS — `@gjsify/rolldown-native` is not loadable, ' +
                'and the npm `rolldown` engine is a Rust napi crate that cannot run under GJS.\n' +
                diagnoseNativeEngine(),
        );
    }
    // Indirect specifier so Rolldown's static-analysis doesn't try to
    // bundle the npm crate into a GJS target build.
    const specifier = 'rolldown';
    const target = resolveImportTargetForGjs(specifier);
    const mod = (await import(/* @vite-ignore */ target)) as typeof Rolldown;
    return mod.rolldown;
}

/**
 * Say WHY the native engine could not be loaded, read off disk rather than
 * guessed.
 *
 * The three causes need three different fixes, and this message used to assert
 * the rarest of them ("the CLI bundle was invoked DIRECTLY … bypasses the
 * `gjsify` launcher") as the "most likely cause". On the by-far most common
 * one — a freshly cloned + freshly installed tree, where the engine's JS facade
 * has simply never been built — that reading is not merely unhelpful, it points
 * at a launcher that was in fact used correctly, so the reader goes looking for
 * an env-var problem that does not exist. `scripts/verify-committed-bundles.mjs`
 * hit exactly that and it blocked releases.
 *
 * The probe is `existsSync`-only (no import, no resolution) so it cannot itself
 * throw or recurse into the failure being explained.
 */
function diagnoseNativeEngine(): string {
    let pkgDir: string | null = null;
    try {
        const bundleDir = path.dirname(new URL(import.meta.url).pathname);
        pkgDir = findRolldownNativeDir(process.cwd(), bundleDir);
    } catch {
        pkgDir = null;
    }

    if (pkgDir === null) {
        return (
            '`@gjsify/rolldown-native` is NOT INSTALLED — no node_modules/@gjsify/rolldown-native was found ' +
            `walking up from ${process.cwd()} or from the CLI bundle's own directory.\n` +
            'Install it: `gjsify install @gjsify/rolldown-native` (in the gjsify repo: `gjsify install`). ' +
            'Running the build under Node also works — there the npm `rolldown` crate is used instead.'
        );
    }

    const facade = path.join(pkgDir, 'lib', 'esm', 'index.js');
    if (!existsSync(facade)) {
        return (
            `The engine's JS facade is NOT BUILT: ${facade} does not exist.\n` +
            'It is a BUILD OUTPUT, not something `gjsify install` produces — so a freshly cloned or freshly ' +
            'installed tree never has it, and every `gjsify build` under GJS fails here until it is built once. ' +
            'Building it needs a bundler, which is why it cannot bootstrap itself under GJS; the Node CLI entry ' +
            'does it instead. From the gjsify repo root:\n' +
            '  gjsify run build:infra                          # the full cold-tree chain (recommended)\n' +
            '  node scripts/bootstrap-native-facades.mjs       # just the facades, if the rest is already built\n' +
            'Both are idempotent and skip already-built facades in seconds.'
        );
    }

    return (
        'The JS facade is built, so this is the typelib/prebuild lookup failing. Most likely the CLI bundle was ' +
        'invoked DIRECTLY (`gjs -m …/cli.gjs.mjs`, or by executing dist/cli.gjs.mjs), which bypasses the `gjsify` ' +
        'launcher that exports GI_TYPELIB_PATH / LD_LIBRARY_PATH for the prebuilds. The typelib lookup happens ' +
        'inside the GJS runtime, so those must be set BEFORE the process starts — the CLI cannot repair it from ' +
        'the inside. Run through the `gjsify` bin instead (`node_modules/.bin/gjsify …`, or the globally installed ' +
        'shim), or export the env yourself:\n' +
        `  P=${path.join(pkgDir, 'prebuilds', `${process.platform ?? 'linux'}-${process.arch ?? 'x64'}`)}\n` +
        '  GI_TYPELIB_PATH=$P LD_LIBRARY_PATH=$P gjs -m …/cli.gjs.mjs build …\n' +
        'Otherwise: no prebuild exists for this architecture. Running the build under Node also works.'
    );
}

/**
 * Convert a bare npm specifier into something dynamic `import(...)` can
 * load regardless of host runtime:
 *
 *   - Node has a native node_modules resolver — return the specifier
 *     unchanged.
 *   - GJS's native ESM loader has no node_modules walker, so we resolve
 *     the specifier through multiple `createRequire` anchors (cwd,
 *     workspace root, bundle URL, parent-dir walk, `GJSIFY_NODE_PATH`)
 *     and dynamic-import the resulting `file://` URL.
 *
 * Falls back to the bare specifier when every anchor misses so the
 * host runtime's loader surfaces its native error path instead of a
 * silent synth from this helper.
 *
 * The bundle-URL anchor (`import.meta.url`) is critical for the case
 * where the install lives next to the bundle but the user invokes
 * `gjs -m <install>/dist/cli.gjs.mjs build …` from a completely
 * unrelated cwd — without it, the createRequire walk anchored at the
 * cwd's `node_modules` chain misses, and we'd throw `Module not found:
 * rolldown` even though the package is present under the install dir.
 */
function resolveImportTargetForGjs(specifier: string): string {
    if (!isGjs()) return specifier;
    const resolved = resolveNpmPackage(specifier, { bundleUrl: import.meta.url });
    if (resolved) return pathToFileURL(resolved).href;
    return specifier;
}

interface BundleResult {
    warnings: string[];
    output: Array<
        | {
              type: 'chunk';
              fileName: string;
              name: string;
              isEntry: boolean;
              isDynamicEntry: boolean;
              code: string;
              map?: string;
              sourcemapFilename?: string;
              imports: string[];
              dynamicImports: string[];
          }
        | {
              type: 'asset';
              fileName: string;
              names: string[];
              originalFileNames: string[];
              sourceText?: string;
              sourceBytesLen: number;
          }
    >;
}

interface NativeRolldownSurface {
    hasNativeRolldown(): boolean;
    bundleWithPlugins(opts: unknown, plugins: NativePlugin[]): Promise<BundleResult>;
}

export interface NativePluginContext {
    resolve(
        specifier: string,
        importer?: string,
        opts?: { skipSelf?: boolean; isEntry?: boolean },
    ): Promise<{ id: string; external: boolean } | null>;
    warn(message: string): void;
    error(message: string): never;
}

export interface NativePlugin {
    name: string;
    idFilter?: { load?: string; transform?: string; resolveId?: string };
    load?: (this: NativePluginContext, id: string) => unknown;
    transform?: (this: NativePluginContext, code: string, id: string, moduleType: string) => unknown;
    resolveId?: (
        this: NativePluginContext,
        specifier: string,
        importer: string | undefined,
        opts: { isEntry: boolean },
    ) => unknown;
    renderChunk?: (
        this: NativePluginContext,
        code: string,
        chunk: { fileName: string; name: string; isEntry: boolean },
    ) => unknown;
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
    rolldownInput: InputOptions;
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
        const opts = liftTransformExtras(
            stripUnserializable({
                ...input.rolldownInput,
                input: normalizeInputForNative(input.rolldownInput.input),
                format: input.format,
            }),
        );
        delete (opts as { plugins?: unknown }).plugins;
        const result = await native.bundleWithPlugins(opts as unknown as Record<string, unknown>, nativePlugins);
        reportNativeWarnings(result, input.rolldownInput as Record<string, unknown>);
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
export async function runWatch(finalOpts: BundlerOptions): Promise<RolldownWatcher> {
    if (await shouldUseNative()) {
        throw new Error(
            '`gjsify build --watch` requires the npm `rolldown` engine. The native engine ' +
                '(`@gjsify/rolldown-native`) does not expose a watcher API. Run the watch loop ' +
                'under Node (`node lib/index.js build … --watch`) or set `GJSIFY_BUNDLER=npm`.',
        );
    }
    const specifier = 'rolldown';
    const target = resolveImportTargetForGjs(specifier);
    const mod = (await import(/* @vite-ignore */ target)) as typeof Rolldown;
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
            throw new Error(
                'GJSIFY_BUNDLER=native but @gjsify/rolldown-native is not loadable (no prebuild for this architecture, or not running under GJS).',
            );
        }
        return true;
    }

    // Phase D-3.1 — runtime-aware default.
    //   Node:    use npm rolldown (no FFI loading cost at install time).
    //   GJS:     try @gjsify/rolldown-native — it's the only engine
    //            that can actually run here (npm rolldown is a Rust
    //            crate). Fall back to npm only on Node.
    if (!isGjs()) return false;
    const native = await tryLoadNative();
    return native !== null;
}

/**
 * Walk parent directories from `startDir` (and optionally a second anchor
 * `bundleDir`) looking for `node_modules/@gjsify/rolldown-native/package.json`.
 * Returns the package root path (parent of its `package.json`) on the first
 * hit, or null when nothing is found within 12 levels.
 *
 * This is a raw `existsSync`-based probe that bypasses both `createRequire`
 * (whose GJS polyfill may not walk the full chain when anchored inside a
 * sub-package dir) and `findWorkspaceRoot` (which requires `discoverWorkspaces`
 * to map the sub-package to a workspace member, a step that can fail under
 * the GJS polyfill stack). Used by `tryLoadNative` as an explicit fallback
 * when the standard `resolveNpmPackage` anchors miss.
 */
export function findRolldownNativeDir(startDir: string, bundleDir?: string): string | null {
    const relPath = path.join('node_modules', '@gjsify', 'rolldown-native', 'package.json');
    const dirsToSearch: string[] = [startDir];
    if (bundleDir && bundleDir !== startDir) dirsToSearch.push(bundleDir);

    for (const anchor of dirsToSearch) {
        let dir = anchor;
        for (let i = 0; i < 12; i++) {
            const candidate = path.join(dir, relPath);
            if (existsSync(candidate)) {
                return path.join(dir, 'node_modules', '@gjsify', 'rolldown-native');
            }
            const parent = path.resolve(dir, '..');
            if (parent === dir) break;
            dir = parent;
        }
    }
    return null;
}

async function tryLoadNative(): Promise<NativeRolldownSurface | null> {
    if (_nativeProbe) return _nativeProbe;
    _nativeProbe = (async (): Promise<NativeRolldownSurface | null> => {
        if (!isGjs()) return null;
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
            if (isGjs()) {
                // Same multi-anchor resolution as `loadNpmRolldown` —
                // when the bundle is invoked from a cwd outside the
                // install dir, anchoring solely at `import.meta.url`
                // misses node_modules layouts where the user's cwd
                // or the workspace root carries the package instead.
                //
                // When `resolveNpmPackage`'s standard anchors all miss
                // (e.g. invoked from a package subdir whose own
                // node_modules doesn't carry the optional-peer
                // `@gjsify/rolldown-native`), fall back to a raw
                // `existsSync`-based parent-dir walk — it bypasses
                // both the GJS `createRequire` polyfill's walk
                // limitations and `findWorkspaceRoot`'s dependency on
                // `discoverWorkspaces`, both of which can fail to map a
                // sub-package dir up to the hoisted workspace root.
                const bundleDir = path.dirname(new URL(import.meta.url).pathname);
                const resolvedFromNpm = resolveNpmPackage(specifier, { bundleUrl: import.meta.url });
                const resolvedFromFs = resolvedFromNpm
                    ? null
                    : (() => {
                          const pkgDir = findRolldownNativeDir(process.cwd(), bundleDir);
                          if (!pkgDir) return null;
                          // Resolve the package entry via createRequire anchored
                          // inside the found package dir so we get the correct
                          // exports-map / main field entry point.
                          try {
                              return createRequire(
                                  pathToFileURL(path.join(pkgDir, '__gjsify_resolve__.js')).href,
                              ).resolve(specifier);
                          } catch {
                              return null;
                          }
                      })();
                const resolved = resolvedFromNpm ?? resolvedFromFs ?? createRequire(import.meta.url).resolve(specifier);
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
    const {
        output: outputOpts,
        plugins: _droppedPlugins,
        ...rest
    } = finalOpts as unknown as Record<string, unknown> & { output?: Record<string, unknown> };
    void _droppedPlugins;
    const bundlerOpts = liftTransformExtras(
        stripUnserializable({
            ...rest,
            ...outputOpts,
            input: normalizeInputForNative(finalOpts.input as InputOptions['input']),
        }),
    );
    if (
        (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
            ?.GJSIFY_DEBUG_NATIVE_OPTS
    ) {
        // Debug switch to inspect the shape we ship to the native facade —
        // mismatches surface as Rust serde parse errors that point at column
        // numbers in this JSON.
        console.error('[gjsify-bundler-pick] native opts JSON:', JSON.stringify(bundlerOpts));
    }
    const result = await native.bundleWithPlugins(bundlerOpts as unknown as Record<string, unknown>, nativePlugins);
    reportNativeWarnings(result, finalOpts as unknown as Record<string, unknown>);

    // The native facade returns the BundleOutput shape but doesn't
    // write files — replicate `.write()` here so callers see the same
    // on-disk layout whether they used npm rolldown or native.
    const outputCfg = (finalOpts.output ?? {}) as { dir?: string; file?: string };
    const outDir = outputCfg.dir ?? (outputCfg.file ? path.dirname(outputCfg.file) : process.cwd());
    if (outDir) await fs.mkdir(outDir, { recursive: true });
    for (const item of result.output) {
        // A single `--outfile` build collapses to that exact path; otherwise
        // each chunk/asset lands at `outDir/<fileName>`. Nested fileNames
        // (e.g. `_virtual/_rolldown/runtime.js` from a `--library` /
        // code-split build) live in subdirectories npm rolldown's `.write()`
        // creates implicitly — replicate that here, or `writeFile` throws
        // ENOENT on the missing parent (regression: `--library` under the
        // native GJS engine). Also write text assets for `.write()` parity.
        const target =
            outputCfg.file && item.type === 'chunk' && result.output.length === 1
                ? outputCfg.file
                : path.join(outDir, item.fileName);
        await fs.mkdir(path.dirname(target), { recursive: true });
        if (item.type === 'chunk') {
            await fs.writeFile(target, item.code, 'utf8');
            // `.write()` parity: npm rolldown emits `<fileName>.map` next to
            // each chunk when `sourcemap: 'File'|'Hidden'` is set. The native
            // facade carries the map JSON on the chunk (`map` is undefined for
            // inline/disabled sourcemaps) — write it or sourcemaps would be
            // silently unavailable under the GJS-default engine.
            if (typeof item.map === 'string') {
                await fs.writeFile(`${target}.map`, item.map, 'utf8');
            }
        } else if (item.sourceText !== undefined) {
            await fs.writeFile(target, item.sourceText, 'utf8');
        }
    }

    // Synthesize the RolldownOutput shape downstream code touches.
    return synthRolldownOutput(result);
}

/**
 * Surface native-engine bundle warnings through the same channel npm
 * rolldown uses (its default `onLog` prints warnings at logLevel 'info').
 * The Rust side collects rolldown warnings + plugin `this.warn()` calls
 * into `BundleResult.warnings`; never reading them is what let the
 * dropped-options hazard class ship unnoticed — UNRESOLVED_IMPORT (the
 * only runtime signal that an import is riding the unresolved-fallback
 * accident) and every plugin warning were invisible on the GJS-default
 * engine. De-duplicated per call; respects `logLevel: 'silent'` (the
 * `--globals auto` analysis passes set it, so analysis stays quiet).
 */
function reportNativeWarnings(result: BundleResult, opts: Record<string, unknown>): void {
    if (opts['logLevel'] === 'silent') return;
    if (!Array.isArray(result.warnings) || result.warnings.length === 0) return;
    const seen = new Set<string>();
    for (const warning of result.warnings) {
        if (seen.has(warning)) continue;
        seen.add(warning);
        console.warn(`[gjsify-bundler] ${warning}`);
    }
}

// Warn-once registry for `stripUnserializable` — one warning per option
// key per process, so a 3-pass `--globals auto` build doesn't repeat the
// same message. The silent drop of function-valued options is the
// recurring footgun behind three shipped/near-shipped bugs (app/node.ts,
// library/lib.ts, app/gjs.ts external predicates) — never drop silently.
const warnedDroppedKeys = new Set<string>();

/**
 * Sanitize fields the JSON encoder can't ship to the Rust deserializer.
 *
 * Functions vanish under `JSON.stringify` (the key disappears from the
 * JSON), silently changing build behavior vs npm rolldown — so dropping
 * one now WARNS (once per key). `external` gets a dedicated message: the
 * orchestrators express externals as exact-name arrays + an
 * `externalsPlugin` resolveId hook precisely because a function predicate
 * cannot cross this boundary; a function here means a regression (or a
 * user config) reintroduced the dropped-predicate class.
 *
 * `external` array elements must be plain strings — the Rust
 * `deserialize_external` only accepts `Vec<String>` and a RegExp
 * serializes to `{}`, producing an opaque serde column error. Reject
 * RegExp/non-string elements with a NAMED error instead.
 *
 * `sourcemap` is TRANSLATED, not dropped: the JS API accepts
 * `boolean | 'inline' | 'hidden'` while the Rust `SourceMapType` enum
 * (plain serde derive, no rename_all) only accepts `'File' | 'Inline' |
 * 'Hidden'`. `true` → `'File'`, `'inline'` → `'Inline'`, `'hidden'` →
 * `'Hidden'`; `false` is omitted (same effect).
 *
 * Exported for the unit tests in `bundler-pick.spec.ts`.
 */
export function stripUnserializable<T extends Record<string, unknown>>(opts: T): T {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(opts)) {
        if (typeof v === 'function') {
            if (!warnedDroppedKeys.has(k)) {
                warnedDroppedKeys.add(k);
                const hint =
                    k === 'external'
                        ? ' Function `external` predicates are NOT supported by the native engine — ' +
                          'pass exact names as a string array and/or enforce shape rules via a ' +
                          'resolveId plugin returning `{ external: true }` (see externalsPlugin in ' +
                          '@gjsify/rolldown-plugin-gjsify).'
                        : ' Function-valued options do not survive the JSON boundary to the Rust core.';
                console.warn(
                    `[gjsify-bundler] dropping non-serializable option "${k}" for the native rolldown engine —` +
                        ` behavior may diverge from npm rolldown.${hint}`,
                );
            }
            continue;
        }
        if (k === 'external' && Array.isArray(v)) {
            const bad = v.find((el) => typeof el !== 'string');
            if (bad !== undefined) {
                throw new Error(
                    'gjsify build: `external` entries must be exact string names under the native ' +
                        `rolldown engine (got ${bad instanceof RegExp ? bad.toString() : typeof bad}). ` +
                        'RegExp/function externals are only supported by npm rolldown — use exact names ' +
                        'or a resolveId plugin returning `{ external: true }`.',
                );
            }
            out[k] = v;
            continue;
        }
        if (k === 'sourcemap') {
            const mapped = translateSourcemapOption(v);
            if (mapped !== undefined) out[k] = mapped;
            continue;
        }
        out[k] = v;
    }
    return out as T;
}

/**
 * Map the JS-API `sourcemap` spellings onto the Rust `SourceMapType` enum
 * variants. Returns `undefined` for `false`/unknown shapes (omit the key).
 * Exported for the unit tests in `bundler-pick.spec.ts`.
 */
export function translateSourcemapOption(v: unknown): 'File' | 'Inline' | 'Hidden' | undefined {
    if (v === true || v === 'file' || v === 'File') return 'File';
    if (v === 'inline' || v === 'Inline') return 'Inline';
    if (v === 'hidden' || v === 'Hidden') return 'Hidden';
    return undefined;
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

/**
 * Convert npm rolldown's `transform.inject` map shorthand into the array
 * of descriptors the native Rust deserializer expects. The Rust
 * `InjectImport` enum (`tag = "type"`, `rename_all = "camelCase"`) has
 * exactly TWO variants:
 *
 *   - `{ type: 'named', imported, alias?, from }`
 *   - `{ type: 'namespace', alias, from }`
 *
 * npm rolldown's map spellings translate as:
 *
 *   - `{ alias: 'module' }`        → default import →
 *     `{ type: 'named', imported: 'default', alias, from: 'module' }`
 *     (the Rust `InjectImport::default()` constructor encodes default
 *     imports as a named import of `default` — there is NO `'default'`
 *     variant; emitting `{ type: 'default' }` crashes the deserializer
 *     with `unknown variant \`default\``).
 *   - `{ alias: ['module', '*'] }` → namespace import →
 *     `{ type: 'namespace', alias, from: 'module' }`.
 *   - `{ alias: ['module', 'name'] }` → named import →
 *     `{ type: 'named', from: 'module', imported: 'name', alias }`.
 *
 * Exported for the unit tests in `bundler-pick.spec.ts`.
 */
export function mapToInjectArray(map: Record<string, string | [string, string]>): Array<Record<string, string>> {
    const out: Array<Record<string, string>> = [];
    for (const [alias, value] of Object.entries(map)) {
        if (typeof value === 'string') {
            // Default-import binding: `import alias from 'module'`
            out.push({ type: 'named', imported: 'default', from: value, alias });
        } else {
            const [from, imported] = value;
            if (imported === '*') {
                // Namespace-import binding: `import * as alias from 'from'`
                out.push({ type: 'namespace', from, alias });
            } else {
                // Named-import binding: `import { imported as alias } from 'from'`
                out.push({ type: 'named', from, imported, alias });
            }
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
function normalizeInputForNative(input: InputOptions['input']): Array<{ name?: string; import: string }> {
    if (input === undefined) return [];
    if (typeof input === 'string') return [{ import: input }];
    if (Array.isArray(input)) {
        return input.map((v) => (typeof v === 'string' ? { import: v } : (v as { name?: string; import: string })));
    }
    return Object.entries(input as Record<string, string>).map(([name, file]) => ({ name, import: file }));
}

export type PluginRecord = { name?: string; [k: string]: unknown };

export function isPluginObject(p: unknown): p is PluginRecord {
    return p !== null && typeof p === 'object' && !Array.isArray(p);
}

interface RolldownHookFilter {
    id?: RegExp | string | Array<RegExp | string>;
}
interface RolldownHookObject {
    filter?: RolldownHookFilter;
    handler: (...args: never[]) => unknown;
}

function pickHook<F extends (...args: never[]) => unknown>(raw: unknown): { fn: F; idFilter?: string } | undefined {
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
    if (load) {
        out.load = load.fn as NativePlugin['load'];
        if (load.idFilter) idFilter.load = load.idFilter;
    }
    const transform = pickHook(p.transform);
    if (transform) {
        out.transform = transform.fn as NativePlugin['transform'];
        if (transform.idFilter) idFilter.transform = transform.idFilter;
    }
    const resolveId = pickHook(p.resolveId);
    if (resolveId) {
        out.resolveId = resolveId.fn as NativePlugin['resolveId'];
        if (resolveId.idFilter) idFilter.resolveId = resolveId.idFilter;
    }
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
