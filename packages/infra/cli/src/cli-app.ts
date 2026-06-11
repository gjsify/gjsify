// The gjsify CLI command surface, factored out of `index.ts` so it can be
// invoked two ways:
//   1. As the process entry point (`index.ts` → `runCli(hideBin(process.argv))`).
//   2. IN-PROCESS by `gjsify run` (`commands/run.ts`) to dispatch a script
//      that is a single `gjsify <subcommand>` WITHOUT spawning a fresh gjs.
//
// Why (2) matters: under the GJS-first default every nested `gjsify …`
// invocation is a heavyweight gjs process (startup + bundle loads). A package
// build chains ~5 of them (`foreach → npm → gjsify run build:gjsify → gjsify
// build`, and `gjsify run build:types → gjsify tsc → gjs tsc.gjs.mjs`), so on
// CI's few cores the multiplier oversubscribes and the build thrashes. Letting
// `gjsify run` dispatch the inner `gjsify <cmd>` in-process collapses two gjs
// into one. See STATUS.md.
//
// This module MUST NOT execute anything at load time (no top-level
// `parseAsync`) — `run.ts` imports it, and a top-level run would re-dispatch
// the original argv on import.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yargs from 'yargs';

import {
    buildCommand as build,
    testCommand as test,
    runCommand as run,
    infoCommand as info,
    systemCheckCommand as systemCheck,
    checkCommand as check,
    showcaseCommand as showcase,
    createCommand as create,
    gresourceCommand as gresource,
    gettextCommand as gettext,
    gsettingsCommand as gsettings,
    flatpakCommand as flatpak,
    dlxCommand as dlx,
    installCommand as install,
    foreachCommand as foreach,
    workspaceCommand as workspace,
    packCommand as pack,
    publishCommand as publish,
    whoamiCommand as whoami,
    loginCommand as login,
    logoutCommand as logout,
    selfUpdateCommand as selfUpdate,
    generateInstallerCommand as generateInstaller,
    uninstallCommand as uninstall,
    formatCommand as format,
    lintCommand as lint,
    fixCommand as fix,
    upgradeCommand as upgrade,
    barrelsCommand as barrels,
    tscCommand as tsc,
    affectedCommand as affected,
} from './commands/index.js';
import { APP_NAME } from './constants.js';

// Detect which runtime is executing the CLI (GJS or Node.js).
// GJS MUST be checked first because @gjsify/process sets
// `process.versions.node = '20.0.0'` for compatibility — a plain
// `process.versions.node` check would be a false Node positive under GJS.
function runtimeLabel(): string {
    try {
        const sys = (globalThis as { imports?: { system?: { version?: number } } }).imports?.system;
        if (sys?.version !== undefined) {
            const v = Number(sys.version);
            return `GJS ${Math.floor(v / 10000)}.${Math.floor((v % 10000) / 100)}.${v % 100} (SpiderMonkey)`;
        }
    } catch {
        /* not GJS */
    }
    if (typeof process !== 'undefined' && typeof process.versions?.node === 'string') {
        return `Node.js ${process.version}`;
    }
    return 'unknown runtime';
}

// Read the version from package.json adjacent to the bundle. yargs's
// auto-version-discovery (its `pkg-up`-driven default) doesn't reach
// through the bundled `dist/cli.gjs.mjs` path on GJS — falls back to
// "unknown". Both layouts are covered:
//   - dev (tsx, `yarn workspace`):  src/index.ts → ../package.json
//   - bundled (install -g):         dist/cli.gjs.mjs → ../package.json
function readBundleVersion(): string {
    try {
        const here = dirname(fileURLToPath(import.meta.url));
        const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
            version?: unknown;
        };
        return typeof pkg.version === 'string' ? pkg.version : 'unknown';
    } catch {
        return 'unknown';
    }
}

/**
 * Build + run the gjsify yargs command surface for the given argv (already
 * stripped of the `node`/`gjs` + script prefix — i.e. what `hideBin` returns).
 *
 * `parseAsync()` (not `.argv`) so the caller's `await` keeps the process alive
 * until command handlers finish — under GJS the script ends as soon as the
 * top-level synchronous flow does, and fire-and-forget handlers would silently
 * exit before any async work runs.
 */
export async function runCli(argv: readonly string[]): Promise<void> {
    const cli = yargs(argv as string[]);
    await cli
        .scriptName(APP_NAME)
        .version(readBundleVersion())
        .strict()
        // Use the full terminal width for help (yargs caps at 80 by default).
        .wrap(cli.terminalWidth())
        .command(create.command, create.description, create.builder, create.handler)
        .command(install.command, install.description, install.builder, install.handler)
        .command(build.command, build.description, build.builder, build.handler)
        .command(test.command, test.description, test.builder, test.handler)
        .command(run.command, run.description, run.builder, run.handler)
        .command(dlx.command, dlx.description, dlx.builder, dlx.handler)
        .command(info.command, info.description, info.builder, info.handler)
        .command(systemCheck.command, systemCheck.description, systemCheck.builder, systemCheck.handler)
        .command(check.command, check.description, check.builder, check.handler)
        .command(showcase.command, showcase.description, showcase.builder, showcase.handler)
        .command(gresource.command, gresource.description, gresource.builder, gresource.handler)
        .command(gettext.command, gettext.description, gettext.builder, gettext.handler)
        .command(gsettings.command, gsettings.description, gsettings.builder, gsettings.handler)
        .command(flatpak.command, flatpak.description, flatpak.builder, flatpak.handler)
        .command(foreach.command, foreach.description, foreach.builder, foreach.handler)
        .command(workspace.command, workspace.description, workspace.builder, workspace.handler)
        .command(pack.command, pack.description, pack.builder, pack.handler)
        .command(publish.command, publish.description, publish.builder, publish.handler)
        .command(whoami.command, whoami.description, whoami.builder, whoami.handler)
        .command(login.command, login.description, login.builder, login.handler)
        .command(logout.command, logout.description, logout.builder, logout.handler)
        .command(selfUpdate.command, selfUpdate.description, selfUpdate.builder, selfUpdate.handler)
        .command(
            generateInstaller.command,
            generateInstaller.description,
            generateInstaller.builder,
            generateInstaller.handler,
        )
        .command(uninstall.command, uninstall.description, uninstall.builder, uninstall.handler)
        .command(upgrade.command, upgrade.description, upgrade.builder, upgrade.handler)
        .command(format.command, format.description, format.builder, format.handler)
        .command(lint.command, lint.description, lint.builder, lint.handler)
        .command(fix.command, fix.description, fix.builder, fix.handler)
        .command(barrels.command, barrels.description, barrels.builder, barrels.handler)
        .command(tsc.command, tsc.description, tsc.builder, tsc.handler)
        .command(affected.command, affected.description, affected.builder, affected.handler)
        .demandCommand(1)
        .epilogue(`Running on ${runtimeLabel()}`)
        .help()
        .parseAsync();
}
