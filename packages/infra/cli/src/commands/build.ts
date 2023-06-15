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
            .option('exclude', {
                description: "An array of glob patterns to exclude entry-points and aliases",
                array: true,
                type: 'string',
                normalize: true,
                default: []
            })
            .option('verbose', {
                description: "Switch on the verbose mode",
                type: 'boolean',
                normalize: true,
                default: false
            })
            .option('app', {
                description: "Use this if you want to build a application, the application platforms node and deno are usually only used for tests",
                type: 'string',
                choices: ['gjs', 'node', 'deno', 'browser'],
                normalize: true,
                default: 'gjs'
            })
            .option('format', {
                description: "Override the default output format",
                type: 'string',
                choices: ['iife', 'esm', 'cjs'],
                normalize: true,
            })
            .option('minify', {
                description: "When enabled, the generated code will be minified instead of pretty-printed",
                type: 'boolean',
                normalize: true,
                default: false
            })
            .option('library', {
                description: "Use this if you want to build a library for Gjsify",
                type: 'boolean',
                normalize: true,
                default: false
            })
            .option('outfile', {
                alias: 'o',
                description: "Sets the output file name for the build operation. If no outfile is specified, the outfile will be parsed from the package.json. Only used if application mode is active",
                type: 'string',
                normalize: true,
            })
            .option('outdir', {
                alias: 'd',
                description: "Sets the output directory for the build operation. If no outdir is specified, the outdir will be parsed from the package.json. Only used if library mode is active",
                type: 'string',
                normalize: true,
            })
            .option('reflection', {
                alias: 'r',
                description: "Enables TypeScript types on runtime using Deepkit's type compiler",
                type: 'boolean',
                normalize: true,
                default: false
            })
            .option('log-level', {
                description: "The log level can be changed to prevent esbuild from printing warning and/or error messages to the terminal",
                type: 'string',
                choices: ['silent', 'error', 'warning', 'info', 'debug', 'verbose'],
                normalize: true,
                default: 'warning'
            })
    },
    handler: async (args) => {
        const config = new Config();
        const configData = await config.forBuild(args);
        const action = new BuildAction(configData);
        await action.start({
            library: args.library,
            app: args.app,
        })
    }
}