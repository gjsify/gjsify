// Shared npmrc loader for `gjsify publish` / `gjsify whoami` / future
// auth-aware commands. Mirrors npm CLI's resolution order so a maintainer's
// `~/.npmrc` token AND a CI-injected `NPM_CONFIG_USERCONFIG` token both
// reach the registry call.
//
// Resolution order (lowest → highest precedence — last write wins on key
// collisions because the sources are concatenated and re-parsed):
//   1. globalconfig:  /etc/npmrc  (system; intentionally NOT read here —
//                     gjsify's user-facing commands operate on per-user
//                     credentials, matching `npm whoami`'s behavior)
//   2. userconfig:    $NPM_CONFIG_USERCONFIG  (overrides ~/.npmrc)
//                     or ~/.npmrc  (default)
//   3. projectconfig: ./.npmrc  (closest workspace)
//
// `actions/setup-node` writes the auth-token npmrc to $RUNNER_TEMP/.npmrc
// and exports NPM_CONFIG_USERCONFIG pointing at it — it does NOT touch
// ~/.npmrc. Honor the env var so CI authentication works end-to-end.
//
// `${VAR}` placeholders are expanded inline (npm CLI's expand-on-read
// behavior). The auth-token npmrc from actions/setup-node ships
// `_authToken=${NODE_AUTH_TOKEN}` as a literal placeholder; the env var is
// set on the publish step.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseNpmrc, type NpmrcConfig } from '@gjsify/npm-registry';

export async function loadNpmrc(cwd: string): Promise<NpmrcConfig> {
    const sources: string[] = [];
    const projectNpmrc = join(cwd, '.npmrc');
    if (existsSync(projectNpmrc)) sources.push(readFileSync(projectNpmrc, 'utf-8'));
    const userConfig = process.env.NPM_CONFIG_USERCONFIG;
    if (userConfig && existsSync(userConfig)) {
        sources.push(readFileSync(userConfig, 'utf-8'));
    } else {
        const homeNpmrc = join(homedir(), '.npmrc');
        if (existsSync(homeNpmrc)) sources.push(readFileSync(homeNpmrc, 'utf-8'));
    }
    const merged = sources
        .join('\n')
        .replace(/\$\{([A-Z_][A-Z0-9_]*)\}/gi, (_, name) => process.env[name as string] ?? '');
    return parseNpmrc(merged);
}

/**
 * True iff the parsed npmrc contains *any* `_authToken` entry. Cheap helper
 * for commands that want a clear "no token configured" error message
 * instead of a generic 401/empty response.
 */
export function hasAnyAuthToken(npmrc: NpmrcConfig): boolean {
    return Object.keys(npmrc.authTokens).length > 0;
}

/**
 * True iff the parsed npmrc has *any* credential (bearer token or basic
 * auth). Used by `gjsify whoami` to differentiate "no token configured"
 * from "token configured but rejected by the registry".
 */
export function hasAnyCredential(npmrc: NpmrcConfig): boolean {
    return hasAnyAuthToken(npmrc) || Object.keys(npmrc.basicAuth).length > 0;
}
