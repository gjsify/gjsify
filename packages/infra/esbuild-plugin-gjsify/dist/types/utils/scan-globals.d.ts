/**
 * Resolve a `--globals` CLI argument into the set of `/register` subpaths
 * that must be injected into the build.
 *
 * The argument is a comma-separated list of identifiers or group names.
 * Group names (`node`, `web`, `dom`) expand to all identifiers in that group.
 * Unknown tokens are silently ignored. Empty or whitespace-only input returns
 * an empty set.
 *
 * Examples:
 *   resolveGlobalsList('fetch,Buffer,process')
 *     → Set { 'fetch/register', '@gjsify/buffer/register', '@gjsify/node-globals/register' }
 *
 *   resolveGlobalsList('node,web')
 *     → Set { '@gjsify/buffer/register', '@gjsify/node-globals/register', 'fetch/register', … }
 *
 *   resolveGlobalsList('')
 *     → Set { }
 */
export declare function resolveGlobalsList(globalsArg: string): Set<string>;
/**
 * Write a stub ESM file with `import` statements for the given register
 * paths and return its absolute path, suitable for passing to esbuild's
 * `inject` option via the plugin's `autoGlobalsInject` field.
 *
 * The file lives inside `<cwd>/node_modules/.cache/gjsify/` so esbuild's
 * module resolver can follow the bare specifiers in the generated imports.
 *
 * The file name is hashed by content so repeated builds with the same
 * set reuse the same file (no churn, idempotent on disk).
 */
export declare function writeRegisterInjectFile(registerPaths: Set<string>, cwd?: string): Promise<string | null>;
