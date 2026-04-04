import type { Command } from '../types/index.js';
import { discoverExamples, findExample } from '../utils/discover-examples.js';
import { runMinimalChecks, checkGwebgl, detectPackageManager, buildInstallCommand } from '../utils/check-system-deps.js';
import { runGjsBundle } from '../utils/run-gjs.js';

interface ShowcaseOptions {
    name?: string;
    json: boolean;
    list: boolean;
}

export const showcaseCommand: Command<any, ShowcaseOptions> = {
    command: 'showcase [name]',
    description: 'List or run built-in gjsify example applications.',
    builder: (yargs) => {
        return yargs
            .positional('name', {
                description: 'Example name to run (omit to list all)',
                type: 'string',
            })
            .option('json', {
                description: 'Output as JSON',
                type: 'boolean',
                default: false,
            })
            .option('list', {
                description: 'List available examples',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        // List mode: no name given, or --list flag
        if (!args.name || args.list) {
            const examples = discoverExamples();

            if (args.json) {
                console.log(JSON.stringify(examples, null, 2));
                return;
            }

            if (examples.length === 0) {
                console.log('No examples found. Example packages may not be installed.');
                return;
            }

            // Group by category
            const grouped = new Map<string, typeof examples>();
            for (const ex of examples) {
                const list = grouped.get(ex.category) ?? [];
                list.push(ex);
                grouped.set(ex.category, list);
            }

            console.log('Available gjsify examples:\n');
            for (const [category, list] of grouped) {
                console.log(`  ${category.toUpperCase()}:`);
                const maxNameLen = Math.max(...list.map(e => e.name.length));
                for (const ex of list) {
                    const pad = ' '.repeat(maxNameLen - ex.name.length + 2);
                    const desc = ex.description ? `${pad}${ex.description}` : '';
                    console.log(`    ${ex.name}${desc}`);
                }
                console.log('');
            }

            console.log('Run an example:  gjsify showcase <name>');
            return;
        }

        // Run mode: find the example
        const example = findExample(args.name);
        if (!example) {
            console.error(`Unknown example: "${args.name}"`);
            console.error('Run "gjsify showcase" to list available examples.');
            process.exit(1);
        }

        // System dependency check before running — only check what this example needs.
        // All examples need GJS; WebGL examples additionally need gwebgl prebuilds.
        const results = runMinimalChecks();
        const needsWebgl = example.packageName.includes('webgl') || example.packageName.includes('three');
        if (needsWebgl) {
            results.push(checkGwebgl());
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

        // Run the example via shared GJS runner
        console.log(`Running example: ${example.name}\n`);
        await runGjsBundle(example.bundlePath);
    },
};
