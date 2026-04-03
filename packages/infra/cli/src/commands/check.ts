import type { Command } from '../types/index.js';
import { runAllChecks, detectPackageManager, buildInstallCommand } from '../utils/check-system-deps.js';

interface CheckOptions {
    json: boolean;
}

export const checkCommand: Command<any, CheckOptions> = {
    command: 'check',
    description: 'Check that all required system dependencies (GJS, GTK4, Blueprint Compiler, etc.) are installed.',
    builder: (yargs) => {
        return yargs
            .option('json', {
                description: 'Output results as JSON',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = process.cwd();
        const results = runAllChecks(cwd);
        const pm = detectPackageManager();
        const missing = results.filter(r => !r.found);

        if (args.json) {
            console.log(JSON.stringify({ packageManager: pm, deps: results }, null, 2));
            process.exit(missing.length > 0 ? 1 : 0);
            return;
        }

        console.log('System dependency check\n');
        for (const dep of results) {
            const icon = dep.found ? '✓' : '✗';
            const ver = dep.version ? `  (${dep.version})` : '';
            console.log(`  ${icon}  ${dep.name}${ver}`);
        }

        console.log(`\nPackage manager: ${pm}`);

        if (missing.length === 0) {
            console.log('\nAll dependencies found.');
            return;
        }

        console.log(`\nMissing: ${missing.map(d => d.name).join(', ')}`);
        const cmd = buildInstallCommand(pm, missing);
        if (cmd) {
            console.log(`\nTo install missing dependencies:\n  ${cmd}`);
        } else {
            console.log('\nNo install command available for your package manager. Install manually.');
        }

        process.exit(1);
    },
};
