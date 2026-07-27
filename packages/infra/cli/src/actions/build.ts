import type { ConfigData, BundlerOptions } from '../types/index.js';
import type { App, PluginOptions } from '@gjsify/rolldown-plugin-gjsify';
import type { RolldownOutput, RolldownPluginOption } from 'rolldown';
import { runBundle, runWatch, bundleToChunks } from '../bundler-pick.js';
import { gjsifyPlugin, textLoaderPlugin, resolveShebangLine, NODE_SHEBANG } from '@gjsify/rolldown-plugin-gjsify';
import { isGjs } from '@gjsify/rolldown-plugin-gjsify/runtime';
import { resolveUserPlugins } from '../utils/resolve-plugin-by-name.js';
import {
    resolveGlobalsList,
    writeRegisterInjectFile,
    detectAutoGlobals,
    detectNodeGiGlobals,
} from '@gjsify/rolldown-plugin-gjsify/globals';
import { pnpPlugin } from '@gjsify/rolldown-plugin-pnp';
import { dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { normalizeBundlerOptions, mergeBundlerOptions } from '../utils/normalize-bundler-options.js';
import { inputSourceDirs, isOutdirInsideSource, libraryOutputLeakError } from '../utils/library-output.js';
import { detectHtmlEntry, parseHtmlEntry, emitBrowserHtml, htmlOutPathFor } from '../utils/html-entry.js';
import { assertGjsBundleLoadable } from '../utils/gjs-bundle-guard.js';

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

/**
 * Fresh when the cached GJS bundle is newer than BOTH the source file AND the
 * project's lockfile (the dep-change signal). Missing bundle/source → not fresh
 * (rebuild). Shared by the plugin + config GJS-bundle caches.
 */
async function isBundleFresh(outfile: string, sourcePath: string, cwd: string): Promise<boolean> {
    try {
        const outStat = await stat(outfile);
        const srcStat = await stat(sourcePath);
        const depMtime = await newestLockfileMtime(cwd);
        return outStat.mtimeMs >= Math.max(srcStat.mtimeMs, depMtime);
    } catch {
        return false;
    }
}

export class BuildAction {
    constructor(readonly configData: ConfigData = {}) {}

    /** Library mode */
    async buildLibrary(): Promise<RolldownOutput[]> {
        const { verbose, library, typescript, exclude, aliases } = this.configData;
        const lib = library ?? {};
        const userBundler = normalizeBundlerOptions(this.configData);

        // Refuse to emit the compiled tree into the input source directory.
        // The outdir is derived below from `dirname(module ?? main)`; when a
        // package points `main`/`module` at a source entry (`src/index.ts`)
        // that derivation is `src/`, so preserve-modules would write `.js`
        // duplicates + a `_virtual/` dir + a nested `src/<pkg>/src` tree next
        // to the sources. An explicit `--outdir` is the escape hatch and is
        // trusted; only the DERIVED default is guarded.
        const cwd = process.cwd();
        const sourceDirs = inputSourceDirs(userBundler.input, cwd);
        const assertDerivedOutdirSafe = (outdir: string | undefined) => {
            if (outdir && isOutdirInsideSource(outdir, sourceDirs, cwd)) throw libraryOutputLeakError(outdir);
        };

        const moduleOutdir = lib.module ? dirname(lib.module) : undefined;
        const mainOutdir = lib.main ? dirname(lib.main) : undefined;

        const moduleOutExt = lib.module ? extname(lib.module) : '.js';
        const mainOutExt = lib.main ? extname(lib.main) : '.js';

        const multipleBuilds = moduleOutdir && mainOutdir && moduleOutdir !== mainOutdir;

        const pnp = await buildPnpPlugin();
        const pnpPlugins: RolldownPluginOption[] = pnp ? [pnp] : [];

        const results: RolldownOutput[] = [];

        if (multipleBuilds) {
            // Both outdirs are derived from module/main — always guard them
            // (`--outdir` is not consulted on the multi-output path).
            assertDerivedOutdirSafe(moduleOutdir);
            assertDerivedOutdirSafe(mainOutdir);
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
            const explicitOutdir = userBundler.output?.dir;
            const outfilePath = userBundler.output?.file ?? lib.module ?? lib.main;
            const outExt = outfilePath ? extname(outfilePath) : '.js';
            const outdir = explicitOutdir ?? (outfilePath ? dirname(outfilePath) : undefined);
            // Only the DERIVED default is a footgun; a user-supplied --outdir
            // is trusted (the documented escape hatch).
            if (explicitOutdir === undefined) assertDerivedOutdirSafe(outdir);
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
     * that the orchestrator appends to its input list. Runs for `--app gjs`
     * AND `--app node`: on gjs the registers install our polyfills over the
     * bare GJS runtime; on node an EXPLICIT list is the reverse bridge's
     * DOM-surface request (a genuine GJS source built via `@gjsify/node-gi`
     * needs the same `@gjsify/*` registers — document, HTMLCanvasElement, … —
     * it gets under `--app gjs`, backed by gi:// through node-gi). Browser
     * builds rely on native globals.
     *
     * Node is EXPLICIT-ONLY by design: plain `--globals auto` never injects
     * web/dom registers into a node bundle (cross-platform packages' node
     * builds must stay loadable on plain Node without node-gi), so the
     * `@gjsify/empty` routing is only lifted when the USER names the globals.
     *
     * Used for the explicit-only path (no `auto` token) and, on node, for the
     * `auto,<extras>` extras. The gjs auto path is handled in `buildApp` via
     * the iterative multi-pass build.
     */
    private async resolveGlobalsInject(
        app: App,
        globals: string,
        verbose: boolean | undefined,
    ): Promise<string | undefined> {
        if (app !== 'gjs' && app !== 'node') return undefined;
        if (!globals) return undefined;

        const registerPaths = resolveGlobalsList(globals);
        if (registerPaths.size === 0) return undefined;

        // On `--app node` (the reverse bridge) the injected register bodies must
        // OVERRIDE the runtime-native web globals gjsify owns (the `fetch`
        // family — undici rejects the root-relative `/res/...` asset paths a GJS
        // app uses). See writeRegisterInjectFile / REVERSE_BRIDGE_NATIVE_OVERRIDE_IDENTS.
        const injectPath = await writeRegisterInjectFile(registerPaths, process.cwd(), {
            reverseBridgeOverride: app === 'node',
        });
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
     * Post-bundle gate for `--app gjs`: throw when the emitted bundle still
     * STATICALLY imports Node builtins, which stock GJS cannot resolve (see
     * `utils/gjs-bundle-guard.ts` for the full rationale).
     *
     * The oracle is the bundler's own module graph — each chunk's `imports`
     * list — not the emitted text. Both engines report it (npm `rolldown`
     * natively, `@gjsify/rolldown-native` via `synthRolldownOutput`), and it
     * cannot be fooled by a `node:` specifier quoted inside a string, which a
     * text scan cannot tell from a statement.
     */
    private assertGjsOutputLoadable(result: RolldownOutput, outfile: string | undefined, outdir: string | undefined) {
        const chunks = (result.output ?? []).filter((item) => item.type === 'chunk');
        assertGjsBundleLoadable(chunks, outfile ?? outdir ?? 'the GJS bundle');
    }

    /**
     * Post-bundle step for a `--app browser` HTML entry: write the processed
     * `index.html` beside the JS bundle, with the entry `<script>`'s `src`
     * rewritten to point at the built bundle. Mirrors `applyShebang` — kept in
     * the CLI (not a Rolldown plugin) because the native rolldown engine
     * exposes no `emitFile`.
     */
    private async applyBrowserHtml(
        htmlEntry: { htmlSource: string; scriptTag: string; scriptSrc: string },
        outfile: string,
        verbose: boolean | undefined,
    ): Promise<void> {
        const jsOutPath = resolve(outfile);
        const outHtmlPath = htmlOutPathFor(jsOutPath);
        const html = emitBrowserHtml({
            htmlSource: htmlEntry.htmlSource,
            scriptTag: htmlEntry.scriptTag,
            scriptSrc: htmlEntry.scriptSrc,
            jsOutPath,
            outHtmlPath,
        });
        await mkdir(dirname(outHtmlPath), { recursive: true });
        await writeFile(outHtmlPath, html);
        if (verbose) console.debug(`[gjsify] --app browser: wrote ${outHtmlPath}`);
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
     * Bundle a single plugin entry for GJS via {@link bundleFileForGjsCached} and
     * return its path. Rethrows with context naming the plugin. (GJS's native ESM
     * loader can't resolve a plugin's `package.json#exports` subpaths for a bare
     * specifier; Rolldown resolves them at bundle time.)
     */
    private async bundlePluginForGjs(
        resolvedPath: string,
        pluginName: string,
        verbose: boolean | undefined,
    ): Promise<string> {
        try {
            return await BuildAction.bundleFileForGjsCached(resolvedPath, {
                cacheSubdir: 'plugins',
                label: pluginName,
                verbose,
                noCacheEnv: 'GJSIFY_NO_PLUGIN_CACHE',
            });
        } catch (err) {
            throw new Error(
                `gjsify config: failed to bundle plugin "${pluginName}" for GJS ` +
                    `(needed because GJS can't import packages that use exports-map subpaths directly). ` +
                    `(${(err as Error).message})`,
            );
        }
    }

    /**
     * Bundle a single ESM entry file to a self-contained `--app gjs` module and
     * return its path — the shared "bundle one file for GJS" helper behind both
     * the plugin loader (exports-map subpaths GJS can't resolve for a bare
     * specifier) and the config loader (`node:`/npm imports GJS can't resolve for
     * an external ESM file). Reuses the full `--app gjs` pipeline (exports-map-aware
     * resolution, `node:`→`@gjsify` aliases, `gi://` externalized, `--globals auto`,
     * single-file output).
     *
     * The nested `BuildAction` is constructed with EXPLICIT bundler options, so
     * `buildApp` uses that configData directly and never re-enters `Config.load`
     * — no recursion, even when the input is the very `gjsify.config.js` being
     * loaded. `preserveDefaultExport` re-exports `default` through the side-effect
     * entry wrapper so the file imports as a library; shebang stays unset (the
     * artifact is imported, not executed).
     *
     * Cached under `node_modules/.cache/gjsify/<cacheSubdir>/`, keyed by the source
     * path. Invalidated when the source OR the project lockfile is newer than the
     * cached bundle (a dep bump rewrites the lockfile but not the source mtime).
     * `<noCacheEnv>=1` forces a rebuild (covers the residual window: a transitive
     * dep edited in place, touching neither the source nor a lockfile).
     */
    static async bundleFileForGjsCached(
        inputPath: string,
        opts: {
            cacheSubdir: string;
            label: string;
            verbose?: boolean;
            noCacheEnv?: string;
            /** Extra compile-time `define`s (e.g. rewrite the entry's `import.meta.url`). */
            define?: Record<string, string>;
        },
    ): Promise<string> {
        const cwd = process.cwd();
        const cacheDir = join(cwd, 'node_modules', '.cache', 'gjsify', opts.cacheSubdir);
        const safeName = opts.label.replace(/[^a-zA-Z0-9._-]/g, '_');
        const outfile = join(cacheDir, `${safeName}-${shortHash(inputPath)}.mjs`);

        const cacheDisabled = opts.noCacheEnv ? isTruthyEnv(process.env[opts.noCacheEnv]) : false;
        if (!cacheDisabled && (await isBundleFresh(outfile, inputPath, cwd))) {
            if (opts.verbose) console.debug(`[gjsify] reusing cached GJS bundle ${outfile}`);
            return outfile;
        }

        if (opts.verbose) console.debug(`[gjsify] bundling ${inputPath} for GJS → ${outfile}`);
        await mkdir(cacheDir, { recursive: true });
        await new BuildAction({
            verbose: opts.verbose,
            bundler: {
                input: inputPath,
                output: { file: outfile },
                ...(opts.define ? { transform: { define: opts.define } } : {}),
            },
        }).buildApp('gjs', { preserveDefaultExport: true });
        return outfile;
    }

    /** Application mode */
    async buildApp(
        app: App = 'gjs',
        opts: { watch?: boolean; preserveDefaultExport?: boolean } = {},
    ): Promise<RolldownOutput[]> {
        const { verbose, typescript, exclude, library: pkg, aliases, excludeGlobals } = this.configData;

        const userBundler = normalizeBundlerOptions(this.configData);

        // --- `--app browser` HTML entry (Vite-style) ---
        // When the entry is an `index.html`, bundle the module its
        // `<script type="module" src>` references (rewrite `input` to that
        // module so auto-globals detection + the bundle both see the real
        // entry, NOT the html) and remember the page so a post-bundle step can
        // emit a processed `index.html` next to the JS. Guarded on browser +
        // an html input; every other build path is untouched.
        let htmlEntry: { htmlSource: string; scriptTag: string; scriptSrc: string } | null = null;
        if (app === 'browser') {
            const htmlPath = detectHtmlEntry(userBundler.input);
            if (htmlPath) {
                const htmlSource = await readFile(htmlPath, 'utf-8');
                const { moduleEntry, scriptTag, scriptSrc } = parseHtmlEntry(htmlPath, htmlSource);
                userBundler.input = moduleEntry;
                htmlEntry = { htmlSource, scriptTag, scriptSrc };
            }
        }

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

        // An html entry emits its `index.html` next to the JS bundle, so it
        // needs a concrete outfile to anchor that sibling path.
        if (htmlEntry && !outfile) {
            throw new Error(
                'gjsify build: an .html entry needs an explicit --outfile ' +
                    '(e.g. --outfile dist-app/app.js); the emitted index.html is written beside it.',
            );
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
            ...(opts.preserveDefaultExport ? { preserveDefaultExport: true } : {}),
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
        } else if (app === 'node' && autoMode) {
            // `--app node` reverse direction: detect GJS ambient globals
            // (`print`/`imports`/…) in the bundled, tree-shaken output and
            // inject `@gjsify/node-gi/globals` only when present. A single
            // in-memory analysis pass (the shim is external — no convergence
            // loop). Gated on `autoMode` so `--globals none` opts out. The
            // detection must run BEFORE the final build so the entry can be
            // wrapped; nothing is injected when no globals are referenced (the
            // eager-native-load regression guard).
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

            const needsGiGlobals = await detectNodeGiGlobals(
                {
                    input: userBundler.input,
                    plugins: [...pnpPlugins, ...userPlugins],
                    external: userBundler.external,
                    transform: userBundler.transform,
                    format,
                },
                pluginOpts,
                gjsifyPluginFactory,
                bundleToChunks,
            );

            if (needsGiGlobals) pluginOpts.nodeGiGlobalsInject = true;

            // Explicit extras on a node build (`--globals auto,dom,…`) are the
            // reverse bridge's DOM-surface request: inject the SAME register
            // modules the gjs target would for those identifiers, so a genuine
            // GJS source (an Excalibur/WebGLBridge app) gets document /
            // HTMLCanvasElement / matchMedia / … on Node via node-gi. The
            // orchestrator lifts the `@gjsify/empty` register routing only when
            // this inject stub is present (see app/node.ts) — plain `auto`
            // node builds are byte-unchanged.
            if (extras) {
                pluginOpts.autoGlobalsInject = await this.resolveGlobalsInject(app, extras, verbose);
            }
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

        // Refuse to hand back a `--app gjs` bundle stock GJS cannot even load.
        if (app === 'gjs') {
            this.assertGjsOutputLoadable(writeResult, outfile, outdir);
        }

        // Browser HTML entry: emit the processed `index.html` beside the bundle
        // (engine-portable post-step — the native rolldown engine has no
        // `emitFile`, so this can't live in a plugin). `outfile` is guaranteed
        // present here (guarded above when `htmlEntry` is set).
        if (app === 'browser' && htmlEntry && outfile) {
            await this.applyBrowserHtml(htmlEntry, outfile, verbose);
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
                        // No `--app gjs` loadability gate here: the watcher's
                        // BUNDLE_END carries the bundle, not the generated
                        // output, and re-running `generate()` just to read the
                        // chunk graph would double every rebuild. The one-shot
                        // build is the gate that CI and the pre-commit hook go
                        // through; `--watch` is a dev loop.
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
