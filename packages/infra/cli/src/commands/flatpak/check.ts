// `gjsify flatpak check` — run Flathub's pre-submission linters locally.
//
// Wraps two tools:
//   - `appstreamcli validate --strict <metainfo>` — MetaInfo XML
//     correctness check
//   - `flatpak-builder-lint manifest <manifest.json>` — manifest
//     correctness check (and optionally `repo` for built artefacts)
//
// Both ship inside the `org.flatpak.Builder` flatpak. We exec them from
// the host PATH; if missing, print an install hint pointing at
// `flatpak install -y flathub org.flatpak.Builder`.

import { existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import type { Command, ConfigData, ConfigDataFlatpak } from '../../types/index.js';
import { readPackageJson, looksLikeAppId } from './utils.js';
import { Config } from '../../config.js';

interface FlatpakCheckOptions {
    manifest?: string;
    repo?: string;
    metainfo?: string;
    appstream?: boolean;
    builderLint?: boolean;
    verbose?: boolean;
}

export const flatpakCheckCommand: Command<unknown, FlatpakCheckOptions> = {
    command: 'check [manifest]',
    description:
        'Run Flathub pre-submission linters: appstreamcli validate + flatpak-builder-lint.',
    builder: (yargs) => {
        return yargs
            .positional('manifest', {
                description: 'Path to the Flatpak manifest. Auto-detects `<app-id>.json` if omitted.',
                type: 'string',
                normalize: true,
            })
            .option('repo', {
                description: 'Built ostree-repo path. If given, also runs `flatpak-builder-lint repo`.',
                type: 'string',
                normalize: true,
            })
            .option('metainfo', {
                description: 'MetaInfo XML path. Default: `data/<app-id>.metainfo.xml.in`.',
                type: 'string',
                normalize: true,
            })
            .option('appstream', {
                description: 'Run `appstreamcli validate --strict` (default: true).',
                type: 'boolean',
                default: true,
            })
            .option('builder-lint', {
                description: 'Run `flatpak-builder-lint manifest` (default: true).',
                type: 'boolean',
                default: true,
            })
            .option('verbose', {
                description: 'Stream linter stdout/stderr verbatim.',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cfg = new Config();
        const configData = await cfg.forBuild({} as never).catch(() => ({} as ConfigData));
        const flatpak: ConfigDataFlatpak = configData.flatpak ?? {};
        const cwd = process.cwd();

        const appId = resolveAppId(args.manifest as string | undefined, flatpak, cwd);
        const manifestPath = resolveManifestPath(args.manifest as string | undefined, appId, cwd);
        const metainfoPath =
            (args.metainfo as string | undefined) ?? `data/${appId ?? 'unknown'}.metainfo.xml.in`;
        const metainfoAbs = resolve(cwd, metainfoPath);

        let failures = 0;

        if (args.appstream !== false) {
            if (!existsSync(metainfoAbs)) {
                console.warn(`[gjsify flatpak check] skipping appstreamcli — ${metainfoAbs} not found`);
            } else {
                const ok = await runLinter('appstreamcli', ['validate', '--strict', metainfoAbs], args.verbose ?? false);
                if (!ok) failures++;
            }
        }

        if (args.builderLint !== false) {
            if (!existsSync(manifestPath)) {
                console.error(`[gjsify flatpak check] manifest not found: ${manifestPath}`);
                process.exit(1);
                return;
            }
            const ok = await runLinter('flatpak-builder-lint', ['manifest', manifestPath], args.verbose ?? false);
            if (!ok) failures++;

            if (args.repo) {
                const repoPath = resolve(cwd, args.repo as string);
                const okRepo = await runLinter('flatpak-builder-lint', ['repo', repoPath], args.verbose ?? false);
                if (!okRepo) failures++;
            }
        }

        if (failures > 0) {
            console.error(`\n[gjsify flatpak check] ${failures} check(s) failed.`);
            process.exit(1);
        }
        console.log('[gjsify flatpak check] all checks passed.');
    },
};

function resolveAppId(
    explicit: string | undefined,
    flatpak: ConfigDataFlatpak,
    cwd: string,
): string | undefined {
    if (flatpak.appId) return flatpak.appId;
    try {
        const pkg = readPackageJson(cwd);
        if (looksLikeAppId(pkg.name)) return pkg.name as string;
    } catch { /* no pkg.json */ }
    if (explicit) {
        // strip `.json` extension if present
        return explicit.replace(/\.json$/, '');
    }
    return undefined;
}

function resolveManifestPath(explicit: string | undefined, appId: string | undefined, cwd: string): string {
    if (explicit) return resolve(cwd, explicit);
    if (appId) return resolve(cwd, `${appId}.json`);
    // Last resort: find a single *.json that looks like a manifest
    const candidates = readdirSync(cwd).filter((f) => f.endsWith('.json') && !f.startsWith('package'));
    if (candidates.length === 1) return resolve(cwd, candidates[0]);
    throw new Error(
        'gjsify flatpak check: no manifest path given and could not auto-detect. ' +
            'Pass the manifest as a positional argument.',
    );
}

function runLinter(bin: string, args: string[], verbose: boolean): Promise<boolean> {
    return new Promise((resolveP) => {
        const child = spawn(bin, args, {
            stdio: verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        if (!verbose) {
            child.stdout?.setEncoding('utf-8');
            child.stderr?.setEncoding('utf-8');
            child.stdout?.on('data', (c) => { stdout += c; });
            child.stderr?.on('data', (c) => { stderr += c; });
        }
        child.on('error', (err) => {
            const e = err as NodeJS.ErrnoException;
            if (e.code === 'ENOENT') {
                console.error(
                    `[gjsify flatpak check] ${bin} not found in PATH.\n` +
                        `Install via:\n` +
                        `  flatpak install -y flathub org.flatpak.Builder\n` +
                        `  alias ${bin}="flatpak run --command=${bin} org.flatpak.Builder"`,
                );
            } else {
                console.error(`[gjsify flatpak check] ${bin} failed to spawn: ${e.message}`);
            }
            resolveP(false);
        });
        child.on('exit', (code) => {
            const ok = code === 0;
            const tag = ok ? 'OK' : 'FAIL';
            console.log(`[gjsify flatpak check] ${tag}: ${bin} ${args.join(' ')}`);
            if (!ok && !verbose) {
                if (stdout.trim()) console.log(stdout.trimEnd());
                if (stderr.trim()) console.error(stderr.trimEnd());
            }
            resolveP(ok);
        });
    });
}

void join;
