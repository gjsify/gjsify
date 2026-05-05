import type { Command } from '../types/index.js';
import { discoverShowcases, findShowcase } from '../utils/discover-showcases.js';
import {
    runMinimalChecks,
    checkGwebgl,
    detectPackageManager,
    buildInstallCommand,
} from '../utils/check-system-deps.js';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

interface ShowcaseOptions {
    name?: string;
    json: boolean;
    list: boolean;
}

export const showcaseCommand: Command<any, ShowcaseOptions> = {
    command: 'showcase [name]',
    description: 'List or run curated gjsify showcase applications.',
    builder: (yargs) =>
        yargs
            .positional('name', {
                description: 'Showcase name to run (omit to list all)',
                type: 'string',
            })
            .option('json', {
                description: 'Output as JSON',
                type: 'boolean',
                default: false,
            })
            .option('list', {
                description: 'List available showcases',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
        // List mode: no name given, or --list flag
        if (!args.name || args.list) {
            const showcases = discoverShowcases();

            if (args.json) {
                console.log(JSON.stringify(showcases, null, 2));
                return;
            }

            if (showcases.length === 0) {
                console.log('No showcases found. The CLI ships a curated list in `showcases.json`; if it is missing the CLI install is incomplete.');
                return;
            }

            const grouped = new Map<string, typeof showcases>();
            for (const sc of showcases) {
                const list = grouped.get(sc.category) ?? [];
                list.push(sc);
                grouped.set(sc.category, list);
            }

            console.log('Available gjsify showcases:\n');
            for (const [category, list] of grouped) {
                console.log(`  ${category.toUpperCase()}:`);
                const maxNameLen = Math.max(...list.map((e) => e.name.length));
                for (const sc of list) {
                    const pad = ' '.repeat(maxNameLen - sc.name.length + 2);
                    const desc = sc.description ? `${pad}${sc.description}` : '';
                    console.log(`    ${sc.name}${desc}`);
                }
                console.log('');
            }

            console.log('Run a showcase:  gjsify showcase <name>');
            return;
        }

        const showcase = findShowcase(args.name);
        if (!showcase) {
            console.error(`Unknown showcase: "${args.name}"`);
            console.error('Run "gjsify showcase" to list available showcases.');
            process.exit(1);
        }

        // System dependency check before delegating — only what this showcase needs.
        const results = runMinimalChecks();
        if (showcase.needsWebgl) {
            results.push(checkGwebgl(process.cwd()));
        }
        const missingHard = results.filter(
            (r) => !r.found && (r.severity === 'required' || r.id === 'gwebgl'),
        );
        if (missingHard.length > 0) {
            console.error('Missing system dependencies:\n');
            for (const dep of missingHard) {
                console.error(`  ✗  ${dep.name}`);
            }
            const pm = detectPackageManager();
            const cmd = buildInstallCommand(pm, missingHard);
            if (cmd) {
                console.error(`\nInstall with:\n  ${cmd}`);
            }
            process.exit(1);
        }

        // Delegate to `gjsify dlx <package>` — same npm-cache, same atomic
        // symlink-swap, same `gjsify.main` resolution. Re-spawning the CLI
        // keeps the dlx logic in one place.
        console.log(`Running showcase: ${showcase.name} (via gjsify dlx)\n`);
        const cliBin = fileURLToPath(new URL('../index.js', import.meta.url));
        const child = spawn(process.execPath, [cliBin, 'dlx', showcase.packageName], {
            stdio: 'inherit',
        });
        await new Promise<void>((resolvePromise, reject) => {
            child.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`gjsify dlx exited with code ${code}`));
                } else {
                    resolvePromise();
                }
            });
            child.on('error', reject);
        }).catch((err) => {
            console.error(err.message);
            process.exit(1);
        });
    },
};
