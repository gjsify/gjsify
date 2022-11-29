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

export const setNodeAliasPrefix = (ALIASES: Record<string, string>) => {
    // Also resolve alias names with `npm:${ALIAS}`
    for (const ALIAS in ALIASES) {
        const key = `node:${ALIAS}`;
        if(!ALIASES[key]) ALIASES[key] = ALIASES[ALIAS];
    }
    return ALIASES;
}

export const resolveAliasesByType = (ALIASES: Record<string, string>, resolveBy: 'main' | 'module' = 'module') => {
    const aliases: Record<string, string> = {}
    for (const ALIAS in ALIASES) {
        if(ALIASES[ALIAS].startsWith("http://") || ALIASES[ALIAS].startsWith("https://")) {
            aliases[ALIAS] = ALIASES[ALIAS];
        } else {
            aliases[ALIAS] = resolvePackageByType(ALIASES[ALIAS]);
        }
        
    }
    return aliases
}

export const resolvePackageByType = (pkgName: string, resolveBy: 'main' | 'module' = 'module') => {
    const resolveByFallback = resolveBy === 'main' ? 'module' : 'main';

    let result: string | undefined;

    let resolveTo = pkgName;
    if(!resolveTo.endsWith('/') && !extname(resolveTo) ) {
        resolveTo = join(resolveTo, 'package.json')
    }

    if(resolveTo.endsWith('package.json')) {
        const pkgPath = require.resolve(resolveTo);
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if(pkg[resolveBy]) {
            resolveTo = join(dirname(resolveTo), pkg[resolveBy]);
        } else if(pkg[resolveByFallback]) {
            resolveTo = join(dirname(resolveTo), pkg[resolveByFallback]);
            console.warn(`Package entry point type "${resolveBy}" not found for "${pkg.name}", use "${resolveByFallback}" instead!`)
        } else {
            resolveTo = join(dirname(resolveTo), 'index.js');
            console.warn(`Package entry point type "${resolveBy}" not found for "${pkg.name}", use index.js instead!`)
        }
    }

    try {
        result = require.resolve(resolveTo);
    } catch (error) {
        console.warn(error.message);
    }

    return result;
}



const getAliasesGeneralForGjs = () => resolveAliasesByType(ALIASES_GENERAL_FOR_GJS);
const getAliasesNodeForGjs = () => resolveAliasesByType(setNodeAliasPrefix(ALIASES_NODE_FOR_GJS));
const getAliasesWebForGjs = () => resolveAliasesByType(ALIASES_WEB_FOR_GJS);

const getAliasesGeneralForDeno = () => resolveAliasesByType(ALIASES_GENERAL_FOR_DENO);
const getAliasesNodeForDeno = () => resolveAliasesByType(setNodeAliasPrefix(ALIASES_NODE_FOR_DENO));
const getAliasesGjsForDeno = () => resolveAliasesByType(ALIASES_GJS_FOR_DENO);

const getAliasesGeneralForNode = () => resolveAliasesByType(ALIASES_GENERAL_FOR_NODE);
const getAliasesGjsForNode = () => resolveAliasesByType(ALIASES_GJS_FOR_NODE);
const getAliasesWebForNode = () => resolveAliasesByType(ALIASES_WEB_FOR_NODE);


export const getAliasesForGjs = () => {
    return {...getAliasesGeneralForGjs(), ...getAliasesNodeForGjs(), ...getAliasesWebForGjs() }
}

export const getAliasesForDeno = () => {
    return {...getAliasesGeneralForDeno(), ...getAliasesNodeForDeno(), ...getAliasesGjsForDeno() }
}

export const getAliasesForNode = () => {
    return {...getAliasesGeneralForNode(), ...getAliasesGjsForNode(), ...getAliasesWebForNode() }
}

/** Array of Node.js build in module names (also with node: prefix) */
export const externalNode = [...EXTERNALS_NODE, ...EXTERNALS_NODE.map(E => `node:${E}`)];

/** Array of NPM module names for which we have our own implementation */
export const externalNPM = [...EXTERNALS_NPM];

