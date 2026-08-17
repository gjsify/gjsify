// `gjsify prune` — remove installed packages this target cannot use.
//
// The repair half of ADR 0025. `install`/`self-update` prune what they would not
// have placed, but only going forward: a prefix that accreted foreign-platform
// packages under an older CLI is only reachable by asking. That is this command,
// and it is why it exists at all rather than the automatic pass alone.
//
// `--os/--cpu/--libc` are accepted here and deliberately NOT honoured by the
// automatic pass: typed on `prune` they are a request ("show me what a darwin-arm64
// host could not use"), while inherited by an install they would delete the host's
// own packages. See `automaticPruneRefusal`.

import { existsSync } from 'node:fs';
import type { Command } from '../types/index.js';
import { acquireInstallLock } from '../utils/install-lock.js';
import { defaultGlobalLayout } from '../utils/install-global.js';
import { resolveHostPlatform } from '../utils/platform-check.js';
import { executePrune, formatPruneReport, planPrune } from '../utils/prune-prefix.js';

interface PruneOptions {
    global: boolean;
    dryRun: boolean;
    verbose: boolean;
    os?: string;
    cpu?: string;
    libc?: string;
}

export const pruneCommand: Command<unknown, PruneOptions> = {
    command: 'prune',
    description:
        'Remove installed packages this host cannot use (foreign os/cpu/libc). ' +
        'Reads each package manifest — a package that declares no platform is never touched.',
    builder: (yargs) =>
        yargs
            .option('global', {
                description: 'Prune the user-global XDG prefix (the `install -g` target) instead of the project.',
                type: 'boolean',
                alias: 'g',
                default: false,
            })
            .option('dry-run', {
                description: 'Report what would be removed without touching the filesystem.',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'List every package rather than the first few.',
                type: 'boolean',
                default: false,
            })
            .option('os', {
                description: 'Prune AS IF the host were this OS (linux, darwin, win32). Defaults to this host.',
                type: 'string',
            })
            .option('cpu', {
                description: 'Prune AS IF the host were this architecture (x64, arm64, …). Defaults to this host.',
                type: 'string',
            })
            .option('libc', {
                description: 'Prune AS IF the host used this libc (glibc, musl). Defaults to this host.',
                type: 'string',
            }),
    handler: async (args) => {
        const layout = args.global ? defaultGlobalLayout() : null;
        const prefix = layout ? layout.prefix : process.cwd();

        if (!existsSync(`${prefix}/node_modules`)) {
            console.log(`gjsify prune: nothing installed at ${prefix}`);
            return;
        }

        // The flags are read HERE rather than through the npm config keys, so the
        // automatic pass — which refuses to act on an overridden target — cannot be
        // reached by way of this command's own options.
        const target = resolveHostPlatform({
            env: {
                ...(args.os ? { npm_config_os: args.os } : {}),
                ...(args.cpu ? { npm_config_cpu: args.cpu } : {}),
                ...(args.libc ? { npm_config_libc: args.libc } : {}),
            },
        });

        // A prune racing an install's extract would delete a half-written tree. The
        // lock is the same one every writer of this prefix takes (ADR 0001).
        const lock = await acquireInstallLock(prefix, {});
        let result;
        try {
            result = executePrune(planPrune({ prefix, target }), { dryRun: args.dryRun });
        } finally {
            lock.release();
        }

        console.log(formatPruneReport(result, { dryRun: args.dryRun, verbose: args.verbose }));

        // Removing nothing is a SUCCESS — idempotent housekeeping, unlike `uninstall`
        // where naming a package that is not there is a mistake worth reporting. Only
        // a removal the user asked for and did not get is a failure.
        if (result.failed.length > 0) return process.exit(1);
    },
};
