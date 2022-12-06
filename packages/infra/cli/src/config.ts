import { APP_NAME } from  './constants.js';
import { cosmiconfig, Options as LoadOptions } from 'cosmiconfig';
import { readPackageJSON, resolvePackageJSON, readTSConfig, resolveTSConfig } from 'pkg-types';
import lodash from "lodash";
const { merge } = lodash;

import type { CliBuildOptions, ConfigData, CosmiconfigResult, ConfigDataTypescript, ConfigDataLibrary} from './types/index.js';
import type { ArgumentsCamelCase } from 'yargs';

export class Config {

    readonly loadOptions: LoadOptions = {
        searchPlaces: [APP_NAME]
    }

    constructor(loadOptions: LoadOptions = {}) {
        if(Object.keys(loadOptions).length) {
            this.loadOptions = loadOptions;
        }
    }

    /** Loads gjsify config file, e.g `gjsify.js` */
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
        dirPath = await resolveTSConfig(dirPath)     
        const tsconfig = await readTSConfig(dirPath);
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

        merge(configData.library, pkg, configData.library);
        merge(configData.typescript, tsConfig, configData.typescript);
        merge(configData.esbuild, {
            entryPoints: cliArgs.entryPoints,
            outfile: cliArgs.outfile,
            outdir: cliArgs.outdir,
            logLevel: cliArgs.logLevel || 'warning'
        });

        if(configData.verbose) console.debug("configData", configData);

        return configData;

    }
}