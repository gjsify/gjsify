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
// into one. See status/open-todos.md.
//
// This module MUST NOT execute anything at load time (no top-level
// `parseAsync`) — `run.ts` imports it, and a top-level run would re-dispatch
// the original argv on import.
import yargs from 'yargs';

import { classifyCliFailure } from './cli-fail.js';
import { cliVersion } from './utils/publish-headers.js';

import {
    buildCommand as build,
    clearCommand as clear,
    copyCommand as copy,
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
    shipCommand as ship,
    dlxCommand as dlx,
    installCommand as install,
    foreachCommand as foreach,
    workspaceCommand as workspace,
    packCommand as pack,
    publishCommand as publish,
    whoamiCommand as whoami,
    loginCommand as login,
    logoutCommand as logout,
    trustCommand as trust,
    onboardCommand as onboard,
    selfUpdateCommand as selfUpdate,
    generateInstallerCommand as generateInstaller,
    pruneCommand as prune,
    uninstallCommand as uninstall,
    formatCommand as format,
    lintCommand as lint,
    fixCommand as fix,
    upgradeCommand as upgrade,
    barrelsCommand as barrels,
    tscCommand as tsc,
    affectedCommand as affected,
    storybookCommand as storybook,
    devCommand as dev,
    debugCommand as debug,
    browseCommand as browse,
} from './commands/index.js';
import { APP_NAME } from './constants.js';
import { isBun, isDeno, isNode, gjsSystemVersion } from '@gjsify/rolldown-plugin-gjsify/runtime';
import { ensureGjsifyShimOnPath } from './utils/gjsify-shim.js';

// Detect which runtime is executing the CLI (GJS, Node.js, Bun or Deno) for the
// help epilogue. Bun and Deno MUST be checked before Node because both — like
// GJS's @gjsify/process shim — fake `process.versions.node` for npm
// compatibility, so a plain Node probe is a false positive on either.
function runtimeLabel(): string {
    // Off GJS `gjsSystemVersion()` RETURNS undefined (an optional-chained
    // `globalThis.imports` read, same probe as `isGjs()`) — it never throws.
    const sysVersion = gjsSystemVersion();
    if (sysVersion !== undefined) {
        const v = Number(sysVersion);
        return `GJS ${Math.floor(v / 10000)}.${Math.floor((v % 10000) / 100)}.${v % 100} (SpiderMonkey)`;
    }
    if (isBun()) {
        const version = (globalThis as { Bun?: { version?: string } }).Bun?.version ?? process.versions.bun;
        return `Bun ${version ?? ''}`.trim();
    }
    if (isDeno()) {
        const version = (globalThis as { Deno?: { version?: { deno?: string } } }).Deno?.version?.deno;
        return `Deno ${version ?? ''}`.trim();
    }
    if (isNode()) {
        return `Node.js ${process.version}`;
    }
    return 'unknown runtime';
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
    // Make a runnable `gjsify` available on PATH for child processes
    // (workspace/foreach orchestration + compound `gjsify run` scripts). TWO
    // cases, not one — the "No-op on Node" this comment used to claim stopped
    // being true when the bootstrap case landed: under GJS, so node-free builds
    // don't fall back to the Node bin; and a BOOTSTRAP CLI under Node, where the
    // tree's own `node_modules/.bin/gjsify` dangles until `build:infra` — which
    // is what a cold macOS/Windows leg runs — has produced what it dispatches to.
    ensureGjsifyShimOnPath();
    const cli = yargs(argv as string[]);
    await cli
        .scriptName(APP_NAME)
        .version(cliVersion())
        .strict()
        // Sits beside `.strict()` because that is what produces most of what it
        // classifies. See `cli-fail.ts` for the four yargs measurements this
        // depends on; the short version: `msg` is the discriminator (a handler
        // rejection is the ONE call site that passes null), registering a handler
        // removes yargs' own showHelp+exit, and the incoming error must never be
        // re-thrown as-is because yargs routes `YError` back into `fail()`.
        .fail((msg, err) => {
            const failure = classifyCliFailure(msg, err);
            if (failure.kind === 'usage') {
                cli.showHelp('error');
                // Plain Error, not `err`: re-throwing a YError re-enters fail()
                // and prints the help twice. `index.ts` prints this message.
                throw new Error(failure.message, { cause: err });
            }
            // A handler threw. Return WITHOUT printing or exiting — that is the
            // entire fix. The rejection propagates out of `parseAsync()` and
            // `index.ts`'s catch is the one printer (message, optional
            // GJSIFY_DEBUG stack, `process.exitCode = 1`, `gjsExit(1)`).
        })
        // Use the full terminal width for help (yargs caps at 80 by default).
        .wrap(cli.terminalWidth())
        .command(create.command, create.description, create.builder, create.handler)
        .command(install.command, install.description, install.builder, install.handler)
        .command(build.command, build.description, build.builder, build.handler)
        .command(clear.command, clear.description, clear.builder, clear.handler)
        .command(copy.command, copy.description, copy.builder, copy.handler)
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
        .command(ship.command, ship.description, ship.builder, ship.handler)
        .command(foreach.command, foreach.description, foreach.builder, foreach.handler)
        .command(workspace.command, workspace.description, workspace.builder, workspace.handler)
        .command(pack.command, pack.description, pack.builder, pack.handler)
        .command(publish.command, publish.description, publish.builder, publish.handler)
        .command(whoami.command, whoami.description, whoami.builder, whoami.handler)
        .command(login.command, login.description, login.builder, login.handler)
        .command(logout.command, logout.description, logout.builder, logout.handler)
        .command(trust.command, trust.description, trust.builder, trust.handler)
        .command(onboard.command, onboard.description, onboard.builder, onboard.handler)
        .command(selfUpdate.command, selfUpdate.description, selfUpdate.builder, selfUpdate.handler)
        .command(
            generateInstaller.command,
            generateInstaller.description,
            generateInstaller.builder,
            generateInstaller.handler,
        )
        .command(uninstall.command, uninstall.description, uninstall.builder, uninstall.handler)
        .command(prune.command, prune.description, prune.builder, prune.handler)
        .command(upgrade.command, upgrade.description, upgrade.builder, upgrade.handler)
        .command(format.command, format.description, format.builder, format.handler)
        .command(lint.command, lint.description, lint.builder, lint.handler)
        .command(fix.command, fix.description, fix.builder, fix.handler)
        .command(barrels.command, barrels.description, barrels.builder, barrels.handler)
        .command(tsc.command, tsc.description, tsc.builder, tsc.handler)
        .command(affected.command, affected.description, affected.builder, affected.handler)
        .command(storybook.command, storybook.description, storybook.builder, storybook.handler)
        .command(dev.command, dev.description, dev.builder, dev.handler)
        .command(debug.command, debug.description, debug.builder, debug.handler)
        .command(browse.command, browse.description, browse.builder, browse.handler)
        .demandCommand(1)
        .epilogue(`Running on ${runtimeLabel()}`)
        .help()
        .parseAsync();
}
