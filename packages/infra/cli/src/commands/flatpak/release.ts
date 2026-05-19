// `gjsify flatpak release` — orchestrate the full release-to-Flathub flow.
//
// One command chains the same steps a maintainer otherwise runs by hand
// after cutting a release:
//   1. Regenerate Flathub assets from `gjsify.flatpak` config (delegates to
//      `gjsify flatpak init --force`)
//   2. Run Flathub linters (delegates to `gjsify flatpak check`)
//   3. Create + push the git tag (unless `--skip-tag`)
//   4. Sync the per-app Flathub tracking-repo (delegates to
//      `gjsify flatpak sync-flathub`)
//
// Each step shells out to the same CLI binary so the user sees identical
// behaviour to running the sub-commands directly. The orchestrator
// stops at the first failure and reports which step blocked, with a
// clear command the user can re-run by hand.

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import type { Command } from '../../types/index.js';

const execFileAsync = promisify(execFile);

interface ReleaseOptions {
    version: string;
    skipTag?: boolean;
    skipCheck?: boolean;
    skipInit?: boolean;
    pushTag?: boolean;
    dryRun?: boolean;
    flathubRepo?: string;
    verbose?: boolean;
}

export const flatpakReleaseCommand: Command<unknown, ReleaseOptions> = {
    command: 'release <version>',
    description:
        'Cut a release end-to-end: regenerate Flathub assets, run linters, create + push the git tag, then open the Flathub PR. Each step delegates to the equivalent `gjsify flatpak <sub>` command.',
    builder: (yargs) => {
        return yargs
            // yargs' built-in `--version` flag would otherwise consume the
            // positional value.
            .version(false)
            .positional('version', {
                description: 'Release tag, e.g. `v0.6.6`.',
                type: 'string',
                demandOption: true,
            })
            .option('skip-init', {
                description: 'Skip the `flatpak init --force` regen step.',
                type: 'boolean',
                default: false,
            })
            .option('skip-check', {
                description: 'Skip the `flatpak check` linter step.',
                type: 'boolean',
                default: false,
            })
            .option('skip-tag', {
                description:
                    'Skip the `git tag` + `git push --tags` step (use when the tag was already created out-of-band).',
                type: 'boolean',
                default: false,
            })
            .option('push-tag', {
                description: 'Push the created tag after creating it. Default: true.',
                type: 'boolean',
                default: true,
            })
            .option('flathub-repo', {
                description: 'Flathub tracking-repo override forwarded to sync-flathub.',
                type: 'string',
            })
            .option('dry-run', {
                description: 'Print each step that would run without executing any of them.',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'Echo every sub-command invocation.',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const version = typeof args.version === 'string' ? args.version.trim() : '';
        if (!version) {
            throw new Error('[gjsify flatpak release] missing <version> positional');
        }

        const cliEntry = resolveCliEntry();
        const cwd = process.cwd();

        const steps: Array<{ name: string; args: string[]; cwd?: string }> = [];
        if (!args.skipInit) {
            steps.push({ name: 'init', args: [cliEntry, 'flatpak', 'init', '--force'] });
        }
        if (!args.skipCheck) {
            steps.push({ name: 'check', args: [cliEntry, 'flatpak', 'check'] });
        }
        const syncArgs = [cliEntry, 'flatpak', 'sync-flathub', '--version', version];
        if (args.flathubRepo) syncArgs.push('--flathub-repo', args.flathubRepo as string);
        if (args.verbose) syncArgs.push('--verbose');

        console.log(`[gjsify flatpak release] starting release of ${version}`);
        if (args.dryRun) {
            console.log('[gjsify flatpak release] --dry-run set; printing plan only:');
            for (const s of steps) console.log(`  · ${s.name}: node ${s.args.join(' ')}`);
            if (!args.skipTag) console.log(`  · tag: git tag ${version}${args.pushTag !== false ? ' && git push origin ' + version : ''}`);
            console.log(`  · sync: node ${syncArgs.join(' ')}`);
            return;
        }

        // Run init + check in sequence (must succeed before any git mutation).
        for (const step of steps) {
            if (args.verbose) console.log(`[gjsify flatpak release] step ${step.name}: node ${step.args.join(' ')}`);
            await runNode(step.args, cwd);
            console.log(`[gjsify flatpak release] ${step.name} ✔`);
        }

        // Tag creation — only after init + check succeed so we don't end up
        // with a tag pointing at a broken release.
        if (!args.skipTag) {
            if (args.verbose) console.log(`[gjsify flatpak release] git tag ${version}`);
            try {
                await execFileAsync('git', ['tag', version], { cwd });
                console.log(`[gjsify flatpak release] tag ${version} created`);
            } catch (err) {
                throw new Error(
                    `[gjsify flatpak release] git tag failed (${(err as Error).message}). ` +
                        `If the tag already exists, re-run with --skip-tag.`,
                );
            }
            if (args.pushTag !== false) {
                if (args.verbose) console.log(`[gjsify flatpak release] git push origin ${version}`);
                await execFileAsync('git', ['push', 'origin', version], { cwd });
                console.log(`[gjsify flatpak release] tag pushed`);
            }
        }

        // Sync flathub last.
        if (args.verbose) console.log(`[gjsify flatpak release] sync: node ${syncArgs.join(' ')}`);
        await runNode(syncArgs, cwd);
        console.log(`[gjsify flatpak release] ✅ release ${version} complete`);
    },
};

/** Resolve a path to the gjsify CLI entry to invoke sub-commands. */
function resolveCliEntry(): string {
    // `commands/flatpak/release.ts` → compiled into
    // `lib/commands/flatpak/release.js`. The CLI entry is `lib/index.js`.
    const here = fileURLToPath(import.meta.url);
    const cliRoot = resolve(dirname(here), '..', '..');
    return resolve(cliRoot, 'index.js');
}

/** Spawn `node <args>` and reject on non-zero exit. */
async function runNode(args: string[], cwd: string): Promise<void> {
    await new Promise<void>((resolvePromise, reject) => {
        const child = spawn('node', args, { cwd, stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) resolvePromise();
            else reject(new Error(`sub-command exited with code ${code}: node ${args.join(' ')}`));
        });
    });
}
