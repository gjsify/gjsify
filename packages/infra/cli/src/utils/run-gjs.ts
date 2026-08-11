// Shared utility for running a GJS bundle with native package env vars.
// Used by `gjsify run`, `gjsify dlx`, and the showcase command (via dlx).
//
// Detection runs `detectNativePackages` from two starting points and merges by package name
// (CWD shadows bundle): `process.cwd()` for native deps in the user's project, and
// `dirname(bundlePath)` for those in whatever node_modules the bundle lives in — critical for
// `gjsify dlx`, where the bundle sits under `~/.cache/gjsify/dlx/<sha>/…` and the user's CWD
// is unrelated. The bundle-side walk also catches transitive deps' typelibs.
//
// Env composition is split out as the pure `computeNativeEnvForBundle()` so the e2e tests can
// assert the env without spawning gjs.

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { detectNativePackages, buildNativeEnv, type NativeEnv } from './detect-native-packages.js';

/**
 * Pure env computation: the typelib + shared-library search paths {@link runGjsBundle} would
 * inject into the spawned `gjs`, plus the formatted prefix for the `$ …` echo. Which library
 * variable is set is host-dependent (`LD_LIBRARY_PATH` / `DYLD_LIBRARY_PATH` / `PATH`) — see
 * `buildNativeEnv`.
 */
export function computeNativeEnvForBundle(
    bundlePath: string,
    cwd: string = process.cwd(),
    inherited: Record<string, string | undefined> = process.env,
): { env: NativeEnv; envPrefix: string } {
    const resolvedBundle = resolve(bundlePath);

    const cwdPackages = detectNativePackages(cwd);
    const bundlePackages = detectNativePackages(dirname(resolvedBundle));

    const seen = new Set(cwdPackages.map((p) => p.name));
    const nativePackages = [...cwdPackages, ...bundlePackages.filter((p) => !seen.has(p.name))];

    // `inherited` feeds BOTH halves — composition and comparison. Split them and the win32
    // branch disagrees with itself: `buildNativeEnv` writes the library variable back under
    // the host's own spelling (`Path` in a stock env block), so a comparison keyed on the
    // canonical `PATH` would look up a key that is not there and call every run a change.
    const env = buildNativeEnv(nativePackages, { env: inherited });
    // Show only what this CLI actually CHANGED: `buildNativeEnv` prepends to the inherited
    // value unconditionally, so with no native packages it hands back the host's own variable
    // verbatim. Harmless on Linux, where `LD_LIBRARY_PATH` is usually unset; on Windows the
    // library variable IS `PATH`, never empty, so every run printed a ~2 kB dump of the host
    // PATH in front of a command the user is invited to copy.
    const envPrefix = Object.entries(env)
        .filter(([key, value]) => value !== undefined && value !== '' && value !== inherited[key])
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');

    return { env, envPrefix };
}

/**
 * Options for {@link runGjsBundle}, which runs a GJS bundle with `GI_TYPELIB_PATH` and the
 * host's library variable set for any native gjsify packages discoverable from the CWD or the
 * bundle's own node_modules tree.
 */
export interface RunGjsBundleOptions {
    /**
     * Exit this process with code 0 once the child succeeds. Under GJS, `ensureMainLoop()`
     * (armed by spawn) keeps the parent's GLib loop alive after the child exits, so a TERMINAL
     * caller (`gjsify run <file>`, `dlx`) must opt in or it parks forever — this gap hung CI's
     * WebGL conformance job for 83 min on a suite that finished in 1.35 s. Callers that
     * continue after the bundle (`gjsify test`'s multi-runtime loop) MUST leave this false; an
     * unconditional exit truncated `gjsify test` after the first gjs bundle.
     */
    exitOnSuccess?: boolean;
    /**
     * Suppress the `$ <env> gjs -m …` echo. Worth its ~2 kB of env prefix for a one-shot
     * `gjsify run <bundle>`; pure noise for a build script invoked a dozen times per chain
     * (`utils/node-script.ts`).
     */
    quiet?: boolean;
}

export async function runGjsBundle(
    bundlePath: string,
    extraArgs: string[] = [],
    options: RunGjsBundleOptions = {},
): Promise<void> {
    const { env: nativeEnv, envPrefix } = computeNativeEnvForBundle(bundlePath);

    const env = {
        ...process.env,
        ...nativeEnv,
    };

    const gjsArgs = ['-m', bundlePath, ...extraArgs];

    // Echo the exact command so users can copy-paste it and run gjs without the wrapper.
    // stderr, so children speaking a protocol on stdout (an MCP stdio server) keep a clean one.
    const gjsCommand = ['gjs', ...gjsArgs.map((a) => (a.includes(' ') ? `"${a}"` : a))].join(' ');
    if (!options.quiet) console.error(`$ ${envPrefix ? `${envPrefix} ` : ''}${gjsCommand}`);

    const child = spawn('gjs', gjsArgs, { env, stdio: 'inherit' });

    let failed = false;
    // The CHILD's own exit code, re-raised verbatim; a spawn error (no `gjs` on PATH) has none
    // of its own and falls back to 1. Collapsing every failure to 1 lost information callers
    // act on — a chain reading `$?` to tell "tool failed" from "tool says no" saw 1 for both.
    let childCode = 1;
    await new Promise<void>((resolvePromise, reject) => {
        child.on('close', (code) => {
            if (code !== 0) {
                childCode = code ?? 1;
                reject(new Error(`gjs exited with code ${code}`));
            } else {
                resolvePromise();
            }
        });
        child.on('error', reject);
    }).catch((err) => {
        console.error(err.message);
        failed = true;
    });
    if (failed) {
        // Set `process.exitCode` synchronously BEFORE exiting: under GJS `process.exit()` is
        // deferred (the GLib main loop is armed), so under run.ts's in-process script dispatch
        // execution returns to the caller, which propagates by reading `process.exitCode`.
        // Without it, `gjsify run <script>` wrapping `gjsify run <bundle>` swallowed a non-zero
        // gjs exit and returned 0 — masking a failing `test:gjs` in the `test` chain, and via
        // `gjsify foreach test` in CI. The `return` guards a fall-through second `exit`.
        process.exitCode = childCode;
        return process.exit(childCode);
    }
    // See RunGjsBundleOptions.exitOnSuccess — terminal callers opt in,
    // mid-flow callers (test.ts's runtime loop) keep the process alive.
    if (options.exitOnSuccess) return process.exit(0);
}
