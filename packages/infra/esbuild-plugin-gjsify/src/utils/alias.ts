import {
    EXTERNALS_NODE,
    EXTERNALS_NPM,
    ALIASES_GENERAL_FOR_GJS,
    ALIASES_NODE_FOR_GJS,
    ALIASES_WEB_FOR_GJS,
    ALIASES_GENERAL_FOR_NODE,
    ALIASES_GJS_FOR_NODE,
    ALIASES_WEB_FOR_NODE
} from "@gjsify/resolve-npm";

// All Node.js built-in modules → @gjsify/empty for browser builds.
// These are legitimately unavailable in a browser. Even when test specs
// guard them with on('Node.js', ...), esbuild resolves dynamic imports
// statically and will fail without this alias layer.
const NODE_BUILTINS_EMPTY: Record<string, string> = Object.fromEntries(
    [...EXTERNALS_NODE, ...EXTERNALS_NODE.map(m => `node:${m}`)].map(m => [m, '@gjsify/empty'])
);

// Aliases applied when building for a real browser target.
// Layer order (last wins):
//   1. NODE_BUILTINS_EMPTY: all node built-ins → empty baseline
//   2. ALIASES_WEB_FOR_NODE: web API bare specifiers → globals, /register → empty
//   3. ALIASES_GENERAL_FOR_NODE: @gjsify/node-globals/register → empty
//   4. Explicit overrides for assert (needs real impl) + stream/web (has globals.mjs)
const ALIASES_FOR_BROWSER: Record<string, string> = {
    ...NODE_BUILTINS_EMPTY,
    // ALL ALIASES_WEB_FOR_NODE: bare specifiers → globals re-exports, /register → empty
    ...ALIASES_WEB_FOR_NODE,
    // GJS helper registers → no-op
    ...ALIASES_GENERAL_FOR_NODE,
    // assert — needed by @gjsify/unit internally (override empty from NODE_BUILTINS_EMPTY)
    'assert': '@gjsify/assert',
    'node:assert': '@gjsify/assert',
    // node:stream/web → browser streams globals (override empty from NODE_BUILTINS_EMPTY)
    'node:stream/web': '@gjsify/web-streams/globals',
    'stream/web': '@gjsify/web-streams/globals',
};

import type { ResolveAliasOptions } from '../types/index.js';

export const setNodeAliasPrefix = (ALIASES: Record<string, string>) => {
    // Also resolve alias names with `node:${ALIAS}`
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

const getAliasesGeneralForNode = (options: ResolveAliasOptions) => ALIASES_GENERAL_FOR_NODE;
const getAliasesGjsForNode = (options: ResolveAliasOptions) => ALIASES_GJS_FOR_NODE;
const getAliasesWebForNode = (options: ResolveAliasOptions) => ALIASES_WEB_FOR_NODE;

export const getAliasesForGjs = (options: ResolveAliasOptions) => {
    return {...getAliasesGeneralForGjs(options), ...getAliasesNodeForGjs(options), ...getAliasesWebForGjs(options) }
}

export const getAliasesForNode = (options: ResolveAliasOptions) => {
    return {...getAliasesGeneralForNode(options), ...getAliasesGjsForNode(options), ...getAliasesWebForNode(options) }
}

export const getAliasesForBrowser = (_options?: ResolveAliasOptions) => {
    return { ...ALIASES_FOR_BROWSER };
}

/** Array of Node.js build in module names (also with node: prefix) */
export const externalNode = [...EXTERNALS_NODE, ...EXTERNALS_NODE.map(E => `node:${E}`)];

/** Array of NPM module names for which we have our own implementation */
export const externalNPM = [...EXTERNALS_NPM];
