// Shared npmrc loader for the auth-aware commands (`gjsify publish`,
// `gjsify whoami`, …), so that both a maintainer's `~/.npmrc` token and a
// CI-injected `NPM_CONFIG_USERCONFIG` token reach the registry call.
// `actions/setup-node` writes its auth-token npmrc to `$RUNNER_TEMP/.npmrc` and
// exports `NPM_CONFIG_USERCONFIG` at it — it never touches `~/.npmrc`, so
// honouring that env var is what makes CI authentication work, and `${VAR}`
// placeholders must be expanded on read (npm's own behaviour):
// `_authToken=${NODE_AUTH_TOKEN}` arrives as a literal placeholder.
//
// `/etc/npmrc` (globalconfig) is deliberately NOT read — these commands operate
// on per-user credentials, matching `npm whoami`. The remaining sources are
// concatenated and re-parsed, so LAST WRITE WINS on a key collision: appended
// project-first then user, the user/CI config overrides the project `.npmrc`,
// which is the inverse of npm's own precedence.

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
 * True iff the parsed npmrc contains *any* `_authToken` entry — lets a command
 * say "no token configured" instead of relaying a generic 401.
 */
export function hasAnyAuthToken(npmrc: NpmrcConfig): boolean {
    return Object.keys(npmrc.authTokens).length > 0;
}

/**
 * True iff the parsed npmrc has *any* credential (bearer token or basic auth).
 * `gjsify whoami` uses it to tell "no token configured" apart from "token
 * configured but rejected by the registry".
 */
export function hasAnyCredential(npmrc: NpmrcConfig): boolean {
    return hasAnyAuthToken(npmrc) || Object.keys(npmrc.basicAuth).length > 0;
}
