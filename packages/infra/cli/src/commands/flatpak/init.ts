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
import { looksLikeAppId, readPackageJson } from './utils.js';
import {
    DEFAULT_CLI_FINISH_ARGS,
    DEFAULT_GUI_FINISH_ARGS,
    deriveAppendPath,
    resolveRuntime,
} from '../../utils/flatpak-runtime.js';
import { pickFlatpakBuildKeys } from '../../utils/ship/flatpak-config.js';
import {
    renderDesktop,
    renderFlathubJson,
    renderMetainfoApp,
    renderMetainfoCli,
    validateScaffoldInputs,
    type ScaffoldInputs,
} from './scaffold.js';
import { Config } from '../../config.js';
import { OxcNotFoundError, hasOxcDevDep, runOxfmt } from '../../utils/oxc-resolve.js';

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
    format?: boolean;
}

export const flatpakInitCommand: Command<unknown, FlatpakInitOptions> = {
    command: 'init',
    description: 'Generate Flatpak manifest + MetaInfo XML + .desktop + flathub.json from `gjsify.flatpak` config.',
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
            })
            .option('format', {
                description:
                    'Run `oxfmt --write` on the generated JS/TS files when `oxfmt` is detected in the project. ' +
                    'Default: true. Pass --no-format to skip. Note: oxfmt formats JS/TS only — the JSON/XML/.desktop ' +
                    'manifests generated here are not reformatted (CSS/JSON formatting was dropped in the oxc migration).',
                type: 'boolean',
                default: true,
            });
    },
    handler: async (args) => {
        const cfg = new Config();
        const configData = await cfg.forCommand().catch(() => ({}) as ConfigData);
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
            (args.kind as 'app' | 'cli' | undefined) ?? flatpak.kind ?? (args.cliOnly ? 'cli' : 'app');

        // The six BUILD keys come through the deprecation window
        // (`utils/ship/flatpak-config.ts`), not straight off `gjsify.flatpak`.
        // These commands did NOT move, but the keys did: a project that followed
        // `ship`'s own advice and moved them would otherwise lose them here and
        // get a committed manifest against a different runtime version with
        // different finish-args, silently, at exit 0.
        const buildKeys = pickFlatpakBuildKeys(configData.ship?.flatpak, flatpak).values;

        const { runtime, runtimeId, sdk, runtimeVersion } = resolveRuntime(buildKeys, {
            runtime: args.runtime,
            runtimeVersion: args.runtimeVersion,
        });

        const sdkExtensions = mergeArrays(buildKeys.sdkExtensions, args.sdkExtension);
        const appendPath =
            buildKeys.appendPath ?? (sdkExtensions?.length ? deriveAppendPath(sdkExtensions) : undefined);
        const command = (args.command as string | undefined) ?? flatpak.command ?? appId;

        const explicitFinishArgs = args.finishArg as string[] | undefined;
        const finishArgs =
            explicitFinishArgs !== undefined
                ? explicitFinishArgs
                : (buildKeys.finishArgs ?? (kind === 'cli' ? DEFAULT_CLI_FINISH_ARGS : DEFAULT_GUI_FINISH_ARGS));

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

        const cleanup = buildKeys.cleanup;
        if (cleanup?.length) manifest.cleanup = cleanup;

        // Module assembly. Two precedence rules:
        //   `flatpak.modules`      — full replacement; if set, neither the
        //                            extras nor the meson default get added.
        //                            Right shape for npm-tarball CLI tools
        //                            where the meson default would be wrong.
        //   `flatpak.extraModules` — prepended to the meson default.
        //                            Right shape for meson-built GTK apps
        //                            that want a few extra sibling modules
        //                            (e.g. blueprint-compiler).
        const modules: unknown[] = [];
        if (flatpak.modules?.length) {
            modules.push(...flatpak.modules);
        } else {
            if (flatpak.extraModules?.length) modules.push(...flatpak.extraModules);
            modules.push({
                name: deriveModuleName(appId),
                buildsystem: 'meson',
                sources: [{ type: 'dir', path: '.' }],
            });
        }
        manifest.modules = modules;

        const writtenFiles: string[] = [];
        const trackWrite = (p: string | null) => {
            if (p) writtenFiles.push(p);
        };

        const manifestOut = (args.manifest as string | undefined) ?? `${appId}.json`;
        const manifestPath = resolve(cwd, manifestOut);
        trackWrite(
            writeIfFresh(manifestPath, JSON.stringify(manifest, null, 2) + '\n', args.force ?? false, 'manifest'),
        );

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
            const metainfoXml = kind === 'cli' ? renderMetainfoCli(scaffold) : renderMetainfoApp(scaffold);
            const metainfoOut = (args.metainfo as string | undefined) ?? `data/${appId}.metainfo.xml.in`;
            trackWrite(writeIfFresh(resolve(cwd, metainfoOut), metainfoXml, args.force ?? false, 'metainfo'));

            if (kind === 'app') {
                const desktopOut = (args.desktop as string | undefined) ?? `data/${appId}.desktop.in`;
                trackWrite(
                    writeIfFresh(resolve(cwd, desktopOut), renderDesktop(scaffold), args.force ?? false, 'desktop'),
                );

                if (!flatpak.icon) {
                    console.warn(
                        `[gjsify flatpak init] No gjsify.flatpak.icon set. Flathub requires a scalable SVG at\n` +
                            `  data/icons/hicolor/scalable/apps/${appId}.svg`,
                    );
                }
            }

            const flathubOut = (args.flathubJson as string | undefined) ?? 'flathub.json';
            trackWrite(
                writeIfFresh(resolve(cwd, flathubOut), renderFlathubJson(kind), args.force ?? false, 'flathub.json'),
            );
        }

        // Optional post-format: when oxfmt is configured in the project, run
        // `oxfmt --write` on any generated JS/TS files. oxfmt formats JS/TS
        // (+TOML) only — the manifest/MetaInfo/.desktop/flathub outputs are
        // JSON/XML/INI and are therefore left untouched (CSS/JSON formatting
        // was dropped in the Biome → oxc migration). In practice flatpak init
        // emits no JS/TS, so this is usually a no-op; it remains as a hook for
        // any future JS/TS scaffold output.
        const jsLikeFiles = writtenFiles.filter((p) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(p));
        if (jsLikeFiles.length > 0 && args.format !== false && hasOxcDevDep(cwd)) {
            try {
                await runOxfmt(['--write', ...jsLikeFiles], { cwd });
            } catch (err) {
                if (err instanceof OxcNotFoundError) {
                    // oxfmt configured but binding missing — non-fatal warning.
                    console.warn(
                        `[gjsify flatpak init] post-format skipped: oxfmt declared but binding not installed. ` +
                            `Run \`gjsify install\` then re-run with --force, or pass --no-format.`,
                    );
                } else {
                    throw err;
                }
            }
        }

        if (args.verbose) {
            console.log(`[gjsify flatpak init] kind=${kind} runtime=${runtimeId} ${runtimeVersion} sdk=${sdk}`);
            console.log(`[gjsify flatpak init] command=${command} finish-args=${JSON.stringify(finishArgs)}`);
            void runtime;
        }
    },
};

function writeIfFresh(path: string, content: string, force: boolean, label: string): string | null {
    if (existsSync(path) && !force) {
        console.log(`[gjsify flatpak init] skipped ${label}: ${path} (exists; --force to overwrite)`);
        return null;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf-8');
    console.log(`[gjsify flatpak init] wrote ${label}: ${path}`);
    return path;
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

function deriveModuleName(appId: string): string {
    const parts = appId.split('.');
    return parts[parts.length - 1] || appId;
}
