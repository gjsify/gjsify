import type { ConfigData } from '../types/index.js';
import type { App } from '@gjsify/esbuild-plugin-gjsify';
import { build, BuildOptions, BuildResult } from 'esbuild';
import { gjsifyPlugin } from '@gjsify/esbuild-plugin-gjsify';
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
            const format = esbuild?.format || outdir?.includes('/cjs') || outExt === '.cjs' ? 'cjs' : 'esm';
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

    /** Application mode */
    async buildApp(app: App = 'gjs') {

        const { verbose, esbuild, typescript, exclude, library } = this.configData;

        const format: 'cjs' | 'esm' = esbuild?.format || esbuild?.outfile?.endsWith('.cjs') ? 'cjs' : 'esm';

        // Set default outfile if no outdir is set 
        if(esbuild && !esbuild?.outfile && !esbuild?.outdir && !library?.module && (library?.main || library?.module)) {
            esbuild.outfile = esbuild?.format === 'cjs' ? library.main || library.module : library.module || library.main;
        }

        const result = await build({
            ...this.getEsBuildDefaults(),
            ...esbuild,
            format,
            plugins: [
                gjsifyPlugin({debug: verbose, app, format, exclude, reflection: typescript?.reflection}),
            ]
        });

        // See https://esbuild.github.io/api/#metafile
        // TODO add cli options for this 
        // if(result.metafile) {
        //     const outFile = esbuild?.outfile ? esbuild.outfile + '.meta.json' : 'meta.json';
        //     await writeFile(outFile, JSON.stringify(result.metafile));

        //     let text = await analyzeMetafile(result.metafile)
        //     console.log(text)
        // }

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