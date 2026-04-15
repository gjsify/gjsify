import { APP_NAME } from  './constants.js';
import { cosmiconfig, type Options as LoadOptions } from 'cosmiconfig';
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
        let configFile = await cosmiconfig(APP_NAME, this.loadOptions).search(searchFrom) as CosmiconfigResult<ConfigData> | null;

        configFile ||= {
            config: {},
            filepath: '',
            isEmpty: true,
        }

        configFile.config ||= {};
        configFile.config.esbuild ||= {};
        configFile.config.library ||= {};
        configFile.config.typescript ||= {};
        return configFile;
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

        merge(configData.library ??= {}, pkg, configData.library);
        merge(configData.typescript ??= {}, tsConfig, configData.typescript);
        merge(configData.esbuild ??= {}, {
            format: cliArgs.format,
            minify: cliArgs.minify,
            entryPoints: cliArgs.entryPoints,
            outfile: cliArgs.outfile,
            outdir: cliArgs.outdir,
            logLevel: cliArgs.logLevel || 'warning'
        });

        if(configData.verbose) console.debug("configData", configData);

        return configData;

    }
}