import { APP_NAME } from  './constants.js';
import { cosmiconfig, Options as LoadOptions } from 'cosmiconfig';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { readPackageJSON, resolvePackageJSON } from 'pkg-types';
import lodash from "lodash";
const { merge } = lodash;

import type { CliBuildOptions, ConfigData, CosmiconfigResult } from './types/index.js';
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
        return configFile;
    }

    /** Loads package.json of the current project */
    private async readPackageJSON(dirPath?: string) {   
        dirPath = await resolvePackageJSON(dirPath)     
        const pkg = await readPackageJSON(dirPath);
        return pkg;
    }

    async forBuild(cliArgs: ArgumentsCamelCase<CliBuildOptions>) {
        const configFile = await this.load(process.cwd());
        const configData: ConfigData = {...configFile.config};
        const configFilePath = configFile.filepath || process.cwd();
        const pkg = await this.readPackageJSON(configFilePath);

        merge(configData.library, pkg, configData.library);
        merge(configData.esbuild, {
            entryPoints: cliArgs.entryPoints,
            outfile: cliArgs.outfile,
        });

        return configData;

    }
}