// Run an npm-style lifecycle script (`prepack`, `prepare`, `prepublishOnly`,
// `postpack`, `postpublish`, …) from inside a `gjsify pack` / `gjsify
// publish` flow.
//
// Why this exists separately from `gjsify run`: `gjsify run <script>` ends
// with `process.exit(<code>)` so it can be used as a CLI entrypoint that
// behaves like `yarn run` / `npm run`. That's wrong for the embedded use
// case where pack/publish needs the lifecycle script to finish, then keep
// running its own logic. This helper resolves to a Promise that settles
// when the child exits.
//
// ## Not calling `process.exit()` is what ARMED the hang, not what avoided it
//
// This header used to end "no process.exit, no GLib-mainloop intermingling
// from `ensureMainLoop`". The second half was exactly backwards, and it is why
// nobody looked here for #1010.
//
// `@gjsify/child_process`'s async `spawn()` calls `ensureMainLoop()`
// unconditionally — the caller has no say. That arms a GJS main-loop hook whose
// blocking `g_main_loop_run()` only `process.exit()` tears down. So a helper
// that spawns asynchronously and deliberately does NOT exit leaves the loop
// armed forever: `gjsify pack` on a package with a `prepack` wrote its tarball,
// printed its complete JSON, and then parked at 0% CPU until killed at 5m30s.
// A package with no lifecycle script exited in under a second, and the same
// pack under Node exited in 0.68s.
//
// `utils/spawn.ts` already owns that contract and makes every call site DECLARE
// which side of it they are on. This helper was the one spawn in the CLI that
// bypassed it — the seventh of the "six near-identical wrappers" that file was
// written to consolidate. It now goes through it with `completion: 'return'`,
// which is what "settle, then keep running our own logic" means.
//
// Matches yarn / npm script semantics:
//   - `shell: true` so `&&` / `|` / env-var refs work
//   - PATH prepended with `<wsDir>/node_modules/.bin` + monorepo-root bin
//   - `npm_lifecycle_event` / `npm_package_name` / `npm_package_version`
//     env vars set
//   - FORCE_COLOR=1 default unless caller overrides

import { delimiter, join } from 'node:path';
import { describeExit, spawnToCompletion } from './spawn.js';
import { findWorkspaceRoot } from './workspace-root.js';

export interface RunLifecycleScriptOptions {
    /** When true, do not throw on missing scripts — return `false` instead. */
    optional?: boolean;
    /**
     * Stdio inheritance for the spawned script. Default `'inherit'` so output
     * appears in the parent's terminal. Pass `'inherit-stderr'` to mirror
     * inheritance but redirect the child's stdout → parent's stderr — used by
     * `gjsify pack --json` and `gjsify publish` so the parent's stdout stays
     * a clean JSON stream (script log lines would otherwise corrupt the
     * machine-readable output that callers `JSON.parse`).
     */
    stdio?: 'inherit' | 'inherit-stderr' | 'pipe' | 'ignore';
    /** Extra environment variables layered on top of the defaults. */
    env?: Record<string, string>;
}

/**
 * Run a lifecycle script defined in `pkg.scripts[name]` from `wsDir`.
 * Returns `true` if the script existed and exited 0. Returns `false` if
 * `optional: true` and the script is missing. Throws on non-zero exit.
 */
export async function runLifecycleScript(
    wsDir: string,
    pkg: Record<string, unknown>,
    name: string,
    opts: RunLifecycleScriptOptions = {},
): Promise<boolean> {
    const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
    const literal = scripts[name];
    if (typeof literal !== 'string') {
        if (opts.optional !== false) return false;
        throw new Error(`gjsify lifecycle-script: no "${name}" in ${wsDir}/package.json`);
    }

    const monorepoRoot = findWorkspaceRoot(wsDir);
    const binDirs = [join(wsDir, 'node_modules', '.bin')];
    if (monorepoRoot && monorepoRoot !== wsDir) {
        binDirs.push(join(monorepoRoot, 'node_modules', '.bin'));
    }

    // Match yarn / npm color-forcing default — see runScript() in run.ts
    // for the full reasoning. Without this, lifecycle scripts that call
    // tools like biome / esbuild / tsc lose ANSI color in piped contexts
    // (CI logs, redirected output) because `process.stdout.isTTY` is
    // false for the spawned child.
    const colorEnv =
        process.env.FORCE_COLOR !== undefined || process.env.NO_COLOR !== undefined ? {} : { FORCE_COLOR: '1' };

    const env: Record<string, string | undefined> = {
        ...process.env,
        ...colorEnv,
        PATH: [...binDirs, process.env.PATH ?? ''].filter(Boolean).join(delimiter),
        npm_lifecycle_event: name,
        npm_package_name: (pkg.name as string | undefined) ?? '',
        npm_package_version: (pkg.version as string | undefined) ?? '',
        ...opts.env,
    };

    // `'ignore'` has no `spawnToCompletion` equivalent and no call site in the
    // tree; folding it onto `'inherit'` would silently start printing where a
    // caller asked for silence, so it is rejected rather than approximated.
    if (opts.stdio === 'ignore') {
        throw new Error('gjsify lifecycle-script: stdio "ignore" is not supported — see utils/spawn.ts');
    }

    const result = await spawnToCompletion(literal, [], {
        // The whole point of this helper: pack/publish waits for the script and
        // then keeps running. Under GJS that is the blocking path, which is what
        // keeps the armed main loop from outliving us — see the header.
        completion: 'return',
        cwd: wsDir,
        env: env as NodeJS.ProcessEnv,
        shell: true,
        stdio: opts.stdio === 'inherit-stderr' ? 'inherit-stderr' : opts.stdio === 'pipe' ? 'pipe' : 'inherit',
    });

    if (result.code !== 0) {
        throw new Error(`gjsify lifecycle-script: "${name}" in ${wsDir} exited with ${describeExit(result)}`);
    }

    return true;
}
