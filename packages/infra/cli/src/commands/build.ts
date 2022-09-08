import { Config } from '../config.js';
import { BuildAction } from '../actions/build.js';
import type { Command, CliBuildOptions } from '../types/index.js';

export const buildCommand: Command<any, CliBuildOptions> = {
    command: 'build [entryPoints..]',
    description: 'Build and bundle your Gjs project',
    builder: (yargs) => {
        return yargs
            .option('entry-points', {
                description: "The entry points you want to bundle",
                array: true,
                type: 'string',
                normalize: true,
                default: ['src/index.ts'],
                coerce: (arg: string[]) => {
                    // Removes duplicates
                    return [...new Set(arg)];
                }
            })
            .option('platform', {
                description: "The platform you want to build your application for, the platforms node and deno are usually only used for tests",
                type: 'string',
                choices: ['gjs', 'node', 'deno'],
                normalize: true,
                default: 'gjs'
            })
            .option('library', {
                description: "Use this if you want to build a library for Gjsify",
                type: 'boolean',
                normalize: true,
                default: false
            })
            .option('outfile', {
                description: "Sets the output file name for the build operation. If no outfile is specified, the outfile will be parsed from the package.json",
                type: 'string',
                normalize: true,
            })
            .option('reflection', {
                description: "Enables TypeScript types on runtime",
                type: 'boolean',
                normalize: true,
                default: false
            })
    },
    handler: async (args) => {
        const config = new Config();
        const configData = await config.forBuild(args);
        const action = new BuildAction(configData);
        await action.start({
            library: args.library,
            platform: args.platform,
        })
    }
}