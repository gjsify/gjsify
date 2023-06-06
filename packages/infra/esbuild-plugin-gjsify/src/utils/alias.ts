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

const getAliasesGeneralForGjs = (options: ResolveAliasOptions) => ALIASES_GENERAL_FOR_GJS;
const getAliasesNodeForGjs = (options: ResolveAliasOptions) => setNodeAliasPrefix(ALIASES_NODE_FOR_GJS);
const getAliasesWebForGjs = (options: ResolveAliasOptions) => ALIASES_WEB_FOR_GJS;

const getAliasesGeneralForDeno = (options: ResolveAliasOptions) => ALIASES_GENERAL_FOR_DENO;
const getAliasesNodeForDeno = (options: ResolveAliasOptions) => setNodeAliasPrefix(ALIASES_NODE_FOR_DENO);
const getAliasesGjsForDeno = (options: ResolveAliasOptions) => ALIASES_GJS_FOR_DENO;

const getAliasesGeneralForNode = (options: ResolveAliasOptions) => ALIASES_GENERAL_FOR_NODE;
const getAliasesGjsForNode = (options: ResolveAliasOptions) => ALIASES_GJS_FOR_NODE;
const getAliasesWebForNode = (options: ResolveAliasOptions) => ALIASES_WEB_FOR_NODE;


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

