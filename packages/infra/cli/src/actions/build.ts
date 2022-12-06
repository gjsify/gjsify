import type { ConfigData } from '../types/index.js';
import type { App } from '@gjsify/esbuild-plugin-gjsify';
import { build, BuildOptions } from 'esbuild';
import { gjsifyPlugin } from '@gjsify/esbuild-plugin-gjsify';
import { dirname } from 'path';

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
                ...this.getEsBuildDefaults(),
                ...esbuild,
                format: moduleFormat,
                outdir: moduleOutdir,
                plugins: [
                    gjsifyPlugin({debug: verbose, library: moduleFormat, reflection: typescript?.reflection}),
                ]
            });
    
            const mainFormat = mainOutdir.includes('/cjs') ? 'cjs' : 'esm';
            await build({
                ...this.getEsBuildDefaults(),
                ...esbuild,
                format: moduleFormat,
                outdir: mainOutdir,
                plugins: [
                    gjsifyPlugin({debug: verbose, library: mainFormat, reflection: typescript?.reflection})
                ]
            });
        } else {
            const outfile = esbuild?.outfile || library?.module || library?.main;
            const outdir = esbuild?.outdir || (outfile ? dirname(outfile) : undefined);
            const format = esbuild?.format || outdir?.includes('/cjs') ? 'cjs' : 'esm';
            await build({
                ...this.getEsBuildDefaults(),
                ...esbuild,
                format,
                outdir,
                plugins: [
                    gjsifyPlugin({debug: verbose, library: format, reflection: typescript?.reflection})
                ]
            });
        }
    }

    /** Application mode */
    async buildApp(app: App = 'gjs') {

        const { verbose, esbuild, typescript } = this.configData;

        const format: 'cjs' | 'esm' = esbuild?.format || esbuild?.outfile?.endsWith('.cjs') ? 'cjs' : 'esm';

        await build({
            ...this.getEsBuildDefaults(),
            ...esbuild,
            format,
            plugins: [
                gjsifyPlugin({debug: verbose, app, format, reflection: typescript?.reflection}),
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