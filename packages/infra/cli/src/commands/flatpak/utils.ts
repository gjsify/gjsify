// Shared helpers for the `gjsify flatpak <sub>` subcommand group.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigDataFlatpak } from '../../types/config-data.js';

/**
 * Default GNOME-Platform runtime version. Bumped per release window.
 * GNOME 50 = April 2026 stable; tracked in
 * https://docs.flathub.org/docs/for-app-authors/requirements.
 */
export const DEFAULT_GNOME_RUNTIME_VERSION = '50';

/** Default Freedesktop-Platform runtime version (LTS-ish). */
export const DEFAULT_FREEDESKTOP_RUNTIME_VERSION = '24.08';

/** Permissive GUI defaults for GTK4 + Adwaita apps. */
export const DEFAULT_GUI_FINISH_ARGS = [
    '--device=dri',
    '--share=ipc',
    '--socket=fallback-x11',
    '--socket=wayland',
];

/** Lean defaults for headless CLI tools — no display, no GPU. */
export const DEFAULT_CLI_FINISH_ARGS: string[] = [];

/** Read package.json from a directory. Throws a helpful error if missing/invalid. */
export function readPackageJson(dir: string): Record<string, unknown> {
    const path = resolve(dir, 'package.json');
    let raw: string;
    try {
        raw = readFileSync(path, 'utf-8');
    } catch {
        throw new Error(`gjsify flatpak: no package.json found at ${path}`);
    }
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
        throw new Error(`gjsify flatpak: package.json at ${path} is not valid JSON: ${(err as Error).message}`);
    }
}

/** True if a name string looks like a reverse-DNS Flatpak app id. */
export function looksLikeAppId(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]*(\.[A-Za-z][A-Za-z0-9_-]*){2,}$/.test(value);
}

/**
 * Pick the runtime + sdk + version triple from config + CLI overrides.
 * `--runtime` and `--runtime-version` flags win over config values.
 */
export function resolveRuntime(
    flatpak: ConfigDataFlatpak | undefined,
    overrides: { runtime?: string; runtimeVersion?: string },
): { runtime: 'gnome' | 'freedesktop'; runtimeId: string; sdk: string; runtimeVersion: string } {
    const runtime = (overrides.runtime ?? flatpak?.runtime ?? 'gnome') as 'gnome' | 'freedesktop';
    if (runtime !== 'gnome' && runtime !== 'freedesktop') {
        throw new Error(`gjsify flatpak: unknown runtime "${runtime}" (expected "gnome" or "freedesktop")`);
    }
    const runtimeVersion =
        overrides.runtimeVersion ??
        flatpak?.runtimeVersion ??
        (runtime === 'gnome' ? DEFAULT_GNOME_RUNTIME_VERSION : DEFAULT_FREEDESKTOP_RUNTIME_VERSION);

    if (runtime === 'gnome') {
        return { runtime, runtimeId: 'org.gnome.Platform', sdk: 'org.gnome.Sdk', runtimeVersion };
    }
    return { runtime, runtimeId: 'org.freedesktop.Platform', sdk: 'org.freedesktop.Sdk', runtimeVersion };
}

/** Default container image for the GitHub Actions workflow. */
export function defaultCiContainer(runtime: 'gnome' | 'freedesktop', runtimeVersion: string): string {
    const tag = `${runtime}-${runtimeVersion}`;
    return `ghcr.io/flathub-infra/flatpak-github-actions:${tag}`;
}
