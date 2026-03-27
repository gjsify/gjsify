import { resolve } from 'node:path';
import type { Command } from '../types/index.js';
import { detectNativePackages, buildNativeEnv } from '../utils/detect-native-packages.js';

interface InfoOptions {
    export: boolean;
    file?: string;
}

export const infoCommand: Command<any, InfoOptions> = {
    command: 'info [file]',
    description: 'Show native gjsify packages detected in node_modules and the env vars needed to run a GJS bundle directly with gjs.',
    builder: (yargs) => {
        return yargs
            .positional('file', {
                description: 'Optional: the GJS bundle path to include in the example command (e.g. dist/gjs.js)',
                type: 'string',
                normalize: true,
            })
            .option('export', {
                description: 'Output only shell export statements suitable for eval (eval $(gjsify info --export))',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = process.cwd();
        const file = args.file ? resolve(args.file as string) : null;
        const nativePackages = detectNativePackages(cwd);
        const { LD_LIBRARY_PATH, GI_TYPELIB_PATH } = buildNativeEnv(nativePackages);

        if (args.export) {
            // Machine-readable output for eval
            console.log(`export LD_LIBRARY_PATH="${LD_LIBRARY_PATH}"`);
            console.log(`export GI_TYPELIB_PATH="${GI_TYPELIB_PATH}"`);
            return;
        }

        // Human-readable output
        if (nativePackages.length === 0) {
            console.log('No native gjsify packages detected in node_modules.');
            console.log('Native packages declare "gjsify": { "prebuilds": "<dir>" } in their package.json.');
            return;
        }

        console.log('Native packages detected:');
        for (const pkg of nativePackages) {
            console.log(`  ${pkg.name}  →  ${pkg.prebuildsDir}`);
        }

        console.log('');
        console.log('To run your app directly with gjs, set:');
        console.log(`  export LD_LIBRARY_PATH="${LD_LIBRARY_PATH}"`);
        console.log(`  export GI_TYPELIB_PATH="${GI_TYPELIB_PATH}"`);

        if (file) {
            console.log(`  gjs -m ${file}`);
        } else {
            console.log('  gjs -m <your-bundle.js>');
        }

        console.log('');
        console.log('Or use gjsify run to handle this automatically:');
        if (file) {
            console.log(`  gjsify run ${args.file}`);
        } else {
            console.log('  gjsify run <your-bundle.js>');
        }
    },
};
