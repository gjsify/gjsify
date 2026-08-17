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

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Command } from '../types/index.js';
import { detectNativePackages, buildNativeEnv } from '../utils/detect-native-packages.js';
import { isOnPath } from '../utils/check-system-deps.js';
import { existsSync } from 'node:fs';
import { forceExit } from '../utils/force-exit.js';
import { nodeBinary } from '../utils/run-node.js';
import { findWorkspaceRoot } from '../utils/workspace-root.js';
import { spawnToCompletion } from '../utils/spawn.js';

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
            // `return` — the handler must not fall through and try to spawn a
            // compiler that is not there. `forceExit` and not `process.exit`
            // because the latter is idle-scheduled under GJS, and NOTHING here
            // armed a main loop to deliver it: the process would reach natural
            // shutdown and report 0 while printing the message above.
            return forceExit(1);
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

        // Run upstream `typescript` under Node — the Node fallback.
        //
        // `nodeBinary()`, NEVER a bare `process.execPath`: under the GJS bundle
        // `process.execPath` is the GJS interpreter (`/proc/self/exe` →
        // `gjs-console`), so `spawn(process.execPath, [tsc.js])` hands
        // TypeScript's CommonJS CLI to GJS, which dies on the first `module`
        // reference — or, where execPath resolves to a gjsify launcher instead,
        // re-executes the CLI with the tsc entry as an unknown argument. Both
        // were reached from a COLD tree: `@gjsify/tsc`'s `dist/tsc.gjs.mjs` is a
        // build output, and `build:infra` builds `@gjsify/create-app` (its first
        // `gjsify tsc` caller) long before `@gjsify/tsc` produces it, so the
        // fallback below is the NORMAL path there, not an edge case.
        // `run-node.ts` owns the one correct answer; every other spawn site in
        // this CLI already routes through it.
        const runNodeTsc = async (): Promise<void> => {
            const nodeBin = nodeBinary();
            // PRE-FLIGHT, deliberately NOT the spawn's `'error'` event.
            //
            // Under the GJS bundle that event is not delivered when the program
            // is missing: the handler below never runs, the command returns
            // normally, and `gjsify tsc` exits **0 in total silence** having
            // compiled nothing. Measured in CI by `tests/e2e/tsc-node-fallback`'s
            // "FAILS LOUDLY …" case, whose assertion printed an EMPTY captured
            // output — no stderr at all, so nothing had reported anything.
            //
            // Deciding it here, synchronously, is what makes the failure
            // reportable: the exit happens on the caller's own stack rather than
            // in a continuation that may never be scheduled.
            const runnable = nodeBin.includes('/') || nodeBin.includes('\\') ? existsSync(nodeBin) : isOnPath(nodeBin);
            if (!runnable) {
                console.error(
                    `gjsify tsc: the @gjsify/tsc GJS bundle is unavailable and \`${nodeBin}\` cannot be run, ` +
                        'so upstream `typescript` cannot run either.',
                );
                console.error('  Build the bundle with: gjsify workspace @gjsify/tsc build');
                console.error('  …or install Node.js so the upstream `typescript` fallback can be spawned.');
                return forceExit(1);
            }
            // `forceExit` runs from the child's own `'close'` DISPATCH, never from a
            // promise continuation — which is why this awaits a promise that only
            // ever REJECTS instead of `await`ing the completion.
            //
            // Under GJS `forceExit` ends the process by THROWING SpiderMonkey's
            // uncatchable exit exception. Thrown inside an `await` continuation that
            // exception is captured by the async machinery as a rejection rather than
            // unwinding the stack, so nothing exits — and the GLib main loop the spawn
            // armed then keeps the process alive with nothing left to quit it.
            // Measured: `gjsify tsc --version` printed `Version 6.0.3` and hung
            // forever, which in CI is a 30-minute step timeout.
            try {
                await new Promise<void>((_never, reject) => {
                    void spawnToCompletion(nodeBin, [nodeTscPath as string, ...tscArgs], {
                        completion: 'exit',
                        env,
                        onSpawn: (child) => {
                            child.on('close', (code) => forceExit(code ?? 1));
                        },
                    }).catch(reject);
                });
            } catch (err) {
                const e = err as NodeJS.ErrnoException;
                if (e.code === 'ENOENT') {
                    console.error(
                        'gjsify tsc: the @gjsify/tsc GJS bundle is unavailable and `node` is not on PATH, ' +
                            'so upstream `typescript` cannot run either.',
                    );
                    console.error('  Build the bundle with: gjsify workspace @gjsify/tsc build');
                } else {
                    console.error(`gjsify tsc (node typescript): ${e.message}`);
                }
                return forceExit(1);
            }
        };

        // Prefer GJS — the Node-free @gjsify/tsc bundle — when it resolves. If
        // `gjs` is not on PATH (ENOENT), transparently fall back to upstream
        // `typescript` under Node when available.
        if (bundlePath) {
            // A raw failed spawn (notably ENOENT when `gjs` is absent) emits BOTH
            // 'error' AND 'close', and the two raced: the 'close' handler exited
            // with the spawn errno (ENOENT → -2, surfacing as a misleading 254)
            // and pre-empted the Node fallback, so `gjsify tsc` died instead of
            // degrading to upstream tsc on a gjs-less host such as a CI runner. A
            // promise cannot both reject and resolve, so routing through
            // `spawnToCompletion` makes that race structurally impossible rather
            // than guarded by a flag.
            // Same shape, and the same reason, as `runNodeTsc` above: exit from the
            // child's `'close'` dispatch, await a promise that only rejects.
            try {
                await new Promise<void>((_never, reject) => {
                    void spawnToCompletion('gjs', ['-m', bundlePath, ...tscArgs], {
                        completion: 'exit',
                        env,
                        onSpawn: (child) => {
                            child.on('close', (code) => forceExit(code ?? 1));
                        },
                    }).catch(reject);
                });
            } catch (err) {
                const e = err as NodeJS.ErrnoException;
                if (e.code === 'ENOENT' && nodeTscPath) {
                    // No gjs on PATH — run upstream typescript under Node.
                    return await runNodeTsc();
                }
                if (e.code === 'ENOENT') {
                    console.error('gjsify tsc: `gjs` not found on PATH and no npm `typescript` fallback.');
                    console.error('  Install GJS (e.g. `dnf install gjs`), or add `typescript` to the project.');
                } else {
                    console.error(`gjsify tsc: ${e.message}`);
                }
                return forceExit(1);
            }
        } else {
            // No GJS bundle resolvable — go straight to the Node fallback.
            await runNodeTsc();
        }
    },
};
