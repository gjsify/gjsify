// `gjsify flatpak init` — generate a Flatpak manifest from package.json
// + the `gjsify.flatpak` config namespace, plus (Phase F.9) MetaInfo XML,
// `.desktop` (app kind only), and `flathub.json` policy stub in the same
// invocation.
//
// Defaults are designed for the two real-world shapes:
//   * `--kind app` (default) — GTK4 + Adwaita apps (Learn6502): `gnome`
//     runtime, GUI finish-args, desktop-application MetaInfo, .desktop +
//     icon required.
//   * `--kind cli` — headless CLI tools (ts-for-gir): same `gnome` runtime
//     (GJS bundles need GLib/GIO at runtime — Freedesktop ships no GJS),
//     but lean finish-args + console-application MetaInfo + flathub.json
//     with `skip-icons-check`.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Command, ConfigData, ConfigDataFlatpak } from '../../types/index.js';
import {
    DEFAULT_CLI_FINISH_ARGS,
    DEFAULT_GUI_FINISH_ARGS,
    looksLikeAppId,
    readPackageJson,
    resolveRuntime,
} from './utils.js';
import {
    renderDesktop,
    renderFlathubJson,
    renderMetainfoApp,
    renderMetainfoCli,
    validateScaffoldInputs,
    type ScaffoldInputs,
} from './scaffold.js';
import { Config } from '../../config.js';

interface FlatpakInitOptions {
    appId?: string;
    runtime?: string;
    runtimeVersion?: string;
    kind?: string;
    cliOnly?: boolean;
    manifest?: string;
    metainfo?: string;
    desktop?: string;
    flathubJson?: string;
    command?: string;
    force?: boolean;
    sdkExtension?: string[];
    finishArg?: string[];
    verbose?: boolean;
}

export const flatpakInitCommand: Command<unknown, FlatpakInitOptions> = {
    command: 'init',
    description:
        'Generate Flatpak manifest + MetaInfo XML + .desktop + flathub.json from `gjsify.flatpak` config.',
    builder: (yargs) => {
        return yargs
            .option('app-id', {
                description: 'Reverse-DNS app id (default: `gjsify.flatpak.appId` or package.json#name)',
                type: 'string',
            })
            .option('runtime', {
                description: 'Runtime family',
                choices: ['gnome', 'freedesktop'] as const,
            })
            .option('runtime-version', {
                description: 'Runtime version (default: gnome -> 50, freedesktop -> 24.08)',
                type: 'string',
            })
            .option('kind', {
                description: 'App kind: "app" (default, desktop) or "cli" (console-application MetaInfo, no .desktop)',
                choices: ['app', 'cli'] as const,
            })
            .option('cli-only', {
                description: '(Deprecated) Alias for `--kind cli`. Use --kind instead.',
                type: 'boolean',
                default: false,
            })
            .option('manifest', {
                description: 'Output path for the manifest. Default: `<app-id>.json` in cwd.',
                type: 'string',
                normalize: true,
            })
            .option('metainfo', {
                description: 'Output path for the MetaInfo XML. Default: `data/<app-id>.metainfo.xml.in` in cwd.',
                type: 'string',
                normalize: true,
            })
            .option('desktop', {
                description: 'Output path for the .desktop entry (app kind only). Default: `data/<app-id>.desktop.in`.',
                type: 'string',
                normalize: true,
            })
            .option('flathub-json', {
                description: 'Output path for the flathub.json policy stub. Default: `flathub.json` in cwd.',
                type: 'string',
                normalize: true,
            })
            .option('command', {
                description: 'Binary name in /app/bin (default: app id)',
                type: 'string',
            })
            .option('sdk-extension', {
                description: 'Extra SDK extension (repeatable)',
                type: 'string',
                array: true,
            })
            .option('finish-arg', {
                description: 'Extra finish-arg (repeatable). Override defaults entirely with multiple --finish-arg.',
                type: 'string',
                array: true,
            })
            .option('force', {
                description: 'Overwrite existing output files (manifest, metainfo, desktop, flathub.json)',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'Print the resolved manifest fields before writing',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cfg = new Config();
        const configData = await cfg.forBuild({} as never).catch(() => ({} as ConfigData));
        const flatpak: ConfigDataFlatpak = configData.flatpak ?? {};
        const cwd = process.cwd();
        const pkg = readPackageJson(cwd);

        const appId =
            (args.appId as string | undefined) ??
            flatpak.appId ??
            (looksLikeAppId(pkg.name) ? (pkg.name as string) : undefined);
        if (!appId) {
            throw new Error(
                'gjsify flatpak init: no app id available. Pass --app-id, set gjsify.flatpak.appId in package.json, ' +
                    'or rename the package to a reverse-DNS id like org.example.MyApp.',
            );
        }

        const kind: 'app' | 'cli' =
            (args.kind as 'app' | 'cli' | undefined) ??
            flatpak.kind ??
            (args.cliOnly ? 'cli' : 'app');

        const { runtime, runtimeId, sdk, runtimeVersion } = resolveRuntime(flatpak, {
            runtime: args.runtime,
            runtimeVersion: args.runtimeVersion,
        });

        const sdkExtensions = mergeArrays(flatpak.sdkExtensions, args.sdkExtension);
        const appendPath = flatpak.appendPath ?? (sdkExtensions?.length ? deriveAppendPath(sdkExtensions) : undefined);
        const command = (args.command as string | undefined) ?? flatpak.command ?? appId;

        const explicitFinishArgs = args.finishArg as string[] | undefined;
        const finishArgs =
            explicitFinishArgs !== undefined
                ? explicitFinishArgs
                : flatpak.finishArgs ??
                  (kind === 'cli' ? DEFAULT_CLI_FINISH_ARGS : DEFAULT_GUI_FINISH_ARGS);

        const manifest: Record<string, unknown> = {
            id: appId,
            runtime: runtimeId,
            'runtime-version': runtimeVersion,
            sdk,
        };
        if (sdkExtensions?.length) manifest['sdk-extensions'] = sdkExtensions;
        if (appendPath?.length) {
            manifest['build-options'] = { 'append-path': appendPath.join(':') };
        }
        manifest.command = command;
        manifest['finish-args'] = finishArgs;

        const cleanup = flatpak.cleanup;
        if (cleanup?.length) manifest.cleanup = cleanup;

        const modules: unknown[] = [];
        if (flatpak.extraModules?.length) modules.push(...flatpak.extraModules);
        modules.push({
            name: deriveModuleName(appId),
            buildsystem: 'meson',
            sources: [{ type: 'dir', path: '.' }],
        });
        manifest.modules = modules;

        const manifestOut = (args.manifest as string | undefined) ?? `${appId}.json`;
        const manifestPath = resolve(cwd, manifestOut);
        writeIfFresh(manifestPath, JSON.stringify(manifest, null, 4) + '\n', args.force ?? false, 'manifest');

        const pkgName = (pkg.name as string | undefined) ?? appId;
        const scaffold: ScaffoldInputs = {
            appId,
            name: flatpak.name ?? friendlyName(pkgName, appId),
            command,
            kind,
            flatpak,
        };

        const missing = validateScaffoldInputs(scaffold);
        if (missing.length > 0) {
            console.warn('[gjsify flatpak init] Manifest written, but MetaInfo / .desktop are skipped — config gaps:');
            for (const m of missing) console.warn(`  - ${m.field}: ${m.hint}`);
            console.warn(
                '\nFill these fields in package.json#gjsify.flatpak (or .gjsifyrc.*) and re-run with --force.',
            );
        } else {
            const metainfoXml =
                kind === 'cli' ? renderMetainfoCli(scaffold) : renderMetainfoApp(scaffold);
            const metainfoOut =
                (args.metainfo as string | undefined) ?? `data/${appId}.metainfo.xml.in`;
            writeIfFresh(resolve(cwd, metainfoOut), metainfoXml, args.force ?? false, 'metainfo');

            if (kind === 'app') {
                const desktopOut =
                    (args.desktop as string | undefined) ?? `data/${appId}.desktop.in`;
                writeIfFresh(resolve(cwd, desktopOut), renderDesktop(scaffold), args.force ?? false, 'desktop');

                if (!flatpak.icon) {
                    console.warn(
                        `[gjsify flatpak init] No gjsify.flatpak.icon set. Flathub requires a scalable SVG at\n` +
                            `  data/icons/hicolor/scalable/apps/${appId}.svg`,
                    );
                }
            }

            const flathubOut = (args.flathubJson as string | undefined) ?? 'flathub.json';
            writeIfFresh(resolve(cwd, flathubOut), renderFlathubJson(kind), args.force ?? false, 'flathub.json');
        }

        if (args.verbose) {
            console.log(`[gjsify flatpak init] kind=${kind} runtime=${runtimeId} ${runtimeVersion} sdk=${sdk}`);
            console.log(`[gjsify flatpak init] command=${command} finish-args=${JSON.stringify(finishArgs)}`);
            void runtime;
        }
    },
};

function writeIfFresh(path: string, content: string, force: boolean, label: string): void {
    if (existsSync(path) && !force) {
        console.log(`[gjsify flatpak init] skipped ${label}: ${path} (exists; --force to overwrite)`);
        return;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf-8');
    console.log(`[gjsify flatpak init] wrote ${label}: ${path}`);
}

function friendlyName(pkgName: string, appId: string): string {
    if (pkgName.startsWith('@')) {
        const base = pkgName.slice(pkgName.indexOf('/') + 1);
        return base;
    }
    if (pkgName === appId) {
        const segs = appId.split('.');
        return segs[segs.length - 1] ?? appId;
    }
    return pkgName;
}

function mergeArrays(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
    if (!a?.length && !b?.length) return undefined;
    return [...(a ?? []), ...(b ?? [])];
}

function deriveAppendPath(sdkExtensions: string[]): string[] {
    const out: string[] = [];
    for (const ext of sdkExtensions) {
        const m = /^org\.freedesktop\.Sdk\.Extension\.([A-Za-z0-9-]+)$/.exec(ext);
        if (m) out.push(`/usr/lib/sdk/${m[1]}/bin`);
    }
    out.push('/app/bin');
    return out;
}

function deriveModuleName(appId: string): string {
    const parts = appId.split('.');
    return parts[parts.length - 1] || appId;
}
