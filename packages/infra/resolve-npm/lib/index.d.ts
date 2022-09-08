/** Array of Node.js build in module names */
export declare const EXTERNALS_NODE: string[];
/** Array of NPM module names for which we have our own implementation */
export declare const EXTERNALS_NPM: string[];
/** Record of Node.js modules (build in or not) and his replacement */
export declare const ALIASES_NODE: {[alias:string]: string}; 
/** Record of Web modules and his replacement */
export declare const ALIASES_WEB: {[alias:string]: string}; 