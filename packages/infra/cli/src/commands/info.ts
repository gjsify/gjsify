import { resolve } from 'node:path';
import type { Command } from '../types/index.js';
import { detectNativePackages, buildNativeEnv } from '../utils/detect-native-packages.js';

interface InfoOptions {
    export: boolean;
    file?: string;
}

export const infoCommand: Command<unknown, InfoOptions> = {
    command: 'info [file]',
    description:
        'Show native gjsify packages detected in node_modules and the env vars needed to run a GJS bundle directly with gjs.',
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
        // Which variables this yields is host-dependent: GI_TYPELIB_PATH
        // everywhere, plus the loader path variable the host actually consults
        // (LD_LIBRARY_PATH on Linux, DYLD_LIBRARY_PATH on macOS, PATH on
        // Windows). Iterate rather than destructuring two fixed names, or the
        // printed environment is wrong off Linux.
        const nativeEnv = buildNativeEnv(nativePackages);
        const envEntries = Object.entries(nativeEnv).filter(([, value]) => value !== undefined);

        if (args.export) {
            // Machine-readable output for eval
            for (const [key, value] of envEntries) console.log(`export ${key}="${value}"`);
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
        for (const [key, value] of envEntries) console.log(`  export ${key}="${value}"`);

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
