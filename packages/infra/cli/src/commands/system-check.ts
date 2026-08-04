import type { Command } from '../types/index.js';
import { runAllChecks, detectPackageManager, buildInstallCommand, checkTypeSkew } from '../utils/check-system-deps.js';

interface CheckOptions {
    json: boolean;
}

export const systemCheckCommand: Command<unknown, CheckOptions> = {
    command: 'system-check',
    description:
        'Check that required system dependencies (GJS, GTK4, libsoup3, …) are installed. Optional dependencies are detected only when their @gjsify/* package is in your project. (Previously called `gjsify check`; the bare name now runs TypeScript checks across the workspace — see `gjsify check --help`.)',
    builder: (yargs) => {
        return yargs.option('json', {
            description: 'Output results as JSON',
            type: 'boolean',
            default: false,
        });
    },
    handler: async (args) => {
        const results = runAllChecks(process.cwd());
        const pm = detectPackageManager();
        const typeSkew = checkTypeSkew(process.cwd());
        const missingRequired = results.filter((r) => !r.found && r.severity === 'required');
        const missingOptional = results.filter((r) => !r.found && r.severity === 'optional');
        const allMissing = [...missingRequired, ...missingOptional];

        if (args.json) {
            console.log(JSON.stringify({ packageManager: pm, deps: results, typeSkew }, null, 2));
            // Only required deps influence the exit code.
            return process.exit(missingRequired.length > 0 ? 1 : 0);
        }

        console.log('System dependency check\n');

        const required = results.filter((r) => r.severity === 'required');
        const optional = results.filter((r) => r.severity === 'optional');

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
                const requiredBy =
                    dep.requiredBy && dep.requiredBy.length > 0 ? `  — needed by ${dep.requiredBy.join(', ')}` : '';
                console.log(`  ${icon}  ${dep.name}${ver}${requiredBy}`);
            }
        }

        // Printed BEFORE the all-found early return: a version skew is invisible to
        // the presence checks by construction (both sides are installed and both
        // report a version), so "All dependencies found." is exactly the message it
        // would otherwise hide behind.
        if (typeSkew.length > 0) {
            console.log('\nType/runtime version skew:');
            for (const skew of typeSkew) {
                const arrow = skew.relation === 'ahead' ? '⚠' : 'ℹ';
                console.log(
                    `  ${arrow}  ${skew.typePackage} describes ${skew.declared}, ` +
                        `installed ${skew.pkgConfig} is ${skew.installed}`,
                );
            }
            if (typeSkew.some((skew) => skew.relation === 'ahead')) {
                console.log(
                    '\n  ⚠ types are AHEAD of the installed library: code using newer API\n' +
                        '    type-checks and then fails at runtime with an undefined property.\n' +
                        '    Either install the matching library version, or pin the older\n' +
                        '    @girs/* release. GIRepository cannot detect this — it matches the\n' +
                        '    API version (e.g. 4.0) only, so any 4.x typelib satisfies gi://Gtk.',
                );
            }
        }

        console.log(`\nPackage manager: ${pm}`);

        if (allMissing.length === 0) {
            console.log('\nAll dependencies found.');
            return;
        }

        if (missingRequired.length > 0) {
            console.log(`\nMissing required: ${missingRequired.map((d) => d.name).join(', ')}`);
        }
        if (missingOptional.length > 0) {
            console.log(`Missing optional: ${missingOptional.map((d) => d.name).join(', ')}`);
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
