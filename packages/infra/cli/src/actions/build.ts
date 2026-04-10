import type { ConfigData } from '../types/index.js';
import type { App } from '@gjsify/esbuild-plugin-gjsify';
import { build, BuildOptions, BuildResult } from 'esbuild';
import { gjsifyPlugin } from '@gjsify/esbuild-plugin-gjsify';
import { resolveGlobalsList, writeRegisterInjectFile, detectAutoGlobals } from '@gjsify/esbuild-plugin-gjsify/globals';
import { dirname, extname } from 'path';

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
     * Resolve the `--globals` CLI list into a pre-computed inject stub path
     * that the esbuild plugin will append to its `inject` list. Only runs
     * for `--app gjs` — Node and browser builds rely on native globals.
     *
     * Returns `undefined` for `auto` mode (handled in `buildApp` via
     * two-pass build) and for explicit opt-out (`none` / empty string).
     */
    private async resolveGlobalsInject(
        app: App,
        globals: string | undefined,
        verbose: boolean | undefined,
    ): Promise<string | undefined> {
        if (app !== 'gjs') return undefined;

        // auto mode is handled separately in buildApp()
        if (!globals || globals === 'auto') return undefined;

        // Explicit opt-out
        if (globals === 'none') return undefined;

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

    /** Application mode */
    async buildApp(app: App = 'gjs') {

        const { verbose, esbuild, typescript, exclude, library: pgk } = this.configData;

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
        };

        // --- Auto mode: two-pass build (detect globals from first pass) ---
        if (app === 'gjs' && (!globals || globals === 'auto')) {
            const { injectPath } = await detectAutoGlobals(
                { ...this.getEsBuildDefaults(), ...esbuild, format },
                pluginOpts,
                verbose,
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

            return [result];
        }

        // --- Explicit or none mode ---
        const autoGlobalsInject = await this.resolveGlobalsInject(app, globals, verbose);

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