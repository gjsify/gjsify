// `gjsify tsc [tscArgs..]` — Run the TypeScript compiler under GJS via the
// committed `@gjsify/tsc` bundle (`@gjsify/tsc/bundle` → `dist/tsc.gjs.mjs`).
//
// Thin delegator: resolves the bundle path through `createRequire` anchored
// at the workspace root (falling back to cwd), then spawns
// `gjs -m <bundle> [tscArgs..]` with LD_LIBRARY_PATH + GI_TYPELIB_PATH set
// for any installed native gjsify packages (mirrors `gjsify run` exactly).
// Forwards the child's exit code so CI/scripts see real tsc semantics.
//
// Equivalent to invoking the `gjsify-tsc` bin from the @gjsify/tsc package
// directly — this command just spares the user from having to discover the
// bin path or remember the bare package name.
//
// @gjsify/tsc is a runtime dependency of @gjsify/cli (declared in
// package.json) so the resolve below succeeds out of the box for any
// `gjsify install`-managed workspace. The install-hint branch only fires
// if the dep was removed or the consumer is running a forked CLI.
//
// Reference: packages/infra/cli/src/commands/run.ts (env-setup precedent).

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Command } from '../types/index.js';
import { detectNativePackages, buildNativeEnv } from '../utils/detect-native-packages.js';
import { findWorkspaceRoot } from '../utils/workspace-root.js';

interface TscOptions {
    tscArgs: string[];
}

export const tscCommand: Command<unknown, TscOptions> = {
    command: 'tsc [tscArgs..]',
    description:
        'Run TypeScript compiler (tsc) under GJS via the @gjsify/tsc bundle. All arguments are passed through to tsc. Equivalent to `gjsify-tsc <args>` from the @gjsify/tsc bin.',
    builder: (yargs) =>
        // Pass-through subcommand: tsc owns the entire flag namespace
        // (`--version`, `--help`, `--noEmit`, `-p`, …). Disable yargs's
        // built-in `--version` / `--help` for this command so they don't
        // intercept tsc's own flags (without this, `gjsify tsc --version`
        // would print the gjsify CLI version instead of tsc's). Treat any
        // unknown option as a positional so EVERY flag flows through to
        // `tscArgs`.
        yargs
            .parserConfiguration({
                'unknown-options-as-args': true,
            })
            .version(false)
            .help(false)
            .positional('tscArgs', {
                description: 'Arguments forwarded verbatim to tsc (e.g. `--version`, `-p tsconfig.json`).',
                type: 'string',
                array: true,
                default: [],
            }),
    handler: async (args) => {
        // `unknown-options-as-args` parks unrecognised flags in `args._`
        // (yargs's positional-overflow channel) — `args.tscArgs` only
        // captures bare positionals, not pass-through flags. `_[0]` is
        // the command name (`tsc`), strip it; the rest is forwarded
        // verbatim, preserving the original flag order.
        const overflow = ((args._ as (string | number)[]) ?? []).slice(1).map(String);
        const explicit = (args.tscArgs as string[]) ?? [];
        // When `_` has anything beyond the command name, it already
        // includes both flags AND any bare positionals in the original
        // order — use it directly. Fall back to the explicit positional
        // array for the args-free invocation.
        const tscArgs = overflow.length > 0 ? overflow : explicit;

        const cwd = process.cwd();
        // Anchor resolution at the workspace root so a sub-package `cwd`
        // (e.g. `packages/web/fetch`) still finds the hoisted `@gjsify/tsc`
        // at the root's `node_modules`. Falls back to cwd for standalone
        // (non-monorepo) projects that have the package locally.
        // Resolve `@gjsify/tsc/bundle` from two anchors, in order:
        //   1. the consumer's workspace root / cwd (the normal install — a
        //      project that has `@gjsify/tsc` as a dev dependency), then
        //   2. the running CLI bundle's own location (`import.meta.url`).
        // Anchor 2 is what makes a *bundled* gjsify (the Flatpak SDK
        // extension's `node_modules/@gjsify/tsc`, or any install where the CLI
        // ships its own toolchain) resolve `@gjsify/tsc` even when the consumer
        // project has none — mirroring how `bundler-pick.ts` dual-anchors the
        // native bridges at cwd AND the bundle.
        const anchorDir = findWorkspaceRoot(cwd) ?? cwd;
        const anchors = [pathToFileURL(`${anchorDir}/__gjsify_tsc__.js`).href, import.meta.url];

        let bundlePath: string | undefined;
        for (const anchor of anchors) {
            try {
                bundlePath = createRequire(anchor).resolve('@gjsify/tsc/bundle');
                break;
            } catch {
                // try the next anchor
            }
        }

        // Node fallback: upstream npm `typescript`'s CLI (`lib/tsc.js`),
        // resolved from the same anchors. gjsify tsc is GJS-first — the
        // @gjsify/tsc bundle is the Node-free path — but it stays runnable
        // under Node: on a machine with no `gjs`, it transparently spawns
        // upstream `typescript`. Mirrors how `bundler-pick.ts` falls back to
        // npm `rolldown` off GJS, so "both with both" holds for the type-gate.
        let nodeTscPath: string | undefined;
        for (const anchor of anchors) {
            try {
                nodeTscPath = join(dirname(createRequire(anchor).resolve('typescript/package.json')), 'lib', 'tsc.js');
                break;
            } catch {
                // try the next anchor
            }
        }

        if (!bundlePath && !nodeTscPath) {
            console.error('gjsify tsc: neither @gjsify/tsc (GJS bundle) nor npm `typescript` (Node) is installed.');
            console.error('  Install with: gjsify install --save-dev @gjsify/tsc   (or add `typescript`).');
            // `return` — a bare `process.exit()` is deferred under GJS and the
            // handler would try to spawn a compiler that is not there.
            return process.exit(1);
        }

        // Mirror `gjsify run`'s native-env composition so any future
        // typescript-the-bundle code path that reaches a native bridge
        // (today: none — tsc itself is pure JS) still finds the right
        // typelibs. Costs ~one fs scan per invocation, same as run.
        const nativePackages = detectNativePackages(cwd);
        const nativeEnv = buildNativeEnv(nativePackages);

        const env = {
            ...process.env,
            ...nativeEnv,
        };

        // Run upstream `typescript` under this Node — the Node-only fallback.
        const runNodeTsc = (): void => {
            const child = spawn(process.execPath, [nodeTscPath as string, ...tscArgs], { env, stdio: 'inherit' });
            child.on('close', (code) => process.exit(code ?? 1));
            child.on('error', (err: NodeJS.ErrnoException) => {
                console.error(`gjsify tsc (node typescript): ${err.message}`);
                process.exit(1);
            });
        };

        // Prefer GJS — the Node-free @gjsify/tsc bundle — when it resolves. If
        // `gjs` is not on PATH (ENOENT), transparently fall back to upstream
        // `typescript` under Node when available.
        if (bundlePath) {
            // A failed spawn (notably ENOENT when `gjs` is absent) emits BOTH
            // 'error' AND 'close'. The 'error' handler owns the outcome (Node
            // fallback or a clear exit), so the 'close' handler must NOT also
            // exit — otherwise it races and exits with the spawn errno (e.g.
            // ENOENT → -2), which surfaced as a misleading 254 and pre-empted the
            // fallback (gjsify tsc died instead of degrading to upstream tsc on a
            // gjs-less host such as a CI runner).
            let gjsSpawnFailed = false;
            const child = spawn('gjs', ['-m', bundlePath, ...tscArgs], { env, stdio: 'inherit' });
            await new Promise<void>((resolvePromise) => {
                child.on('close', (code) => {
                    if (gjsSpawnFailed) return;
                    process.exit(code ?? 1);
                });
                child.on('error', (err: NodeJS.ErrnoException) => {
                    gjsSpawnFailed = true;
                    if (err.code === 'ENOENT' && nodeTscPath) {
                        // No gjs on PATH — run upstream typescript under Node.
                        runNodeTsc();
                    } else if (err.code === 'ENOENT') {
                        console.error('gjsify tsc: `gjs` not found on PATH and no npm `typescript` fallback.');
                        console.error('  Install GJS (e.g. `dnf install gjs`), or add `typescript` to the project.');
                        process.exit(1);
                    } else {
                        console.error(`gjsify tsc: ${err.message}`);
                        process.exit(1);
                    }
                });
                // Never resolves naturally — process.exit() above terminates the
                // program once the child closes. The promise just keeps the
                // handler alive while the child runs.
                void resolvePromise;
            });
        } else {
            // No GJS bundle resolvable — go straight to the Node fallback.
            runNodeTsc();
        }
    },
};
