import type { ConfigData, App } from '../types/index.js';
import { build } from 'esbuild';
import { gjsifyPlugin } from '@gjsify/esbuild-plugin-gjsify';
import { deepkitPlugin } from '@gjsify/esbuild-plugin-deepkit';
import { dirname } from 'path';

export class BuildAction {
    constructor(readonly configData: ConfigData = {}) {

    }

    /** Library mode */
    async buildLibrary() {
        let { verbose, library, esbuild, typescript } = this.configData;
        library ||= {};
        esbuild ||= {};
        typescript ||= {};

        const moduleOutdir = library?.module ? dirname(library.module) : undefined;
        const mainOutdir = library?.main ? dirname(library.main) : undefined;

        const multipleBuilds = moduleOutdir && mainOutdir && (moduleOutdir !== mainOutdir);
    
        if(multipleBuilds) {
            const moduleFormat = moduleOutdir.includes('/cjs') ? 'cjs' : 'esm';
            await build({
                ...esbuild,
                format: moduleFormat,
                outdir: moduleOutdir,
                plugins: [
                    gjsifyPlugin({debug: verbose, library: moduleFormat}),
                    deepkitPlugin({reflection: typescript?.reflection})
                ]
            });
    
            const mainFormat = mainOutdir.includes('/cjs') ? 'cjs' : 'esm';
            await build({
                ...esbuild,
                format: moduleFormat,
                outdir: mainOutdir,
                plugins: [
                    gjsifyPlugin({debug: verbose, library: mainFormat}),
                    deepkitPlugin({reflection: typescript?.reflection})
                ]
            });
        } else {
            const outfile = esbuild?.outfile || library?.module || library?.main;
            const outdir = esbuild?.outdir || (outfile ? dirname(outfile) : undefined);
            const format = esbuild?.format || outdir?.includes('/cjs') ? 'cjs' : 'esm';
            await build({
                ...esbuild,
                format,
                outdir,
                plugins: [
                    gjsifyPlugin({debug: verbose, library: format}),
                    deepkitPlugin({reflection: typescript?.reflection})
                ]
            });
        }
    }

    /** Application mode */
    async buildApp(app: App = 'gjs') {

        const { verbose, esbuild, typescript } = this.configData;

        const format: 'cjs' | 'esm' = esbuild?.format || esbuild?.outfile?.endsWith('.cjs') ? 'cjs' : 'esm';

        await build({
            ...esbuild,
            format,
            plugins: [
                gjsifyPlugin({debug: verbose, app, format}),
                deepkitPlugin({reflection: typescript?.reflection})
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