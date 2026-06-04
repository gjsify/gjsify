// Write/remove npm auth tokens in the user's `.npmrc` — the write side of
// `load-npmrc.ts` (which only reads). Used by `gjsify login` / `gjsify logout`.
//
// npm stores the token under a "nerf-dart" key: the registry URL with the
// protocol stripped, e.g. `//registry.npmjs.org/:_authToken=<token>`. We upsert
// exactly that line in the userconfig file (`$NPM_CONFIG_USERCONFIG` or
// `~/.npmrc`), preserving every other line, and chmod it to 0600 (it holds a
// credential).

import { existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

/** The `.npmrc` file `gjsify login` writes to (matches `load-npmrc.ts`'s userconfig source). */
export function userconfigNpmrcPath(): string {
    return process.env.NPM_CONFIG_USERCONFIG || join(homedir(), '.npmrc');
}

/**
 * The npm "nerf-dart" key for a registry: the URL with the protocol removed,
 * keeping the host + path with a trailing slash — `//registry.npmjs.org/`.
 */
export function nerfDart(registry: string): string {
    const u = new URL(registry);
    const path = u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
    return `//${u.host}${path}`;
}

/** The full `_authToken` config key for a registry. */
export function authTokenKey(registry: string): string {
    return `${nerfDart(registry)}:_authToken`;
}

function readUserconfig(path: string): string {
    return existsSync(path) ? readFileSync(path, 'utf-8') : '';
}

function writeUserconfig(path: string, content: string): void {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, content, 'utf-8');
    // Credential file — restrict to the owner (best-effort; ignored on Windows).
    try {
        chmodSync(path, 0o600);
    } catch {
        /* non-POSIX filesystem */
    }
}

/**
 * Upsert `<nerf-dart>:_authToken=<token>` in the userconfig `.npmrc`, preserving
 * all other lines. Returns the file path written.
 */
export function writeAuthToken(registry: string, token: string): string {
    const path = userconfigNpmrcPath();
    const key = authTokenKey(registry);
    const line = `${key}=${token}`;
    const existing = readUserconfig(path);
    const lines = existing.length ? existing.split('\n') : [];
    let replaced = false;
    const next = lines.map((l) => {
        // Match the key at the start of the line (ignore `${...}` placeholder
        // values too — we always overwrite with the concrete token).
        if (l.replace(/\s+/g, '').startsWith(`${key}=`)) {
            replaced = true;
            return line;
        }
        return l;
    });
    // Strip trailing blank lines so we don't accumulate them across rewrites.
    while (next.length && next[next.length - 1].trim() === '') next.pop();
    if (!replaced) next.push(line);
    writeUserconfig(path, next.join('\n') + '\n');
    return path;
}

/**
 * Remove the `<nerf-dart>:_authToken=` line for a registry from the userconfig
 * `.npmrc`. Returns `{ path, removed }` — `removed` is false if no line matched.
 */
export function removeAuthToken(registry: string): { path: string; removed: boolean } {
    const path = userconfigNpmrcPath();
    const key = authTokenKey(registry);
    const existing = readUserconfig(path);
    if (!existing) return { path, removed: false };
    const lines = existing.split('\n');
    const next = lines.filter((l) => !l.replace(/\s+/g, '').startsWith(`${key}=`));
    const removed = next.length !== lines.length;
    if (removed) writeUserconfig(path, next.join('\n'));
    return { path, removed };
}
