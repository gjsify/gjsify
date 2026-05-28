import {
    EXTERNALS_NODE,
    EXTERNALS_NPM,
    ALIASES_GENERAL_FOR_GJS,
    ALIASES_NODE_FOR_GJS,
    ALIASES_WEB_FOR_GJS,
    ALIASES_GENERAL_FOR_NODE,
    ALIASES_GJS_FOR_NODE,
    ALIASES_WEB_FOR_NODE,
    getDerivedAliasesSync,
} from '@gjsify/resolve-npm';

import type { ResolveAliasOptions } from '../types/index.js';

export const setNodeAliasPrefix = (ALIASES: Record<string, string>) => {
    // Also resolve alias names with `node:${ALIAS}`
    for (const ALIAS in ALIASES) {
        if (ALIAS.startsWith('node:')) {
            continue;
        }
        const key = `node:${ALIAS}`;
        if (!ALIASES[key]) ALIASES[key] = ALIASES[ALIAS];
    }
    return ALIASES;
};

const getAliasesGeneralForGjs = (_options: ResolveAliasOptions) => ALIASES_GENERAL_FOR_GJS;
const getAliasesNodeForGjs = (_options: ResolveAliasOptions) => setNodeAliasPrefix(ALIASES_NODE_FOR_GJS);
const getAliasesWebForGjs = (_options: ResolveAliasOptions) => ALIASES_WEB_FOR_GJS;

const getAliasesGeneralForNode = (_options: ResolveAliasOptions) => ALIASES_GENERAL_FOR_NODE;
const getAliasesGjsForNode = (_options: ResolveAliasOptions) => ALIASES_GJS_FOR_NODE;
const getAliasesWebForNode = (_options: ResolveAliasOptions) => ALIASES_WEB_FOR_NODE;

/**
 * Compose the alias map for a target runtime.
 *
 * Merge order — later entries WIN, so hardcoded `ALIASES_*` entries take
 * precedence over derived ones. This preserves 100% backwards-compatible
 * behavior for the curated set of bare specifiers (`webcrypto`, `assert`, …)
 * encoded in the hardcoded maps. The derived layer fills in `@gjsify/<X>`
 * direct-import routes for packages that have declared a `gjsify.runtimes`
 * triplet, additively — when both sources mention the same key, hardcoded
 * wins.
 */
export const getAliasesForGjs = (options: ResolveAliasOptions) => {
    return {
        // Derived first → hardcoded overrides.
        ...getDerivedAliasesSync('gjs'),
        ...getAliasesGeneralForGjs(options),
        ...getAliasesNodeForGjs(options),
        ...getAliasesWebForGjs(options),
    };
};

export const getAliasesForNode = (options: ResolveAliasOptions) => {
    return {
        ...getDerivedAliasesSync('node'),
        ...getAliasesGeneralForNode(options),
        ...getAliasesGjsForNode(options),
        ...getAliasesWebForNode(options),
    };
};

/** Array of Node.js build in module names (also with node: prefix) */
export const externalNode = [...EXTERNALS_NODE, ...EXTERNALS_NODE.map((E) => `node:${E}`)];

/** Array of NPM module names for which we have our own implementation */
export const externalNPM = [...EXTERNALS_NPM];
