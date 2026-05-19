// `gjsify flatpak sync-flathub` — sync the per-app Flathub tracking-repo.
//
// Flathub distributes each app via a separate `flathub/<app-id>` repo
// whose manifest pins a specific git tag + commit-SHA of the upstream
// source. After cutting a new release in the source repo, the Flathub
// repo's manifest needs to be updated to reference the new tag/commit.
// This command automates that workflow:
//
//   1. Resolve appId + flathub-repo (from gjsify.flatpak config / flags)
//   2. Resolve --version (explicit flag or `git describe --tags --abbrev=0`)
//   3. Resolve commit SHA via `git rev-list -n 1 <version>`
//   4. Clone (or update) the flathub tracking-repo into $XDG_CACHE_HOME
//   5. Surgically edit the manifest: modules[].sources[].{tag,commit}
//      plus x-checker-data block (inject if missing)
//   6. Create a branch, commit the changes
//   7. (unless --no-pr) push + open a PR via `gh pr create`

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { Command, ConfigData } from '../../types/index.js';
import { Config } from '../../config.js';
import { readPackageJson } from './utils.js';

const execFileAsync = promisify(execFile);

interface SyncFlathubOptions {
    version?: string;
    appId?: string;
    flathubRepo?: string;
    commit?: string;
    branch?: string;
    sourceIndex?: number;
    pr?: boolean;
    dryRun?: boolean;
    verbose?: boolean;
}

interface FlathubManifestSource {
    type?: string;
    url?: string;
    tag?: string;
    commit?: string;
    'x-checker-data'?: Record<string, unknown>;
    [key: string]: unknown;
}

interface FlathubManifestModule {
    name?: string;
    sources?: FlathubManifestSource[];
    [key: string]: unknown;
}

interface FlathubManifest {
    id?: string;
    modules?: FlathubManifestModule[];
    [key: string]: unknown;
}

export const flatpakSyncFlathubCommand: Command<unknown, SyncFlathubOptions> = {
    command: 'sync-flathub',
    description:
        'Update the per-app Flathub tracking-repo manifest to a new git tag + commit. Clones, edits, commits, optionally opens a PR.',
    builder: (yargs) => {
        return yargs
            // Disable yargs' built-in `--version` (which would otherwise
            // print the package version) so this command's `--version
            // <tag>` flag works.
            .version(false)
            .option('version', {
                description: 'Git tag to sync to. Default: `git describe --tags --abbrev=0` in cwd.',
                type: 'string',
            })
            .option('app-id', {
                description: 'Reverse-DNS app id. Default: `gjsify.flatpak.appId`.',
                type: 'string',
            })
            .option('flathub-repo', {
                description: 'Flathub tracking-repo (owner/name). Default: `flathub/<appId>`.',
                type: 'string',
            })
            .option('commit', {
                description: 'Commit SHA to pin. Default: resolved via `git rev-list -n 1 <version>` in cwd.',
                type: 'string',
            })
            .option('branch', {
                description: 'Branch name in the flathub-repo. Default: `update-to-<version>`.',
                type: 'string',
            })
            .option('source-index', {
                description:
                    'Index into modules[0].sources[] to update (when manifest has multiple sources). Default: first `type: git` source.',
                type: 'number',
            })
            .option('pr', {
                description:
                    'After commit + push, open a PR via `gh pr create`. Pass `--no-pr` to skip and stop after push.',
                type: 'boolean',
                default: true,
            })
            .option('dry-run', {
                description: 'Show what would be edited; touch no files, run no git commands.',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'Echo every git / gh invocation before running.',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = process.cwd();
        const cfg = new Config();
        const configData = await cfg.forBuild({} as never).catch(() => ({} as ConfigData));
        const flatpak = configData.flatpak ?? {};

        const appId =
            (args.appId as string | undefined) ??
            flatpak.appId ??
            (readPackageJson(cwd).name as string | undefined);
        if (!appId) {
            throw new Error(
                '[gjsify flatpak sync-flathub] no app id available — pass --app-id or set gjsify.flatpak.appId.',
            );
        }

        const flathubRepo =
            (args.flathubRepo as string | undefined) ??
            flatpak.flathubRepo ??
            `flathub/${appId}`;

        const version = (args.version as string | undefined) ?? (await resolveLatestTag(cwd, args.verbose));
        if (!version) {
            throw new Error(
                '[gjsify flatpak sync-flathub] no version resolved — pass --version vX.Y.Z or create a git tag locally.',
            );
        }

        const commitSha =
            (args.commit as string | undefined) ?? (await resolveCommitForTag(cwd, version, args.verbose));

        const branch = (args.branch as string | undefined) ?? `update-to-${normaliseBranchSegment(version)}`;

        console.log(`[gjsify flatpak sync-flathub] appId=${appId}`);
        console.log(`[gjsify flatpak sync-flathub] flathubRepo=${flathubRepo}`);
        console.log(`[gjsify flatpak sync-flathub] version=${version}`);
        console.log(`[gjsify flatpak sync-flathub] commit=${commitSha}`);
        console.log(`[gjsify flatpak sync-flathub] branch=${branch}`);

        if (args.dryRun) {
            console.log(`[gjsify flatpak sync-flathub] --dry-run set; not cloning / writing / pushing.`);
            return;
        }

        const cacheRoot = flathubCacheRoot();
        const cloneDir = join(cacheRoot, flathubRepo.replace('/', '__'));
        mkdirSync(cacheRoot, { recursive: true });

        await ensureClone(cloneDir, flathubRepo, args.verbose);
        const manifestPath = join(cloneDir, `${appId}.json`);
        if (!existsSync(manifestPath)) {
            throw new Error(
                `[gjsify flatpak sync-flathub] Flathub manifest not found at ${manifestPath} — wrong appId / wrong flathub-repo?`,
            );
        }

        const original = readFileSync(manifestPath, 'utf-8');
        const updated = editManifest(original, {
            tag: version,
            commit: commitSha,
            sourceIndex: args.sourceIndex,
        });
        if (updated === original) {
            console.log(`[gjsify flatpak sync-flathub] manifest already at ${version} — nothing to do.`);
            return;
        }
        writeFileSync(manifestPath, updated, 'utf-8');
        console.log(`[gjsify flatpak sync-flathub] manifest patched at ${manifestPath}`);

        await gitInRepo(cloneDir, ['checkout', '-B', branch], args.verbose);
        await gitInRepo(cloneDir, ['add', '.'], args.verbose);
        await gitInRepo(cloneDir, ['commit', '-m', `Update to ${version}`], args.verbose);

        if (args.pr === false) {
            console.log(`[gjsify flatpak sync-flathub] --no-pr set; branch ${branch} committed locally in ${cloneDir}.`);
            return;
        }

        await gitInRepo(cloneDir, ['push', '-u', 'origin', branch, '--force-with-lease'], args.verbose);
        const prBody = `Auto-generated by \`gjsify flatpak sync-flathub\`.\n\n- Version: \`${version}\`\n- Commit: \`${commitSha}\`\n`;
        await ghCreate(cloneDir, flathubRepo, branch, version, prBody, args.verbose);
    },
};

// ─── Internal helpers ────────────────────────────────────────────────────

async function resolveLatestTag(cwd: string, verbose?: boolean): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync('git', ['describe', '--tags', '--abbrev=0'], { cwd });
        if (verbose) console.log(`[gjsify flatpak sync-flathub] resolved latest tag → ${stdout.trim()}`);
        return stdout.trim() || null;
    } catch {
        return null;
    }
}

async function resolveCommitForTag(cwd: string, tag: string, verbose?: boolean): Promise<string> {
    try {
        const { stdout } = await execFileAsync('git', ['rev-list', '-n', '1', tag], { cwd });
        const sha = stdout.trim();
        if (!sha) throw new Error(`empty rev-list output`);
        if (verbose) console.log(`[gjsify flatpak sync-flathub] resolved ${tag} → ${sha}`);
        return sha;
    } catch (err: any) {
        throw new Error(
            `[gjsify flatpak sync-flathub] tag ${tag} not found locally. Run \`git fetch --tags\` or pass --commit <sha>.\n` +
                `  underlying error: ${err?.message ?? err}`,
        );
    }
}

function normaliseBranchSegment(version: string): string {
    return version.replace(/^v/, '').replace(/[^A-Za-z0-9._-]/g, '-');
}

function flathubCacheRoot(): string {
    const base = process.env.XDG_CACHE_HOME || join(homedir(), '.cache');
    return join(base, 'gjsify', 'flathub-sync');
}

async function ensureClone(cloneDir: string, flathubRepo: string, verbose?: boolean): Promise<void> {
    if (existsSync(join(cloneDir, '.git'))) {
        if (verbose) console.log(`[gjsify flatpak sync-flathub] reusing clone at ${cloneDir}`);
        // Hard-reset to remote HEAD to clear stale state from a previous run
        await gitInRepo(cloneDir, ['fetch', 'origin'], verbose);
        const defaultBranch = await detectDefaultBranch(cloneDir, verbose);
        await gitInRepo(cloneDir, ['checkout', defaultBranch], verbose);
        await gitInRepo(cloneDir, ['reset', '--hard', `origin/${defaultBranch}`], verbose);
        return;
    }
    mkdirSync(resolve(cloneDir, '..'), { recursive: true });
    const url = `https://github.com/${flathubRepo}.git`;
    if (verbose) console.log(`[gjsify flatpak sync-flathub] git clone ${url} ${cloneDir}`);
    try {
        await execFileAsync('git', ['clone', url, cloneDir]);
    } catch (err: any) {
        if (err?.code === 'ENOENT') {
            throw new Error(
                '[gjsify flatpak sync-flathub] `git` not found. Install git from your distro (Fedora: `dnf install git`, Debian: `apt install git`).',
            );
        }
        throw err;
    }
}

async function detectDefaultBranch(cloneDir: string, verbose?: boolean): Promise<string> {
    // Most flathub repos use `master`; some newer ones use `main`. Probe
    // via `git remote show` which surfaces the HEAD branch.
    try {
        const { stdout } = await execFileAsync('git', ['remote', 'show', 'origin'], { cwd: cloneDir });
        const m = stdout.match(/HEAD branch: (\S+)/);
        if (m && m[1] && m[1] !== '(unknown)') {
            if (verbose) console.log(`[gjsify flatpak sync-flathub] default branch → ${m[1]}`);
            return m[1];
        }
    } catch {
        // fall through to master fallback
    }
    return 'master';
}

function gitInRepo(cwd: string, args: string[], verbose?: boolean): Promise<void> {
    if (verbose) console.log(`[gjsify flatpak sync-flathub] git ${args.join(' ')} (in ${cwd})`);
    return new Promise((res, rej) => {
        const child = spawn('git', args, { cwd, stdio: 'inherit' });
        child.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                rej(
                    new Error(
                        '[gjsify flatpak sync-flathub] `git` not found. Install it from your distro.',
                    ),
                );
            } else {
                rej(err);
            }
        });
        child.on('exit', (code) => {
            if (code === 0) res();
            else rej(new Error(`git ${args[0]} exited ${code}`));
        });
    });
}

function ghCreate(
    cloneDir: string,
    flathubRepo: string,
    branch: string,
    version: string,
    body: string,
    verbose?: boolean,
): Promise<void> {
    const args = [
        'pr',
        'create',
        '--repo',
        flathubRepo,
        '--head',
        branch,
        '--title',
        `Update to ${version}`,
        '--body',
        body,
    ];
    if (verbose) console.log(`[gjsify flatpak sync-flathub] gh ${args.join(' ')} (in ${cloneDir})`);
    return new Promise((res, rej) => {
        const child = spawn('gh', args, { cwd: cloneDir, stdio: 'inherit' });
        child.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
                rej(
                    new Error(
                        '[gjsify flatpak sync-flathub] `gh` (GitHub CLI) not found. Install via `dnf install gh` (Fedora), `apt install gh` (Debian/Ubuntu), or `flatpak install -y flathub com.github.cli`.',
                    ),
                );
            } else {
                rej(err);
            }
        });
        child.on('exit', (code) => {
            if (code === 0) res();
            else rej(new Error(`gh pr create exited ${code}`));
        });
    });
}

/**
 * Surgically edit a Flathub manifest to update the git source's `tag` +
 * `commit` (and inject `x-checker-data` if missing). Preserves the
 * original indent + whitespace + key ordering of the surrounding JSON
 * by parsing through JSON.parse + re-stringifying with the detected
 * indent.
 */
export function editManifest(
    original: string,
    args: { tag: string; commit: string; sourceIndex?: number },
): string {
    const manifest: FlathubManifest = JSON.parse(original);
    const modules = manifest.modules ?? [];
    if (modules.length === 0) {
        throw new Error('[gjsify flatpak sync-flathub] manifest has no modules');
    }
    const mainModule = modules[0]!;
    const sources = mainModule.sources ?? [];
    if (sources.length === 0) {
        throw new Error('[gjsify flatpak sync-flathub] modules[0] has no sources');
    }

    let idx = args.sourceIndex ?? sources.findIndex((s) => s.type === 'git');
    if (idx < 0 || idx >= sources.length) {
        throw new Error(
            `[gjsify flatpak sync-flathub] no git source found in modules[0].sources (use --source-index <n>)`,
        );
    }
    const source = sources[idx]!;
    if (source.type !== 'git') {
        throw new Error(
            `[gjsify flatpak sync-flathub] modules[0].sources[${idx}].type is "${source.type}", expected "git"`,
        );
    }

    source.tag = args.tag;
    source.commit = args.commit;
    if (!source['x-checker-data']) {
        source['x-checker-data'] = {
            type: 'git',
            'tag-pattern': '^v(\\d+\\.\\d+\\.\\d+)$',
            'version-scheme': 'semantic',
        };
    }

    // Detect the original indent (2 vs 4 spaces) by inspecting the second
    // line — Flathub manifests are all 2-space in practice, but some
    // older ones might be 4. Preserve original convention.
    const indent = detectIndent(original);
    return JSON.stringify(manifest, null, indent) + (original.endsWith('\n') ? '\n' : '');
}

function detectIndent(json: string): number {
    const match = json.match(/^\{\n( +)/);
    if (match) return match[1]!.length;
    return 2;
}
