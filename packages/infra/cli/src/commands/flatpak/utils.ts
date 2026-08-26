// Shared helpers for the `gjsify flatpak <sub>` subcommand group.
//
// The runtime/SDK/finish-args half moved to `utils/flatpak-runtime.ts` when
// `gjsify ship --target flatpak` became its second caller — see that file's
// header. What is left here is what only these subcommands ask.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

/** Default container image for the GitHub Actions workflow. */
export function defaultCiContainer(runtime: 'gnome' | 'freedesktop', runtimeVersion: string): string {
    const tag = `${runtime}-${runtimeVersion}`;
    return `ghcr.io/flathub-infra/flatpak-github-actions:${tag}`;
}
