import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Command } from '../types/index.js';

const execFileAsync = promisify(execFile);

interface GSettingsOptions {
    schemadir: string;
    targetdir?: string;
    strict?: boolean;
    verbose?: boolean;
}

export const gsettingsCommand: Command<any, GSettingsOptions> = {
    command: 'gsettings <schemadir>',
    description:
        'Compile GSettings schema XML files into a binary gschemas.compiled (wraps `glib-compile-schemas`).',
    builder: (yargs) => {
        return yargs
            .positional('schemadir', {
                description: 'Directory containing *.gschema.xml descriptors',
                type: 'string',
                normalize: true,
                demandOption: true,
            })
            .option('targetdir', {
                alias: 't',
                description:
                    'Directory to write gschemas.compiled (default: <schemadir>)',
                type: 'string',
                normalize: true,
            })
            .option('strict', {
                description:
                    'Abort on any schema warning (passes --strict to glib-compile-schemas)',
                type: 'boolean',
                default: true,
            })
            .option('verbose', {
                description: 'Print the underlying glib-compile-schemas invocation',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const schemadir = resolve(args.schemadir as string);
        const targetdir = args.targetdir
            ? resolve(args.targetdir as string)
            : schemadir;

        const cmdArgs: string[] = [];
        if (args.strict) cmdArgs.push('--strict');
        cmdArgs.push(`--targetdir=${targetdir}`);
        cmdArgs.push(schemadir);

        if (args.verbose) {
            console.log(`[gjsify gsettings] glib-compile-schemas ${cmdArgs.join(' ')}`);
        }

        // glib-compile-schemas writes a temporary file in `targetdir` before
        // renaming to gschemas.compiled — fails with ENOENT if missing.
        await mkdir(targetdir, { recursive: true });

        try {
            const { stdout, stderr } = await execFileAsync('glib-compile-schemas', cmdArgs);
            if (stdout) process.stdout.write(stdout);
            if (stderr) process.stderr.write(stderr);
            if (args.verbose) {
                console.log(`[gjsify gsettings] wrote ${targetdir}/gschemas.compiled`);
            }
        } catch (err: any) {
            if (err?.code === 'ENOENT') {
                console.error(
                    '[gjsify gsettings] glib-compile-schemas not found. Install it via your distro (package: glib2-devel / libglib2.0-dev).',
                );
            } else {
                if (err?.stderr) process.stderr.write(err.stderr);
                console.error(
                    `[gjsify gsettings] glib-compile-schemas failed${err?.code !== undefined ? ` (exit ${err.code})` : ''}`,
                );
            }
            process.exitCode = typeof err?.code === 'number' ? err.code : 1;
        }
    },
};
