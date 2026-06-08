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
        if (!bundlePath) {
            console.error('gjsify tsc: @gjsify/tsc is not installed.');
            console.error('  Install with: gjsify install --save-dev @gjsify/tsc');
            process.exit(1);
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

        const gjsArgs = ['-m', bundlePath, ...tscArgs];
        const child = spawn('gjs', gjsArgs, { env, stdio: 'inherit' });

        await new Promise<void>((resolvePromise) => {
            child.on('close', (code) => {
                process.exit(code ?? 1);
            });
            child.on('error', (err: NodeJS.ErrnoException) => {
                if (err.code === 'ENOENT') {
                    console.error('gjsify tsc: `gjs` not found on PATH. Install GJS (e.g. `dnf install gjs`).');
                } else {
                    console.error(`gjsify tsc: ${err.message}`);
                }
                process.exit(1);
            });
            // Never resolves naturally — process.exit() above terminates
            // the program once the child closes. The promise just keeps
            // the handler alive while gjs runs.
            void resolvePromise;
        });
    },
};
