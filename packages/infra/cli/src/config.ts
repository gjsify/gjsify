import { APP_NAME } from './constants.js';
import { cosmiconfig, type Loader, type Options as LoadOptions } from 'cosmiconfig';
import { basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isGjs, hostRuntime } from '@gjsify/rolldown-plugin-gjsify/runtime';
import { buildAppForRuntime } from './utils/runtimes.js';
import { DIALECT_APPS, isSourceDialect, SOURCE_DIALECTS } from '@gjsify/rolldown-plugin-gjsify';
import { GI_RENDERER_APPS } from '@gjsify/resolve-npm';

/**
 * Does the failed `import()` of a config look like a MODULE-RESOLUTION failure
 * (the config imports something GJS's ESM loader can't resolve for an external
 * file — `node:` builtins, npm deps) rather than a syntax/eval error in the
 * config body? Only the former is worth retrying by bundling the config.
 */
function isModuleResolutionFailure(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /Unsupported URI scheme|\bnode:|Cannot find (module|package)|Module not found|ERR_MODULE_NOT_FOUND|Failed to resolve/i.test(
        msg,
    );
}

/**
 * Load a `gjsify.config.js` that imports `node:`/npm modules under the
 * GJS-bundled CLI by BUNDLING it first (`--app gjs`: `node:`→`@gjsify`, `gi://`
 * externalized, `--globals auto`, one self-contained ESM), then importing that.
 * The Node-free way to run an otherwise-unimportable config under GJS — cached +
 * de-recursed (the nested build uses explicit options, never re-enters config
 * loading; see `BuildAction.bundleFileForGjsCached`).
 */
async function loadConfigViaGjsBundle(filepath: string, verbose: boolean): Promise<unknown> {
    let outfile: string;
    try {
        // Dynamic import keeps the build machinery out of config.ts's eager
        // module graph — pulled only when a config actually needs bundling.
        const { BuildAction } = await import('./actions/build.js');
        outfile = await BuildAction.bundleFileForGjsCached(filepath, {
            cacheSubdir: 'config',
            label: basename(filepath),
            verbose,
            noCacheEnv: 'GJSIFY_NO_CONFIG_CACHE',
            // The bundle lives in the cache dir, but the config commonly resolves
            // sibling files (e.g. `readFileSync(resolve(dirname(fileURLToPath(
            // import.meta.url)), 'package.json'))`) relative to ITS OWN location.
            // Bake the original config's URL so those reads hit the real dir.
            define: { 'import.meta.url': JSON.stringify(pathToFileURL(filepath).href) },
            // A config file is evaluated INSIDE the CLI process — toolchain by
            // construction, so a `@gjsify/*` the project cannot resolve may come
            // from the CLI's own install.
            resolveFromToolchain: true,
        });
    } catch (bundleErr) {
        throw new Error(
            `gjsify: failed to bundle the config ${filepath} for the GJS CLI. ` +
                `Fixes: run the build under Node (\`npx gjsify …\`), keep the config to plain values / ` +
                `\`process.env\`, or move settings into \`package.json#gjsify\`. (${(bundleErr as Error).message})`,
        );
    }
    try {
        const mod = (await import(pathToFileURL(outfile).href)) as { default?: unknown };
        return mod.default ?? mod;
    } catch (importErr) {
        throw new Error(
            `gjsify: bundled the config ${filepath} for GJS but could not import the result ` +
                `(${outfile}). (${(importErr as Error).message})`,
        );
    }
}

/**
 * Config-file loader for the GJS-bundled CLI (`cli.gjs.mjs`).
 *
 * cosmiconfig's default `.js`/`.mjs`/`.cjs` loader does `await import(href)` and,
 * on failure, falls back to a synchronous CJS `require` — which under GJS crashes
 * deep in the bundled require-shim with an opaque `a.shift is not a function`.
 * The real cause: a `gjsify.config.js` that imports `node:` builtins (e.g.
 * `node:fs` to read `package.json`) can't be resolved by GJS's ESM loader for an
 * externally-imported module (`Unsupported URI scheme for importing: node`).
 *
 * Fast path: plain-value configs `import()` fine under GJS — no bundling. When
 * the import fails on module resolution, bundle the config for GJS and import
 * THAT (so `node:`/npm imports resolve) — so node:-importing configs work
 * Node-free, not just fail cleanly. Genuine syntax/eval errors are rethrown
 * as-is. The Node CLI never takes this path (its `import()` resolves `node:`).
 */
const gjsConfigLoader: Loader = async (filepath) => {
    try {
        const mod = (await import(pathToFileURL(filepath).href)) as { default?: unknown };
        return mod.default ?? mod;
    } catch (err) {
        if (!isModuleResolutionFailure(err)) throw err;
        return loadConfigViaGjsBundle(filepath, Boolean(process.env.GJSIFY_DEBUG));
    }
};

/**
 * On GJS, override cosmiconfig's default JS loaders (whose require fallback
 * crashes) with {@link gjsConfigLoader}. Empty on Node, so cosmiconfig keeps its
 * defaults there — zero behavior change off GJS.
 */
const gjsConfigLoaders: Record<string, Loader> = isGjs()
    ? { '.js': gjsConfigLoader, '.mjs': gjsConfigLoader, '.cjs': gjsConfigLoader }
    : {};

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
function merge<T extends object>(target: T, ...sources: object[]): T {
    for (const source of sources) {
        if (!source) continue;
        for (const key of Object.keys(source)) {
            const targetVal = (target as Record<string, unknown>)[key];
            const sourceVal = (source as Record<string, unknown>)[key];
            if (sourceVal !== undefined) {
                if (isPlainObject(targetVal) && isPlainObject(sourceVal)) {
                    merge(targetVal, sourceVal);
                } else {
                    (target as Record<string, unknown>)[key] = sourceVal;
                }
            }
        }
    }
    return target;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
    return (
        typeof val === 'object' &&
        val !== null &&
        !Array.isArray(val) &&
        Object.getPrototypeOf(val) === Object.prototype
    );
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

import type {
    CliBuildOptions,
    ConfigData,
    CosmiconfigResult,
    ConfigDataTypescript,
    ConfigDataLibrary,
} from './types/index.js';
import type { ArgumentsCamelCase } from 'yargs';

export class Config {
    readonly loadOptions: Partial<LoadOptions> = {};

    constructor(loadOptions: Partial<LoadOptions> = {}) {
        if (Object.keys(loadOptions).length) {
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
            searchPlaces: (this.loadOptions.searchPlaces ?? defaultSearchPlaces(APP_NAME)).filter(
                (p) => p !== 'package.json',
            ),
            // GJS: swap the crashing default JS loaders for one that surfaces an
            // actionable error instead of `a.shift is not a function`. User-provided
            // loaders still win. No-op on Node (gjsConfigLoaders is empty there).
            loaders: { ...gjsConfigLoaders, ...this.loadOptions.loaders },
        });
        const fileResult = (await fileExplorer.search(searchFrom)) as CosmiconfigResult<ConfigData> | null;

        const merged: ConfigData = {};
        try {
            const pkg = (await this.readPackageJSON(searchFrom)) as { gjsify?: ConfigData };
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
        dirPath = await resolvePackageJSON(dirPath);
        const pkg = await readPackageJSON(dirPath);
        return pkg;
    }

    /** Loads tsconfig.json of the current project */
    private async readTSConfig(dirPath?: string) {
        const tsconfig = getTsconfig(dirPath)?.config || {};
        return tsconfig;
    }

    /**
     * The globals policy for a `gjsify run --node-script` bundle, resolved from the
     * package that OWNS THE SCRIPT — not the cwd, which during a monorepo build is the
     * repo root. `gjsify.nodeScript` overrides either key (see `ConfigData.nodeScript`).
     *
     * CONFIG AND NOT A FLAG because on a host with no `node` the caller is a
     * `package.json` spelling `node scripts/x.mjs`, re-entering the CLI through the shim
     * `writeNodeShim()` writes: no call site to hang a flag on, on exactly the hosts this
     * exists for.
     */
    async forNodeScript(scriptPath: string): Promise<{ globals?: string; excludeGlobals?: string[] }> {
        const { config } = await this.load(dirname(scriptPath));
        return {
            globals: config.nodeScript?.globals ?? config.globals,
            excludeGlobals: config.nodeScript?.excludeGlobals ?? config.excludeGlobals,
        };
    }

    /**
     * The config for a command that is NOT a build — `gjsify flatpak …`,
     * `gjsify ship …`.
     *
     * They all want exactly what the loader already produces: the merged
     * `package.json#gjsify` + config-file object, with none of `forBuild`'s
     * build-specific defaulting. Reaching it through `forBuild({} as never)`
     * — five copies of that line before this method existed — lies to the type
     * system and drags a tsconfig read and bundler defaults into a command
     * that has no bundle.
     */
    async forCommand(searchFrom: string = process.cwd()): Promise<ConfigData> {
        const { config } = await this.load(searchFrom);
        return config;
    }

    async forBuild(cliArgs: ArgumentsCamelCase<CliBuildOptions>) {
        const configFile = await this.load(process.cwd());
        const configData: ConfigData = { ...configFile.config };
        const configFilePath = configFile.filepath || process.cwd();
        const pkg = (await this.readPackageJSON(configFilePath)) as ConfigDataLibrary;
        const tsConfig = (await this.readTSConfig(configFilePath)) as ConfigDataTypescript;

        tsConfig.reflection ||= cliArgs.reflection;

        // `--verbose` and `--log-level` are two spellings of one question, and
        // only the boolean reached here — so `--log-level debug` turned the
        // BUNDLER's logging up (see the mapping further down, which sets
        // `bundler.logLevel`) while the CLI's own verbose output stayed off.
        // Either spelling now answers it; neither silences the other.
        configData.verbose = cliArgs.verbose || cliArgs.logLevel === 'debug' || cliArgs.logLevel === 'verbose';
        configData.exclude = cliArgs.exclude || [];
        if (cliArgs.consoleShim !== undefined) configData.consoleShim = cliArgs.consoleShim;
        if (cliArgs.giRenderer !== undefined) configData.giRenderer = cliArgs.giRenderer;
        // `--dialect` narrows here rather than at the call site. yargs `choices`
        // already rejects an unknown value typed on the command line, but a
        // `gjsify.dialect` in package.json or `.gjsifyrc.*` never passes through
        // yargs — so the one place both spellings meet is the one place that
        // checks, and it names the alternatives instead of silently ignoring.
        if (cliArgs.dialect !== undefined) {
            if (!isSourceDialect(cliArgs.dialect)) {
                throw new Error(
                    `gjsify build: "${cliArgs.dialect}" is not a source dialect. Known: ${SOURCE_DIALECTS.join(', ')}. ` +
                        'This is the dialect the SOURCE is written in — not gjsify.runtimes, which declares the runtime a package RUNS on.',
                );
            }
            configData.dialect = cliArgs.dialect;
        }
        // Default `--app` FOLLOWS the host runtime the CLI executes in: gjs when
        // run under gjs, node when run under node/bun/deno (both consume the
        // `--app node` bundle). Applied post-merge (not as a yargs `default:`)
        // so a `gjsify.app` declared in package.json#gjsify / `.gjsifyrc.*`
        // survives — a yargs default is indistinguishable from a user value and
        // would clobber the config one. Precedence: CLI flag > config file >
        // host default (same pattern as `globals` / `bundler.input`).
        if (cliArgs.app !== undefined) configData.app = cliArgs.app;
        configData.app ??= buildAppForRuntime(hostRuntime());
        // A dialect only composes on the targets that have a plugin for it, and
        // saying so is the whole point: `--dialect react-native --app browser`
        // parses, resolves and then composes NOTHING, so the alias never happens,
        // the support gate never runs, and the build succeeds while doing none of
        // what was asked. That is the shape this repo keeps paying for — a flag
        // accepted and ignored. Checked here rather than in the plugin because the
        // plugin only ever sees the targets it was composed on.
        if (configData.dialect !== undefined && !DIALECT_APPS.has(configData.app)) {
            throw new Error(
                `gjsify build: --dialect ${configData.dialect} has no effect on --app ${configData.app}. ` +
                    `It composes on ${[...DIALECT_APPS].join(' and ')} only. ` +
                    'Drop the dialect, or build one of those targets.',
            );
        }
        // Same rule for the `gi://` arm, and the same reason: `--gi-renderer --app gjs`
        // would parse, resolve and compose nothing, so the flag would be accepted and
        // ignored. On `gjs` and `node` the specifier is already answered — natively and
        // through `requireGi` — so there is nothing for a renderer to substitute for.
        if (configData.giRenderer === true && !GI_RENDERER_APPS.includes(configData.app)) {
            throw new Error(
                `gjsify build: --gi-renderer has no effect on --app ${configData.app}. ` +
                    `It composes on ${GI_RENDERER_APPS.join(' and ')} only — the targets with no GObject ` +
                    'introspection to answer `gi://` with. `--app gjs` resolves it natively and `--app node` ' +
                    'through @gjsify/node-gi, so neither needs a widget renderer standing in for it.',
            );
        }
        if (cliArgs.globals !== undefined) configData.globals = cliArgs.globals;
        // Fallback applied post-merge (not as a yargs `default:`) so a
        // `globals` declared in package.json#gjsify / `.gjsifyrc.*` survives —
        // a yargs default is indistinguishable from a user value and would
        // overwrite the config one. Precedence: CLI flag > config file > 'auto'
        // (mirrors the `bundler.input` fallback below).
        configData.globals ??= 'auto';
        if (cliArgs.shebang !== undefined) configData.shebang = cliArgs.shebang;
        if (cliArgs.excludeGlobals) {
            const raw = Array.isArray(cliArgs.excludeGlobals)
                ? cliArgs.excludeGlobals.join(',')
                : String(cliArgs.excludeGlobals);
            const ids = raw
                .split(',')
                .map((s: string) => s.trim())
                .filter(Boolean);
            if (ids.length) configData.excludeGlobals = [...(configData.excludeGlobals ?? []), ...ids];
        }

        merge((configData.library ??= {}), pkg, configData.library);
        merge((configData.typescript ??= {}), tsConfig, configData.typescript);

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
            configData.aliases = { ...configData.aliases, ...aliasMap };
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
                    throw new Error(`gjsify config: defineFromPackageJson["${name}"] is missing a "field" string`);
                }
                const value = readDottedPath(pkg as Record<string, unknown>, spec.field);
                fromPkgDefines[name] = value === undefined ? 'undefined' : JSON.stringify(value);
            }
        }
        const fromEnvDefines: Record<string, string> = {};
        if (configData.defineFromEnv) {
            for (const [name, spec] of Object.entries(configData.defineFromEnv)) {
                if (!spec || typeof spec.env !== 'string' || !spec.env) {
                    throw new Error(`gjsify config: defineFromEnv["${name}"] is missing an "env" string`);
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
                ...transform.define,
                ...fromPkgDefines,
                ...fromEnvDefines,
                ...defineMap,
            };
        }

        if (configData.verbose) console.debug('configData', configData);

        return configData;
    }
}
