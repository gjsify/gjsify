import path from "path";
import {readFileSync } from "fs";
import { ALIASES_NODE, ALIASES_WEB, EXTERNALS_NODE, EXTERNALS_NPM } from "@gjsify/resolve-npm";

export const setNodeAliasPrefix = (ALIASES: Record<string, string>) => {
    // Also resolve alias names with `npm:${ALIAS}`
    for (const ALIAS in ALIASES) {
        const key = `node:${ALIAS}`;
        if(!ALIASES[key]) ALIASES[key] = ALIASES[ALIAS];
    }
    return ALIASES;
}

export const resolveAliases = (ALIASES: Record<string, string>, resolveBy: 'main' | 'module' = 'module') => {
    const resolveByFallback = resolveBy === 'main' ? 'module' : 'main';
    const aliases: Record<string, string> = {}
    for (const ALIAS in ALIASES) {
        let resolveTo = ALIASES[ALIAS];
        if(!resolveTo.endsWith('/') && !path.extname(resolveTo) ) {
            resolveTo = path.join(resolveTo, 'package.json')
        }

        if(resolveTo.endsWith('package.json')) {
            const pkgPath = require.resolve(resolveTo);
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
            if(pkg[resolveBy]) {
                resolveTo = path.join(path.dirname(resolveTo), pkg[resolveBy]);
            } else if(pkg[resolveByFallback]) {
                resolveTo = path.join(path.dirname(resolveTo), pkg[resolveByFallback]);
            } else {
                resolveTo = path.join(path.dirname(resolveTo), 'index.js');
            }
        }

        try {
            // const test = require.resolve();
            aliases[ALIAS] = require.resolve(resolveTo);
        } catch (error) {
            console.warn(error.message);
        }
        
    }
    return aliases
}

export const aliasesNode = resolveAliases(setNodeAliasPrefix(ALIASES_NODE));

export const aliasesWeb = resolveAliases(ALIASES_WEB);

/** Array of Node.js build in module names (also with node: prefix) */
export const externalNode = [...EXTERNALS_NODE, ...EXTERNALS_NODE.map(E => `node:${E}`)];

/** Array of NPM module names for which we have our own implementation */
export const externalNPM = [...EXTERNALS_NPM];