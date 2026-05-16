// `gjsify run <target> [args..]` — dual-mode runner.
//
//   gjsify run <file>     → existing behavior: run a GJS bundle file
//                          via `gjs -m`, with LD_LIBRARY_PATH +
//                          GI_TYPELIB_PATH set for native packages.
//   gjsify run <script>   → yarn-run-style: look up `<script>` in the
//                          current workspace's package.json `scripts`
//                          and execute it with `node_modules/.bin` on
//                          PATH (workspace + monorepo root).
//
// Phase D.5 added the script-runner side. The two modes coexist via a
// `looksLikeFile()` heuristic: anything with a path separator, JS-ish
// extension, or that resolves to an existing path on disk is treated
// as a bundle file. Everything else is a script name. Users who want
// to disambiguate can pass `./<file>` explicitly.

import { existsSync, statSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { Command } from '../types/index.js';
import { runGjsBundle } from '../utils/run-gjs.js';
import { readPackageJson } from '../utils/pkg-json-edit.js';
import { findWorkspaceRoot } from '../utils/workspace-root.js';

interface RunOptions {
    target: string;
    args: string[];
}

export const runCommand: Command<any, RunOptions> = {
    command: 'run <target> [args..]',
    description:
        'Run a script from package.json (yarn-run-style) or a GJS bundle file. If <target> resolves to a file on disk (or has a path-like prefix), it is launched via gjs with LD_LIBRARY_PATH + GI_TYPELIB_PATH set for native packages. Otherwise it is looked up in the current package.json `scripts`.',
    builder: (yargs) =>
        yargs
            .positional('target', {
                description: 'Either a script name (looked up in package.json `scripts`) or a path to a GJS bundle (e.g. dist/gjs.js).',
                type: 'string',
                demandOption: true,
            })
            .positional('args', {
                description: 'Extra arguments passed through to the script / gjs.',
                type: 'string',
                array: true,
                default: [],
            }),
    handler: async (args) => {
        const target = args.target as string;
        const extraArgs = (args.args as string[]) ?? [];

        // Script lookup wins over file detection. Without this, a bare
        // `gjsify run build` would resolve to a file when a `./build`
        // directory exists in cwd (e.g. meson's build dir from a Vala
        // prebuild) — masking the package.json's `"build": "…"` script.
        // File mode is still entered for explicit path-shaped targets
        // (`./bundle.js`, `dist/x.mjs`, `/abs/path`).
        const pkg = readPackageJson(join(process.cwd(), 'package.json'));
        const hasScript = pkg?.scripts && typeof (pkg.scripts as Record<string, unknown>)[target] === 'string';

        if (!hasScript && looksLikeFile(target)) {
            const file = resolve(target);
            await runGjsBundle(file, extraArgs);
            return;
        }

        await runScript(target, extraArgs);
    },
};

function looksLikeFile(target: string): boolean {
    if (target.startsWith('./') || target.startsWith('../') || target.startsWith('/')) return true;
    if (target.includes('/') || target.includes('\\')) return true;
    if (/\.(c?js|mjs|cjs|gjs)$/.test(target)) return true;
    // Bare names like "build" can collide with build/ directories from
    // meson/vala prebuilds — only treat as a file if it's a regular file,
    // not a directory.
    try {
        const st = statSync(target);
        return st.isFile();
    } catch { return false; }
}

/**
 * Run a script declared in the current workspace's `package.json#scripts`.
 * Mirrors `yarn run <script>` semantics:
 *   - PATH prepended with `<workspace>/node_modules/.bin` AND the
 *     monorepo-root `node_modules/.bin` (covers locally-installed bins
 *     and hoisted bins)
 *   - extra args appended after the script's literal command, shell-escaped
 *   - executed through `shell: true` so `&&` / `|` / env-var refs work
 *     exactly as in package.json scripts (matches npm/yarn)
 */
async function runScript(script: string, extraArgs: readonly string[]): Promise<void> {
    const cwd = process.cwd();
    const pkgPath = join(cwd, 'package.json');
    const pkg = readPackageJson(pkgPath);
    if (!pkg) {
        console.error(`gjsify run: no package.json in ${cwd}`);
        process.exit(1);
    }
    const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {};
    const literal = scripts[script];
    if (typeof literal !== 'string') {
        const available = Object.keys(scripts).join(', ') || '<none>';
        console.error(
            `gjsify run: no script "${script}" in ${pkgPath} (available: ${available})`,
        );
        process.exit(1);
    }

    const monorepoRoot = findWorkspaceRoot(cwd);
    const binDirs = [join(cwd, 'node_modules', '.bin')];
    if (monorepoRoot && monorepoRoot !== cwd) {
        binDirs.push(join(monorepoRoot, 'node_modules', '.bin'));
    }
    const env = {
        ...process.env,
        PATH: [...binDirs, process.env.PATH ?? ''].filter(Boolean).join(delimiter),
        npm_lifecycle_event: script,
        npm_package_name: pkg.name ?? '',
        npm_package_version: pkg.version ?? '',
    };

    const fullCmd = extraArgs.length > 0
        ? `${literal} ${extraArgs.map(shellEscape).join(' ')}`
        : literal;
    // ensureMainLoop() (called inside spawn) keeps GJS alive after the
    // child exits — without an explicit process.exit() the success path
    // would park the loop forever. The error path already exits.
    await new Promise<void>((resolveOk, reject) => {
        const child = spawn(fullCmd, [], { cwd, env, stdio: 'inherit', shell: true });
        child.on('close', (code) => {
            if (code === 0) resolveOk();
            else reject(new Error(`script "${script}" exited with code ${code}`));
        });
        child.on('error', reject);
    }).catch((err: Error) => {
        console.error(err.message);
        process.exit(1);
    });
    process.exit(0);
}

function shellEscape(arg: string): string {
    if (/^[a-zA-Z0-9_\-./=:@,]+$/.test(arg)) return arg;
    return `'${arg.replace(/'/g, "'\\''")}'`;
}
