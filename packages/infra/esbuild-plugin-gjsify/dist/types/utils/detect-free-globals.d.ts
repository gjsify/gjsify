/**
 * Parse bundled JS code and return the set of free (unbound) identifiers
 * that match known GJS globals from `GJS_GLOBALS_MAP`.
 *
 * "Free" means the identifier is referenced but never declared in the
 * module (var/let/const/function/class/import/param/catch).
 *
 * After esbuild bundling + minification, local variables that shadow
 * globals are renamed to short names, so any surviving known-global name
 * in the output is almost certainly a true global reference. The
 * declared-names check is a safety net for edge cases where esbuild
 * keeps the original name.
 *
 * `typeof X` references ARE included — if code guards with
 * `typeof fetch !== 'undefined'`, it intends to use fetch when available
 * and we can provide it.
 */
export declare function detectFreeGlobals(code: string): Set<string>;
