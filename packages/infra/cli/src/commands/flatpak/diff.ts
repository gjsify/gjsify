// `gjsify flatpak diff` — report drift between the local config + git
// state and the per-app Flathub tracking-repo manifest.
//
// The most common failure mode is *version drift*: a release was cut
// locally (a new `git tag`), but the Flathub-repo manifest still pins
// the previous tag, so end-users on flatpak install never see the
// release. This command surfaces that drift before
// `gjsify flatpak sync-flathub` is needed (the symmetric command that
// fixes it).
//
// Workflow:
//   1. Resolve appId + flathub-repo (same precedence as sync-flathub)
//   2. Fetch the Flathub manifest (or read `--against <local>`)
//   3. Resolve the local latest git tag (`git describe --tags --abbrev=0`)
//   4. Compare module[0].sources's `tag` + `commit` to the local state
//   5. Exit 0 when in sync, 1 when there's drift, with a clear message

import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Command, ConfigData } from '../../types/index.js';
import { Config } from '../../config.js';
import { readPackageJson } from './utils.js';

const execFileAsync = promisify(execFile);

interface DiffOptions {
    version?: string;
    appId?: string;
    flathubRepo?: string;
    against?: string;
    detail?: boolean;
    sourceIndex?: number;
    verbose?: boolean;
}

interface FlathubSource {
    type?: string;
    tag?: string;
    commit?: string;
    [key: string]: unknown;
}

interface FlathubManifest {
    id?: string;
    modules?: Array<{ sources?: FlathubSource[] } | null>;
    [key: string]: unknown;
}

export const flatpakDiffCommand: Command<unknown, DiffOptions> = {
    command: 'diff',
    description:
        'Compare the per-app Flathub tracking-repo manifest against the local git state and report version / commit drift.',
    builder: (yargs) => {
        return yargs
            .version(false)
            .option('version', {
                description:
                    'Local version to compare against. Default: `git describe --tags --abbrev=0` in cwd.',
                type: 'string',
            })
            .option('app-id', {
                description: 'Reverse-DNS app id. Default: `gjsify.flatpak.appId`.',
                type: 'string',
            })
            .option('flathub-repo', {
                description:
                    'Flathub tracking-repo (owner/name). Default: `gjsify.flatpak.flathubRepo` or `flathub/<appId>`.',
                type: 'string',
            })
            .option('against', {
                description:
                    'Read the Flathub manifest from a local file instead of fetching it. Useful in CI or offline.',
                type: 'string',
            })
            .option('detail', {
                description:
                    'Also print the full Flathub manifest source entry alongside the resolved local version.',
                type: 'boolean',
                default: false,
            })
            .option('source-index', {
                description:
                    'Index into modules[0].sources[] to inspect (when the manifest has multiple sources).',
                type: 'number',
            })
            .option('verbose', {
                description: 'Echo fetch URL + resolved values.',
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
                '[gjsify flatpak diff] no app id available — pass --app-id or set gjsify.flatpak.appId.',
            );
        }

        const flathubRepo =
            (args.flathubRepo as string | undefined) ??
            flatpak.flathubRepo ??
            `flathub/${appId}`;

        const localVersion =
            (args.version as string | undefined) ?? (await resolveLatestTag(cwd, args.verbose));

        const remoteSource = await loadFlathubSource(
            { appId, flathubRepo, against: args.against, verbose: args.verbose },
            args.sourceIndex,
        );

        const remoteTag = remoteSource?.tag;
        const remoteCommit = remoteSource?.commit;

        console.log(`[gjsify flatpak diff] appId=${appId}`);
        console.log(`[gjsify flatpak diff] flathubRepo=${flathubRepo}`);
        console.log(`[gjsify flatpak diff] flathub: tag=${remoteTag ?? '(missing)'} commit=${remoteCommit ?? '(missing)'}`);
        console.log(`[gjsify flatpak diff] local:   tag=${localVersion ?? '(none)'}`);

        if (args.detail && remoteSource) {
            console.log('[gjsify flatpak diff] flathub manifest source:');
            console.log(JSON.stringify(remoteSource, null, 2));
        }

        if (!localVersion) {
            console.warn(
                '[gjsify flatpak diff] no local git tag found — cut a release (`git tag vX.Y.Z`) ' +
                    'or pass --version vX.Y.Z to compare against an explicit value.',
            );
            // Still surface remote state, but exit cleanly so this isn't a fatal CI step.
            return;
        }
        if (!remoteTag) {
            console.warn(
                '[gjsify flatpak diff] flathub manifest has no `tag` field on the inspected source.',
            );
            process.exit(1);
        }

        if (remoteTag === localVersion) {
            console.log(`✅ in sync (${localVersion})`);
            return;
        }

        console.log(`❌ drift detected — flathub=${remoteTag} vs local=${localVersion}`);
        console.log(
            `   run \`gjsify flatpak sync-flathub --version ${localVersion}\` to update the Flathub manifest.`,
        );
        process.exit(1);
    },
};

// ─── Internal helpers ────────────────────────────────────────────────────

async function loadFlathubSource(
    args: { appId: string; flathubRepo: string; against?: string; verbose?: boolean },
    sourceIndex: number | undefined,
): Promise<FlathubSource | null> {
    let raw: string;
    if (args.against) {
        if (!existsSync(args.against)) {
            throw new Error(`[gjsify flatpak diff] --against path ${args.against} does not exist`);
        }
        raw = readFileSync(args.against, 'utf-8');
    } else {
        // Try main + master raw URLs on GitHub. Flathub repos historically use
        // master; newer ones may use main. No XDG cache: fresh fetch each run.
        raw = await fetchFlathubManifest(args.flathubRepo, args.appId, args.verbose);
    }

    let manifest: FlathubManifest;
    try {
        manifest = JSON.parse(raw) as FlathubManifest;
    } catch (err) {
        throw new Error(
            `[gjsify flatpak diff] failed to parse Flathub manifest as JSON: ${(err as Error).message}`,
        );
    }
    const modules = manifest.modules ?? [];
    const sources = modules[0]?.sources ?? [];
    if (sources.length === 0) return null;
    const idx = sourceIndex ?? sources.findIndex((s) => s?.type === 'git');
    if (idx < 0 || idx >= sources.length) return null;
    return sources[idx] ?? null;
}

async function fetchFlathubManifest(
    flathubRepo: string,
    appId: string,
    verbose: boolean | undefined,
): Promise<string> {
    for (const branch of ['master', 'main']) {
        const url = `https://raw.githubusercontent.com/${flathubRepo}/${branch}/${appId}.json`;
        if (verbose) console.log(`[gjsify flatpak diff] fetch ${url}`);
        try {
            const res = await fetch(url);
            if (res.ok) return await res.text();
            if (verbose) console.log(`[gjsify flatpak diff] ${branch} → HTTP ${res.status}`);
        } catch (err) {
            if (verbose) console.log(`[gjsify flatpak diff] ${branch} fetch error: ${(err as Error).message}`);
        }
    }
    throw new Error(
        `[gjsify flatpak diff] could not fetch flathub manifest from ${flathubRepo} on master or main`,
    );
}

async function resolveLatestTag(cwd: string, verbose: boolean | undefined): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync('git', ['describe', '--tags', '--abbrev=0'], { cwd });
        const tag = stdout.trim();
        if (verbose) console.log(`[gjsify flatpak diff] local latest tag → ${tag}`);
        return tag || null;
    } catch {
        return null;
    }
}
