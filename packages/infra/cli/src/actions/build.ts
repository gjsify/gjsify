import type { ConfigData, Platform } from '../types/index.js';
import { build } from 'esbuild';
import { gjsify } from '@gjsify/esbuild-plugin-gjsify';

export class BuildAction {
    constructor(readonly configData: ConfigData = {}) {

    }

    async buildLibrary() {
        const { library, esbuild } = this.configData;

        console.debug("library", library);

        const multipleBuilds = library?.module && library.main && library.module !== library.main;
    
        if(multipleBuilds) {
            await build({
                ...esbuild,
                outfile: library.module,
                plugins: [
                    gjsify({debug: true, library: 'esm'}),
                ]
            });
    
            await build({
                ...esbuild,
                outfile: library.main,
                plugins: [
                    gjsify({debug: true, library: 'cjs'}),
                ]
            });
        } else {
            const outfile = library?.module || library?.main || esbuild?.outfile;
            const format = library?.type === 'module' || outfile?.endsWith('.mjs') || !outfile?.endsWith('.cjs') ? 'esm' : 'cjs';
            await build({
                ...esbuild,
                outfile,
                plugins: [
                    gjsify({debug: true, library: format}),
                ]
            });
        }
    }

    async buildApp(platform: Platform = 'gjs') {

        const { esbuild } = this.configData;

        await build({
            ...esbuild,
            plugins: [
                gjsify({debug: true, platform}),
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