import type { ConfigData, BundlerOptions } from '../types/index.js';
import type { App, PluginOptions } from '@gjsify/rolldown-plugin-gjsify';
import type { RolldownOutput, RolldownPluginOption } from 'rolldown';
import { runBundle, runWatch, bundleToChunks } from '../bundler-pick.js';
import { gjsifyPlugin, textLoaderPlugin, resolveShebangLine, NODE_SHEBANG } from '@gjsify/rolldown-plugin-gjsify';
import { isGjs } from '@gjsify/rolldown-plugin-gjsify/runtime';
import { resolveUserPlugins } from '../utils/resolve-plugin-by-name.js';
import { resolveGlobalsList, writeRegisterInjectFile, detectAutoGlobals } from '@gjsify/rolldown-plugin-gjsify/globals';
import { pnpPlugin } from '@gjsify/rolldown-plugin-pnp';
import { dirname, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { normalizeBundlerOptions, mergeBundlerOptions } from '../utils/normalize-bundler-options.js';

const DEFAULT_GJS_SHEBANG = '#!/usr/bin/env -S gjs -m';

/**
 * `true` when `path` points at a location that's unsafe to use as a build
 * outfile (would overwrite source). Currently catches:
 *   - any TypeScript extension (`.ts`, `.tsx`, `.mts`, `.cts`, `.mtsx`, `.ctsx`)
 *   - paths that live under a `src/` segment (relative or absolute)
 */
function isUnsafeDefaultOutput(path: string): boolean {
    if (/\.[cm]?tsx?$/i.test(path)) return true;
    const norm = path.replace(/\\/g, '/');
    if (/(?:^|\/)src\//.test(norm)) return true;
    return false;
}

/**
 * Resolve the gjsify-flavoured PnP plugin. Anchors the relay on this file's
 * URL so transitive `@gjsify/*` polyfills (reached via @gjsify/cli's deps on
 * @gjsify/{node,web}-polyfills) are resolvable for external consumers without
 * each one having to be a direct devDep.
 *
 * The path rewriter (`__filename`/`__dirname` + `import.meta.url` injection
 * for node_modules code) is registered separately by the orchestrator —
 * Rolldown's transform hooks all run sequentially, no shared `onLoad` race.
 */
async function buildPnpPlugin(): Promise<RolldownPluginOption | null> {
    return pnpPlugin({ issuerUrl: import.meta.url });
}

/**
 * Stable, filesystem-safe short hash of a string (djb2 → 8 hex chars).
 * Used to key a plugin's cached GJS bundle by its resolved source path.
 * Dependency-free on purpose — avoids pulling crypto into this hot path.
 */
function shortHash(value: string): string {
    let h = 5381;
    for (let i = 0; i < value.length; i++) {
        h = ((h << 5) + h + value.charCodeAt(i)) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

function isTruthyEnv(v: string | undefined): boolean {
    return v === '1' || v === 'true' || v === 'yes';
}

/**
 * Lockfiles whose change implies a plugin's *transitive* deps may have moved.
 * A dep bump (`npm/yarn/pnpm/gjsify install`) rewrites one of these but leaves
 * the plugin's own entry-file mtime untouched — so the plugin GJS-bundle cache
 * must invalidate on these too, not only on the entry.
 */
const PLUGIN_CACHE_DEP_SIGNALS = ['gjsify-lock.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];

/** Newest mtime (ms) among known lockfiles in `cwd`, or 0 when none exist. */
async function newestLockfileMtime(cwd: string): Promise<number> {
    let newest = 0;
    for (const name of PLUGIN_CACHE_DEP_SIGNALS) {
        try {
            const s = await stat(join(cwd, name));
            if (s.mtimeMs > newest) newest = s.mtimeMs;
        } catch {
            // not present — ignore
        }
    }
    return newest;
}

export class BuildAction {
    constructor(readonly configData: ConfigData = {}) {}

    /** Library mode */
    async buildLibrary(): Promise<RolldownOutput[]> {
        const { verbose, library, typescript, exclude, aliases } = this.configData;
        const lib = library ?? {};
        const userBundler = normalizeBundlerOptions(this.configData);

        const moduleOutdir = lib.module ? dirname(lib.module) : undefined;
        const mainOutdir = lib.main ? dirname(lib.main) : undefined;

        const moduleOutExt = lib.module ? extname(lib.module) : '.js';
        const mainOutExt = lib.main ? extname(lib.main) : '.js';

        const multipleBuilds = moduleOutdir && mainOutdir && moduleOutdir !== mainOutdir;

        const pnp = await buildPnpPlugin();
        const pnpPlugins: RolldownPluginOption[] = pnp ? [pnp] : [];

        const results: RolldownOutput[] = [];

        if (multipleBuilds) {
            const moduleFormat: 'esm' | 'cjs' =
                moduleOutdir.includes('/cjs') || moduleOutExt === '.cjs' ? 'cjs' : 'esm';
            results.push(
                await runOneLibraryBuild({
                    pluginOpts: {
                        debug: verbose,
                        library: moduleFormat,
                        exclude,
                        reflection: typescript?.reflection,
                        jsExtension: moduleOutExt,
                    },
                    userBundler,
                    output: { dir: moduleOutdir },
                    userAliases: aliases,
                    pnpPlugins,
                }),
            );

            const mainFormat: 'esm' | 'cjs' = mainOutdir.includes('/cjs') || mainOutExt === '.cjs' ? 'cjs' : 'esm';
            results.push(
                await runOneLibraryBuild({
                    pluginOpts: {
                        debug: verbose,
                        library: mainFormat,
                        exclude,
                        reflection: typescript?.reflection,
                        jsExtension: mainOutExt,
                    },
                    userBundler,
                    output: { dir: mainOutdir },
                    userAliases: aliases,
                    pnpPlugins,
                }),
            );
        } else {
            const outfilePath = userBundler.output?.file ?? lib.module ?? lib.main;
            const outExt = outfilePath ? extname(outfilePath) : '.js';
            const outdir = userBundler.output?.dir ?? (outfilePath ? dirname(outfilePath) : undefined);
            const format: 'esm' | 'cjs' =
                (userBundler.output?.format as 'esm' | 'cjs' | undefined) ??
                (outdir?.includes('/cjs') || outExt === '.cjs' ? 'cjs' : 'esm');
            results.push(
                await runOneLibraryBuild({
                    pluginOpts: {
                        debug: verbose,
                        library: format,
                        exclude,
                        reflection: typescript?.reflection,
                        jsExtension: outExt,
                    },
                    userBundler,
                    output: { dir: outdir },
                    userAliases: aliases,
                    pnpPlugins,
                }),
            );
        }
        return results;
    }

    /**
     * Parse the `--globals` value into { autoMode, extras }.
     * - `auto`             → { autoMode: true, extras: '' }
     * - `auto,dom`         → { autoMode: true, extras: 'dom' }
     * - `auto,dom,fetch`   → { autoMode: true, extras: 'dom,fetch' }
     * - `dom,fetch`        → { autoMode: false, extras: 'dom,fetch' }
     * - `none` / ``        → { autoMode: false, extras: '' }
     * - `undefined`        → { autoMode: true, extras: '' }  (default)
     */
    private parseGlobalsValue(value: string | undefined): {
        autoMode: boolean;
        extras: string;
    } {
        if (value === undefined) return { autoMode: true, extras: '' };
        if (value === 'none' || value === '') return { autoMode: false, extras: '' };

        const tokens = value
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean);
        const hasAuto = tokens.includes('auto');
        const extras = tokens.filter((t) => t !== 'auto').join(',');

        return { autoMode: hasAuto, extras };
    }

    /**
     * Resolve the `--globals` CLI list into a pre-computed inject stub path
     * that the orchestrator appends to its input list. Only runs for
     * `--app gjs` — Node and browser builds rely on native globals.
     *
     * Used only for the explicit-only path (no `auto` token in the value).
     * The auto path is handled in `buildApp` via the iterative multi-pass build.
     */
    private async resolveGlobalsInject(
        app: App,
        globals: string,
        verbose: boolean | undefined,
    ): Promise<string | undefined> {
        if (app !== 'gjs') return undefined;
        if (!globals) return undefined;

        const registerPaths = resolveGlobalsList(globals);
        if (registerPaths.size === 0) return undefined;

        const injectPath = await writeRegisterInjectFile(registerPaths, process.cwd());
        if (verbose && injectPath) {
            console.debug(
                `[gjsify] globals: injected ${registerPaths.size} register module(s) from --globals ${globals}`,
            );
        }
        return injectPath ?? undefined;
    }

    /**
     * Post-processing: prepend the resolved shebang line and mark the
     * output executable. Runs for GJS and Node app builds with a single
     * outfile. The default line depends on the target — `gjs -m` for
     * `--app gjs`, `node` for `--app node` — so a single `shebang: true`
     * config produces a directly-executable bin for whichever target is
     * built. For GJS the shebang plugin already injects during bundling;
     * this hook is the safety net for anything that bypassed it (e.g.
     * user-supplied banners that out-ordered it) plus the chmod. For Node
     * there is no in-bundle plugin, so this hook is the sole injection point.
     */
    private async applyShebang(app: App, outfile: string | undefined, verbose: boolean | undefined): Promise<void> {
        if (!outfile) {
            if (verbose) console.warn('[gjsify] --shebang skipped: no single outfile (use --outfile for executables)');
            return;
        }

        const defaultLine = app === 'node' ? NODE_SHEBANG : DEFAULT_GJS_SHEBANG;
        const line = resolveShebangLine(this.configData.shebang, defaultLine) ?? defaultLine;

        const content = await readFile(outfile, 'utf-8');
        if (content.startsWith('#!')) {
            if (verbose) console.debug(`[gjsify] --shebang skipped: ${outfile} already starts with a shebang`);
        } else {
            await writeFile(outfile, line + '\n' + content);
        }
        await chmod(outfile, 0o755);
        if (verbose) console.debug(`[gjsify] --shebang: wrote ${line} + chmod 0o755 to ${outfile}`);
    }

    /**
     * GJS plugin loader — bundle the resolved plugin module to a single
     * self-contained ESM file, then import that. Works around GJS's native
     * ESM loader not following `package.json#exports` subpath maps for bare
     * specifiers: Rolldown resolves those subpaths at bundle time, so the
     * emitted file has no unresolvable bare-specifier imports left. Injected
     * as the `loadModule` strategy in `buildApp` only when running under GJS.
     */
    private async loadPluginViaGjsBundle(
        resolvedPath: string,
        pluginName: string,
        verbose: boolean | undefined,
    ): Promise<Record<string, unknown>> {
        const outfile = await this.bundlePluginForGjs(resolvedPath, pluginName, verbose);
        try {
            return (await import(pathToFileURL(outfile).href)) as Record<string, unknown>;
        } catch (err) {
            throw new Error(
                `gjsify config: failed to import the GJS bundle for plugin "${pluginName}" ` +
                    `(bundled to ${outfile}). (${(err as Error).message})`,
            );
        }
    }

    /**
     * Bundle a single plugin entry for `--app gjs` to a cached temp file and
     * return its path. Reuses the full `--app gjs` pipeline (exports-map-aware
     * resolution, `node:`→`@gjsify` aliases, `--globals auto`, single-file
     * output) via a nested `BuildAction`. The nested config carries no
     * `bundler.plugins`, so it never recurses back into plugin resolution.
     *
     * Cached under `node_modules/.cache/gjsify/plugins/`, keyed by the resolved
     * source path. Invalidated when the plugin entry OR the project lockfile is
     * newer than the cached bundle — a dep bump rewrites the lockfile but not
     * the plugin's own entry mtime. The one window neither mtime catches (a
     * transitive dep edited in place) is covered by the `GJSIFY_NO_PLUGIN_CACHE=1`
     * escape hatch. Failures are rethrown with context naming the plugin.
     */
    private async bundlePluginForGjs(
        resolvedPath: string,
        pluginName: string,
        verbose: boolean | undefined,
    ): Promise<string> {
        const cwd = process.cwd();
        const cacheDir = join(cwd, 'node_modules', '.cache', 'gjsify', 'plugins');
        const safeName = pluginName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const outfile = join(cacheDir, `${safeName}-${shortHash(resolvedPath)}.mjs`);

        const cacheDisabled = isTruthyEnv(process.env.GJSIFY_NO_PLUGIN_CACHE);
        if (!cacheDisabled && (await this.isPluginBundleFresh(outfile, resolvedPath, cwd))) {
            if (verbose) console.debug(`[gjsify] plugin "${pluginName}": reusing cached GJS bundle ${outfile}`);
            return outfile;
        }

        if (verbose) console.debug(`[gjsify] plugin "${pluginName}": bundling for GJS → ${outfile}`);

        try {
            await mkdir(cacheDir, { recursive: true });
            // shebang is intentionally left unset — the artifact is imported,
            // not executed, so it must NOT carry a `#!` line.
            const pluginBuild = new BuildAction({
                verbose,
                bundler: { input: resolvedPath, output: { file: outfile } },
            });
            await pluginBuild.buildApp('gjs');
        } catch (err) {
            throw new Error(
                `gjsify config: failed to bundle plugin "${pluginName}" for GJS ` +
                    `(needed because GJS can't import packages that use exports-map subpaths directly; ` +
                    `cache dir ${cacheDir}). (${(err as Error).message})`,
            );
        }
        return outfile;
    }

    /**
     * Fresh when the cached bundle is newer than BOTH the plugin entry AND the
     * project's lockfile (the dep-change signal). Missing bundle/source → not
     * fresh (rebuild).
     */
    private async isPluginBundleFresh(outfile: string, resolvedPath: string, cwd: string): Promise<boolean> {
        try {
            const outStat = await stat(outfile);
            const srcStat = await stat(resolvedPath);
            const depMtime = await newestLockfileMtime(cwd);
            return outStat.mtimeMs >= Math.max(srcStat.mtimeMs, depMtime);
        } catch {
            return false;
        }
    }

    /** Application mode */
    async buildApp(app: App = 'gjs', opts: { watch?: boolean } = {}): Promise<RolldownOutput[]> {
        const { verbose, typescript, exclude, library: pkg, aliases, excludeGlobals } = this.configData;

        const userBundler = normalizeBundlerOptions(this.configData);

        const formatRaw =
            (userBundler.output?.format as 'esm' | 'cjs' | 'iife' | undefined) ??
            (userBundler.output?.file?.endsWith('.cjs') ? 'cjs' : 'esm');
        // The orchestrator only handles esm/cjs (iife is not a GJS / Node /
        // browser-bundle target we support). Coerce.
        const format: 'esm' | 'cjs' = formatRaw === 'iife' ? 'esm' : formatRaw;

        // Set default outfile if no outdir is set
        let outfile = userBundler.output?.file;
        let outdir = userBundler.output?.dir;
        if (!outfile && !outdir && (pkg?.main || pkg?.module)) {
            const candidate = format === 'cjs' ? (pkg.main ?? pkg.module) : (pkg.module ?? pkg.main);
            if (candidate && isUnsafeDefaultOutput(candidate)) {
                throw new Error(
                    `gjsify build: refusing to default --outfile to ${candidate} ` +
                        `(would overwrite a TypeScript source file). Pass --outfile/--outdir ` +
                        `explicitly, or set "gjsify.bundler.output.file" in package.json.`,
                );
            }
            outfile = candidate;
        }

        const { consoleShim, globals } = this.configData;

        const userExternal = Array.isArray(userBundler.external) ? (userBundler.external as string[]) : undefined;
        const userBanner =
            typeof userBundler.output?.banner === 'string' ? (userBundler.output.banner as string) : undefined;

        const pluginOpts: PluginOptions = {
            debug: verbose,
            app,
            format,
            exclude,
            reflection: typescript?.reflection,
            consoleShim,
            ...(aliases ? { aliases } : {}),
        };

        const { autoMode, extras } = this.parseGlobalsValue(globals);

        const pnp = await buildPnpPlugin();
        const pnpPlugins: RolldownPluginOption[] = pnp ? [pnp] : [];

        // User-supplied text loaders need to be available during BOTH the
        // auto-globals pre-build (`detectAutoGlobals`) and the final build —
        // otherwise Rolldown's parser hits unknown extensions like `.ui` /
        // `.asm` during the pre-build, fails to parse them as JS/JSX, and
        // the auto-globals iteration aborts before the final plugin chain is
        // ever assembled. Build the user-plugin chain once, up front, and
        // pass it into both passes.
        const userTextLoader = textLoaderPlugin({ loaders: this.configData.loaders });
        const userPlugins: RolldownPluginOption[] = userTextLoader ? [userTextLoader] : [];

        // User-supplied bundler.plugins (mix of plugin objects + by-name
        // entries) — resolved from the project's node_modules. Same
        // ordering rationale as the text loader: must be present during
        // auto-globals pre-build to avoid claiming the same files via
        // Rolldown's default classifier.
        if (userBundler.plugins?.length) {
            // Under GJS, plugin modules can't always be imported directly:
            // GJS's native ESM loader doesn't follow `package.json#exports`
            // subpath maps, so a plugin whose source imports an internal
            // subpath (e.g. `@mdx-js/mdx/internal-…`) throws `Module not
            // found` even when the file is on disk. The injected loader
            // first bundles such a plugin to a single self-contained ESM
            // (Rolldown resolves the exports map at bundle time) and imports
            // that instead. On Node the default direct-import path is used.
            const resolved = await resolveUserPlugins(
                userBundler.plugins,
                process.cwd(),
                isGjs() ? { loadModule: (p, name) => this.loadPluginViaGjsBundle(p, name, verbose) } : {},
            );
            userPlugins.push(...resolved);
        }

        // --- Auto mode (with optional extras): iterative multi-pass build ---
        if (app === 'gjs' && autoMode) {
            // Return the full orchestrator config (options + plugins) so
            // auto-globals can reuse the per-app `resolve.conditionNames` /
            // `mainFields` / `external` / `treeshake` for the in-memory
            // analysis bundle. Without these, native-rolldown defaults to
            // a different module-resolution condition set than npm-rolldown
            // and the detected free-global set diverges (see PR for the
            // missing-URL case under the GJS-CLI self-host loop).
            const gjsifyPluginFactory = async (opts: PluginOptions) => {
                const cfg = await gjsifyPlugin(
                    {
                        input: userBundler.input,
                        output: { file: outfile, dir: outdir },
                        userExternal,
                        userBanner,
                        userAliases: aliases,
                        shebang: this.configData.shebang,
                    },
                    opts,
                );
                return { options: cfg.options, plugins: cfg.plugins };
            };

            const { injectPath } = await detectAutoGlobals(
                {
                    input: userBundler.input,
                    plugins: [...pnpPlugins, ...userPlugins],
                    external: userBundler.external,
                    transform: userBundler.transform,
                    format,
                },
                pluginOpts,
                gjsifyPluginFactory,
                verbose,
                // Pass the project working dir so the resolvability gate in
                // detectAutoGlobals can check whether each detected global's
                // polyfill package is installed before writing a register
                // import. Without `cwd` the gate is bypassed and an
                // unresolvable import would hard-crash the analysis pass.
                // Mirrors the explicit-globals path (resolveGlobalsInject)
                // and resolveUserPlugins above, which already anchor on cwd.
                { extraGlobalsList: extras, excludeGlobals, cwd: process.cwd() },
                bundleToChunks,
            );

            pluginOpts.autoGlobalsInject = injectPath;
        } else if (extras) {
            pluginOpts.autoGlobalsInject = await this.resolveGlobalsInject(app, extras, verbose);
        }

        // Final build: orchestrator → rolldown → write
        const cfg = await gjsifyPlugin(
            {
                input: userBundler.input,
                output: { file: outfile, dir: outdir },
                userExternal,
                userBanner,
                userAliases: aliases,
                shebang: this.configData.shebang,
            },
            pluginOpts,
        );

        const merged = mergeBundlerOptions(cfg.options as BundlerOptions, userBundler);

        const finalOpts: BundlerOptions = {
            ...merged,
            // Drop user-config plugins from `merged` — they survived
            // mergeBundlerOptions via spread but have already been resolved
            // and appended into `userPlugins` above. Re-emitting the raw
            // entries (which may include `BundlerPluginByName` shapes
            // Rolldown doesn't understand) would crash the build.
            plugins: [...pnpPlugins, ...userPlugins, ...cfg.plugins],
        };

        if (opts.watch) {
            await this.runWatchLoop(finalOpts, app, outfile, verbose);
            return [];
        }

        const writeResult = await runBundle(finalOpts);

        if ((app === 'gjs' || app === 'node') && this.configData.shebang) {
            await this.applyShebang(app, outfile, verbose);
        }

        return [writeResult];
    }

    /**
     * Drive `rolldown.watch(...)`: rebuild on source change, apply the
     * post-bundle shebang hook on each successful build, surface errors
     * without exiting, clean up on SIGINT/SIGTERM. Resolves only when the
     * watcher closes — keeps the CLI process alive across rebuilds.
     */
    private async runWatchLoop(
        finalOpts: BundlerOptions,
        app: App,
        outfile: string | undefined,
        verbose: boolean | undefined,
    ): Promise<void> {
        const watcher = await runWatch(finalOpts);

        const closed = new Promise<void>((resolve) => {
            watcher.on('close', () => resolve());
        });

        let closing = false;
        const shutdown = async () => {
            if (closing) return;
            closing = true;
            console.log('\n[gjsify build --watch] stopping watcher…');
            try {
                await watcher.close();
            } catch (err) {
                console.error('[gjsify build --watch] watcher close error:', err);
            }
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        watcher.on('event', async (event) => {
            switch (event.code) {
                case 'START':
                    if (verbose) console.log('[gjsify build --watch] rebuild start');
                    break;
                case 'BUNDLE_START':
                    console.log('[gjsify build --watch] building…');
                    break;
                case 'BUNDLE_END':
                    console.log(`[gjsify build --watch] built in ${event.duration}ms`);
                    try {
                        if ((app === 'gjs' || app === 'node') && this.configData.shebang) {
                            await this.applyShebang(app, outfile, verbose);
                        }
                    } finally {
                        await event.result.close();
                    }
                    break;
                case 'END':
                    console.log('[gjsify build --watch] waiting for changes…');
                    break;
                case 'ERROR':
                    console.error('[gjsify build --watch] build failed:', event.error?.message ?? event.error);
                    if (verbose && event.error?.stack) console.error(event.error.stack);
                    try {
                        await event.result.close();
                    } catch {
                        // best-effort cleanup
                    }
                    break;
            }
        });

        if (verbose) {
            watcher.on('change', (id, change) => {
                console.log(`[gjsify build --watch] ${change.event}: ${id}`);
            });
        }

        await closed;
    }

    async start(buildType: { library?: boolean; app?: App; watch?: boolean } = { app: 'gjs' }) {
        if (buildType.library) {
            if (buildType.watch) {
                throw new Error(
                    'gjsify build: --watch is not supported with --library (library mode would emit watcher rebuilds for every produced format; use --app gjs|node|browser instead).',
                );
            }
            return await this.buildLibrary();
        }
        return await this.buildApp(buildType.app, { watch: buildType.watch });
    }
}

interface OneLibraryBuildArgs {
    pluginOpts: PluginOptions;
    userBundler: BundlerOptions;
    output: { file?: string; dir?: string };
    userAliases?: Record<string, string>;
    pnpPlugins: RolldownPluginOption[];
}

async function runOneLibraryBuild(args: OneLibraryBuildArgs): Promise<RolldownOutput> {
    const cfg = await gjsifyPlugin(
        {
            input: args.userBundler.input,
            output: args.output,
            userAliases: args.userAliases,
        },
        args.pluginOpts,
    );

    const merged = mergeBundlerOptions(cfg.options as BundlerOptions, args.userBundler);
    const finalOpts: BundlerOptions = {
        ...merged,
        plugins: [...args.pnpPlugins, ...cfg.plugins],
    };

    return await runBundle(finalOpts);
}
