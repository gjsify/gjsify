// Launching a browser with the dev build (ADR 0077 § 6) — through `web-ext run`,
// which loads the folder as a temporary add-on and reloads it when the folder
// changes. Firefox cannot load an unpacked extension from a command-line flag at
// all; web-ext does it over the remote debugging protocol.
//
// web-ext is a Node program. Once `gjsify exec` (ADR 0076, #1812) ships, this is
// the one place that changes: the spawn goes through it and a GJS-only host can
// run the dev loop.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { isOnPath } from '../check-system-deps.js';
import { webExtRunTarget, type WebextTarget } from './targets.js';

export interface WebExtRunOptions {
    sourceDir: string;
    target: WebextTarget;
    profile: string;
    browserBinary?: string;
    headless?: boolean;
}

/** `web-ext run` arguments. Pure, so the flag spelling per browser is pinned by a spec. */
export function webExtRunArgs(opts: WebExtRunOptions): string[] {
    const driver = webExtRunTarget(opts.target);
    if (driver === null) {
        throw new Error(
            `gjsify webext dev: web-ext cannot launch ${opts.target.browser}. Build with \`gjsify webext build ` +
                `--target ${opts.target.id}\` and load the folder by hand, or pass \`--no-launch\`.`,
        );
    }
    const args = [
        'run',
        '--source-dir',
        opts.sourceDir,
        '--target',
        driver,
        '--no-input',
        '--profile-create-if-missing',
    ];
    if (driver === 'firefox-desktop') {
        args.push('--firefox-profile', opts.profile, '--keep-profile-changes');
        if (opts.browserBinary) args.push('--firefox', opts.browserBinary);
        if (opts.headless) args.push('--arg=-headless');
    } else {
        args.push('--chromium-profile', opts.profile);
        if (opts.browserBinary) args.push('--chromium-binary', opts.browserBinary);
        if (opts.headless) args.push('--arg=--headless=new');
    }
    return args;
}

/**
 * The persistent dev profile. Persistent because a fresh profile per run loses
 * whatever the developer set up in the browser (a login, a granted permission)
 * on every restart.
 */
export function defaultDevProfile(name: string, target: WebextTarget, env: NodeJS.ProcessEnv = process.env): string {
    const cache = env.XDG_CACHE_HOME || join(homedir(), '.cache');
    return join(cache, 'gjsify', 'webext', name, target.id);
}

/** How to spawn web-ext: always the BARE name, with the environment that finds it. */
export interface WebExtCommand {
    cmd: 'web-ext';
    env: NodeJS.ProcessEnv;
}

/**
 * The `web-ext` to run: the project's own install (walking up, because a
 * workspace hoists it to the root), else one on PATH, else null.
 *
 * A project install is put on the child's PATH rather than spawned by its path:
 * on Windows it is a `.cmd` shim, Node refuses to spawn a batch file directly
 * (EINVAL, CVE-2024-27980), and `spawnToCompletion` routes only a BARE name
 * through `cmd.exe`.
 */
export function resolveWebExt(
    root: string,
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
): WebExtCommand | null {
    const leaf = platform === 'win32' ? 'web-ext.cmd' : 'web-ext';
    for (let dir = root; ; dir = dirname(dir)) {
        const bin = join(dir, 'node_modules', '.bin');
        if (existsSync(join(bin, leaf))) {
            return { cmd: 'web-ext', env: { ...env, PATH: [bin, env.PATH].filter(Boolean).join(delimiter) } };
        }
        if (dirname(dir) === dir) break;
    }
    return isOnPath('web-ext') ? { cmd: 'web-ext', env } : null;
}

export const WEB_EXT_MISSING =
    'gjsify webext dev: `web-ext` is not installed. Add it to the project (`gjsify install --save-dev web-ext`) ' +
    'or install it globally, or pass `--no-launch` to rebuild without a browser.';
