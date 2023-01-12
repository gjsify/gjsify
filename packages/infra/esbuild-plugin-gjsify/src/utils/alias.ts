import {
    EXTERNALS_NODE,
    EXTERNALS_NPM,
    ALIASES_GENERAL_FOR_DENO,
    ALIASES_NODE_FOR_DENO,
    ALIASES_GJS_FOR_DENO,
    ALIASES_GENERAL_FOR_GJS,
    ALIASES_NODE_FOR_GJS,
    ALIASES_WEB_FOR_GJS,
    ALIASES_GENERAL_FOR_NODE,
    ALIASES_GJS_FOR_NODE,
    ALIASES_WEB_FOR_NODE
} from "@gjsify/resolve-npm";

import type { ResolveAliasOptions } from '../types/index.js';

export const setNodeAliasPrefix = (ALIASES: Record<string, string>) => {
    // Also resolve alias names with `npm:${ALIAS}`
    for (const ALIAS in ALIASES) {
        if(ALIAS.startsWith('node:')) {
            continue
        }
        const key = `node:${ALIAS}`;
        if(!ALIASES[key]) ALIASES[key] = ALIASES[ALIAS];
    }
    return ALIASES;
}

export const resolveAliasesByType = (ALIASES: Record<string, string>, options: ResolveAliasOptions) => {
    const aliases: Record<string, string> = {}
    for (const ALIAS in ALIASES) {
        if(ALIASES[ALIAS].startsWith("http://") || ALIASES[ALIAS].startsWith("https://") || ALIASES[ALIAS].startsWith("file://")) {
            aliases[ALIAS] = ALIASES[ALIAS];
        } else {
            aliases[ALIAS] = resolvePackage(ALIASES[ALIAS], options);
        }        
    }
    return aliases
}

const resolvePackage = (pkgName: string, options: ResolveAliasOptions): string => {

    // TODO: use micromatch here
    if(options.external.includes(pkgName)) {
        if(options.debug) console.debug('[gjsify] external alias: ' + pkgName);
        return pkgName;
    }

    let resolveTo = pkgName;
    let result = resolveTo;

    try {
        result = require.resolve(resolveTo);
        if(options.debug) console.debug('[gjsify] resolve alias: ' + result);
        return result;
    } catch (error) {
        console.warn('[gjsify]', error.message, pkgName);
    }

    if(options.debug) console.debug('[gjsify] resolve alias: ' + result);

    return result;
}



const getAliasesGeneralForGjs = (options: ResolveAliasOptions) => resolveAliasesByType(ALIASES_GENERAL_FOR_GJS, options);
const getAliasesNodeForGjs = (options: ResolveAliasOptions) => resolveAliasesByType(setNodeAliasPrefix(ALIASES_NODE_FOR_GJS), options);
const getAliasesWebForGjs = (options: ResolveAliasOptions) => resolveAliasesByType(ALIASES_WEB_FOR_GJS, options);

const getAliasesGeneralForDeno = (options: ResolveAliasOptions) => resolveAliasesByType(ALIASES_GENERAL_FOR_DENO, options);
const getAliasesNodeForDeno = (options: ResolveAliasOptions) => resolveAliasesByType(setNodeAliasPrefix(ALIASES_NODE_FOR_DENO), options);
const getAliasesGjsForDeno = (options: ResolveAliasOptions) => resolveAliasesByType(ALIASES_GJS_FOR_DENO, options);

const getAliasesGeneralForNode = (options: ResolveAliasOptions) => resolveAliasesByType(ALIASES_GENERAL_FOR_NODE, options);
const getAliasesGjsForNode = (options: ResolveAliasOptions) => resolveAliasesByType(ALIASES_GJS_FOR_NODE, options);
const getAliasesWebForNode = (options: ResolveAliasOptions) => resolveAliasesByType(ALIASES_WEB_FOR_NODE, options);


export const getAliasesForGjs = (options: ResolveAliasOptions) => {
    return {...getAliasesGeneralForGjs(options), ...getAliasesNodeForGjs(options), ...getAliasesWebForGjs(options) }
}

export const getAliasesForDeno = (options: ResolveAliasOptions) => {
    return {...getAliasesGeneralForDeno(options), ...getAliasesNodeForDeno(options), ...getAliasesGjsForDeno(options) }
}

export const getAliasesForNode = (options: ResolveAliasOptions) => {
    return {...getAliasesGeneralForNode(options), ...getAliasesGjsForNode(options), ...getAliasesWebForNode(options) }
}

/** Array of Node.js build in module names (also with node: prefix) */
export const externalNode = [...EXTERNALS_NODE, ...EXTERNALS_NODE.map(E => `node:${E}`)];

/** Array of NPM module names for which we have our own implementation */
export const externalNPM = [...EXTERNALS_NPM];

