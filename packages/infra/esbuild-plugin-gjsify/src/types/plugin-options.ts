export interface PluginOptions {
    debug?: boolean;
    platform?: 'gjs' | 'node' | 'deno';
    aliases?: Record<string, string>;
    exclude?: string[];
    /** Override the format, only be considered if the target platform is `'node'`, otherwise it is always `'esm'` */
    format?: 'esm' | 'cjs'
    /** 
     * Library Mode
     * Use this if you want to build a library for Gjsify instead of an end user application.
     */
    library?: 'esm' | 'cjs';
}