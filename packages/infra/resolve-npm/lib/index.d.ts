/** Array of Node.js build in module names */
export declare const EXTERNALS_NODE: string[];

/** Array of NPM module names for which we have our own implementation */
export declare const EXTERNALS_NPM: string[];

/** General record of modules for Gjs */
export declare const ALIASES_GENERAL_FOR_GJS: {[alias:string]: string}; 

/** Record of Node.js modules (build in or not) and his replacement for Gjs */
export declare const ALIASES_NODE_FOR_GJS: {[alias:string]: string}; 

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

