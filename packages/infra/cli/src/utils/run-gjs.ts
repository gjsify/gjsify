// Shared utility for running a GJS bundle with native package env vars.
// Used by `gjsify run`, `gjsify dlx`, and the showcase command (via dlx).
//
// Detection runs the same exhaustive node_modules walker (`detectNativePackages`)
// from two starting points and merges by package name (CWD shadows bundle):
//
//   1. process.cwd()          — picks up native deps in the user's project
//                               (yarn / pnpm / npm node_modules walking up).
//   2. dirname(bundlePath)    — picks up native deps in whatever node_modules
//                               the bundle lives in. Critical for `gjsify dlx`
//                               where the bundle resides in
//                               `~/.cache/gjsify/dlx/<sha>/.../node_modules/<pkg>/dist/`
//                               and the user's CWD is unrelated. The bundle-side
//                               walk also catches transitive deps' typelibs.
//
// Env composition is split out as `computeNativeEnvForBundle()` — a pure
// function that takes a bundle path + cwd and returns the env it would inject.
// This lets the e2e tests assert the env without spawning gjs.

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { detectNativePackages, buildNativeEnv, type NativeEnv } from './detect-native-packages.js';

/**
 * Pure env computation for a given bundle. Returns the typelib +
 * shared-library search paths that {@link runGjsBundle} would inject into the
 * spawned `gjs` process, plus the formatted env-prefix string used for the
 * `$ …` echo. Which library variable is set is host-dependent
 * (`LD_LIBRARY_PATH` / `DYLD_LIBRARY_PATH` / `PATH`) — see `buildNativeEnv`.
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

    // `inherited` feeds BOTH halves — the composition and the comparison. Split
    // them and the win32 branch disagrees with itself: `buildNativeEnv` writes
    // the library variable back under the host's own spelling (`Path` in a
    // stock env block), so a comparison keyed on the canonical `PATH` would
    // look up a key that is not there and call every run a change.
    const env = buildNativeEnv(nativePackages, { env: inherited });
    // Show only what this CLI actually CHANGED. `buildNativeEnv` prepends the
    // detected directories to the inherited value and returns the result
    // unconditionally, so with no native packages it hands back the host's own
    // variable verbatim — and the echo then claimed the CLI had set it.
    //
    // Harmless on Linux, where `LD_LIBRARY_PATH` is usually unset and the empty
    // filter caught it. On Windows the library variable IS `PATH`, which is
    // never empty, so every run printed a ~2 kB dump of the host PATH in front
    // of a command the user is invited to copy — burying the command, and
    // claiming a change that never happened. Comparing against the inherited
    // value is what makes the echo honest on both.
    const envPrefix = Object.entries(env)
        .filter(([key, value]) => value !== undefined && value !== '' && value !== inherited[key])
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');

    return { env, envPrefix };
}

/**
 * Run a GJS bundle, automatically setting LD_LIBRARY_PATH and GI_TYPELIB_PATH
 * for any installed native gjsify packages discoverable from either the CWD
 * or the bundle's own node_modules tree.
 */
export interface RunGjsBundleOptions {
    /**
     * Exit this process with code 0 once the child succeeds. Under GJS,
     * `ensureMainLoop()` (armed by spawn) keeps the parent's GLib loop alive
     * after the child exits — a TERMINAL caller (`gjsify run <file>`, `dlx`)
     * must opt in here or it parks forever (this exact gap hung CI's
     * "Test WebGL conformance" for 83 min: the suite finished in 1.35 s, the
     * parent `gjsify run conformance.gjs.js` never exited). Callers that
     * continue after the bundle (e.g. `gjsify test`'s multi-runtime
     * aggregation loop) MUST leave this false — an unconditional exit here
     * truncated `gjsify test` after the first gjs bundle.
     */
    exitOnSuccess?: boolean;
    /**
     * Suppress the `$ <env> gjs -m …` echo. The echo exists so a user can
     * copy-paste the exact command, which is worth ~2 kB of env prefix for a
     * one-shot `gjsify run <bundle>` — and is pure noise for a build script the
     * chain invokes a dozen times (`utils/node-script.ts`).
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

    // Print the exact command being executed so users can copy-paste it to
    // run gjs directly without the wrapper. Env vars are only shown if we
    // actually set any (i.e. native gjsify packages were detected).
    // Use stderr so that children speaking a protocol on stdout (e.g. an
    // MCP stdio server) receive an uncontaminated stdout stream.
    const gjsCommand = ['gjs', ...gjsArgs.map((a) => (a.includes(' ') ? `"${a}"` : a))].join(' ');
    if (!options.quiet) console.error(`$ ${envPrefix ? `${envPrefix} ` : ''}${gjsCommand}`);

    const child = spawn('gjs', gjsArgs, { env, stdio: 'inherit' });

    let failed = false;
    // The CHILD's own exit code, so it can be re-raised verbatim. A spawn error
    // (no `gjs` on PATH) has no code of its own and falls back to 1.
    //
    // Collapsing every failure to 1 lost information a caller acts on: a script
    // run through `gjsify run --node-script` reports ITS status (the bootstrap
    // scripts all end `process.exit(r.status ?? 1)`, forwarding a child's code),
    // and a chain that reads `$?` to distinguish "tool failed" from "tool says
    // no" saw the same 1 for both.
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
        // Set `process.exitCode` synchronously BEFORE exiting: under GJS
        // `process.exit()` is deferred (the GLib main loop is armed), so when
        // this runs via run.ts's in-process script dispatch, execution returns
        // to the caller, which propagates by reading `process.exitCode`. Without
        // this, `gjsify run <script>` whose body is `gjsify run <bundle>`
        // swallowed a non-zero gjs exit and returned 0 — masking a failing
        // `test:gjs` in the `test` script chain (and, via `gjsify foreach test`,
        // in CI). The `return` guards against a fall-through second `exit`.
        process.exitCode = childCode;
        return process.exit(childCode);
    }
    // See RunGjsBundleOptions.exitOnSuccess — terminal callers opt in,
    // mid-flow callers (test.ts's runtime loop) keep the process alive.
    if (options.exitOnSuccess) return process.exit(0);
}
