// `gjsify flatpak init` — generate a Flatpak manifest from package.json
// + the `gjsify.flatpak` config namespace.
//
// Defaults are designed for the two real-world shapes:
//   * GTK4 + Adwaita apps (Learn6502): `gnome` runtime, GUI finish-args
//   * Headless CLI tools (ts-for-gir): same `gnome` runtime (GJS bundles
//     need GLib/GIO at runtime — Freedesktop ships no GJS), but lean
//     finish-args via `--cli-only`. Memory file
//     `project_flatpak_runtime_choice.md` documents this trade-off.

import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Command, ConfigData, ConfigDataFlatpak } from '../../types/index.js';
import {
    DEFAULT_CLI_FINISH_ARGS,
    DEFAULT_GUI_FINISH_ARGS,
    looksLikeAppId,
    readPackageJson,
    resolveRuntime,
} from './utils.js';
import { Config } from '../../config.js';

interface FlatpakInitOptions {
    appId?: string;
    runtime?: string;
    runtimeVersion?: string;
    cliOnly?: boolean;
    manifest?: string;
    command?: string;
    force?: boolean;
    sdkExtension?: string[];
    finishArg?: string[];
    verbose?: boolean;
}

export const flatpakInitCommand: Command<unknown, FlatpakInitOptions> = {
    command: 'init',
    description:
        'Generate a Flatpak manifest from package.json + `gjsify.flatpak` config.',
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
            .option('cli-only', {
                description: 'Strip GUI finish-args; keep `gnome` runtime so GJS is available at runtime',
                type: 'boolean',
                default: false,
            })
            .option('manifest', {
                description: 'Output path. Default: `<app-id>.json` in cwd.',
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
                description: 'Overwrite an existing manifest',
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

        const { runtime, runtimeId, sdk, runtimeVersion } = resolveRuntime(flatpak, {
            runtime: args.runtime,
            runtimeVersion: args.runtimeVersion,
        });

        const sdkExtensions = mergeArrays(flatpak.sdkExtensions, args.sdkExtension);
        const appendPath = flatpak.appendPath ?? (sdkExtensions?.length ? deriveAppendPath(sdkExtensions) : undefined);
        const command = (args.command as string | undefined) ?? flatpak.command ?? appId;

        const explicitFinishArgs = args.finishArg as string[] | undefined;
        const cliOnly = args.cliOnly === true;
        const finishArgs =
            explicitFinishArgs !== undefined
                ? explicitFinishArgs
                : flatpak.finishArgs ??
                  (cliOnly ? DEFAULT_CLI_FINISH_ARGS : DEFAULT_GUI_FINISH_ARGS);

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

        // Modules: caller-supplied `extraModules` first, then the app's own
        // meson module pointing at the source dir.
        const modules: unknown[] = [];
        if (flatpak.extraModules?.length) modules.push(...flatpak.extraModules);
        modules.push({
            name: deriveModuleName(appId),
            buildsystem: 'meson',
            sources: [{ type: 'dir', path: '.' }],
        });
        manifest.modules = modules;

        const out = (args.manifest as string | undefined) ?? `${appId}.json`;
        const outPath = resolve(cwd, out);
        if (existsSync(outPath) && !args.force) {
            throw new Error(
                `gjsify flatpak init: ${outPath} exists. Pass --force to overwrite.`,
            );
        }

        const json = JSON.stringify(manifest, null, 4) + '\n';
        writeFileSync(outPath, json, 'utf-8');

        if (args.verbose) {
            console.log(`[gjsify flatpak init] runtime=${runtimeId} ${runtimeVersion} sdk=${sdk}`);
            console.log(`[gjsify flatpak init] command=${command} finish-args=${JSON.stringify(finishArgs)}`);
        }
        console.log(`[gjsify flatpak init] wrote ${outPath}`);
    },
};

/** Concatenate two optional arrays, dropping `undefined`. */
function mergeArrays(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
    if (!a?.length && !b?.length) return undefined;
    return [...(a ?? []), ...(b ?? [])];
}

/** Map known SDK extension ids to their /usr/lib/sdk/<name>/bin paths. */
function deriveAppendPath(sdkExtensions: string[]): string[] {
    const out: string[] = [];
    for (const ext of sdkExtensions) {
        const m = /^org\.freedesktop\.Sdk\.Extension\.([A-Za-z0-9-]+)$/.exec(ext);
        if (m) out.push(`/usr/lib/sdk/${m[1]}/bin`);
    }
    out.push('/app/bin');
    return out;
}

/** Last segment of the reverse-DNS id, used as the meson-module name. */
function deriveModuleName(appId: string): string {
    const parts = appId.split('.');
    return parts[parts.length - 1] || appId;
}
