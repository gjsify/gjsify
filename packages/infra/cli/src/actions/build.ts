import type { ConfigData } from '../types/index.js';
import type { App } from '@gjsify/esbuild-plugin-gjsify';
import { build, BuildOptions } from 'esbuild';
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
    
        if(multipleBuilds) {

            const moduleFormat = moduleOutdir.includes('/cjs') || moduleOutExt === '.cjs' ? 'cjs' : 'esm';
            await build({
                ...this.getEsBuildDefaults(),
                ...esbuild,
                format: moduleFormat,
                outdir: moduleOutdir,
                plugins: [
                    gjsifyPlugin({debug: verbose, library: moduleFormat, exclude, reflection: typescript?.reflection, jsExtension: moduleOutExt}),
                ]
            });
    
            const mainFormat = mainOutdir.includes('/cjs') || mainOutExt === '.cjs' ? 'cjs' : 'esm';
            await build({
                ...this.getEsBuildDefaults(),
                ...esbuild,
                format: moduleFormat,
                outdir: mainOutdir,
                plugins: [
                    gjsifyPlugin({debug: verbose, library: mainFormat, exclude, reflection: typescript?.reflection, jsExtension: mainOutdir})
                ]
            });
        } else {
            const outfilePath = esbuild?.outfile || library?.module || library?.main;
            const outExt = outfilePath ? extname(outfilePath) : '.js';
            const outdir = esbuild?.outdir || (outfilePath ? dirname(outfilePath) : undefined);
            const format = esbuild?.format || outdir?.includes('/cjs') || outExt === '.cjs' ? 'cjs' : 'esm';
            await build({
                ...this.getEsBuildDefaults(),
                ...esbuild,
                format,
                outdir,
                plugins: [
                    gjsifyPlugin({debug: verbose, library: format, exclude, reflection: typescript?.reflection, jsExtension: outExt})
                ]
            });
        }
    }

    /** Application mode */
    async buildApp(app: App = 'gjs') {

        const { verbose, esbuild, typescript, exclude } = this.configData;

        const format: 'cjs' | 'esm' = esbuild?.format || esbuild?.outfile?.endsWith('.cjs') ? 'cjs' : 'esm';

        await build({
            ...this.getEsBuildDefaults(),
            ...esbuild,
            format,
            plugins: [
                gjsifyPlugin({debug: verbose, app, format, exclude, reflection: typescript?.reflection}),
            ]
        });

    }

    async start(buildType: {library?: boolean, app?: App} = {app: 'gjs'}) {
        if(buildType.library) {
            return this.buildLibrary()
        }
        return this.buildApp(buildType.app)
    }
}