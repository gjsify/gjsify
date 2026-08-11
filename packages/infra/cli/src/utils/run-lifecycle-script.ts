// Run an npm-style lifecycle script (`prepack`, `prepare`, `prepublishOnly`,
// `postpack`, `postpublish`, …) from inside a `gjsify pack` / `gjsify
// publish` flow.
//
// Separate from `gjsify run` because that ends with `process.exit(<code>)` so it can act as a
// CLI entrypoint like `yarn run`. Pack/publish instead needs the lifecycle script to finish and
// then keep running its own logic, so this settles a Promise when the child exits.
//
// NOT calling `process.exit()` is what ARMS a hang, not what avoids it (#1010):
// `@gjsify/child_process`'s async `spawn()` calls `ensureMainLoop()` unconditionally — the
// caller has no say — and that main-loop hook's blocking `g_main_loop_run()` is torn down only
// by `process.exit()`. A helper that spawns asynchronously and deliberately does not exit
// therefore leaves the loop armed forever: `gjsify pack` on a package with a `prepack` wrote
// its tarball, printed its complete JSON, then parked at 0% CPU until killed at 5m30s (no
// lifecycle script: under a second; the same pack under Node: 0.68s). `utils/spawn.ts` owns
// that contract and makes every call site DECLARE which side of it it is on; this goes through
// it with `completion: 'return'`.
//
// Matches yarn / npm script semantics:
//   - `shell: true` so `&&` / `|` / env-var refs work
//   - PATH prepended with `<wsDir>/node_modules/.bin` + monorepo-root bin
//   - `npm_lifecycle_event` / `npm_package_name` / `npm_package_version` set
//   - FORCE_COLOR=1 default unless caller overrides

import { delimiter, join } from 'node:path';
import { describeExit, spawnToCompletion } from './spawn.js';
import { findWorkspaceRoot } from './workspace-root.js';

export interface RunLifecycleScriptOptions {
    /** When true, do not throw on missing scripts — return `false` instead. */
    optional?: boolean;
    /**
     * Stdio for the spawned script; default `'inherit'`. `'inherit-stderr'` redirects the
     * child's stdout → parent's stderr, used by `gjsify pack --json` and `gjsify publish` so
     * script log lines cannot corrupt the JSON stream callers `JSON.parse`.
     */
    stdio?: 'inherit' | 'inherit-stderr' | 'pipe' | 'ignore';
    /** Extra environment variables layered on top of the defaults. */
    env?: Record<string, string>;
}

/**
 * Run the lifecycle script `pkg.scripts[name]` from `wsDir`. `true` when it existed and exited
 * 0, `false` when it is missing and `optional` is set; throws on a non-zero exit.
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

    // Match yarn / npm color-forcing — see `runScript()` in run.ts. Without it, scripts calling
    // biome / esbuild / tsc lose ANSI color in piped contexts (CI logs, redirected output)
    // because `process.stdout.isTTY` is false for the spawned child.
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

    // `'ignore'` has no `spawnToCompletion` equivalent and no call site; folding it onto
    // `'inherit'` would start printing where a caller asked for silence, so it is rejected
    // rather than approximated.
    if (opts.stdio === 'ignore') {
        throw new Error('gjsify lifecycle-script: stdio "ignore" is not supported — see utils/spawn.ts');
    }

    const result = await spawnToCompletion(literal, [], {
        // pack/publish waits for the script, then keeps running. Under GJS that is the blocking
        // path, which is what keeps the armed main loop from outliving us — see the header.
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
