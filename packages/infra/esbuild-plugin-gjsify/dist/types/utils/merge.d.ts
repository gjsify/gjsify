/** Deep merge objects (replaces lodash.merge) */
export declare function merge<T extends Record<string, any>>(target: T, ...sources: Record<string, any>[]): T;
