import type { Command } from '../types/index.js';
import { runAllChecks, detectPackageManager, buildInstallCommand } from '../utils/check-system-deps.js';

interface CheckOptions {
    json: boolean;
}

export const checkCommand: Command<any, CheckOptions> = {
    command: 'check',
    description: 'Check that required system dependencies (GJS, GTK4, libsoup3, …) are installed. Optional dependencies are detected only when their @gjsify/* package is in your project.',
    builder: (yargs) => {
        return yargs
            .option('json', {
                description: 'Output results as JSON',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const results = runAllChecks(process.cwd());
        const pm = detectPackageManager();
        const missingRequired = results.filter(r => !r.found && r.severity === 'required');
        const missingOptional = results.filter(r => !r.found && r.severity === 'optional');
        const allMissing = [...missingRequired, ...missingOptional];

        if (args.json) {
            console.log(JSON.stringify({ packageManager: pm, deps: results }, null, 2));
            // Only required deps influence the exit code.
            process.exit(missingRequired.length > 0 ? 1 : 0);
            return;
        }

        console.log('System dependency check\n');

        const required = results.filter(r => r.severity === 'required');
        const optional = results.filter(r => r.severity === 'optional');

        if (required.length > 0) {
            console.log('Required:');
            for (const dep of required) {
                const icon = dep.found ? '✓' : '✗';
                const ver = dep.version ? `  (${dep.version})` : '';
                console.log(`  ${icon}  ${dep.name}${ver}`);
            }
        }

        if (optional.length > 0) {
            console.log('\nOptional:');
            for (const dep of optional) {
                // ⚠ for missing-but-needed-by-installed-packages, ○ for missing-but-not-needed (shouldn't appear in conditional mode)
                const icon = dep.found ? '✓' : '⚠';
                const ver = dep.version ? `  (${dep.version})` : '';
                const requiredBy = dep.requiredBy && dep.requiredBy.length > 0
                    ? `  — needed by ${dep.requiredBy.join(', ')}`
                    : '';
                console.log(`  ${icon}  ${dep.name}${ver}${requiredBy}`);
            }
        }

        console.log(`\nPackage manager: ${pm}`);

        if (allMissing.length === 0) {
            console.log('\nAll dependencies found.');
            return;
        }

        if (missingRequired.length > 0) {
            console.log(`\nMissing required: ${missingRequired.map(d => d.name).join(', ')}`);
        }
        if (missingOptional.length > 0) {
            console.log(`Missing optional: ${missingOptional.map(d => d.name).join(', ')}`);
        }

        const cmd = buildInstallCommand(pm, allMissing);
        if (cmd) {
            console.log(`\nTo install:\n  ${cmd}`);
        } else {
            console.log('\nNo install command available for your package manager. Install manually.');
        }

        // Exit non-zero ONLY if a required dependency is missing.
        // Optional deps that are missing but needed by an installed @gjsify/*
        // package generate a warning but keep exit code 0 — the user can still
        // build/run code paths that don't touch the optional library.
        process.exit(missingRequired.length > 0 ? 1 : 0);
    },
};
