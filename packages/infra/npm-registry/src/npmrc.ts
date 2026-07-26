// `.npmrc` parsing + registry selection: the default registry, per-scope
// overrides, and the token/basic-auth entries the auth layer resolves against.

import type { NpmrcConfig } from './types.js';

export const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';

/** Pick the right registry URL for a package name (scoped overrides win). */
export function registryFor(name: string, npmrc: NpmrcConfig | undefined): string {
    if (npmrc && name.startsWith('@')) {
        const scope = name.slice(0, name.indexOf('/'));
        const override = npmrc.scopes[scope];
        if (override) return ensureTrailingSlash(override);
    }
    if (npmrc?.registry) return ensureTrailingSlash(npmrc.registry);
    return DEFAULT_REGISTRY;
}

/**
 * Parse a `.npmrc` text body into the subset of npm config this client needs:
 * the default registry, per-scope registry overrides, `_authToken` bearers and
 * `username` / `_password` basic-auth pairs.
 *
 * Every other key (`_auth`, `email`, `cache`, `//host/:certfile`, …) is
 * DROPPED — the result is a closed shape, not a passthrough bag. That is
 * deliberate: the parsed config is handed to `buildHeaders` / `resolveAuthForUrl`
 * and travels through error paths and verbose logs, so it must not carry
 * credential material nobody asked for.
 */
export function parseNpmrc(text: string): NpmrcConfig {
    const out: NpmrcConfig = {
        registry: DEFAULT_REGISTRY,
        scopes: {},
        authTokens: {},
        basicAuth: {},
    };
    const lines = text.split(/\r?\n/);
    const basic: Record<string, { user?: string; pass?: string }> = {};
    for (const raw of lines) {
        const line = raw.replace(/^\s+|\s+$/g, '');
        if (!line || line.startsWith('#') || line.startsWith(';')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        const value = expandEnv(stripQuotes(line.slice(eq + 1).trim()));
        if (key === 'registry') {
            out.registry = ensureTrailingSlash(value);
            continue;
        }
        const scopeRegistry = key.match(/^(@[^:]+):registry$/);
        if (scopeRegistry) {
            out.scopes[scopeRegistry[1]] = ensureTrailingSlash(value);
            continue;
        }
        const tokenMatch = key.match(/^\/\/(.+):_authToken$/);
        if (tokenMatch) {
            out.authTokens[normalizeAuthHost(tokenMatch[1])] = value;
            continue;
        }
        const userMatch = key.match(/^\/\/(.+):username$/);
        if (userMatch) {
            (basic[normalizeAuthHost(userMatch[1])] ??= {}).user = value;
            continue;
        }
        const passMatch = key.match(/^\/\/(.+):_password$/);
        if (passMatch) {
            const decoded = base64Decode(value);
            (basic[normalizeAuthHost(passMatch[1])] ??= {}).pass = decoded;
            continue;
        }
    }
    for (const [host, creds] of Object.entries(basic)) {
        if (creds.user && creds.pass !== undefined) {
            out.basicAuth[host] = { username: creds.user, password: creds.pass };
        }
    }
    return out;
}

function normalizeAuthHost(captured: string): string {
    // npm strips the trailing slash from `//host/path/:_authToken` keys so the
    // path-prefix matcher can compare host-rooted ("//host") and nested
    // ("//host/path") entries on the same axis.
    const trimmed = captured.replace(/\/+$/, '');
    return `//${trimmed}`;
}

/**
 * Normalize a registry URL to a trailing slash. Internal to the package (not
 * part of the public surface) — shared by every module that concatenates a
 * path onto a registry base.
 */
export function ensureTrailingSlash(s: string): string {
    return s.endsWith('/') ? s : s + '/';
}

function stripQuotes(s: string): string {
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    return s;
}

function expandEnv(s: string): string {
    // Handles `${VAR}` only — npm config does not support `$VAR`.
    return s.replace(/\$\{([A-Z0-9_]+)\}/gi, (_m, name: string) => {
        const env = (globalThis as { process?: { env?: Record<string, string> } }).process?.env;
        return env?.[name] ?? '';
    });
}

function base64Decode(s: string): string {
    return atob(s);
}
