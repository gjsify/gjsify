// `gjsify flatpak check` — run Flathub's pre-submission linters locally.
//
// Wraps two tools:
//   - `appstreamcli validate --strict --no-net <metainfo>` — MetaInfo XML
//     correctness check; offline unless `--appstream-network` (a URL that
//     is merely unreachable from the runner must not fail the gate)
//   - `flatpak-builder-lint manifest <manifest.json>` — manifest
//     correctness check (and optionally `repo` for built artefacts)
//
// Both ship inside the `org.flatpak.Builder` flatpak. We exec them from
// the host PATH; a missing `flatpak-builder-lint` runs through
// `flatpak run --command=… org.flatpak.Builder` when that app is installed,
// else the check prints the install hint.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { type SpawnCompletion, spawnToCompletion } from '../../utils/spawn.js';
import type { Command, ConfigData, ConfigDataFlatpak } from '../../types/index.js';
import { readPackageJson, looksLikeAppId } from './utils.js';
import { Config } from '../../config.js';
import {
    type ImageProbe,
    type QualityFinding,
    formatFinding,
    lintMetainfo,
    readImageInfo,
    summarizeFindings,
} from '../../utils/metainfo-quality.js';

interface FlatpakCheckOptions {
    manifest?: string;
    repo?: string;
    metainfo?: string;
    appstream?: boolean;
    quality?: boolean;
    strict?: boolean;
    json?: boolean;
    qualityNetwork?: boolean;
    appstreamNetwork?: boolean;
    builderLint?: boolean;
    verbose?: boolean;
}

/** argv for `appstreamcli`; offline unless the caller opts in to URL reachability checks. */
export function appstreamValidateArgs(metainfoAbs: string, network = false): string[] {
    return ['validate', '--strict', ...(network ? [] : ['--no-net']), metainfoAbs];
}

/** Flathub ships the linter inside this app; installing it is the documented way to get it. */
export const BUILDER_APP_ID = 'org.flatpak.Builder';

/**
 * How to run `flatpak-builder-lint` when it is not on PATH: through the `org.flatpak.Builder`
 * app, which is how Flathub's own docs install it. Without this fallback every host that followed
 * those docs reported the linter as missing and the whole check as failed.
 */
export function builderLintViaFlatpak(args: string[]): { bin: string; args: string[] } {
    return { bin: 'flatpak', args: ['run', '--command=flatpak-builder-lint', BUILDER_APP_ID, ...args] };
}

export const flatpakCheckCommand: Command<unknown, FlatpakCheckOptions> = {
    command: 'check [manifest]',
    description: 'Run Flathub pre-submission linters: appstreamcli validate + flatpak-builder-lint.',
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
                description: 'Run `appstreamcli validate --strict --no-net` (default: true).',
                type: 'boolean',
                default: true,
            })
            .option('quality', {
                description:
                    "Run Flathub's quality guidelines (name, summary, branding, screenshots, release notes) on the MetaInfo (default: true).",
                type: 'boolean',
                default: true,
            })
            .option('strict', {
                description: 'Treat quality warnings as errors.',
                type: 'boolean',
                default: false,
            })
            .option('json', {
                description: 'Print the quality findings as JSON (and nothing else on stdout).',
                type: 'boolean',
                default: false,
            })
            .option('quality-network', {
                description: 'Let the quality check fetch http(s) screenshot/icon URLs to measure their size.',
                type: 'boolean',
                default: false,
            })
            .option('appstream-network', {
                description: 'Let `appstreamcli` fetch the MetaInfo URLs to check they are reachable.',
                type: 'boolean',
                default: false,
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
        const configData = await cfg.forCommand().catch(() => ({}) as ConfigData);
        const flatpak: ConfigDataFlatpak = configData.flatpak ?? {};
        const cwd = process.cwd();

        const appId = resolveAppId(args.manifest as string | undefined, flatpak, cwd);
        const manifestPath = resolveManifestPath(args.manifest as string | undefined, appId, cwd);
        const metainfoPath = (args.metainfo as string | undefined) ?? `data/${appId ?? 'unknown'}.metainfo.xml.in`;
        const metainfoAbs = resolve(cwd, metainfoPath);

        let failures = 0;

        if (args.appstream !== false) {
            if (!existsSync(metainfoAbs)) {
                console.warn(`[gjsify flatpak check] skipping appstreamcli — ${metainfoAbs} not found`);
            } else {
                const ok = await runLinter(
                    'appstreamcli',
                    appstreamValidateArgs(metainfoAbs, args.appstreamNetwork === true),
                    args.verbose ?? false,
                );
                if (!ok) failures++;
            }
        }

        if (args.quality !== false) {
            if (!existsSync(metainfoAbs)) {
                console.warn(`[gjsify flatpak check] skipping quality check — ${metainfoAbs} not found`);
            } else if (!(await runQuality(metainfoAbs, appId, args))) {
                failures++;
            }
        }

        if (args.builderLint !== false && !args.json) {
            if (!existsSync(manifestPath)) {
                console.error(`[gjsify flatpak check] manifest not found: ${manifestPath}`);
                return process.exit(1);
            }
            const ok = await runBuilderLint(['manifest', manifestPath], args.verbose ?? false);
            if (!ok) failures++;

            if (args.repo) {
                const repoPath = resolve(cwd, args.repo as string);
                const okRepo = await runBuilderLint(['repo', repoPath], args.verbose ?? false);
                if (!okRepo) failures++;
            }
        }

        if (failures > 0) {
            console.error(`\n[gjsify flatpak check] ${failures} check(s) failed.`);
            // `return` — the deferred GJS exit otherwise fell through and ALSO
            // printed "all checks passed" after reporting failures.
            return process.exit(1);
        }
        console.log('[gjsify flatpak check] all checks passed.');
    },
};

async function runQuality(metainfoAbs: string, appId: string | undefined, args: FlatpakCheckOptions): Promise<boolean> {
    const base = dirname(metainfoAbs);
    const probeImage: ImageProbe = async (ref) => {
        if (/^https?:\/\//.test(ref)) {
            if (!args.qualityNetwork) return null;
            try {
                const res = await fetch(ref);
                return res.ok ? readImageInfo(new Uint8Array(await res.arrayBuffer())) : null;
            } catch {
                return null;
            }
        }
        const file = resolve(base, ref);
        return existsSync(file) ? readImageInfo(new Uint8Array(readFileSync(file))) : null;
    };
    const id = appId ?? '';
    const iconRefs = id
        ? [
              `icons/hicolor/scalable/apps/${id}.svg`,
              `icons/${id}.svg`,
              `${id}.svg`,
              `${id}.png`,
              `../data/icons/hicolor/scalable/apps/${id}.svg`,
          ]
        : [];
    const findings: QualityFinding[] = await lintMetainfo(readFileSync(metainfoAbs, 'utf-8'), { probeImage, iconRefs });
    const strict = args.strict === true;
    const { errors, warnings } = summarizeFindings(findings, strict);
    if (args.json) {
        console.log(
            JSON.stringify(
                {
                    file: metainfoAbs,
                    errors,
                    warnings,
                    findings: findings.map((f) => ({ ...f, severity: strict ? 'error' : f.severity })),
                },
                null,
                2,
            ),
        );
    } else {
        for (const f of findings) console.log(formatFinding(f, strict));
        console.log(
            `[gjsify flatpak check] ${errors === 0 ? 'OK' : 'FAIL'}: quality ${metainfoAbs} — ${errors} error(s), ${warnings} warning(s)`,
        );
    }
    return errors === 0;
}

function resolveAppId(explicit: string | undefined, flatpak: ConfigDataFlatpak, cwd: string): string | undefined {
    if (flatpak.appId) return flatpak.appId;
    try {
        const pkg = readPackageJson(cwd);
        if (looksLikeAppId(pkg.name)) return pkg.name as string;
    } catch {
        /* no pkg.json */
    }
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

async function runBuilderLint(args: string[], verbose: boolean): Promise<boolean> {
    const direct = await runLinter('flatpak-builder-lint', args, verbose);
    if (direct !== 'missing') return direct === 'ok';
    if (await builderAppInstalled()) {
        const via = builderLintViaFlatpak(args);
        return (await runLinter(via.bin, via.args, verbose)) === 'ok';
    }
    console.error(
        `[gjsify flatpak check] flatpak-builder-lint not found in PATH, and ${BUILDER_APP_ID} is not installed.\n` +
            `Install via:\n` +
            `  flatpak install -y flathub ${BUILDER_APP_ID}`,
    );
    return false;
}

async function builderAppInstalled(): Promise<boolean> {
    try {
        const probe = await spawnToCompletion('flatpak', ['info', BUILDER_APP_ID], {
            completion: 'return',
            stdio: 'capture',
        });
        return probe.code === 0;
    } catch {
        // No `flatpak` binary at all: the app cannot be there either.
        return false;
    }
}

async function runLinter(bin: string, args: string[], verbose: boolean): Promise<'ok' | 'fail' | 'missing'> {
    // `completion: 'return'` — the handler's SUCCESS path ends with a `console.log`
    // and returns, so under GJS an async spawn leaves `ensureMainLoop`'s loop armed
    // and the command parks at 0 % CPU after every check has passed. The failure
    // path exits, which is why the hang would have shown up only on a clean run.
    let result: SpawnCompletion;
    try {
        result = await spawnToCompletion(bin, args, {
            completion: 'return',
            stdio: verbose ? 'inherit' : 'capture',
        });
    } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === 'ENOENT') return 'missing';
        console.error(`[gjsify flatpak check] ${bin} failed to spawn: ${e.message}`);
        return 'fail';
    }

    const ok = result.code === 0;
    console.log(`[gjsify flatpak check] ${ok ? 'OK' : 'FAIL'}: ${bin} ${args.join(' ')}`);
    if (!ok && !verbose) {
        if (result.stdout?.trim()) console.log(result.stdout.trimEnd());
        if (result.stderr?.trim()) console.error(result.stderr.trimEnd());
    }
    return ok ? 'ok' : 'fail';
}

void join;
