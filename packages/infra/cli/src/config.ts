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

        merged.esbuild ||= {};
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

        merge(configData.esbuild ??= {}, {
            format: cliArgs.format,
            minify: cliArgs.minify,
            entryPoints: cliArgs.entryPoints,
            outfile: cliArgs.outfile,
            outdir: cliArgs.outdir,
            logLevel: cliArgs.logLevel || 'warning',
            ...(cliArgs.external?.length ? { external: cliArgs.external } : {}),
            ...(Object.keys(defineMap).length ? { define: defineMap } : {}),
        });

        if(configData.verbose) console.debug("configData", configData);

        return configData;

    }
}