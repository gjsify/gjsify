import type { ConfigData, Platform } from '../types/index.js';
import { build } from 'esbuild';
import { gjsify } from '@gjsify/esbuild-plugin-gjsify';
import { deepkit } from '@gjsify/esbuild-plugin-deepkit';

export class BuildAction {
    constructor(readonly configData: ConfigData = {}) {

    }

    async buildLibrary() {
        const { library, esbuild, typescript } = this.configData;

        const multipleBuilds = library?.module && library.main && library.module !== library.main;
    
        if(multipleBuilds) {
            const moduleFormat = library.module?.endsWith('.cjs') ? 'cjs' : 'esm';
            await build({
                ...esbuild,
                format: moduleFormat,
                outfile: library.module,
                plugins: [
                    gjsify({debug: true, library: moduleFormat}),
                    deepkit({reflection: typescript?.reflection})
                ]
            });
    
            const mainFormat = library.main?.endsWith('.cjs') ? 'cjs' : 'esm';
            await build({
                ...esbuild,
                format: moduleFormat,
                outfile: library.main,
                plugins: [
                    gjsify({debug: true, library: mainFormat}),
                    deepkit({reflection: typescript?.reflection})
                ]
            });
        } else {
            const outfile = library?.module || library?.main || esbuild?.outfile;
            const format = esbuild?.format || outfile?.endsWith('.cjs') ? 'cjs' : 'esm';
            await build({
                ...esbuild,
                format,
                outfile,
                plugins: [
                    gjsify({debug: true, library: format}),
                    deepkit({reflection: typescript?.reflection})
                ]
            });
        }
    }

    async buildApp(platform: Platform = 'gjs') {

        const { esbuild, typescript } = this.configData;

        const format: 'cjs' | 'esm' = esbuild?.format || esbuild?.outfile?.endsWith('.cjs') ? 'cjs' : 'esm';

        await build({
            ...esbuild,
            format,
            plugins: [
                gjsify({debug: true, platform, format}),
                deepkit({reflection: typescript?.reflection})
            ]
        });

    }

    async start(buildType: {library?: boolean, platform?: Platform} = {platform: 'gjs'}) {
        if(buildType.library) {
            return this.buildLibrary()
        }
        return this.buildApp(buildType.platform)
    }
}