import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Command } from '../types/index.js';

const execFileAsync = promisify(execFile);

interface GResourceOptions {
    xml: string;
    sourcedir?: string;
    target?: string;
    verbose?: boolean;
}

/**
 * Derive a default `.gresource` target path from the XML descriptor.
 * `foo.gresource.xml` → `foo.gresource` in the same directory.
 */
function defaultTargetFor(xmlPath: string): string {
    const ext = extname(xmlPath);
    const stem = basename(xmlPath, ext);
    return resolve(dirname(xmlPath), stem);
}

export const gresourceCommand: Command<any, GResourceOptions> = {
    command: 'gresource <xml>',
    description:
        'Compile a GResource XML descriptor into a binary .gresource bundle (wraps `glib-compile-resources`).',
    builder: (yargs) => {
        return yargs
            .positional('xml', {
                description: 'Path to the .gresource.xml descriptor',
                type: 'string',
                normalize: true,
                demandOption: true,
            })
            .option('sourcedir', {
                description: 'Directory containing the resource files referenced by <xml>',
                type: 'string',
                normalize: true,
            })
            .option('target', {
                alias: 't',
                description: 'Output .gresource file (default: <xml-without-.xml> next to <xml>)',
                type: 'string',
                normalize: true,
            })
            .option('verbose', {
                description: 'Print the underlying glib-compile-resources invocation',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const xmlPath = resolve(args.xml as string);
        const target = args.target ? resolve(args.target as string) : defaultTargetFor(xmlPath);
        const sourcedir = args.sourcedir
            ? resolve(args.sourcedir as string)
            : dirname(xmlPath);

        const cmdArgs = [
            `--sourcedir=${sourcedir}`,
            `--target=${target}`,
            xmlPath,
        ];

        if (args.verbose) {
            console.log(`[gjsify gresource] glib-compile-resources ${cmdArgs.join(' ')}`);
        }

        // Ensure the target directory exists — glib-compile-resources writes
        // a temporary file next to the target and fails with ENOENT otherwise.
        await mkdir(dirname(target), { recursive: true });

        try {
            const { stdout, stderr } = await execFileAsync('glib-compile-resources', cmdArgs);
            if (stdout) process.stdout.write(stdout);
            if (stderr) process.stderr.write(stderr);
            if (args.verbose) {
                console.log(`[gjsify gresource] wrote ${target}`);
            }
        } catch (err: any) {
            if (err?.code === 'ENOENT') {
                console.error(
                    '[gjsify gresource] glib-compile-resources not found. Install it via your distro (package: glib2-devel / libglib2.0-dev).',
                );
            } else {
                if (err?.stderr) process.stderr.write(err.stderr);
                console.error(
                    `[gjsify gresource] glib-compile-resources failed${err?.code !== undefined ? ` (exit ${err.code})` : ''}`,
                );
            }
            process.exitCode = typeof err?.code === 'number' ? err.code : 1;
        }
    },
};
