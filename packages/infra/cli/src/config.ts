import { APP_NAME } from  './constants.js';
import { cosmiconfig, type Options as LoadOptions } from 'cosmiconfig';

/** Default cosmiconfig search places for a given module name (matches cosmiconfig defaults). */
function defaultSearchPlaces(name: string): string[] {
    return [
        'package.json',
        `.${name}rc`,
        `.${name}rc.json`,
        `.${name}rc.yaml`,
        `.${name}rc.yml`,
        `.${name}rc.js`,
        `.${name}rc.ts`,
        `.${name}rc.mjs`,
        `.${name}rc.cjs`,
        `${name}.config.js`,
        `${name}.config.ts`,
        `${name}.config.mjs`,
        `${name}.config.cjs`,
    ];
}
import { readPackageJSON, resolvePackageJSON } from 'pkg-types';
import { getTsconfig } from 'get-tsconfig';

/** Deep merge objects (replaces lodash.merge) */
function merge<T extends Record<string, any>>(target: T, ...sources: Record<string, any>[]): T {
    for (const source of sources) {
        if (!source) continue;
        for (const key of Object.keys(source)) {
            const targetVal = (target as any)[key];
            const sourceVal = source[key];
            if (sourceVal !== undefined) {
                if (isPlainObject(targetVal) && isPlainObject(sourceVal)) {
                    merge(targetVal, sourceVal);
                } else {
                    (target as any)[key] = sourceVal;
                }
            }
        }
    }
    return target;
}

function isPlainObject(val: unknown): val is Record<string, any> {
    return typeof val === 'object' && val !== null && !Array.isArray(val) && Object.getPrototypeOf(val) === Object.prototype;
}

/**
 * Read a dotted path (`a.b.c`) from a plain object. Returns `undefined` for
 * any missing segment. Intentionally narrow — only used for surfacing
 * `package.json` fields into compile-time defines, not for arbitrary deep
 * traversal.
 */
function readDottedPath(obj: Record<string, unknown>, path: string): unknown {
    if (!path.includes('.')) return obj[path];
    let cursor: unknown = obj;
    for (const segment of path.split('.')) {
        if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
        cursor = (cursor as Record<string, unknown>)[segment];
    }
    return cursor;
}

import type { CliBuildOptions, ConfigData, CosmiconfigResult, ConfigDataTypescript, ConfigDataLibrary} from './types/index.js';
import type { ArgumentsCamelCase } from 'yargs';

export class Config {

    readonly loadOptions: Partial<LoadOptions> = {}

    constructor(loadOptions: Partial<LoadOptions> = {}) {
        if(Object.keys(loadOptions).length) {
            this.loadOptions = loadOptions;
        }
    }

    /** Loads gjsify config file, e.g `.gjsifyrc.js` */
    private async load(searchFrom?: string) {
        // cosmiconfig's default first-match-wins behaviour silently drops one
        // source when both `package.json#gjsify` and an explicit config file
        // (`.gjsifyrc.js`, `gjsify.config.mjs`, ...) are present. Project hits
        // this footgun: adding `gjsify.bin` to package.json (so `gjsify dlx`
        // resolves the GJS bundle) silently disables `.gjsifyrc.js`. We
        // explicitly load both sources and merge — package.json is the lower
        // layer, the explicit file wins on key collisions.
        //
        // Run two searches:
        //   1. Default (includes package.json) — for projects that only use
        //      package.json#gjsify and no separate file.
        //   2. Explicit-file only (package.json excluded) — to find the
        //      `.gjsifyrc.*` / `gjsify.config.*` regardless of whether
        //      package.json#gjsify exists.
        const fileExplorer = cosmiconfig(APP_NAME, {
            ...this.loadOptions,
            searchPlaces: (this.loadOptions.searchPlaces ?? defaultSearchPlaces(APP_NAME))
                .filter((p) => p !== 'package.json'),
        });
        const fileResult = await fileExplorer.search(searchFrom) as CosmiconfigResult<ConfigData> | null;

        const merged: ConfigData = {};
        try {
            const pkg = await this.readPackageJSON(searchFrom) as { gjsify?: ConfigData };
            if (isPlainObject(pkg?.gjsify)) merge(merged, pkg.gjsify);
        } catch {
            // Missing or unreadable package.json — skip.
        }
        if (fileResult?.config && isPlainObject(fileResult.config)) {
            merge(merged, fileResult.config);
        }

        merged.bundler ||= {};
        merged.library ||= {};
        merged.typescript ||= {};

        return {
            config: merged,
            filepath: fileResult?.filepath ?? '',
            isEmpty: !fileResult && Object.keys(merged).length === 3, // only the three default-empty objects
        };
    }

    /** Loads package.json of the current project */
    private async readPackageJSON(dirPath?: string) {   
        dirPath = await resolvePackageJSON(dirPath)     
        const pkg = await readPackageJSON(dirPath);
        return pkg;
    }

    /** Loads tsconfig.json of the current project */
    private async readTSConfig(dirPath?: string) {     
        const tsconfig = getTsconfig(dirPath)?.config || {};
        return tsconfig;
    }

    async forBuild(cliArgs: ArgumentsCamelCase<CliBuildOptions>) {
        const configFile = await this.load(process.cwd());
        const configData: ConfigData = {...configFile.config};
        const configFilePath = configFile.filepath || process.cwd();
        const pkg = await this.readPackageJSON(configFilePath) as ConfigDataLibrary;
        const tsConfig = await this.readTSConfig(configFilePath) as ConfigDataTypescript;

        tsConfig.reflection ||= cliArgs.reflection;

        // TODO replace with `cliArgs.logLevel`
        configData.verbose = cliArgs.verbose || false;
        configData.exclude = cliArgs.exclude || [];
        if (cliArgs.consoleShim !== undefined) configData.consoleShim = cliArgs.consoleShim;
        if (cliArgs.globals !== undefined) configData.globals = cliArgs.globals;
        if (cliArgs.shebang !== undefined) configData.shebang = cliArgs.shebang;
        if (cliArgs.excludeGlobals) {
            const raw = Array.isArray(cliArgs.excludeGlobals)
                ? cliArgs.excludeGlobals.join(',')
                : String(cliArgs.excludeGlobals);
            const ids = raw.split(',').map((s: string) => s.trim()).filter(Boolean);
            if (ids.length) configData.excludeGlobals = [...(configData.excludeGlobals ?? []), ...ids];
        }

        merge(configData.library ??= {}, pkg, configData.library);
        merge(configData.typescript ??= {}, tsConfig, configData.typescript);

        // Parse `KEY=VALUE` style flags into Record<string, string>.
        // - `--define`: VALUE is a JS expression (string literals must be
        //   pre-quoted by the caller, e.g. `'"1.2.3"'`).
        // - `--alias`: VALUE is the substitute module specifier.
        const parseKvPairs = (entries: readonly string[], flag: string): Record<string, string> => {
            const out: Record<string, string> = {};
            for (const entry of entries) {
                const idx = entry.indexOf('=');
                if (idx === -1) {
                    throw new Error(`Invalid --${flag} value '${entry}'. Expected KEY=VALUE.`);
                }
                const key = entry.slice(0, idx).trim();
                const value = entry.slice(idx + 1);
                if (!key) {
                    throw new Error(`Invalid --${flag} value '${entry}'. Empty key.`);
                }
                out[key] = value;
            }
            return out;
        };
        const defineMap = parseKvPairs(cliArgs.define ?? [], 'define');
        const aliasMap = parseKvPairs(cliArgs.alias ?? [], 'alias');
        if (Object.keys(aliasMap).length) {
            configData.aliases = { ...(configData.aliases ?? {}), ...aliasMap };
        }

        // Resolve `defineFromPackageJson` / `defineFromEnv` into raw
        // KEY=<JSON-stringified value> entries that get merged into the
        // bundler's `transform.define` map below. Both produce JS expressions
        // (the value side of a Rolldown define is substituted at the call
        // site, not stringified again) — so a missing env variable resolves
        // to the literal `undefined`, letting consumer code use
        // `typeof X === 'undefined'` or `X ?? fallback` guards.
        const fromPkgDefines: Record<string, string> = {};
        if (configData.defineFromPackageJson) {
            for (const [name, spec] of Object.entries(configData.defineFromPackageJson)) {
                if (!spec || typeof spec.field !== 'string' || !spec.field) {
                    throw new Error(
                        `gjsify config: defineFromPackageJson["${name}"] is missing a "field" string`,
                    );
                }
                const value = readDottedPath(pkg as Record<string, unknown>, spec.field);
                fromPkgDefines[name] = value === undefined ? 'undefined' : JSON.stringify(value);
            }
        }
        const fromEnvDefines: Record<string, string> = {};
        if (configData.defineFromEnv) {
            for (const [name, spec] of Object.entries(configData.defineFromEnv)) {
                if (!spec || typeof spec.env !== 'string' || !spec.env) {
                    throw new Error(
                        `gjsify config: defineFromEnv["${name}"] is missing an "env" string`,
                    );
                }
                const raw = process.env[spec.env];
                const value = raw !== undefined ? raw : spec.default;
                fromEnvDefines[name] = value === undefined ? 'undefined' : JSON.stringify(value);
            }
        }

        // Merge CLI flags into the Rolldown-shape `bundler` field. Mappings:
        //   --entry-points  → bundler.input
        //   --outfile       → bundler.output.file
        //   --outdir        → bundler.output.dir
        //   --format        → bundler.output.format
        //   --minify        → bundler.output.minify
        //   --log-level     → bundler.logLevel
        //   --external      → bundler.external
        //   --define        → bundler.transform.define
        const bundler = (configData.bundler ??= {});
        const output = (bundler.output ??= {});
        const transform = (bundler.transform ??= {});

        if (cliArgs.entryPoints?.length) bundler.input = cliArgs.entryPoints;
        // Fallback when neither the CLI flag nor the cosmiconfig data set an
        // entry point. Applied here (post-merge) rather than as a yargs
        // `default:` because yargs defaults are indistinguishable from
        // user-set values, and would silently overwrite `bundler.input`
        // declared in package.json#gjsify.
        if (!bundler.input) bundler.input = ['src/index.ts'];
        if (cliArgs.outfile !== undefined) output.file = cliArgs.outfile;
        if (cliArgs.outdir !== undefined) output.dir = cliArgs.outdir;
        if (cliArgs.format !== undefined) output.format = cliArgs.format as 'esm' | 'cjs' | 'iife';
        // CLI flag wins over config; if neither is set, minify by default.
        // Pretty-printed output is opt-in via `--no-minify` or
        // `bundler.output.minify: false` in the config.
        //
        // When minify is enabled (boolean true) we expand it to a MinifyOptions
        // object that PRESERVES function and class .name properties. Rolldown's
        // default mangler renames every top-level class to short identifiers
        // (`e`, `t`, ...), which collapses Function.name → 'e' for many
        // distinct classes. Libraries like Excalibur key runtime data
        // structures off `c.name` (e.g. `Query.createId` hashes
        // `c_${component.name}` to dedupe ECS queries), so once class names
        // collide every query with N components is treated as identical and
        // the wrong filter wins. Keeping the .name property only costs a few
        // bytes per class but keeps name-driven library code working
        // (Excalibur ECS, deepkit reflection, error stacks, etc.).
        if (cliArgs.minify !== undefined) output.minify = cliArgs.minify;
        if (output.minify === undefined) output.minify = true;
        if (output.minify === true) {
            // `keepNames: true` on output is the top-level BundlerOptions
            // path: rolldown wires it into both `mangle.keepNames.all_true()`
            // (function+class) AND `compress.keepNames.all_true()` for us.
            // The previous `minify: { mangle: { keepNames: {...} } }` shape
            // worked under npm rolldown's JS API but rolldown's serde
            // `deserialize_minify` (deserialize_minify_options.rs:311) only
            // accepts SimpleMinifyOptions (bool/string), so the object form
            // was rejected by the native facade's JSON-deserializer with
            // "data did not match any variant of untagged enum
            // SimpleMinifyOptions". `output.keepNames` reaches the binding
            // through the documented top-level path in both engines.
            output.keepNames = true;
        }
        if (cliArgs.logLevel) {
            // Map esbuild log levels to Rolldown's narrower set:
            //   esbuild   → rolldown
            //   silent    → silent
            //   error     → warn   (rolldown has no error-only)
            //   warning   → warn
            //   info      → info
            //   debug     → debug
            //   verbose   → debug  (rolldown has no verbose)
            const map: Record<string, 'silent' | 'warn' | 'info' | 'debug'> = {
                silent: 'silent',
                error: 'warn',
                warning: 'warn',
                warn: 'warn',
                info: 'info',
                debug: 'debug',
                verbose: 'debug',
            };
            const level = map[cliArgs.logLevel] ?? 'warn';
            bundler.logLevel = level;
        }
        if (cliArgs.external?.length) {
            const userExternal = Array.isArray(bundler.external) ? bundler.external : [];
            bundler.external = [...userExternal, ...cliArgs.external];
        }
        if (Object.keys(defineMap).length || Object.keys(fromPkgDefines).length || Object.keys(fromEnvDefines).length) {
            // CLI --define wins over package.json/env (manual overrides during
            // debugging beat declarative config).
            transform.define = {
                ...(transform.define ?? {}),
                ...fromPkgDefines,
                ...fromEnvDefines,
                ...defineMap,
            };
        }

        if(configData.verbose) console.debug("configData", configData);

        return configData;

    }
}