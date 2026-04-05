import type { Command } from '../types/index.js';
import { discoverShowcases, findShowcase } from '../utils/discover-showcases.js';
import { runMinimalChecks, checkGwebgl, detectPackageManager, buildInstallCommand } from '../utils/check-system-deps.js';
import { runGjsBundle } from '../utils/run-gjs.js';

interface ShowcaseOptions {
    name?: string;
    json: boolean;
    list: boolean;
}

export const showcaseCommand: Command<any, ShowcaseOptions> = {
    command: 'showcase [name]',
    description: 'List or run built-in gjsify showcase applications.',
    builder: (yargs) => {
        return yargs
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
            });
    },
    handler: async (args) => {
        // List mode: no name given, or --list flag
        if (!args.name || args.list) {
            const showcases = discoverShowcases();

            if (args.json) {
                console.log(JSON.stringify(showcases, null, 2));
                return;
            }

            if (showcases.length === 0) {
                console.log('No showcases found. Showcase packages may not be installed.');
                return;
            }

            // Group by category
            const grouped = new Map<string, typeof showcases>();
            for (const sc of showcases) {
                const list = grouped.get(sc.category) ?? [];
                list.push(sc);
                grouped.set(sc.category, list);
            }

            console.log('Available gjsify showcases:\n');
            for (const [category, list] of grouped) {
                console.log(`  ${category.toUpperCase()}:`);
                const maxNameLen = Math.max(...list.map(e => e.name.length));
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

        // Run mode: find the showcase
        const showcase = findShowcase(args.name);
        if (!showcase) {
            console.error(`Unknown showcase: "${args.name}"`);
            console.error('Run "gjsify showcase" to list available showcases.');
            process.exit(1);
        }

        // System dependency check before running — only check what this showcase needs.
        // All showcases need GJS; WebGL showcases additionally need gwebgl prebuilds.
        const results = runMinimalChecks();
        const needsWebgl = showcase.packageName.includes('webgl') || showcase.packageName.includes('three');
        if (needsWebgl) {
            results.push(checkGwebgl(process.cwd()));
        }
        const missing = results.filter(r => !r.found);
        if (missing.length > 0) {
            console.error('Missing system dependencies:\n');
            for (const dep of missing) {
                console.error(`  ✗  ${dep.name}`);
            }
            const pm = detectPackageManager();
            const cmd = buildInstallCommand(pm, missing);
            if (cmd) {
                console.error(`\nInstall with:\n  ${cmd}`);
            }
            process.exit(1);
        }

        // Run the showcase via shared GJS runner
        console.log(`Running showcase: ${showcase.name}\n`);
        await runGjsBundle(showcase.bundlePath);
    },
};
