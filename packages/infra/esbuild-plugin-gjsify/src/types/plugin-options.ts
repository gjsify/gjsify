export interface PluginOptions {
    debug?: boolean;
    platform?: 'gjs' | 'node' | 'deno';
    aliases?: Record<string, string>;
    exclude?: string[];
    /** 
     * Library Mode
     * Use this if you want to build a library for Gjsify instead of an end user application.
     */
    library?: 'esm' | 'cjs';
}