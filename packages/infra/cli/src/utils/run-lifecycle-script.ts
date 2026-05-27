// Run an npm-style lifecycle script (`prepack`, `prepare`, `prepublishOnly`,
// `postpack`, `postpublish`, …) from inside a `gjsify pack` / `gjsify
// publish` flow.
//
// Why this exists separately from `gjsify run`: `gjsify run <script>` ends
// with `process.exit(<code>)` so it can be used as a CLI entrypoint that
// behaves like `yarn run` / `npm run`. That's wrong for the embedded use
// case where pack/publish needs the lifecycle script to finish, then keep
// running its own logic. This helper resolves to a Promise that settles
// when the child exits — no process.exit, no GLib-mainloop intermingling
// from `ensureMainLoop`.
//
// Matches yarn / npm script semantics:
//   - `shell: true` so `&&` / `|` / env-var refs work
//   - PATH prepended with `<wsDir>/node_modules/.bin` + monorepo-root bin
//   - `npm_lifecycle_event` / `npm_package_name` / `npm_package_version`
//     env vars set
//   - FORCE_COLOR=1 default unless caller overrides

import { spawn } from 'node:child_process';
import { delimiter, join } from 'node:path';
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
        process.env.FORCE_COLOR !== undefined || process.env.NO_COLOR !== undefined
            ? {}
            : { FORCE_COLOR: '1' };

    const env: Record<string, string | undefined> = {
        ...process.env,
        ...colorEnv,
        PATH: [...binDirs, process.env.PATH ?? ''].filter(Boolean).join(delimiter),
        npm_lifecycle_event: name,
        npm_package_name: (pkg.name as string | undefined) ?? '',
        npm_package_version: (pkg.version as string | undefined) ?? '',
        ...opts.env,
    };

    // `'inherit-stderr'` is our extension on top of node's stdio modes —
    // child stdin inherits, child stdout → parent's stderr (fd 2), child
    // stderr → parent's stderr. Used by `gjsify pack --json` so the
    // prepack's log lines don't get interleaved with the JSON we emit on
    // parent stdout. `spawn`'s `stdio` accepts numeric fds in array form
    // and routes the child's matching stream to that fd.
    const stdioConfig =
        opts.stdio === 'inherit-stderr'
            ? (['inherit', 2, 2] as const)
            : (opts.stdio ?? 'inherit');

    await new Promise<void>((resolveOk, reject) => {
        const child = spawn(literal, [], {
            cwd: wsDir,
            env: env as Record<string, string>,
            stdio: stdioConfig as Parameters<typeof spawn>[2]['stdio'],
            shell: true,
        });
        child.on('close', (code) => {
            if (code === 0) resolveOk();
            else {
                reject(
                    new Error(
                        `gjsify lifecycle-script: "${name}" in ${wsDir} exited with code ${code}`,
                    ),
                );
            }
        });
        child.on('error', reject);
    });

    return true;
}
