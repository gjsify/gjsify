import type { App } from './app.js';
import type { DeepkitPluginOptions } from '@gjsify/esbuild-plugin-deepkit';

export interface PluginOptions extends DeepkitPluginOptions {
    debug?: boolean;
    app?: App;
    aliases?: Record<string, string>;
    /** An array of glob patterns to exclude matches and aliases */
    exclude?: string[];
    /** Override the format, only be considered if the target app platform is `'node'`, otherwise it is always `'esm'` */
    format?: 'esm' | 'cjs'
    /** 
     * Library Mode
     * Use this if you want to build a library for Gjsify instead of an end user application.
     */
    library?: 'esm' | 'cjs';
}