import type { ResolveAliasOptions } from '../types/index.js';
export declare const setNodeAliasPrefix: (ALIASES: Record<string, string>) => Record<string, string>;
export declare const getAliasesForGjs: (options: ResolveAliasOptions) => {
    [x: string]: string;
};
export declare const getAliasesForNode: (options: ResolveAliasOptions) => {
    [x: string]: string;
};
export declare const getAliasesForBrowser: (_options?: ResolveAliasOptions) => {
    [x: string]: string;
};
/** Array of Node.js build in module names (also with node: prefix) */
export declare const externalNode: string[];
/** Array of NPM module names for which we have our own implementation */
export declare const externalNPM: string[];
