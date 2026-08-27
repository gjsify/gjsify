/** Array of Node.js build in module names */
export declare const EXTERNALS_NODE: string[];

/** Array of NPM module names for which we have our own implementation */
export declare const EXTERNALS_NPM: string[];

/** General record of modules for Gjs */
export declare const ALIASES_GENERAL_FOR_GJS: {[alias:string]: string}; 

/** Record of Node.js modules (build in or not) and his replacement for Gjs */
export declare const ALIASES_NODE_FOR_GJS: {[alias:string]: string};

/**
 * Record of Node.js modules (build in or not) and his replacement for `--app browser`.
 * Unwired in this PR — exported for future consumption by browser.ts.
 */
export declare const ALIASES_NODE_FOR_BROWSER: {[alias:string]: string};
export declare const ALIASES_NODE_FOR_NATIVESCRIPT: {[alias:string]: string};

/** Record of Web modules and his replacement for Gjs */
export declare const ALIASES_WEB_FOR_GJS: {[alias:string]: string}; 

/** General record of modules for Deno */
export declare const ALIASES_GENERAL_FOR_DENO: {[alias:string]: string};

/** Record of Gjs modules (build in or not) and his replacement for Deno */
export declare const ALIASES_GJS_FOR_DENO: {[alias:string]: string};

/** Record of Node.js modules (build in or not) and his replacement for Deno */
export declare const ALIASES_NODE_FOR_DENO: {[alias:string]: string};

/** General record of modules for Node */
export declare const ALIASES_GENERAL_FOR_NODE: {[alias:string]: string};

/** Record of Gjs modules (build in or not) and his replacement for Node */
export declare const ALIASES_GJS_FOR_NODE: {[alias:string]: string};

/** Record of Web modules and his replacement for Node */
export declare const ALIASES_WEB_FOR_NODE: {[alias:string]: string};

/** Runtime-slot type carried by `package.json#gjsify.runtimes.<target>`. */
export type RuntimeSlot = 'polyfill' | 'native' | 'partial' | 'none';

/**
 * Per-package runtime quintuplet — `{gjs, node, browser, nativescript,
 * react-native}` × {RuntimeSlot}. The name is legacy; `runtime-aliases.mjs`'s
 * `VALID_TARGETS` is the canonical list.
 *
 * `nativescript` was missing here for the whole life of the 4th slot: the runtime
 * read it, the type denied it, and nothing compared the two — which is why the 5th
 * arrives with both halves in one change.
 */
export interface RuntimeTriplet {
    gjs?: RuntimeSlot;
    node?: RuntimeSlot;
    browser?: RuntimeSlot;
    nativescript?: RuntimeSlot;
    'react-native'?: RuntimeSlot;
}

/** The runtimes a package can declare a slot for. */
export type RuntimeTarget = 'gjs' | 'node' | 'browser' | 'nativescript' | 'react-native';

/**
 * Build a derived `@gjsify/<X>` alias map for the given target runtime, driven
 * by each workspace package's declared `gjsify.runtimes` triplet. See
 * `runtime-aliases.mjs` for the routing semantics.
 */
export declare function getDerivedAliasesSync(target: RuntimeTarget): {[alias: string]: string};

/** Async variant of {@link getDerivedAliasesSync}. */
export declare function getDerivedAliases(
    target: RuntimeTarget,
): Promise<{[alias: string]: string}>;

/** Reset the in-memory cache. Test-only. */
export declare function resetRuntimeAliasesCache(): void;

/** Diagnostic — list every declared runtime triplet keyed by package name. */
export declare function listDeclaredRuntimes(): Promise<Map<string, {
    name: string;
    dir: string;
    runtimes: RuntimeTriplet;
    hasGlobals: boolean;
}>>;
