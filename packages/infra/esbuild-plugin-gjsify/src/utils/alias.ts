import { extname, join, dirname } from "path";
import {readFileSync } from "fs";
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
        const key = `node:${ALIAS}`;
        if(!ALIASES[key]) ALIASES[key] = ALIASES[ALIAS];
    }
    return ALIASES;
}

export const resolveAliasesByType = (ALIASES: Record<string, string>, options: ResolveAliasOptions) => {
    const aliases: Record<string, string> = {}
    for (const ALIAS in ALIASES) {
        if(ALIASES[ALIAS].startsWith("http://") || ALIASES[ALIAS].startsWith("https://")) {
            aliases[ALIAS] = ALIASES[ALIAS];
        } else {
            aliases[ALIAS] = resolvePackageByType(ALIASES[ALIAS], options);
        }
        
    }
    return aliases
}

export const resolvePackageByType = (pkgName: string, options: ResolveAliasOptions): string => {
    const resolveBy = options.resolveBy === 'main' ? 'main' : 'module';
    const resolveByFallback = resolveBy === 'main' ? 'module' : 'main';

    // TODO: use micromatch here
    if(options.external.includes(pkgName)) {
        return pkgName;
    }

    let resolveTo = pkgName;
    let result = resolveTo;

    try {
        result = require.resolve(resolveTo);
        return result;
    } catch (error) {
        console.warn('[gjsify]', error.message);
    }

    // FALLBACK maybe we can `pnpFallbackMode` to `all` instead? See https://yarnpkg.com/configuration/yarnrc#pnpFallbackMode
    // if(!resolveTo.endsWith('/') && !extname(resolveTo) ) {
    //     resolveTo = join(resolveTo, 'package.json')
    // }

    // if(resolveTo.endsWith('package.json')) {
    //     const pkgPath = require.resolve(resolveTo);
    //     const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    //     if(pkg[resolveBy]) {
    //         resolveTo = join(dirname(resolveTo), pkg[resolveBy]);
    //     } else if(pkg[resolveByFallback]) {
    //         resolveTo = join(dirname(resolveTo), pkg[resolveByFallback]);
    //         if(options.debug) console.warn(`Package entry point type "${resolveBy}" not found for "${pkg.name}", use "${resolveByFallback}" instead!`)
    //     } else {
    //         resolveTo = join(dirname(resolveTo), 'index.js');
    //         if(options.debug) console.warn(`Package entry point type "${resolveBy}" not found for "${pkg.name}", use index.js instead!`)
    //     }
    // }

    // try {
    //     result = require.resolve(resolveTo);
    // } catch (error) {
    //     console.warn('[gjsify]', error);
    // }

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

