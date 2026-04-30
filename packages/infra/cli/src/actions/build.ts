import type { ConfigData } from '../types/index.js';
import type { App } from '@gjsify/esbuild-plugin-gjsify';
import { build, BuildOptions, BuildResult } from 'esbuild';
import { gjsifyPlugin } from '@gjsify/esbuild-plugin-gjsify';
import { resolveGlobalsList, writeRegisterInjectFile, detectAutoGlobals } from '@gjsify/esbuild-plugin-gjsify/globals';
import { dirname, extname } from 'node:path';
import { chmod, readFile, writeFile } from 'node:fs/promises';

const GJS_SHEBANG = '#!/usr/bin/env -S gjs -m\n';

export class BuildAction {
    constructor(readonly configData: ConfigData = {}) {

    }

    getEsBuildDefaults() {
        const defaults: BuildOptions = {
            allowOverwrite: true
        }
        return defaults;
    }

    /** Library mode */
    async buildLibrary() {
        let { verbose, library, esbuild, typescript, exclude } = this.configData;
        library ||= {};
        esbuild ||= {};
        typescript ||= {};

        const moduleOutdir = library?.module ? dirname(library.module) : undefined;
        const mainOutdir = library?.main ? dirname(library.main) : undefined;

        const moduleOutExt = library.module ? extname(library.module) : '.js';
        const mainOutExt = library.main ? extname(library.main) : '.js';

        const multipleBuilds = moduleOutdir && mainOutdir && (moduleOutdir !== mainOutdir);

        const results: BuildResult[] = [];
    
        if(multipleBuilds) {

            const moduleFormat = moduleOutdir.includes('/cjs') || moduleOutExt === '.cjs' ? 'cjs' : 'esm';
            results.push(await build({
                ...this.getEsBuildDefaults(),
                ...esbuild,
                format: moduleFormat,
                outdir: moduleOutdir,
                plugins: [
                    gjsifyPlugin({debug: verbose, library: moduleFormat, exclude, reflection: typescript?.reflection, jsExtension: moduleOutExt}),
                ]
            }));
    
            const mainFormat = mainOutdir.includes('/cjs') || mainOutExt === '.cjs' ? 'cjs' : 'esm';
            results.push(await build({
                ...this.getEsBuildDefaults(),
                ...esbuild,
                format: moduleFormat,
                outdir: mainOutdir,
                plugins: [
                    gjsifyPlugin({debug: verbose, library: mainFormat, exclude, reflection: typescript?.reflection, jsExtension: mainOutdir})
                ]
            }));
        } else {
            const outfilePath = esbuild?.outfile || library?.module || library?.main;
            const outExt = outfilePath ? extname(outfilePath) : '.js';
            const outdir = esbuild?.outdir || (outfilePath ? dirname(outfilePath) : undefined);
            const format: 'esm' | 'cjs' = (esbuild?.format as 'esm' | 'cjs') ?? (outdir?.includes('/cjs') || outExt === '.cjs' ? 'cjs' : 'esm');
            results.push(await build({
                ...this.getEsBuildDefaults(),
                ...esbuild,
                format,
                outdir,
                plugins: [
                    gjsifyPlugin({debug: verbose, library: format, exclude, reflection: typescript?.reflection, jsExtension: outExt})
                ]
            }));
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
    private parseGlobalsValue(value: string | undefined): { autoMode: boolean; extras: string } {
        if (value === undefined) return { autoMode: true, extras: '' };
        if (value === 'none' || value === '') return { autoMode: false, extras: '' };

        const tokens = value.split(',').map(t => t.trim()).filter(Boolean);
        const hasAuto = tokens.includes('auto');
        const extras = tokens.filter(t => t !== 'auto').join(',');

        return { autoMode: hasAuto, extras };
    }

    /**
     * Resolve the `--globals` CLI list into a pre-computed inject stub path
     * that the esbuild plugin will append to its `inject` list. Only runs
     * for `--app gjs` — Node and browser builds rely on native globals.
     *
     * Used only for the explicit-only path (no `auto` token in the value).
     * The auto path is handled in `buildApp` via the two-pass build.
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
     * Post-processing: prepend GJS shebang and mark the output file executable.
     * Only runs for GJS app builds with a resolvable single outfile.
     */
    private async applyShebang(outfile: string | undefined, verbose: boolean | undefined): Promise<void> {
        if (!outfile) {
            if (verbose) console.warn('[gjsify] --shebang skipped: no single outfile (use --outfile for GJS executables)');
            return;
        }

        const content = await readFile(outfile, 'utf-8');
        if (content.startsWith('#!')) {
            if (verbose) console.debug(`[gjsify] --shebang skipped: ${outfile} already starts with a shebang`);
        } else {
            await writeFile(outfile, GJS_SHEBANG + content);
        }
        await chmod(outfile, 0o755);
        if (verbose) console.debug(`[gjsify] --shebang: wrote shebang + chmod 0o755 to ${outfile}`);
    }

    /** Application mode */
    async buildApp(app: App = 'gjs') {

        const { verbose, esbuild, typescript, exclude, library: pgk, aliases } = this.configData;

        const format: 'esm' | 'cjs' = (esbuild?.format as 'esm' | 'cjs') ?? (esbuild?.outfile?.endsWith('.cjs') ? 'cjs' : 'esm');

        // Set default outfile if no outdir is set
        if(esbuild && !esbuild?.outfile && !esbuild?.outdir && (pgk?.main || pgk?.module)) {
            esbuild.outfile = esbuild?.format === 'cjs' ? pgk.main || pgk.module : pgk.module || pgk.main;
        }

        const { consoleShim, globals } = this.configData;

        const pluginOpts = {
            debug: verbose,
            app,
            format,
            exclude,
            reflection: typescript?.reflection,
            consoleShim,
            ...(aliases ? { aliases } : {}),
        };

        const { autoMode, extras } = this.parseGlobalsValue(globals);

        // --- Auto mode (with optional extras): iterative multi-pass build ---
        // The extras token is used for cases where the detector cannot
        // statically see a global (e.g. Excalibur indirects globalThis via
        // BrowserComponent.nativeComponent). Common pattern: --globals auto,dom
        if (app === 'gjs' && autoMode) {
            const { injectPath } = await detectAutoGlobals(
                { ...this.getEsBuildDefaults(), ...esbuild, format },
                pluginOpts,
                verbose,
                { extraGlobalsList: extras },
            );

            const result = await build({
                ...this.getEsBuildDefaults(),
                ...esbuild,
                format,
                plugins: [
                    gjsifyPlugin({
                        ...pluginOpts,
                        autoGlobalsInject: injectPath,
                    }),
                ],
            });

            if (app === 'gjs' && this.configData.shebang) {
                await this.applyShebang(esbuild?.outfile, verbose);
            }

            return [result];
        }

        // --- Explicit list (no `auto` token) or none mode ---
        const autoGlobalsInject = extras
            ? await this.resolveGlobalsInject(app, extras, verbose)
            : undefined;

        const result = await build({
            ...this.getEsBuildDefaults(),
            ...esbuild,
            format,
            plugins: [
                gjsifyPlugin({
                    ...pluginOpts,
                    autoGlobalsInject,
                }),
            ]
        });

        if (app === 'gjs' && this.configData.shebang) {
            await this.applyShebang(esbuild?.outfile, verbose);
        }

        return [result];
    }

    async start(buildType: {library?: boolean, app?: App} = {app: 'gjs'}) {
        const results: BuildResult[] = [];
        if(buildType.library) {
            results.push(...(await this.buildLibrary()));
        } else {
            results.push(...(await this.buildApp(buildType.app)));
        }

        return results;
    }
}